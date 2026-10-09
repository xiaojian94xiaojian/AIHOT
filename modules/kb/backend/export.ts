// 导出作业：取数（只从读取层读）→ 生成卡片 → 原子写盘 → 更新 kb-index.json。
//
// 一切从 `publication/` 读：事件与热榜走 loadHot / loadStoryDetail，报告走 listReports / loadReport，
// 精选条目走精选时间线。所以撤回、许可与可见性的规则都还是读取层那一份，模块不自己判可见。
//
// 导出是**快照**：事件卡与报告卡只由本次读到的内容决定，因此它同时承担清理 —— 本次不再认的卡片会被
// 扫进 archive/（`sweepOrphans`）。精选卡不在此列，它们按保留天数过期。
//
// 零模型调用：只读库、只写文件，所以不花一分钱 —— 这也是它能放在第一期的原因。
import { mkdir } from "node:fs/promises";
import { sql } from "@aihot/backend/db";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { listReports, loadReport } from "@aihot/backend/publication/reports";
import { storyReportCondition } from "@aihot/backend/publication/scope";
import { loadHot, loadStoryDetail } from "@aihot/backend/publication/stories";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { cardPath, eventCard, itemCard, kindOfCardId, reportCard, type StoryCardInput } from "./cards.ts";
import { kbConfig } from "./config.ts";
import { archiveDir, inboxDir, NOTE_KINDS, notesDir, projectsDir, renderNote, type Note, type NoteKind, type ReportCardKind } from "./layout.ts";
import { resetInbox, sweepOrphans, syncNote, type SyncAction } from "./prune.ts";
import { loadIndex, saveIndex, sha256, type IndexedNote, type KbIndex } from "./read.ts";

/** 精选条目分页取：一页 40 条（读取层的上限），翻到窗口外或翻够 40 页就停。 */
const ITEM_PAGE = 40;
const ITEM_MAX_PAGES = 40;

/** 报告卡的种类与顺序：日报最勤，回补的意义也最大。 */
const REPORT_KINDS: readonly ReportCardKind[] = ["daily", "weekly", "monthly"];

export interface ExportResult {
  /** 这次写盘或移走的动作，一张卡片一条。 */
  actions: SyncAction[];
  counts: Record<NoteKind, number>;
  /** 本次导出后索引里的卡片总数。 */
  total: number;
  /** 本次不再认、被移进 archive/ 的卡片路径（事件掉出热榜、被合并、报道撤回……）。 */
  swept: string[];
}

/** 该不该导出：安全阀只有写成 true 才打开（AGENTS.md 的规矩）。 */
export function exportEnabled(): boolean {
  return kbConfig().exportEnabled;
}

/**
 * 导出一次。重复导出 = 覆盖同一批文件（文件名是稳定 id），所以是幂等的：
 * 内容没变的卡片按 sha256 跳过写盘，文件的内容和 mtime 都不动。
 */
