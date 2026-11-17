// 发布闭环（W19）：用自己的 handle 自动找最近发的帖，对上推荐话题，并用粉丝快照算发布后 7 天的增量。
// 没有账号系统：handle 只是查询参数，不落库；话题匹配是关键词重合的启发式，历史当日话题未存档。
import { sql } from "@aihot/backend/db";
import { addDays, beijingDate, beijingMidnight, BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { notWithdrawn } from "./visibility.ts";
import { sourceIdsOfHandle } from "./followers.ts";
import { todaysTopics } from "./today.ts";
import type { XDeskPost, XDeskResponse, XTodayTopic } from "../types.ts";

const DAY = 86_400_000;
const STOP = new Set(["我们", "他们", "什么", "怎么", "为什么", "如何", "这个", "那个", "一个", "可以", "已经", "因为", "所以", "但是", "不是", "就是"]);

/** 关键词：英文/数字词 + 中文二元组；用于「这条帖像在说哪个推荐话题」的粗匹配。 */
export function tokensOf(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9][a-z0-9+.-]{2,}/g) ?? []) out.add(word);
  for (const run of lower.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!STOP.has(bigram)) out.add(bigram);
    }
  }
  return out;
}

/** 帖子关键词和每个推荐话题的重合数；至少 2 分才算匹配，最多留 2 个。 */
export function matchTopics(text: string, topics: Array<{ title: string; url: string }>): Array<{ title: string; url: string; score: number }> {
  const postTokens = tokensOf(text);
  return topics
    .map((topic) => {
      const topicTokens = tokensOf(topic.title);
      let score = 0;
      for (const token of topicTokens) if (postTokens.has(token)) score += 1;
      // 英文/产品名命中一次更像真的在说同一件事。
      for (const token of topicTokens) if (/^[a-z0-9+.-]{4,}$/.test(token) && postTokens.has(token)) score += 2;
      return { title: topic.title, url: topic.url, score };
    })
    .filter((topic) => topic.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

export interface FollowerPoint {
  on: string;
  followers: number;
}

/** 发布日之后的第一次快照 → 第 7 天及之前的最后一次快照，算这 7 天的粉丝增量。 */
export function growthWithin(points: FollowerPoint[], postDay: string, days = 7): { growth: number; pct: number; base: number } | null {
  const start = points.findIndex((point) => point.on >= postDay);
  if (start < 0) return null;
  const target = addDays(postDay, days);
  let end = -1;
  for (let index = start; index < points.length; index += 1) {
    if (points[index]!.on <= target) end = index;
    else break;
  }
  if (end <= start) return null;
  const base = points[start]!.followers;
  const growth = points[end]!.followers - base;
  return { growth, pct: base > 0 ? Math.round((growth / base) * 1000) / 10 : 0, base };
}

function dayDiff(from: string, to: string): number {
  return Math.round((beijingMidnight(to).getTime() - beijingMidnight(from).getTime()) / DAY);
}

/** 自己的发布闭环：最近 21 天的帖 + 匹配话题 + 7 天粉丝增量。 */
export async function loadDesk(handle: string): Promise<XDeskResponse> {
  const key = handle.toLowerCase();
  const topics = await todaysTopics(6);
  const ids = await sourceIdsOfHandle(key);
  if (ids.length === 0) {
    return { handle: key, generatedAt: new Date().toISOString(), topics: topicItems(topics.topics), posts: [], notes: notes() };
  }
  const [rows, snapshots] = await Promise.all([
    sql<{ id: string; tweet_id: string | null; text: string | null; published_at: Date; views: string; likes: string }[]>`
      SELECT a.id, a.x_post->>'tweetId' AS tweet_id, a.x_post->>'text' AS text, a.published_at,
             coalesce((a.raw->>'views')::bigint, 0)::text AS views,
             coalesce((a.raw->>'favorite')::bigint, 0)::text AS likes
      FROM articles a
      WHERE a.source_id = ANY(${ids}::text[])
        AND a.published_at > now() - interval '21 days'
        AND ${notWithdrawn}
      ORDER BY a.published_at DESC
      LIMIT 100`,
    sql<{ on: string; followers: string }[]>`
      SELECT to_char(captured_on, 'YYYY-MM-DD') AS on, followers::text AS followers
      FROM x_follower_snapshots
      WHERE lower(handle) = ${key} AND captured_on >= (now() AT TIME ZONE ${BEIJING_TIMEZONE})::date - 60
      ORDER BY captured_on`,
  ]);
  const points: FollowerPoint[] = snapshots.map((row) => ({ on: row.on, followers: Number(row.followers) }));
  const today = beijingDate(new Date());
  const topicList = topicItems(topics.topics);

  const posts: XDeskPost[] = rows.map((row) => {
    const postDay = beijingDate(row.published_at);
    const ageDays = dayDiff(postDay, today);
    const seven = ageDays >= 7 ? growthWithin(points, postDay, 7) : null;
    return {
      id: row.id,
      url: row.tweet_id ? `https://x.com/${key}/status/${row.tweet_id}` : `https://x.com/${key}`,
      text: row.text ?? "",
      at: new Date(row.published_at).toISOString(),
      views: Number(row.views),
      likes: Number(row.likes),
      ageDays,
      status: ageDays < 7 ? "pending" : seven ? "matured" : "unavailable",
      growth7: seven?.growth ?? null,
      growth7Pct: seven?.pct ?? null,
      topics: matchTopics(row.text ?? "", topicList),
    };
  });

  return { handle: key, generatedAt: new Date().toISOString(), topics: topicList, posts, notes: notes() };
}

function topicItems(topics: XTodayTopic[]) {
  return topics.map((topic) => ({ title: topic.title, url: topic.url, angle: topic.angle }));
}

function notes(): string[] {
  return [
    "话题匹配按当前推荐话题的关键词重合算；历史当日话题没有存档，只能当参考。",
    "7 天增量是账号整体的涨粉（发布日之后的第一个粉丝快照 → 第 7 天及之前的最后一次快照），不是这一条帖带来的；同一天发的帖会看到同一个数。",
    "handle 只存在浏览器和这个查询参数里，不写入服务器。",
  ];
}
