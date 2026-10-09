// 三类卡片的渲染：事件卡、报告卡、精选条目卡。全是纯函数——读库的活在外面（export.ts），
// 所以它们最该被测试，也最容易在别的地方复用。
//
// 许可：正文只放读取层已经公开给读者的内容（摘要 + 链接是默认）。`site_fulltext` 关的信源不得落全文，
// 所以这里从不读 item.body：原文永远只是一个链接。
import type { HotEntryView, ReportDetail, SiteItemDetail, StoryDetail, StoryReportView, TopicLink } from "@aihot/contracts/site";
import { siteUrl } from "@aihot/backend/publication/links";
import { cardId, notePath, reportCardId, type Note, type NoteKind, type ReportCardKind } from "./layout.ts";

/** 每张卡片 tags 的前两项：`["radar", <kind>]`，后面才是主题与分类。 */
export const RADAR_TAG = "radar";

/** 正文里最多列多少条时间线/动态：卡片是给人读的入口，不是全量存档（全量在库里）。 */
const TIMELINE_LIMIT = 40;

const trim = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text ? text : null;
};

/** 标题：还原 HTML 实体，并把换行压成空格（frontmatter 里换行会截断字段，正文首行也不能有）。 */
function cardTitle(value: string): string {
  return decodeText(value).replace(/\s+/g, " ").trim();
}

/** 来源名与标题里的 HTML 实体：写进 Markdown 前还原，免得卡片里满是 &quot;。 */
export function decodeText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Markdown 链接文字里的方括号要转义，否则标题会截断链接。 */
const linkText = (text: string): string => text.replace(/([[\]])/g, "\\$1");

/** 一个指向站内页面或原文的 Markdown 链接。 */
function link(text: string, url: string): string {
  return `[${linkText(decodeText(text))}](${url})`;
}

