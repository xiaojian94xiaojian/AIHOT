// 互动结构的两块：全站中位数（每千次曝光的赞/转/评/引），以及把「我的结构」和它比出来的一句话。
//
// 为什么比中位而不是比权重：X 公开的权重乘的是「预测概率」，不是互动计数，直接拿 5.0、0.708 比大小
// 只会让人误读。读者真正能用的信息是「我的回复/引用占比，比同站账号高还是低」。
import { sql } from "@aihot/backend/db";

export interface Structure {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
}

const EMPTY: Structure = { likes: 0, reposts: 0, replies: 0, quotes: 0 };

/** 每千次曝光的互动中位（只算 120 天内有发帖、曝光合计过千的账号，避免小样本拉偏）。 */
export async function structureMedians(): Promise<Structure> {
  const [row] = await sql<{ likes: string | null; reposts: string | null; replies: string | null; quotes: string | null }[]>`
    WITH per_account AS (
      SELECT a.source_id,
             1000.0 * sum((a.raw->>'favorite')::numeric) / nullif(sum((a.raw->>'views')::numeric), 0) AS likes,
             1000.0 * sum((a.raw->>'retweet')::numeric) / nullif(sum((a.raw->>'views')::numeric), 0) AS reposts,
             1000.0 * sum((a.raw->>'reply')::numeric) / nullif(sum((a.raw->>'views')::numeric), 0) AS replies,
             1000.0 * sum((a.raw->>'quote')::numeric) / nullif(sum((a.raw->>'views')::numeric), 0) AS quotes
      FROM articles a
      WHERE a.source_id LIKE 'x-account-%' AND a.published_at > now() - interval '120 days'
      GROUP BY a.source_id
      HAVING sum((a.raw->>'views')::numeric) >= 1000
    )
    SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY likes)::numeric, 1) AS likes,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY reposts)::numeric, 1) AS reposts,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY replies)::numeric, 1) AS replies,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY quotes)::numeric, 1) AS quotes
    FROM per_account`;
  return {
    likes: Number(row?.likes ?? 0),
    reposts: Number(row?.reposts ?? 0),
    replies: Number(row?.replies ?? 0),
    quotes: Number(row?.quotes ?? 0),
  };
}

/**
 * 一句话诊断：每 1 个赞对应多少次回复/引用，和全站中位比。
 * 回复和引用的权重是点赞的七倍多，所以这项偏高的账号，同样的曝光更容易被推荐。
 */
export function structureVerdict(mine: Structure, median: Structure = EMPTY): string {
  const discuss = mine.replies + mine.quotes;
  if (mine.likes + mine.reposts + discuss <= 0) return "互动还太少，看不出结构；等发几条再来看。";
  if (mine.likes <= 0) return "只有回复/引用、没有点赞：讨论型很强，但样本少，再看看。";
  const ratio = discuss / mine.likes;
  const base = median.likes > 0 ? (median.replies + median.quotes) / median.likes : 0;
  if (base <= 0) return `每 1 个赞对应 ${ratio.toFixed(2)} 次回复/引用；全站中位暂时不够算。`;
  const times = ratio / base;
  if (times >= 1.5) {
    return `偏讨论型：每 1 个赞有 ${ratio.toFixed(2)} 次回复/引用，是全站中位（${base.toFixed(2)}）的 ${times.toFixed(1)} 倍——内容能引发讨论，结尾继续留问题。`;
  }
  if (times <= 0.7) {
    return `偏点赞型：每 1 个赞只有 ${ratio.toFixed(2)} 次回复/引用（全站中位 ${base.toFixed(2)}）——想涨得快，结尾抛个问题或做对比。`;
  }
  return `结构接近全站中位：每 1 个赞 ${ratio.toFixed(2)} 次回复/引用（中位 ${base.toFixed(2)}），点赞和讨论都有；想更快就往讨论侧偏一点。`;
}
