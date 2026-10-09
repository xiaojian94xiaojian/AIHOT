// 导出/撤回测试共用的数据：一条公开事件（两个信源、一条精选）、一期日报。
//
// 只造读取层认得的数据：入库、分析、分组、发布都走框架自己的路径，所以卡片上看到的就是
// 读者能看到的那一份 —— 测试因此能盯住「撤回之后卡片必须离开 notes/」这件事。
import { randomUUID } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { computeHotRanking } from "@aihot/backend/events/hot";
import { publishArticle } from "@aihot/backend/publication/publish";
import { SITE } from "@aihot/site";

export interface Seeded {
  /** 卡片 id 用的：事件公开 id、精选条目 id、日报 key。 */
  storyPublicId: string;
  itemId: string;
  /** 另一条同一事件的报道（事件的第二个信源）。 */
  otherItemId: string;
  dailyKey: string;
  urls: { first: string; second: string };
}

export async function seedKb(t: string): Promise<Seeded> {
  const firstSource = `kb-media-${t}`;
  const secondSource = `kb-official-${t}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${firstSource}, ${`某媒体 ${t}`}, 'rss', 'T2', 'editorial', false, '2100-01-01'),
    (${secondSource}, ${`官方账号 ${t}`}, 'rss', 'T1', 'editorial', true, '2100-01-01')`;

  const at = new Date(Date.now() - 30 * 60_000);
  const storyPublicId = randomUUID();
  const [story] = await sql<{ id: number }[]>`
    INSERT INTO stories (public_id, title, first_report_at, latest_at)
    VALUES (${storyPublicId}, ${`事件标题-${t}`}, ${at}, ${new Date(at.getTime() + 10 * 60_000)}) RETURNING id`;
  const [fact] = await sql<{ id: number }[]>`
    INSERT INTO facts (public_id, story_id, title) VALUES (${`fact-${t}`}, ${story!.id}, ${`事实-${t}`}) RETURNING id`;

  const urls = { first: `https://example.com/kb/${t}/1`, second: `https://example.com/kb/${t}/2` };
  const first = await report(firstSource, urls.first, `首条报道-${t}`, `摘要-${t}`, fact!.id, story!.id, at);
  const second = await report(secondSource, urls.second, `后续报道-${t}`, `后续摘要-${t}`, fact!.id, story!.id, new Date(at.getTime() + 10 * 60_000));

  // 热榜：读取层只认「已经发布」的那一份，所以按真实路径算一遍。
  await computeHotRanking();

  // 一期日报：引用上面那条精选，摘要里带一个只有卡片才该有的词，用来验证来源引用完整。
  const dailyKey = "2098-09-09";
  const content = {
    kind: "daily",
    title: `${SITE.name} 日报 · ${dailyKey}`,
    lead: { title: `首条报道-${t}`, leadParagraph: `今天的导语-${t}` },
    leadItemId: first,
    overview: `今日总览-${t}`,
    highlights: [first],
    sections: [{ label: `模型-${t}`, items: [{ itemId: first, title: `首条报道-${t}`, sourceName: `某媒体 ${t}`, sourceUrl: urls.first, firstParty: false }] }],
    flashes: [],
    metrics: {},
  };
  await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
            VALUES ('daily', ${dailyKey}, now(), now(), ${sql.json(content as never)}, now(), 'imported')`;

  return { storyPublicId, itemId: first, otherItemId: second, dailyKey, urls };
}

/** 一条公开的精选报道：入库 → 分析 → 事实成员 → 发布。 */
async function report(sourceId: string, url: string, title: string, summary: string, factId: number, storyId: number, at: Date): Promise<string> {
  const { articleId } = await upsertMaterial({ sourceId, url, title, bodyText: "正文", bodyHtml: "<p>正文</p>", bodyStatus: "ok", via: "fetch", publishedAt: at });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
            VALUES (${articleId}, 1, 'rule', 'pass', 'industry', ${title}, ${summary}, 80, true)`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${factId}, ${articleId}, 'report')`;
  await sql`UPDATE articles SET grouping_status = 'complete', grouped_at = now() WHERE id = ${articleId}`;
  // 证据信号：热榜按它数参与方。
  await sql`INSERT INTO story_signals (story_id, article_id, participant_key, source_id, kind, observed_at)
            VALUES (${storyId}, ${articleId}, ${`source:${sourceId}`}, ${sourceId}, 'editorial', ${at})`;
  await publishArticle(articleId, { releasedAt: new Date(at.getTime() - 60_000) });
  return articleId;
}
