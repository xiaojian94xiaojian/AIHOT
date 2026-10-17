// 备份桶的保留策略：日备 7 天、周备 4 周、月备 6 个月。
//
// 为什么不直接配桶的 lifecycle：Cloudflare R2 的 lifecycle 接口要 Admin 权限的 token，
// 现在这把（DB_BACKUP_STORE_*）只有对象读写，`GET ?lifecycle` 返回 403；但列表与删除都有权限，
// 所以每天在备份（04:10）之后自己列一遍、删掉过期的对象。只动 daily/、weekly/、monthly/ 三个前缀，
// 不认识的前缀一律不碰。
import { createHash } from "node:crypto";
import { backupStore, signV4, type Store } from "@aihot/backend/operations/backup";

/** 保留期（天）。周备是每周日的副本，4 周；月备是每月 1 号的副本，6 个月。 */
export const KEEP_DAYS: Record<string, number> = { daily: 7, weekly: 28, monthly: 180 };

const EMPTY_HASH = createHash("sha256").update("").digest("hex");
const DAY = 86_400_000;

/** 只按前缀和最后修改时间判断；没有前缀或前缀不在策略里的键一律不删。 */
export function expired(key: string, lastModified: string | Date, now: number): boolean {
  const slash = key.indexOf("/");
  if (slash <= 0) return false;
  const days = KEEP_DAYS[key.slice(0, slash)];
  if (!days) return false;
  const at = lastModified instanceof Date ? lastModified.getTime() : Date.parse(lastModified);
  return Number.isFinite(at) && now - at > days * DAY;
}

interface StoredObject {
  key: string;
  lastModified: Date;
}

async function listAll(store: Store): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | undefined;
  do {
    const url = new URL(store.endpoint(""));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);
    const res = await fetch(url, {
      headers: signV4({ method: "GET", url, region: store.region, accessKey: store.secretId, secretKey: store.secretKey, payloadHash: EMPTY_HASH }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`备份桶列举失败：HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1];
      const at = /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1];
      if (key && at && Number.isFinite(Date.parse(at))) out.push({ key, lastModified: new Date(at) });
    }
    token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
  } while (token);
  return out;
}

async function remove(store: Store, key: string): Promise<boolean> {
  const url = new URL(store.endpoint(key));
  const res = await fetch(url, {
    method: "DELETE",
    headers: signV4({ method: "DELETE", url, region: store.region, accessKey: store.secretId, secretKey: store.secretKey, payloadHash: EMPTY_HASH }),
    signal: AbortSignal.timeout(60_000),
  });
  return res.ok || res.status === 404;
}

export interface RotationResult {
  /** 桶里看过的对象数。 */
  scanned: number;
  deleted: string[];
  failed: string[];
}

/** 跑一轮保留策略。`store` 可注入（测试用本地桩），默认读环境里的备份桶配置。 */
export async function rotate(opts: { now?: number; store?: Store | null } = {}): Promise<RotationResult> {
  const store = opts.store === undefined ? backupStore() : opts.store;
  if (!store) return { scanned: 0, deleted: [], failed: [] };
  const now = opts.now ?? Date.now();
  const objects = await listAll(store);
  const result: RotationResult = { scanned: objects.length, deleted: [], failed: [] };
  for (const object of objects.filter((o) => expired(o.key, o.lastModified, now))) {
    if (await remove(store, object.key)) result.deleted.push(object.key);
    else result.failed.push(object.key);
  }
  return result;
}