export async function exportKb(now = new Date()): Promise<ExportResult> {
  const before = await loadIndex();
  const built = new Map<string, { note: Note; relPath: string }>();
  const add = (note: Note, relPath: string) => built.set(note.frontmatter.id, { note, relPath });

  const hot = await loadHot();
  for (const entry of hot.entries) {
    const detail = await storyDetail(entry.story.publicId, now);
    if (!detail) continue;
    const note = eventCard({ detail, entry, urls: await storyUrls(detail, now) } satisfies StoryCardInput);
    add(note, cardPath("event", note.frontmatter.id, new Date(note.frontmatter.created_at)));
  }

  for (const kind of REPORT_KINDS) {
    for (const reported of await listReports(kind, kbConfig().reportsLookback)) {
      const detail = await loadReport(kind, reported.key);
      if (!detail) continue;
      const note = reportCard({ detail });
      add(note, cardPath("report", note.frontmatter.id, new Date(detail.generatedAt), kind));
    }
  }

  for (const item of await selectedItems(now)) {
    const found = await loadItemDetail(item.id, "zh", now);
    if (found.kind !== "found") continue;
    const note = itemCard({ item: found.item, url: found.item.links.original });
    // 卡片按月分目录，用读取层给的时间线锚点（这条精选第一次出现的时间），不用导出时刻。
    add(note, cardPath("item", note.frontmatter.id, new Date(item.anchorAt)));
  }

  const indexed = new Map<string, IndexedNote>();
  const actions: SyncAction[] = [];
  const counts: Record<NoteKind, number> = { event: 0, report: 0, item: 0 };
  for (const { note, relPath } of built.values()) {
    const text = renderNote(note);
    const kind = kindOfCardId(note.frontmatter.id);
    counts[kind] += 1;
    const prior = before?.notes.find((n) => n.id === note.frontmatter.id) ?? null;
    actions.push(await syncNote({ relPath, text, prior, frontmatter: note.frontmatter, kind, now }));
    indexed.set(note.frontmatter.id, {
      id: note.frontmatter.id,
      kind,
      path: relPath,
      sha256: sha256(text),
      title: note.frontmatter.title,
      tags: note.frontmatter.tags,
      status: note.frontmatter.status,
      created_at: note.frontmatter.created_at,
      updated_at: note.frontmatter.updated_at,
      source_refs: note.frontmatter.source_refs.length,
    });
  }

  const window = kbConfig();
  const index: KbIndex = {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    window: { itemRetentionDays: window.itemRetentionDays, reportsLookback: window.reportsLookback },
    counts: Object.fromEntries(NOTE_KINDS.map((k) => [k, counts[k]])),
    notes: [...indexed.values()],
  };
  // 先收走本次不再认的事件卡与报告卡，再写清单：清单里因此不会留下已经移走的路径。
  const swept = await sweepOrphans(new Set([...built.values()].map((b) => b.relPath)), now);
  await saveIndex(index);
  await resetInbox();
  await ensureDirs();
  return { actions, counts, total: index.notes.length, swept };
}

/** 把契约里的顶层目录建出来（projects/ 是第二期选题助手的地方，第一期先备着）。 */
async function ensureDirs(): Promise<void> {
  await mkdir(notesDir(), { recursive: true });
  await mkdir(archiveDir(), { recursive: true });
  await mkdir(projectsDir(), { recursive: true });
  await mkdir(inboxDir(), { recursive: true });
}

/**
 * 事件卡要按报道 id 找原文 URL。读取层只给代表性报道的原文，其余的在库里补；
 * 补不到就不写（来源引用只放真的能点开的原文）。
 *
 * 「哪些报道现在还是公开的」用 `publication/scope.ts` 的谓词（`storyReportCondition`），
 * 不在这里另写一套可见性规则；能取到 URL 的再按详情里点过名的报道过滤一遍，
 * 所以卡片上的链接集合与事件页看到的一致。
 */
async function storyUrls(detail: Awaited<ReturnType<typeof loadStoryDetail>>, now: Date): Promise<Map<string, string>> {
  if (!detail) return new Map();
  const ids = new Set([
    ...detail.timeline.map((r) => r.id),
    ...detail.officialReports.map((r) => r.id),
    ...detail.developments.map((d) => d.representative.id),
    ...(detail.latestReport ? [detail.latestReport.id] : []),
  ]);
  if (!ids.size) return new Map();
  const rows = await sql<{ id: string; url: string }[]>`
    SELECT p.article_id AS id, p.url
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = ANY(${[...ids]}::text[]) AND ${storyReportCondition(now)}`;
  return new Map(rows.map((r) => [r.id, r.url]));
}

/** 一条事件：读它的详情。合并掉的或已不公开的返回 null，跳过不写卡。 */
async function storyDetail(publicId: string, now: Date) {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM stories WHERE public_id = ${publicId} AND merged_into IS NULL`;
  if (!row) return null;
  return loadStoryDetail(Number(row.id), now);
}

/**
 * 保留窗口内的精选条目：走读取层的精选时间线（seated 集合，每个事实一张卡，锚点是它第一次出现的时间）。
 * 没有「取某天之前」的读取接口，所以从最新一页往前翻，翻到窗口外为止。
 */
async function selectedItems(now: Date): Promise<Array<{ id: string; anchorAt: string }>> {
  const cutoff = new Date(now.getTime() - kbConfig().itemRetentionDays * 86_400_000);
  const out: Array<{ id: string; anchorAt: string }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < ITEM_MAX_PAGES; page += 1) {
    const res = await loadTimeline({ channel: "all", category: null, tag: null, limit: ITEM_PAGE, cursor, now });
    let reached = false;
    for (const card of res.cards) {
      if (new Date(card.anchorAt) < cutoff) {
        reached = true;
        break;
      }
      out.push({ id: card.item.id, anchorAt: card.anchorAt });
    }
    if (reached || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}
