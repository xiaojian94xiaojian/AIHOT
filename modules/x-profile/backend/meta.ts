// 账号标注（类型 + 主类目）的读取：列表和画像页用它覆盖代码里的类型表。
import { sql } from "@aihot/backend/db";
import type { PersonCategory, PersonKind } from "../types.ts";

export interface AccountMeta {
  kind: PersonKind;
  category: PersonCategory | null;
}

/** 读一批 handle 的标注；没有标注的不在返回的 Map 里。 */
export async function accountMeta(handles: string[]): Promise<Map<string, AccountMeta>> {
  const out = new Map<string, AccountMeta>();
  if (handles.length === 0) return out;
  const rows = await sql<{ handle: string; kind: string; category: string | null }[]>`
    SELECT handle, kind, category FROM x_account_meta WHERE handle = ANY(${handles}::text[])`;
  for (const row of rows) out.set(row.handle, { kind: row.kind as PersonKind, category: (row.category as PersonCategory | null) ?? null });
  return out;
}
