// 读取出口：列表筛选、按 id 取、确定性搜索的打分与排序。
//
// 这里不连库也不跑导出：直接写卡片文件 + 清单，把读取层当成「读盘 + 打分」来测。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const DATA = await mkdtemp(path.join(os.tmpdir(), "kb-read-"));
process.env.AIHOT_DATA_DIR = DATA;

import type { Note } from "../backend/layout.ts";
const { listNotes, listTags, readNote, saveIndex, searchNotes, searchTerms, SEARCH_WEIGHTS, NOTE_STATUS } = await import("../backend/read.ts");
const { renderNote, writeNote } = await import("../backend/layout.ts");
const { resetInbox } = await import("../backend/prune.ts");

after(async () => {
  await rm(DATA, { recursive: true, force: true });
});

/** 一张卡片：只有 id/title/tags/refs/正文不同，其余按契约填满。 */
function card(kind: "event" | "report" | "item", id: string, opts: { title: string; tags?: string[]; refs?: string[]; body?: string; at?: string }): Note {
  const at = opts.at ?? "2026-10-09T00:00:00.000Z";
  return {
    frontmatter: {
      id,
      title: opts.title,
      created_at: at,
      updated_at: at,
      tags: ["radar", kind, ...(opts.tags ?? [])],
      source_refs: opts.refs ?? ["https://example.com/news/1"],
      status: "active",
      ai_access: "allow",
    },
    body: opts.body ?? `# ${opts.title}\n\n## 摘要\n\n摘要内容。`,
  };
}

const NOTES: Array<[Note, string]> = [
  [card("event", "kb-event-1", { title: "某公司发布某模型", tags: ["ai-models"], refs: ["https://example.com/anthropic/1"], at: "2026-10-09T03:00:00.000Z", body: "# 某公司发布某模型\n\n## 摘要\n\n发布了新模型。\n\n## 时间线\n\n- 2026-10-08 官方账号：确认" }), "notes/events/2026-10/1.md"],
  [card("item", "kb-item-2", { title: "开源权重的一次更新", tags: ["open-source"], refs: ["https://github.com/example/repo"], at: "2026-10-08T03:00:00.000Z", body: "# 开源权重的一次更新\n\n## 摘要\n\n权重放出来了。" }), "notes/items/2026-10/2.md"],
  [card("report", "kb-report-daily-3", { title: "日报 · 2026-10-09", tags: [], refs: ["https://example.com/other/9"], at: "2026-10-07T03:00:00.000Z", body: "# 日报 · 2026-10-09\n\n## 导语\n\n今天发生了什么。" }), "notes/reports/daily/3.md"],
];

before(async () => {
  for (const [note, rel] of NOTES) await writeNote(rel, renderNote(note));
  await saveIndex({
    schemaVersion: 1,
    exportedAt: "2026-10-09T04:00:00.000Z",
    window: { itemRetentionDays: 90, reportsLookback: 8 },
    counts: { event: 1, report: 1, item: 1 },
    notes: NOTES.map(([note, rel]) => ({
      id: note.frontmatter.id,
      kind: note.frontmatter.tags[1] as "event" | "report" | "item",
      path: rel,
      sha256: "irrelevant-for-listing",
      title: note.frontmatter.title,
      tags: note.frontmatter.tags,
      status: note.frontmatter.status,
      created_at: note.frontmatter.created_at,
      updated_at: note.frontmatter.updated_at,
      source_refs: note.frontmatter.source_refs.length,
    })),
  });
});

test("列表按内容时间倒序，可以按类型与标签筛", async () => {
  const all = await listNotes();
  assert.deepEqual(all.map((n) => n.id), ["kb-event-1", "kb-item-2", "kb-report-daily-3"]);
  assert.deepEqual((await listNotes({ kind: "item" })).map((n) => n.id), ["kb-item-2"]);
  assert.deepEqual((await listNotes({ tag: "open-source" })).map((n) => n.id), ["kb-item-2"]);
  assert.deepEqual((await listNotes({ tag: "radar" })).length, 3, "radar 是每张卡都有的类型标记");
  assert.deepEqual(await listNotes({ tag: "不存在的标签" }), []);
  assert.equal(NOTE_STATUS[0], "active");
});

