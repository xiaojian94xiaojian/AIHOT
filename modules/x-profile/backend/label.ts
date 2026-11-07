// 账号初标：用模型给中文区 Top100 标「类型」和「主类目」，写进 x_account_meta。
// 只在一次性脚本里跑（modules/x-profile/scripts/label-accounts.ts），不在页面里调模型；
// 证据只给最近几条帖子和一行统计，标不准的让人在后台改。
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { modelFor } from "@aihot/backend/editorial/models";
import { chatJson } from "@aihot/backend/providers/llm";
import { listPeople } from "./data.ts";


const PROMPT_VERSION = "x-account-label-v1";
const POSTS_GIVEN = 4;
const POST_CHARS = 240;

const LabelSchema = z.object({
  kind: z.enum(["official", "founder", "researcher", "media", "builder", "other"]),
  category: z.enum(["opinion", "product", "model", "industry", "paper", "tip", "other"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(200),
});

const SYSTEM = [
  "你在给一批 X（推特）账号标类型和主类目，供一个中文 AI 行业站筛选和展示。",
  "类型只能取：official（公司/产品官方号）、founder（创始人/高管）、researcher（研究者/学者）、media（媒体/分析/资讯号）、builder（开发者/独立创作者/产品人）、other。",
  "主类目只能取：opinion（观点/思考）、product（产品/工具/发布）、model（模型/技术能力）、industry（产业/公司/商业）、paper（论文/研究）、tip（教程/技巧/经验）、other。",
  "只看给到的名字和最近几条帖子，不确定就选 other 并把 confidence 调低；不要猜。",
  "只输出一个 JSON 对象，不要代码块、不要额外文字，键必须正好是：",
  '{"kind": "builder", "category": "opinion", "confidence": 0.7, "reason": "一句话依据"}',
].join("\n");

interface PostRow {
  source_id: string;
  text: string | null;
}

/** 给一个账号的最近几条帖子（截断）；一次查询按 source_id 分区，避免 N+1。 */
async function recentPosts(sourceIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sourceIds.length === 0) return out;
  const rows = await sql<PostRow[]>`
    SELECT source_id, text FROM (
      SELECT a.source_id, a.x_post->>'text' AS text,
             row_number() OVER (PARTITION BY a.source_id ORDER BY a.published_at DESC) AS rn
      FROM articles a
      WHERE a.source_id = ANY(${sourceIds}::text[]) AND a.published_at > now() - interval '180 days'
    ) t WHERE rn <= ${POSTS_GIVEN}`;
  for (const row of rows) {
    const text = (row.text ?? "").replace(/\s+/g, " ").slice(0, POST_CHARS).trim();
    if (!text) continue;
    const list = out.get(row.source_id) ?? [];
    list.push(text);
    out.set(row.source_id, list);
  }
  return out;
}

/**
 * 标一批账号：默认中文区按中位浏览取前 100。逐条调用模型（一次性脚本，不并发压 provider），
 * 失败的不写入，下次重跑会补上。
 */
export async function labelAccounts(opts: { limit?: number } = {}): Promise<{ labeled: number; skipped: number; total: number }> {
  const limit = opts.limit ?? 100;
  const people = (await listPeople()).people
    .filter((person) => person.region === "zh")
    .sort((a, b) => b.medViews - a.medViews)
    .slice(0, limit);
  const posts = await recentPosts(people.map((person) => person.sourceId));
  const model = await modelFor("x_account_label");
  let labeled = 0;
  let skipped = 0;
  for (const person of people) {
    const samples = posts.get(person.sourceId) ?? [];
    const evidence = [
      `账号：${person.author}（@${person.handle}）`,
      `统计：${person.posts} 条帖、日均 ${person.postsPerDay} 条、浏览中位 ${person.medViews}。`,
      ...(samples.length ? ["最近的帖子：", ...samples.map((text, index) => `${index + 1}. ${text}`)] : ["没有可用的帖子样本。"]),
    ].join("\n");
    try {
      const answer = await chatJson({
        model,
        purpose: "x_account.label",
        subject: `x-account-label:${person.handle}`,
        promptVersion: PROMPT_VERSION,
        system: SYSTEM,
        user: evidence,
        schema: LabelSchema,
        temperature: 0,
        maxTokens: 400,
      });
      const label = answer.data;
      await sql`
        INSERT INTO x_account_meta (handle, kind, category, confidence, reason, model, updated_at)
        VALUES (${person.handle}, ${label.kind}, ${label.category}, ${label.confidence}, ${label.reason}, ${answer.model}, now())
        ON CONFLICT (handle) DO UPDATE SET
          kind = EXCLUDED.kind, category = EXCLUDED.category, confidence = EXCLUDED.confidence,
          reason = EXCLUDED.reason, model = EXCLUDED.model, updated_at = now()`;
      labeled += 1;
    } catch {
      skipped += 1;
    }
  }
  return { labeled, skipped, total: people.length };
}
