// 每周涨粉报告：只挑「中文区、7 日涨粉超过 1000」的账号（发帖多少不再是门槛，证据不够时模型会自己说
// 数据不足以归因），模型（这里是一个本地假服务）写结构化观察，结果按账号和周期落库；同一周期重跑覆盖，不会多出一条。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { beijingDate } from "@aihot/contracts/time";
import { stub } from "../../../tests/setup.ts";
import { xProfileServerModule } from "../server.ts";
import { generateGrowthReports, latestReportFor, loadGrowthReports } from "../backend/growth-report.ts";

installModules([xProfileServerModule]);

const DAY = 86_400_000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

let server: Awaited<ReturnType<typeof stub>> | null = null;
after(async () => {
  await server?.close();
  await closeDb();
});

const ANSWER = {
  conclusion: "本周涨粉主要来自一条产品发布帖，其余日常帖的贡献很小。",
  drivers: [{ why: "发布帖带来了几乎全部的新曝光", evidence: "本周浏览最高的那条发布帖，5,000 次浏览" }],
  moves: ["发布会当天发一条带图、有明确结论的总结帖"],
  confidence: "medium" as const,
};

async function snapshot(at: Date, handle: string, followers: number) {
  await sql`
    INSERT INTO x_follower_snapshots (handle, captured_on, screen_name, followers, captured_at, receipt_id)
    VALUES (${handle}, ${beijingDate(at)}, ${handle}, ${followers}, ${at}, 0)
    ON CONFLICT (handle, captured_on) DO UPDATE SET followers = EXCLUDED.followers`;
}

test("a report is written for Chinese-region accounts over 1000 growth, stored, and readable; reruns replace it", async () => {
  const now = new Date();
  server = await stub(() => ({
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(ANSWER) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  }));
  process.env.LLM_BASE_URL = `${server.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  // 这一步走默认模型（llm）；有预算行时放开它，没有就是不限。
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10_000, per_day = 100_000 WHERE service = 'llm'`;

  await sql`TRUNCATE x_follower_snapshots`;
  await sql`TRUNCATE x_growth_reports`;
  await sql`
    INSERT INTO sources (id, name, kind, config) VALUES
      ('x-account-grow', '@Grow', 'x_search', ${sql.json({ query: "from:Grow -filter:replies" })}),
      ('x-account-lowposts', '@LowPosts', 'x_search', ${sql.json({ query: "from:LowPosts -filter:replies" })}),
      ('x-account-mega', '@Mega', 'x_search', ${sql.json({ query: "from:Mega -filter:replies" })}),
      ('x-account-quiet', '@Quiet', 'x_search', ${sql.json({ query: "from:Quiet -filter:replies" })})
    ON CONFLICT (id) DO NOTHING`;
  await sql`DELETE FROM articles WHERE source_id IN ('x-account-grow', 'x-account-lowposts', 'x-account-mega', 'x-account-quiet')`;
  let id = 0;
  const post = (sourceId: string, language: string, days: number, views: number) => {
    id += 1;
    const at = daysAgo(now, days);
    return sql`
      INSERT INTO articles (id, source_id, identity_key, url, title, language, published_at, discovered_at, timeline_at, raw, x_post)
      VALUES (${`gr-${id}`}, ${sourceId}, ${`test:gr-${id}`}, ${`https://x.com/gr-${id}`}, ${`gr ${id}`}, ${language}, ${at}, ${at}, ${at},
              ${sql.json({ views })}, ${sql.json({ handle: sourceId, lang: language, text: `post ${id}` })})`;
  };
  // grow：中文区，6 条帖，涨 1500；lowposts：中文区，只发 2 条，涨 1200（发帖少也照样进）；
  // mega：英文区，涨 3000（不是中文区，不进）；quiet：中文区但只涨 900（不到 1000，不进）。
  for (const days of [2, 3, 4, 5, 6, 7]) await post("x-account-grow", "zh", days, 5000);
  for (const days of [3, 5]) await post("x-account-lowposts", "zh", days, 5000);
  for (const days of [2, 3, 4, 5, 6, 7]) await post("x-account-mega", "en", days, 9000);
  for (const days of [3, 4]) await post("x-account-quiet", "zh", days, 800);
  await snapshot(daysAgo(now, 8), "grow", 1000);
  await snapshot(daysAgo(now, 1), "grow", 2500);
  await snapshot(daysAgo(now, 8), "lowposts", 1000);
  await snapshot(daysAgo(now, 1), "lowposts", 2200);
  await snapshot(daysAgo(now, 8), "mega", 1000);
  await snapshot(daysAgo(now, 1), "mega", 4000);
  await snapshot(daysAgo(now, 8), "quiet", 1000);
  await snapshot(daysAgo(now, 1), "quiet", 1900);

  const first = await generateGrowthReports(now);
  assert.deepEqual(first, { generated: 2, skipped: 0, period: beijingDate(now) }, "Chinese-region accounts over 1000, posts not a gate");
  assert.equal(server.hits(), 2);

  const stored = await loadGrowthReports();
  assert.equal(stored.reports.length, 2);
  assert.equal(stored.reports[0]!.handle, "grow", "the list is ordered by growth, not by name");
  const report = stored.reports[0]!;
  assert.equal(report.growth, 1500);
  assert.equal(report.posts, 6);
  assert.equal(report.perK, 50);
  assert.equal(report.report.conclusion, ANSWER.conclusion);
  assert.equal(report.report.drivers.length, 1);
  assert.equal(stored.reports[1]!.handle, "lowposts");
  assert.equal(stored.reports[1]!.posts, 2, "two posts are enough to be included now");
  assert.equal(stored.summary?.champion.handle, "grow");
  assert.equal(stored.summary?.darkHorse?.handle, "lowposts", "粉丝不到 5 万的账号里每千曝光最高");
  assert.equal(stored.summary?.moves.length, 1, "两条观察里的同一个动作只留一条");
  assert.equal(report.periodStart, beijingDate(daysAgo(now, 6)));
  assert.equal(report.periodEnd, beijingDate(now));

  const mine = await latestReportFor("grow");
  assert.equal(mine?.report.moves[0], ANSWER.moves[0]);
  assert.equal(await latestReportFor("mega"), null, "an English-region account is not reported");
  assert.equal(await latestReportFor("quiet"), null, "900 growth is below the line");

  // 同一周期重跑：覆盖同一行，不会多出一条。
  const second = await generateGrowthReports(now);
  assert.equal(second.generated, 2);
  assert.equal((await loadGrowthReports()).reports.length, 2);
});