test("按 id 取一篇：清单里没有、或者文件不合契约都取不到", async () => {
  const note = await readNote("kb-event-1");
  assert.equal(note?.frontmatter.title, "某公司发布某模型");
  assert.ok(note?.body.startsWith("# 某公司发布某模型"));
  assert.equal(await readNote("kb-event-不存在"), null);

  // 手改坏了：frontmatter 少一个字段，读取层按坏文件处理。
  await writeNote("notes/items/2026-10/2.md", "---\nid: kb-item-2\ntitle: 坏文件\n---\n\n# 坏文件\n");
  assert.equal(await readNote("kb-item-2"), null);
  assert.deepEqual((await listNotes()).map((n) => n.id), ["kb-event-1", "kb-report-daily-3"], "坏文件不出现在列表里");
  // 复原，后面的用例还要用。
  await writeNote(NOTES[1]![1], renderNote(NOTES[1]![0]));
});

test("五处加权：标题 100 / 标签 70 / 来源 60 / 章节 40 / 正文 20", async () => {
  assert.deepEqual(SEARCH_WEIGHTS, { title: 100, tags: 70, sourceRefs: 60, headings: 40, body: 20 });
  const byTitle = await searchNotes({ q: "发布" });
  assert.equal(byTitle[0]?.note.id, "kb-event-1");
  assert.ok(byTitle[0]!.matched.includes("title"));
  assert.ok(byTitle[0]!.score >= SEARCH_WEIGHTS.title);

  const byTag = await searchNotes({ q: "open-source" });
  assert.deepEqual(byTag.map((h) => h.note.id), ["kb-item-2"]);
  assert.deepEqual(byTag[0]!.matched, ["tags"]);
  assert.equal(byTag[0]!.score, SEARCH_WEIGHTS.tags);

  const byRef = await searchNotes({ q: "anthropic" });
  assert.deepEqual(byRef.map((h) => h.note.id), ["kb-event-1"]);
  assert.deepEqual(byRef[0]!.matched, ["source_refs"]);
  assert.equal(byRef[0]!.score, SEARCH_WEIGHTS.sourceRefs);

  const byHeading = await searchNotes({ q: "时间线" });
  assert.deepEqual(byHeading[0]!.matched, ["headings", "body"]);
  assert.equal(byHeading[0]!.score, SEARCH_WEIGHTS.headings + SEARCH_WEIGHTS.body);

  const byBody = await searchNotes({ q: "权重放出来了" });
  assert.deepEqual(byBody[0]!.matched, ["body"]);
  assert.equal(byBody[0]!.score, SEARCH_WEIGHTS.body);
});

test("多个词累加；分数相同按内容时间新的在前", async () => {
  const hits = await searchNotes({ q: "模型 发布" });
  assert.equal(hits[0]?.note.id, "kb-event-1", "标题命中两个词的分最高");
  assert.ok(hits[0]!.score >= SEARCH_WEIGHTS.title * 2);

  // 「摘要」在两张卡里都只命中章节标题与正文，分数一样，于是按内容时间新的在前。
  const same = await searchNotes({ q: "摘要" });
  assert.deepEqual(same.map((h) => h.note.id), ["kb-event-1", "kb-item-2"]);
  assert.deepEqual([...new Set(same.map((h) => h.score))], [SEARCH_WEIGHTS.headings + SEARCH_WEIGHTS.body]);
  assert.equal((await searchNotes({ q: "导语" }))[0]?.note.id, "kb-report-daily-3");
});

test("搜索可以按类型筛，空查询与无命中都返回空", async () => {
  assert.deepEqual((await searchNotes({ q: "发布", kind: "event" })).map((h) => h.note.id), ["kb-event-1"]);
  assert.deepEqual(await searchNotes({ q: "发布", kind: "report" }), []);
  assert.deepEqual(await searchNotes({ q: "   " }), []);
  assert.deepEqual(await searchNotes({ q: "完全不相干的词" }), []);
  assert.deepEqual(searchTerms("  A，B、C  "), ["a", "b", "c"], "中英文标点都算分隔符，统一小写");
});

test("标签清单按卡片数排列", async () => {
  const tags = await listTags();
  assert.deepEqual(tags[0], { tag: "radar", count: 3 });
  assert.ok(tags.some((t) => t.tag === "ai-models" && t.count === 1));
  assert.ok(tags.some((t) => t.tag === "event" && t.count === 1));
});

test("inbox 清理不碰已有卡片", async () => {
  assert.equal(await resetInbox(), 0);
  assert.equal((await listNotes()).length, 3);
});
