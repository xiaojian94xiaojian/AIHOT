// 读取出口：列表、按 id 取一篇、确定性关键词搜索。
//
// 事实源是 Markdown：这里每次都读文件，不建索引表。搜索就是「读文件 + 打分」，
// 打分沿用 Nodus 的确定性算法（title×100 / tags×70 / source_refs×60 / 章节标题×40 / 正文×20），
// 不做向量检索。等卡片上万再考虑派生索引表（届时它必须可以从文件重建）。
//
// kb-index.json 只是上一次导出的清单（id、路径、sha256、计数），用来列表和校验，
// 少了它也能工作，只是没有清单可依。
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readNoteFile, noteFile, writeDataFile, headingsOf, indexPath, type Note, type NoteKind, type NoteFrontmatter } from "./layout.ts";

/** 笔记契约的两个固定值：状态与 AI 访问边界（借 Nodus 的语义，默认 allow）。 */
export const NOTE_STATUS = ["active", "archived"] as const;
export const AI_ACCESS = "allow";

export interface IndexedNote {
  id: string;
  kind: NoteKind;
  /** 相对知识库根的路径。 */
  path: string;
  sha256: string;
  title: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
  source_refs: number;
}

/** 最近一次导出的清单。它只是清单，事实源仍然是 Markdown。 */
export interface KbIndex {
  schemaVersion: 1;
  exportedAt: string;
  window: { itemRetentionDays: number; reportsLookback: number };
  counts: Record<string, number>;
  notes: IndexedNote[];
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 读清单；没有、读不动或者不是这一版，都当作「还没有导出过」。 */
export async function loadIndex(): Promise<KbIndex | null> {
  const text = await readFile(indexPath(), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as KbIndex;
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.notes) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveIndex(index: KbIndex): Promise<void> {
  await writeDataFile("kb-index.json", `${JSON.stringify(index, null, 2)}\n`);
}

/** 卡片在磁盘上的样子：清单里的一行加上它的 frontmatter 与正文。 */
export interface NoteRef extends IndexedNote {
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface ListQuery {
  kind?: NoteKind | null;
  tag?: string | null;
  status?: string | null;
  limit?: number;
}

/** 列表：按清单的更新时间倒序（导出时间与内容时间分开记，这里用内容时间）。 */
export async function listNotes(q: ListQuery = {}): Promise<NoteRef[]> {
  const index = await loadIndex();
  if (!index) return [];
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const picked = index.notes
    .filter((n) => (q.kind ? n.kind === q.kind : true) && (q.tag ? n.tags.includes(q.tag) : true) && (q.status ? n.status === q.status : true))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
    .slice(0, limit);
  const out: NoteRef[] = [];
  for (const note of picked) {
    const file = await readNoteFile(note.path);
    // 文件没了或者坏了就不列：清单是「上次导出时」的样子，读的时候以文件为准。
    if (file) out.push({ ...note, ...file });
  }
  return out;
}

/** 按 id 取一篇（清单先定位，再读文件；文件不合契约就算取不到）。 */
export async function readNote(id: string): Promise<NoteRef | null> {
  const index = await loadIndex();
  const listed = index?.notes.find((n) => n.id === id);
  if (!listed) return null;
  const file = await readNoteFile(listed.path);
  return file ? { ...listed, ...file } : null;
}

export interface SearchHit {
  note: NoteRef;
  score: number;
  /** 命中的部位，给人看「为什么搜到它」。 */
  matched: string[];
}

/** 五处加权：标题、标签、来源引用、章节标题、正文（Nodus core/vault.py 的确定性打分）。 */
export const SEARCH_WEIGHTS = { title: 100, tags: 70, sourceRefs: 60, headings: 40, body: 20 } as const;

/** 搜索词：按空白切开，最多取 8 个，短于 1 个字符的丢掉。 */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,，、]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** 一个词在一篇笔记上的得分，以及命中在哪几处。 */
function scoreNote(note: NoteRef, terms: readonly string[]): { score: number; matched: Set<string> } {
  const title = note.frontmatter.title.toLowerCase();
  const tags = note.frontmatter.tags.map((t) => t.toLowerCase());
  const refs = note.frontmatter.source_refs.map((r) => r.toLowerCase());
  const headings = headingsOf(note.body).map((h) => h.toLowerCase());
  const body = note.body.toLowerCase();
  let score = 0;
  const matched = new Set<string>();
  for (const term of terms) {
    if (title.includes(term)) {
      score += SEARCH_WEIGHTS.title;
      matched.add("title");
    }
    if (tags.some((t) => t.includes(term))) {
      score += SEARCH_WEIGHTS.tags;
      matched.add("tags");
    }
    if (refs.some((r) => r.includes(term))) {
      score += SEARCH_WEIGHTS.sourceRefs;
      matched.add("source_refs");
    }
    if (headings.some((h) => h.includes(term))) {
      score += SEARCH_WEIGHTS.headings;
      matched.add("headings");
    }
    if (body.includes(term)) {
      score += SEARCH_WEIGHTS.body;
      matched.add("body");
    }
  }
  return { score, matched };
}

export interface SearchQuery extends ListQuery {
  q: string;
}

/** 关键词搜索：先按类型/标签筛，再打分，分高在前；同分按内容时间新旧、再按 id，结果稳定。 */
export async function searchNotes(q: SearchQuery): Promise<SearchHit[]> {
  const terms = searchTerms(q.q);
  if (!terms.length) return [];
  const candidates = await listNotes({ ...q, limit: 500 });
  return candidates
    .map((note) => {
      const { score, matched } = scoreNote(note, terms);
      return { note, score, matched: [...matched] };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updated_at.localeCompare(a.note.updated_at) || a.note.id.localeCompare(b.note.id));
}

/** 库里有哪些主题/分类，各有多少张卡：给 kb_topics 和后台的筛选用。 */
export async function listTags(): Promise<Array<{ tag: string; count: number }>> {
  const index = await loadIndex();
  const counts = new Map<string, number>();
  for (const note of index?.notes ?? []) for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** 清单与磁盘是否一致：清单里每一行的 sha256 与文件内容对得上才算。 */
export async function verifyIndex(): Promise<{ checked: number; missing: string[]; changed: string[] }> {
  const index = await loadIndex();
  if (!index) return { checked: 0, missing: [], changed: [] };
  const missing: string[] = [];
  const changed: string[] = [];
  for (const note of index.notes) {
    const text = await readFile(noteFile(note.path), "utf8").catch(() => null);
    if (text === null) missing.push(note.id);
    else if (sha256(text) !== note.sha256) changed.push(note.id);
  }
  return { checked: index.notes.length, missing, changed };
}
