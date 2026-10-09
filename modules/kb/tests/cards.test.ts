// 卡片渲染：frontmatter 恰好 9 个字段、body 非空且首行是标题、来源引用完整、原文链接可点。
// 这些是纯函数，所以断言可以直接盯住契约本身（KB-PLAN.md §4 的三条硬约束）。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportCitation, ReportDetail, SiteItemDetail, StoryDetail, StoryReportView } from "@aihot/contracts/site";
import { eventCard, itemCard, reportCard } from "../backend/cards.ts";
import { parseNote, renderNote, headingsOf } from "../backend/layout.ts";

/** frontmatter 的 9 个字段，顺序固定：多一个键将来 Nodus 导入就是 invalid_note。 */
const KEYS = ["id", "title", "created_at", "updated_at", "tags", "source_refs", "status", "ai_access"];

function report(id: string, title: string, url: string, at: string, source = "某媒体"): StoryReportView & { url: string } {
  return { id, title, summary: `${title}的摘要`, source: { name: source, firstParty: false }, publishedAt: at, selected: true, url };
}

function story(): StoryDetail {
  const first = report("a1", "某公司发布某模型", "https://example.com/news/1", "2026-10-08T22:10:00Z");
  const second = report("a2", "官方账号确认发布", "https://example.com/news/2", "2026-10-09T01:30:00Z", "官方账号");
  return {
    publicId: "3f2a91ab-0000-4000-8000-000000000001",
    title: "某公司发布某模型",
    status: "active",
    reportCount: 2,
    sourceCount: 2,
    firstReportAt: first.publishedAt,
    latestAt: second.publishedAt,
    digest: "某公司发布了某模型。",
    digestUpdatedAt: "2026-10-09T03:00:00Z",
    summary: null,
    excerpt: null,
    latest: second.title,
    latestReport: { id: second.id },
    whyHot: { participants48h: 9, newParticipants6h: 2, recentReports24h: 2, observationComplete: true, rank: 1 },
    developments: [{ factId: "f1", title: "发布", firstReportAt: first.publishedAt, reportCount: 2, representative: first }],
    officialReports: [second],
    timeline: [second, first],
    heat: [],
    related: [{ publicId: "aaaa1111-0000-4000-8000-000000000002", title: "相关事件", relation: "related" }],
    topics: [{ slug: "ai-models", name: "模型" }],
  };
}

const urls = new Map([
  ["a1", "https://example.com/news/1"],
  ["a2", "https://example.com/news/2"],
]);

const entry = {
  rank: 1,
  story: { publicId: "3f2a91ab-0000-4000-8000-000000000001", title: "某公司发布某模型" },
  heat: 128,
  trend: "up" as const,
  trendPct: 42,
  badges: ["surge"] as Array<"surge" | "new" | "rising">,
  participantCount: 9,
  sourceCount: 5,
  sourceNames: ["某媒体"],
  participants: [{ name: "某媒体", kind: "editorial" as const }, { name: "@someone", kind: "signal" as const }],
  spark: [],
  summary: "某公司发布了某模型。",
  latest: "官方账号确认发布",
  cover: null,
};

test("事件卡：frontmatter 恰好 9 个字段，正文首行是标题", () => {
  const note = eventCard({ detail: story(), entry, urls });
  assert.deepEqual(Object.keys(note.frontmatter), KEYS);
  assert.equal(note.frontmatter.id, "kb-event-3f2a91ab-0000-4000-8000-000000000001");
  assert.equal(note.frontmatter.status, "active");
  assert.equal(note.frontmatter.ai_access, "allow");
  assert.deepEqual(note.frontmatter.tags.slice(0, 3), ["radar", "event", "rank-1"]);
  assert.ok(note.frontmatter.tags.includes("ai-models"), "主题进 tags");

  const text = renderNote(note);
  const parsed = parseNote(text);
  assert.ok(parsed, "渲染出来的笔记能被解析回来（两个方向同一份契约）");
  assert.deepEqual(Object.keys(parsed.frontmatter), KEYS);
  assert.equal(parsed.frontmatter.title, note.frontmatter.title);
  assert.equal(parsed.body.split("\n")[0], "# 某公司发布某模型");
  assert.ok(headingsOf(parsed.body).includes("时间线"));
  assert.match(parsed.body, /当前热度 128（\+42%）/);
  assert.match(parsed.body, /媒体 1 \/ 讨论 1/);
});

