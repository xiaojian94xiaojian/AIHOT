// 撤回传播与保留作业：卡片离开 notes/ 进 archive/，archive/ 里的过期文件真删。
//
// 两件事共用一条路径：`syncNote` 负责「这张卡片现在该在哪、该写什么」（含换月换目录），
// `withdrawCards` 负责「读取层说这条不再公开了，把它移走」。保留作业兜底清理过期精选卡与 archive/。
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "@aihot/backend/db";
import { archiveDir, archiveNote, inboxDir, kbRoot, noteFile, notesDir, writeNote, type NoteFrontmatter, type NoteKind, type ReportCardKind } from "./layout.ts";
import { kbConfig } from "./config.ts";
import { loadIndex, saveIndex, sha256, type IndexedNote } from "./read.ts";

/** archive/ 里的卡片留 7 天再真删（KB-PLAN.md §3）。 */
export const ARCHIVE_DAYS = 7;

export type SyncAction = "unchanged" | "written" | "moved";

export interface SyncNoteInput {
  /** 卡片现在应该在的相对路径。 */
  relPath: string;
  /** 渲染好的完整笔记文本（frontmatter + 正文）。 */
  text: string;
  /** 上一份索引里这张卡片的记录；没有就是新卡片。 */
  prior: IndexedNote | null;
  frontmatter: NoteFrontmatter;
  kind: NoteKind;
  now: Date;
}

/**
 * 让磁盘上这张卡片等于 `text`，路径等于 `relPath`。
 *
 * - 内容和位置都没变：不动文件（幂等，mtime 也不变）。
 * - 位置变了（事件卡换月）：先把旧文件移进 archive/，再写新的。旧文件不直接删，
 *   免得索引还没来得及更新就有人按旧路径读。
 * - 内容变了：覆盖同一个文件（同目录 rename 是原子的，读的人看不到半成品）。
 */
export async function syncNote(input: SyncNoteInput): Promise<SyncAction> {
  const hash = sha256(input.text);
  const prior = input.prior;
  // 内容与位置都还是索引记的那一份：跳过写盘，文件（含 mtime）一个字节都不动。
  if (prior && prior.sha256 === hash && prior.path === input.relPath) return "unchanged";
  // 位置变了（事件卡换月）：旧文件移进 archive/，再写新的。旧文件不直接删，
  // 免得索引还没来得及更新就有人按旧路径读。
  if (prior) await archiveNote(prior.path, input.now);
  await writeNote(input.relPath, input.text);
  return prior ? "moved" : "written";
}

export interface WithdrawResult {
  /** 移进 archive/ 的卡片 id。 */
  archived: string[];
}

/** 一条不公开的报道：事件卡按公开 id 命名，撤回时按它认卡片。 */
export interface WithdrawnStory {
  publicId: string;
}

/**
 * 撤回传播：这些卡片不再公开（报道被撤回、事件被合并、当期报告重写），把它们移进 archive/ 并更新索引。
 * 只按索引认卡片 —— 索引里有、文件也在，才移得动；移不动的跳过不报错，
 * 因为保留作业每天兜底扫一遍 archive/ 与 notes/。
 * 真正还公开的内容由下一次导出照常写回来。
 */
export async function withdrawByIds(ids: readonly string[], now = new Date()): Promise<WithdrawResult> {
  const index = await loadIndex();
  if (!index) return { archived: [] };
  const wanted = new Set(ids);
  const archived: string[] = [];
  const kept: IndexedNote[] = [];
  for (const note of index.notes) {
    if (!wanted.has(note.id)) {
      kept.push(note);
      continue;
    }
    if (await archiveNote(note.path, now)) archived.push(note.id);
  }
  if (archived.length) await saveIndex({ ...index, notes: kept, counts: countsOf(kept) });
  return { archived };
}

/** 事件卡的前缀 + 公开 id，就是它的卡片 id（cards.ts 的 cardId 用同一套）。 */
export function eventCardId(publicId: string): string {
  return `kb-event-${publicId}`;
}

/** 报告卡的 id：`kb-report-<daily|weekly|monthly>-<key>`。 */
export function reportCardIdOf(kind: ReportCardKind, key: string): string {
  return `kb-report-${kind}-${key}`;
}

export interface RetentionResult {
  /** 过期删掉的精选卡数。 */
  deletedItems: number;
  /** archive/ 里超过保留期、真删掉的文件数。 */
  deletedArchived: number;
  /** inbox/ 里遗留的临时文件数（正常为 0）。 */
  clearedInbox: number;
}

/**
 * 保留作业（框架的 ops.retention 每天调一次）：
 * 精选卡按 KB_ITEM_RETENTION_DAYS 过期删除（事件卡与报告卡长期保留），archive/ 里超过 7 天的真删，
 * inbox/ 兜底清空。删完顺手更新索引，索引与磁盘因此始终一致。
 */