/** 稳定去重：同一个 URL 在一张卡片里只出现一次，先出现的顺序保留。 */
function unique(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = (value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/** 主题 slug 与分类进 tags，顺序稳定、不重复。 */
function tagsOf(kind: NoteKind, extra: readonly (string | null | undefined)[]): string[] {
  return unique([RADAR_TAG, kind, ...extra]);
}

/** 卡片更新时间：正文里最新的一处时间，重复导出因此在内容没变时得到同一个文件。 */
function latest(...at: Array<string | null | undefined>): string {
  const times = at.map((v) => (v ? Date.parse(v) : Number.NaN)).filter((v) => Number.isFinite(v));
  return new Date(times.length ? Math.max(...times) : Date.now()).toISOString();
}

/** 卡片创建时间：正文里最早的一处时间。 */
function earliest(...at: Array<string | null | undefined>): string {
  const times = at.map((v) => (v ? Date.parse(v) : Number.NaN)).filter((v) => Number.isFinite(v));
  return new Date(times.length ? Math.min(...times) : Date.now()).toISOString();
}

const iso = (value: string | Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

// 事件卡

/**
 * 一条报道的原文链接。读取层只给代表性的那几条，所以缺的在库里查；
 * 查不到就不写 —— 来源引用只放真的能点开的原文。
 */
export interface StoryCardInput {
  detail: StoryDetail;
  /** 热榜上的那一条（事件卡的热度一节）；事件不在榜上时为 null。 */
  entry: HotEntryView | null;
  /** 报道 id -> 原文 URL，由导出作业从库里补齐。 */
  urls: ReadonlyMap<string, string>;
}

/** 事件卡：摘要、热度、时间线，来源引用是全部公开报道的原文 URL（代表报道在前）。 */
export function eventCard(input: StoryCardInput): Note {
  const { detail, entry, urls } = input;
  const title = cardTitle(detail.title);
  const lines: string[] = [`# ${title}`, "", "## 摘要"];
  const digest = trim(detail.digest) ?? trim(detail.summary);
  if (digest) lines.push(decodeText(digest), "");
  else if (detail.excerpt) lines.push(`${decodeText(detail.excerpt.text)}（来自 ${decodeText(detail.excerpt.sourceName)}）`, "");
  else lines.push("（读取层还没有这条事件的摘要）", "");

  const participants = entry?.participants ?? [];
  const editorial = participants.filter((p) => p.kind === "editorial").length;
  const signal = participants.length - editorial;
  lines.push("## 热度");
  const trend = entry ? trendText(entry) : null;
  lines.push(
    entry
      ? `- 排在热榜第 ${entry.rank} 位，当前热度 ${entry.heat}${trend ? `（${trend}）` : ""}；参与方 ${entry.participantCount}（媒体 ${editorial} / 讨论 ${signal}）`
      : "- 当前不在热榜上",
  );
  lines.push(`- 公开报道 ${detail.reportCount} 条，涉及 ${detail.sourceCount} 家信源`);
  if (detail.firstReportAt) lines.push(`- 首次报道 ${iso(detail.firstReportAt)}`);
  if (detail.latestAt) lines.push(`- 最近更新 ${iso(detail.latestAt)}`);
  if (detail.digestUpdatedAt) lines.push(`- 摘要更新 ${iso(detail.digestUpdatedAt)}`);
  const why = detail.whyHot;
  lines.push(
    `- 近 48 小时参与方 ${why.participants48h}，近 6 小时新增 ${why.newParticipants6h}，近 24 小时报道 ${why.recentReports24h}${why.observationComplete ? "" : "（有一家信源落后，观察不完整）"}`,
  );
  lines.push("");

  if (detail.developments.length > 1) {
    lines.push("## 进展");
    for (const d of detail.developments.slice(0, TIMELINE_LIMIT)) {
      const url = urls.get(d.representative.id) ?? null;
      lines.push(`- ${iso(d.firstReportAt)} ${decodeText(d.title)}${url ? `（${link(d.representative.source.name, url)}）` : ""} · ${d.reportCount} 条报道`);
    }
    lines.push("");
  }

  const timeline = detail.timeline.slice(0, TIMELINE_LIMIT);
  if (timeline.length) {
    lines.push("## 时间线");
    for (const report of timeline) lines.push(timelineLine(report, urls));
    lines.push("");
  }

  if (detail.related.length) {
    lines.push("## 相关事件");
    for (const r of detail.related) lines.push(`- ${link(r.title, siteUrl(`/story/${r.publicId}`))}（${r.relation === "storyline" ? "同一脉络" : "相关"}）`);
    lines.push("");
  }

  const refs = unique([
    detail.latestReport ? urls.get(detail.latestReport.id) : null,
    ...detail.officialReports.map((r) => urls.get(r.id)),
    ...timeline.map((r) => urls.get(r.id)),
    ...detail.developments.map((d) => urls.get(d.representative.id)),
  ]);
  return {
    frontmatter: {
      id: cardId("event", detail.publicId),
      title,
      created_at: earliest(detail.firstReportAt, detail.latestAt),
      updated_at: latest(detail.latestAt, detail.digestUpdatedAt, detail.firstReportAt),
      tags: tagsOf("event", [
        entry?.story.publicId === detail.publicId ? `rank-${entry.rank}` : null,
        detail.status === "settled" ? "settled" : null,
        ...detail.topics.map((t: TopicLink) => t.slug),
      ]),
      source_refs: refs,
      status: detail.status === "settled" ? "archived" : "active",
      ai_access: "allow",
    },
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
  };
}

function trendText(entry: HotEntryView): string | null {
  if (entry.trend === "new") return "新上榜";
  if (entry.trend === "flat") return "基本持平";
  if (entry.trend === "unknown") return null;
  if (entry.trendPct === null) return entry.trend === "up" ? "上升" : "回落";
  return `${entry.trend === "up" ? "+" : "-"}${Math.abs(entry.trendPct)}%`;
}

/** 时间线的一行：时间、报道标题、原文链接；查不到原文链接就只写报道本身（不编一个链接）。 */
function timelineLine(report: StoryReportView, urls: ReadonlyMap<string, string>): string {
  const url = urls.get(report.id) ?? null;
  const at = iso(report.publishedAt) ?? "";
  const who = decodeText(report.source.name);
  return url
    ? `- ${at} ${who}：${link(report.title, url)}`
    : `- ${at} ${who}：${decodeText(report.title)}`;
}

// 报告卡

export interface ReportCardInput {
  detail: ReportDetail;
}

/** 报告卡：导语、总览、各节条目、快讯，来源引用是当期引用的原文 URL。 */
export function reportCard(input: ReportCardInput): Note {
  const { detail } = input;
  const kind = detail.kind as ReportCardKind;
  const title = cardTitle(detail.title);
  const lines: string[] = [`# ${title}`, "", "## 导语"];
  const lead = trim(detail.lead?.leadParagraph) ?? trim(detail.overview);
  if (lead) lines.push(decodeText(lead), "");
  else lines.push("（这一期没有导语）", "");
  lines.push(`- 第 ${detail.issueNumber} 期，生成于 ${iso(detail.generatedAt)}`);
  if (detail.lead?.title) lines.push(`- 头条：${decodeText(detail.lead.title)}`);
  lines.push(`- 共 ${detail.sections.reduce((n, s) => n + s.items.length, 0)} 条引用，约 ${detail.readingMinutes} 分钟读完`);
  lines.push("");

  for (const section of detail.sections) {
    lines.push(`## ${decodeText(section.label)}`);
    if (trim(section.summary)) lines.push("", decodeText(section.summary!), "");
    for (const item of section.items) lines.push(citationLine(item));
    lines.push("");
  }

  if (detail.flashes.length) {
    lines.push("## 快讯");
    for (const flash of detail.flashes) lines.push(citationLine(flash));
    lines.push("");
  }

  const refs = unique([
    ...detail.highlights.map((h) => h.sourceUrl),
    ...detail.sections.flatMap((s) => s.items.flatMap((i) => [i.sourceUrl, ...(i.related ?? []).map((r) => r.sourceUrl)])),
    ...detail.flashes.map((f) => f.sourceUrl),
  ]);
  return {
    frontmatter: {
      id: reportCardId(kind, detail.key),
      title,
      created_at: iso(detail.generatedAt)!,
      updated_at: iso(detail.generatedAt)!,
      tags: tagsOf("report", [kind === "daily" ? "daily" : kind === "weekly" ? "weekly" : "monthly"]),
      source_refs: refs,
      status: "active",
      ai_access: "allow",
    },
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
  };
}

/** 报告里一条引用：站内页面（有的话）与原文各一个链接；撤回的条目如实写成「已撤回」。 */
function citationLine(citation: ReportDetail["highlights"][number]): string {
  const source = link(citation.title, citation.sourceUrl);
  const extra: string[] = [];
  if (citation.itemId && citation.available) extra.push(link("站内", siteUrl(`/items/${citation.itemId}`)));
  if (!citation.available) extra.push("已撤回");
  if (citation.otherSources) extra.push(`另有 ${citation.otherSources} 家信源`);
  const summary = trim(citation.summary);
  return `- ${source}${extra.length ? ` · ${extra.join(" · ")}` : ""}${summary ? `：${decodeText(summary)}` : ""}`;
}

// 精选条目卡

export interface ItemCardInput {
  item: SiteItemDetail;
  /** 代表报道在库里查到的原文 URL；查不到就用条目自己的原文链接。 */
  url?: string | null;
}

/** 精选条目卡：摘要、理由与原文链接。正文不落全文（`site_fulltext` 关的信源不得落全文）。 */
export function itemCard(input: ItemCardInput): Note {
  const { item } = input;
  const title = cardTitle(item.title);
  const url = (input.url ?? item.links.original).trim();
  const lines: string[] = [`# ${title}`, "", "## 摘要"];
  const summary = trim(item.summary);
  if (summary) lines.push(decodeText(summary), "");
  else lines.push("（这条还没有摘要）", "");
  const reason = trim(item.reason);
  if (reason) lines.push("## 为什么值得看", "", decodeText(reason), "");
  lines.push("## 出处");
  lines.push(`- 来源：${decodeText(item.source.name)}${item.channel === "x" ? "（X）" : ""}`);
  if (item.originalTitle && decodeText(item.originalTitle) !== title) lines.push(`- 原标题：${decodeText(item.originalTitle)}`);
  lines.push(item.publishedAt ? `- 发布时间：${iso(item.publishedAt)}` : `- 收录时间：${iso(item.discoveredAt)}`);
  lines.push(`- 站内页面：${siteUrl(`/items/${item.id}`)}`);
  lines.push(`- 原文：${url}`);
  lines.push("");
  if (item.story) {
    lines.push("## 所属事件");
    lines.push(`- ${link(item.story.title, siteUrl(`/story/${item.story.publicId}`))}`);
    lines.push("");
  }
  return {
    frontmatter: {
      id: cardId("item", item.id),
      title,
      created_at: iso(item.discoveredAt)!,
      updated_at: latest(item.timelineAt, item.publishedAt, item.discoveredAt),
      tags: tagsOf("item", [item.category, item.story ? `story-${item.story.publicId}` : null, ...item.tags]),
      source_refs: unique([url]),
      status: "active",
      ai_access: "allow",
    },
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
  };
}

/** 卡片落在哪：事件卡与精选卡按时间分月，报告卡按报告种类。 */
export function cardPath(kind: NoteKind, id: string, at: Date, reportKind?: ReportCardKind): string {
  return notePath(kind, id, at, reportKind);
}

/** 从卡片 id 反推类型（读索引、数各类卡片都要用它）。 */
export function kindOfCardId(id: string): NoteKind {
  if (id.startsWith("kb-report-")) return "report";
  if (id.startsWith("kb-item-")) return "item";
  return "event";
}