test("来源引用只放原文 URL，代表报道在前，正文里的链接都能点", () => {
  const note = eventCard({ detail: story(), entry, urls });
  assert.deepEqual(note.frontmatter.source_refs, ["https://example.com/news/2", "https://example.com/news/1"]);
  for (const ref of note.frontmatter.source_refs) assert.match(ref, /^https:\/\//);
  for (const url of urls.values()) assert.ok(note.frontmatter.source_refs.includes(url), `${url} 出现在 source_refs 里`);
  assert.ok(note.body.includes("[官方账号确认发布](https://example.com/news/2)"));
});

test("查不到原文链接的报道不编链接", () => {
  const note = eventCard({ detail: story(), entry, urls: new Map([["a1", "https://example.com/news/1"]]) });
  assert.deepEqual(note.frontmatter.source_refs, ["https://example.com/news/1"]);
  assert.ok(note.body.includes("- 2026-10-09T01:30:00.000Z 官方账号：官方账号确认发布"), "没有链接就不写链接，但仍列出这条报道");
});

test("事件不在榜上时照常出卡（热度一节如实写）", () => {
  const note = eventCard({ detail: story(), entry: null, urls });
  assert.ok(note.body.includes("- 当前不在热榜上"));
  assert.equal(note.frontmatter.tags.includes("rank-1"), false);
});

test("settled 的事件卡状态是 archived", () => {
  const settled = { ...story(), status: "settled" as const };
  assert.equal(eventCard({ detail: settled, entry, urls }).frontmatter.status, "archived");
});

function citation(itemId: string, title: string, url: string): ReportCitation {
  return { itemId, title, summary: `${title}的摘要`, sourceName: "某媒体", sourceUrl: url, sourceIconUrl: null, firstParty: false, publishedAt: "2026-10-09T00:00:00Z", available: true };
}

function reportDetail(): ReportDetail {
  return {
    kind: "daily",
    key: "2026-10-09",
    issueNumber: 12,
    title: "日报 · 2026-10-09",
    generatedAt: "2026-10-09T01:00:00Z",
    lead: { title: "某公司发布某模型", leadParagraph: "今天最重要的一条。" },
    leadItemId: "i1",
    overview: "总览。",
    highlights: [citation("i1", "某公司发布某模型", "https://example.com/news/1")],
    sections: [{ label: "模型", summary: null, items: [citation("i1", "某公司发布某模型", "https://example.com/news/1"), citation("i2", "另一条", "https://example.com/news/3")] }],
    flashes: [{ ...citation("i3", "快讯一条", "https://example.com/news/4"), available: false, itemId: "i3" }],
    cover: null,
    metrics: {},
    readingMinutes: 3,
    prev: null,
    next: null,
  };
}

test("报告卡：9 个字段、tags 带报告种类、来源引用覆盖所有引用过的原文", () => {
  const note = reportCard({ detail: reportDetail() });
  assert.deepEqual(Object.keys(note.frontmatter), KEYS);
  assert.equal(note.frontmatter.id, "kb-report-daily-2026-10-09");
  assert.deepEqual(note.frontmatter.tags.slice(0, 3), ["radar", "report", "daily"]);
  assert.deepEqual(note.frontmatter.source_refs, ["https://example.com/news/1", "https://example.com/news/3", "https://example.com/news/4"]);
  assert.equal(note.frontmatter.created_at, "2026-10-09T01:00:00.000Z");
  const parsed = parseNote(renderNote(note))!;
  assert.equal(parsed.body.split("\n")[0], "# 日报 · 2026-10-09");
  assert.ok(parsed.body.includes("已撤回"), "撤回的条目如实写出来，不留一个死链当正常引用");
  assert.ok(parsed.body.includes("## 快讯"));
});

test("周报卡的 id 与日报不撞（同日同 key）", () => {
  const weekly = reportCard({ detail: { ...reportDetail(), kind: "weekly", key: "2026-W41", title: "周报 · 2026-W41" } });
  assert.equal(weekly.frontmatter.id, "kb-report-weekly-2026-W41");
  assert.deepEqual(weekly.frontmatter.tags.slice(0, 3), ["radar", "report", "weekly"]);
});

function item(overrides: Partial<SiteItemDetail> = {}): SiteItemDetail {
  return {
    id: "art-1",
    title: "某公司发布某模型",
    originalTitle: "Company ships a model",
    summary: "一句话摘要。",
    reason: "为什么值得看。",
    source: { name: "某媒体" },
    links: { original: "https://example.com/news/1" },
    publishedAt: "2026-10-09T00:00:00Z",
    discoveredAt: "2026-10-09T00:05:00Z",
    timelineAt: "2026-10-09T00:05:00Z",
    category: "ai-models",
    tags: ["发布"],
    score: 88,
    selected: true,
    channel: "news",
    story: { publicId: "3f2a91ab-0000-4000-8000-000000000001", title: "某公司发布某模型" },
    x: null,
    readingMode: "full",
    author: null,
    // 正文有可能是全文；卡片不许把它写进去（site_fulltext 关的信源不得落全文）。
    body: { zh: "<p>这里是全文，绝不该出现在卡片里。</p>", original: null, zhKind: "original", complete: true },
    outline: [],
    relatedStories: [],
    topics: [],
    indexable: true,
    markdownAvailable: true,
    group: null,
    hasTranslation: false,
    bodyLanguage: "zh",
    ...overrides,
  };
}

test("精选卡：不带全文，只要摘要与链接", () => {
  const note = itemCard({ item: item() });
  assert.deepEqual(Object.keys(note.frontmatter), KEYS);
  assert.equal(note.frontmatter.id, "kb-item-art-1");
  assert.deepEqual(note.frontmatter.source_refs, ["https://example.com/news/1"]);
  assert.deepEqual(note.frontmatter.tags.slice(0, 4), ["radar", "item", "ai-models", "story-3f2a91ab-0000-4000-8000-000000000001"]);
  assert.equal(note.body.includes("绝不该出现在卡片里"), false, "正文只放读取层公开的摘要，不落全文");
  const parsed = parseNote(renderNote(note))!;
  assert.equal(parsed.body.split("\n")[0], "# 某公司发布某模型");
  assert.ok(parsed.body.includes("## 出处"));
  assert.ok(parsed.body.includes("- 原文：https://example.com/news/1"));
});

test("标题里的换行与 HTML 实体：frontmatter 不被截断，链接文字不断", () => {
  const dirty = item({ title: "A &amp; B\n换行也来了", originalTitle: null });
  const note = itemCard({ item: dirty });
  assert.equal(note.frontmatter.title, "A & B 换行也来了");
  // 标题里有 `&` 与空格，链接文字仍然完整（不转义方括号才是问题，这里验证实体已被还原）。
  const parsed = parseNote(renderNote(note))!;
  assert.equal(parsed.frontmatter.title, "A & B 换行也来了");
});

test("正文里章节标题能被解析出来（搜索按它加权）", () => {
  const note = eventCard({ detail: story(), entry, urls });
  const parsed = parseNote(renderNote(note))!;
  assert.deepEqual(headingsOf(parsed.body), ["摘要", "热度", "时间线", "相关事件"]);
});

test("同一份输入渲染两次得到同样的文本（重复导出才有幂等可言）", () => {
  const a = renderNote(eventCard({ detail: story(), entry, urls }));
  const b = renderNote(eventCard({ detail: story(), entry, urls }));
  assert.equal(a, b);
});