export async function kbRetention(now = new Date()): Promise<RetentionResult> {
  const index = await loadIndex();
  const cutoff = now.getTime() - kbConfig().itemRetentionDays * 86_400_000;
  let deletedItems = 0;
  const kept: IndexedNote[] = [];
  for (const note of index?.notes ?? []) {
    if (note.kind === "item" && Date.parse(note.created_at) < cutoff) {
      await rm(noteFile(note.path), { force: true });
      deletedItems += 1;
      continue;
    }
    kept.push(note);
  }
  if (index && deletedItems) await saveIndex({ ...index, notes: kept, counts: countsOf(kept) });
  const deletedArchived = await removeOlderThan(archiveDir(), ARCHIVE_DAYS * 86_400_000, now.getTime());
  const clearedInbox = await clearDir(inboxDir());
  await mkdir(kbRoot(), { recursive: true });
  await mkdir(path.join(kbRoot(), "notes"), { recursive: true });
  return { deletedItems, deletedArchived, clearedInbox };
}

/**
 * 一条报道被撤回或改小（`articleChanged`，含 `reduced`）：受影响的事件卡离开 notes/。
 * 事件卡的 id 用公开 id，而钩子给的是数字 story id，所以这里换一次（stories 主键，很轻）。
 * 真正还公开的事件由下一次导出照常写回来。
 */
export async function withdrawStories(storyIds: readonly number[], now = new Date()): Promise<WithdrawResult> {
  const wanted = storyIds.filter((id) => Number.isSafeInteger(id));
  if (!wanted.length) return { archived: [] };
  const rows = await sql<{ public_id: string }[]>`SELECT public_id::text FROM stories WHERE id = ANY(${wanted}::bigint[])`;
  return withdrawByIds(rows.map((r) => eventCardId(r.public_id)), now);
}

/** 报告被重新发布或改写：当期报告卡重做，所以先把它们移走，由下一次导出重写。 */
export async function withdrawnReports(keys: readonly { kind: ReportCardKind; key: string }[], now = new Date()): Promise<WithdrawResult> {
  return withdrawByIds(keys.map((k) => reportCardIdOf(k.kind, k.key)), now);
}

function countsOf(notes: readonly IndexedNote[]): Record<string, number> {
  const counts: Record<string, number> = { event: 0, report: 0, item: 0 };
  for (const note of notes) counts[note.kind] = (counts[note.kind] ?? 0) + 1;
  return counts;
}

/** 删掉 `dir` 下（含子目录）最后修改早于 `maxAgeMs` 的文件。 */
async function removeOlderThan(dir: string, maxAgeMs: number, now: number): Promise<number> {
  let removed = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += await removeOlderThan(file, maxAgeMs, now);
      await rm(file, { recursive: false, force: true }).catch(() => {});
      continue;
    }
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > maxAgeMs) {
      await rm(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/** 清空一个目录里的文件（inbox/ 只放临时文件，正常每次导出结束都是空的）。 */
async function clearDir(dir: string): Promise<number> {
  const entries = await readdir(dir).catch(() => []);
  for (const name of entries) await rm(path.join(dir, name), { recursive: true, force: true });
  return entries.length;
}

/** 导出结束后清一次 inbox/：正常它本来就该是空的，这一步只是不给残留留机会。 */
export async function resetInbox(): Promise<number> {
  return clearDir(inboxDir());
}

/**
 * 清掉导出不再认的卡片文件。
 *
 * 导出是「快照」：事件卡与报告卡只由本次读到的内容决定（事件掉出热榜、被合并、报道撤回、
 * 报告被删），所以 notes/ 里那些本次没有生成的事件卡与报告卡就是过期卡片，移进 archive/。
 * 精选卡不在此列：它们按保留天数过期，由 `kbRetention` 处理，不能因为一次导出没读到就丢掉。
 *
 * 兜底：上一次导出中途失败留下的垃圾、以及手写进 notes/ 的文件，都会在这里被收走。
 */
export async function sweepOrphans(keep: ReadonlySet<string>, now: Date): Promise<string[]> {
  const moved: string[] = [];
  for (const rel of await noteFilesUnder(notesDir())) {
    if (keep.has(rel)) continue;
    const kind = kindOfPath(rel);
    if (kind !== "event" && kind !== "report") continue;
    if (await archiveNote(rel, now)) moved.push(rel);
  }
  return moved;
}

/** notes/ 下所有卡片的相对路径（`/` 分隔）。 */
export async function noteFilesUnder(dir = notesDir(), root = kbRoot()): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await noteFilesUnder(file, root)));
    else if (entry.name.endsWith(".md")) out.push(path.relative(root, file).split(path.sep).join("/"));
  }
  return out;
}

/** 路径里的类型段：`notes/events/…`、`notes/reports/…`、`notes/items/…`。 */
function kindOfPath(relPath: string): NoteKind | null {
  const parts = relPath.split("/");
  if (parts[0] !== "notes") return null;
  if (parts[1] === "events") return "event";
  if (parts[1] === "reports") return "report";
  if (parts[1] === "items") return "item";
  return null;
}

/** inbox/ 里还剩几个临时文件；测试用它检查「导出结束 inbox 为空」。 */
export async function inboxCount(): Promise<number> {
  return (await readdir(inboxDir()).catch(() => [])).length;
}
