// 今天发什么：把站内热点榜和 X 上的讨论量摆在一起，告诉一个博主「今天能写什么、怎么写」。
// 排序 = 热度 + 48 小时里的 X 帖数 + 报道数；写法建议只按讨论程度给，不预测流量。
import { Link, useLoaderData } from "react-router";
import type { XDailyCard, XTodayResponse } from "../types";
import { apiGet, edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { compact, stamp } from "./format";

export async function loader({ request }: { request: Request }) {
  const handle = (new URL(request.url).searchParams.get("handle") ?? "").trim().replace(/^@/, "");
  const [data, card] = await Promise.all([
    loadOr404<XTodayResponse>("/api/site/x-people/today?limit=6", { signal: request.signal }),
    apiGet<XDailyCard>(`/api/site/x-people/card${handle ? `?handle=${encodeURIComponent(handle)}` : ""}`, { signal: request.signal }).catch(() => null),
  ]);
  return { ...data, card, mineHandle: handle };
}

export function meta() {
  return pageMeta({
    title: "今天发什么：48 小时内的可写选题",
    description: "把站内热点和 X 上的讨论量放在一起，按可写性排序，并给出怎么写的建议。",
    path: "/x-people/today",
  });
}

export function headers() {
  return edgeTtl(300);
}

export const handle = { tab: "x-tools", name: "今天发什么" } as const;

export default function TodayPage() {
  const data = useLoaderData<typeof loader>();
  const { card, mineHandle } = data;
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">今天发什么</span>
      </nav>

      <header className="mt-2">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">今天发什么</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          站内热度和 X 上的讨论量放在一起排：<span className="text-ink-2">已经有人聊的接一句观点</span>，<span className="text-ink-2">还没展开的抢时效</span>。
          从热榜前 12 里挑可写性最高的几条，只数 48 小时内入库的帖子，不额外抓取。
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-4">
          <span>窗口 {data.windowHours} 小时（X 的推荐窗口）</span>
          <span>数据 {stamp(data.generatedAt)}</span>
          <Link to="/x-people/methodology#algorithm" className="text-accent hover:underline">为什么这样排 →</Link>
        </div>
      </header>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-2">
        <input
          name="handle"
          defaultValue={mineHandle}
          placeholder="填你的 @handle，卡片会带上你自己的诊断"
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
        <button type="submit" className="rounded-control border border-line px-3 py-1.5 text-[12.5px] text-ink-2 hover:border-accent hover:text-accent">
          生成我的卡
        </button>
      </form>

      {card && (
        <section className="mt-4 rounded-card border border-accent/30 bg-accent/5 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-accent">今天写这条</h2>
            <span className="text-[11px] text-ink-4">一天只推一条</span>
          </div>
          <Link to={card.topic.url} className="mt-1 block break-words text-[17px] font-bold leading-snug text-ink hover:text-accent">
            {card.topic.title}
          </Link>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
            <span className="text-ink-4">怎么写　</span>{card.angle}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.numbers.map((n) => (
              <span key={n.label} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11.5px] text-ink-2">
                {n.label} <b className="num text-ink">{n.value}</b>
              </span>
            ))}
          </div>
          {card.commentable && (
            <div className="mt-2 rounded-card border border-line bg-surface px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-ink-4">
                <span>现在能接一句 · @{card.commentable.handle}</span>
                {card.commentable.remainingViews !== null && <span className="num">12 小时内预计还能涨约 {compact(card.commentable.remainingViews)} 浏览</span>}
              </div>
              <p className="mt-1 line-clamp-2 break-words text-[12.5px] leading-relaxed text-ink">{card.commentable.text || "（无文字）"}</p>
              <div className="num mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
                <span>浏览 {compact(card.commentable.views)}</span>
                <span>回复 {card.commentable.replies}</span>
                <a href={card.commentable.url} target="_blank" rel="noreferrer" className="ml-auto text-accent hover:underline">去回 →</a>
              </div>
            </div>
          )}
          {card.me && (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              <span className="text-ink-4">你的账号　</span>@{card.me.handle} · {card.me.followers === null ? "粉丝快照积累中" : `${compact(card.me.followers)} 粉`} · {card.me.verdict}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
            <a href={card.links.post} target="_blank" rel="noreferrer" className="rounded-full bg-ink px-3 py-1 font-medium text-bg hover:opacity-90">去发 →</a>
            {card.links.reply && (
              <a href={card.links.reply} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1 text-ink-2 hover:border-accent">去回 →</a>
            )}
            <Link to={card.topic.url} className="rounded-full border border-line px-3 py-1 text-ink-2 hover:border-accent">看事件</Link>
          </div>
        </section>
      )}

      {data.topics.length === 0 ? (
        <p className="mt-6 rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">
          热点榜还没有数据，等下一轮排名生成后再看。
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {data.topics.map((topic, index) => (
            <li key={topic.storyId} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="num mt-0.5 w-6 shrink-0 text-[15px] font-black text-ink-4">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <Link to={topic.url} className="break-words text-[15px] font-semibold leading-snug text-ink hover:text-accent">
                    {topic.title}
                  </Link>
                  <div className="num mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
                    <span>热度 {compact(topic.heat)}</span>
                    <span>{topic.posts} 条 X 帖</span>
                    <span>{topic.reports} 篇报道</span>
                    {topic.repliesPerK > 0 && <span>每千曝光回复 {topic.repliesPerK}</span>}
                    <span className="text-ink-4">最近 {stamp(topic.latestAt)}</span>
                  </div>

                  <div className="mt-2 rounded-card bg-accent/5 px-3 py-2 text-[12.5px] leading-relaxed">
                    <div className="text-ink-2"><span className="font-medium text-accent">怎么写　</span>{topic.angle}</div>
                    <div className="mt-1 text-ink-3"><span className="text-ink-4">为什么　</span>{topic.why}</div>
                  </div>

                  {(topic.commentables ?? []).length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] text-ink-4">现在能接一句 · 中文区 · 1–12 小时前发的</div>
                      <div className="mt-1 space-y-1.5">
                        {(topic.commentables ?? []).map((post) => (
                          <a
                            key={post.id}
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-card border border-accent/30 bg-accent/[0.04] px-2.5 py-1.5 transition-colors hover:border-accent/60"
                          >
                            <div className="line-clamp-2 break-words text-[12px] leading-relaxed text-ink">{post.text || "（无文字）"}</div>
                            <div className="num mt-1 flex flex-wrap items-center gap-x-2.5 text-[10.5px] text-ink-4">
                              <span className="text-ink-3">@{post.handle}</span>
                              <span>浏览 {compact(post.views)}</span>
                              <span>回复 {post.replies}</span>
                              <span className="ml-auto text-accent">去回 →</span>
                            </div>
                            <div className="mt-0.5 text-[10.5px] text-ink-4">{post.reason}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {(topic.commentables ?? []).length === 0 && (
                    <p className="mt-2 text-[11.5px] text-ink-4">
                      本题暂无可评样本（中文区、1–12 小时内、浏览 ≥50、回复 &lt;50）。
                    </p>
                  )}

                  {topic.refs.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] text-ink-4">参考帖（近 48 小时）</div>
                      <div className="mt-1 space-y-1.5">
                        {topic.refs.map((post) => (
                          <a
                            key={post.id}
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-card border border-line px-2.5 py-1.5 transition-colors hover:border-accent/50"
                          >
                            <div className="line-clamp-2 break-words text-[12px] leading-relaxed text-ink">{post.text || "（无文字）"}</div>
                            <div className="num mt-1 flex flex-wrap gap-x-2.5 text-[10.5px] text-ink-4">
                              <span>浏览 {compact(post.views)}</span>
                              <span>赞 {compact(post.likes)}</span>
                              <span>转 {compact(post.retweets)}</span>
                              {post.replies > 0 && <span>评 {compact(post.replies)}</span>}
                              {post.quotes > 0 && <span>引 {compact(post.quotes)}</span>}
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-4">
        三条硬规则（来自 X 公开的 For You 算法）：帖子超过 48 小时不再进推荐；回复、引用的权重是点赞的七倍多；
        打开外链的权重只有 0.2，正文讲完再放链接。可评帖只取中文区、1–12 小时前、浏览 ≥50、回复 &lt;50 的帖子（口径按本站数据校准过）。
      </p>
    </div>
  );
}
