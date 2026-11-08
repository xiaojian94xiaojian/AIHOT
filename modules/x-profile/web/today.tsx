// 今天发什么：把站内热点榜和 X 上的讨论量摆在一起，告诉一个博主「今天能写什么、怎么写」。
// 排序 = 热度 + 48 小时里的 X 帖数 + 报道数；写法建议只按讨论程度给，不预测流量。
import { Link, useLoaderData } from "react-router";
import type { XDailyCard, XTodayResponse } from "../types";
import { apiGet, edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { SourceAvatar } from "@aihot/web/components/ui/SourceAvatar";
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
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 lg:px-6 space-y-4">
      <nav className="text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">今天发什么</span>
      </nav>

      <header>
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">今天发什么</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
          站内热度和 X 上的讨论量放在一起排：<span className="text-ink-2 font-medium">已经有人聊的接一句观点</span>，<span className="text-ink-2 font-medium">还没展开的抢时效</span>。
          从热榜前 12 里挑可写性最高的几条，只数 48 小时内入库的帖子，不额外抓取。
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-4">
          <span>窗口 {data.windowHours} 小时（X 的推荐窗口）</span>
          <span>数据截至 {stamp(data.generatedAt)}</span>
          <Link to="/x-people/methodology#algorithm" className="text-accent hover:underline">为什么这样排 →</Link>
        </div>
      </header>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <label htmlFor="today-handle-input" className="sr-only">输入你的 X Handle</label>
        <input
          id="today-handle-input"
          name="handle"
          defaultValue={mineHandle}
          placeholder="填你的 @handle，卡片会带上你自己的诊断"
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
        />
        <button type="submit" className="min-h-[36px] rounded-control border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-accent font-medium">
          生成我的卡
        </button>
      </form>

      {/* 今日推荐卡片视觉升级：突出头号选题与可互动靶点 */}
      {card && (
        <section className="rounded-card border-2 border-accent/40 bg-accent-soft p-4 lg:p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-accent/20 pb-2.5">
            <h2 className="text-[13px] font-bold text-accent flex items-center gap-1.5">
              <span>★ 今日头号推荐选题</span>
            </h2>
            <span className="text-[11px] text-ink-4">每天精选 1 条高讨论度热点</span>
          </div>
          <Link to={card.topic.url} className="block break-words text-[18px] font-bold leading-snug text-ink hover:text-accent transition">
            {card.topic.title}
          </Link>
          <div className="rounded-control bg-surface border border-line p-3 text-[12.5px] leading-relaxed text-ink-2">
            <span className="text-ink-4 font-semibold mr-1.5">怎么写建议：</span>{card.angle}
          </div>
          <div className="flex flex-wrap gap-2">
            {card.numbers.map((n) => (
              <span key={n.label} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 shadow-sm">
                {n.label} <b className="num text-ink">{n.value}</b>
              </span>
            ))}
          </div>
          {card.commentable && (
            <div className="rounded-card border border-line bg-surface p-3.5 space-y-2 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-ink-4">
                <span className="font-semibold text-ink-3">活跃讨论靶点 · 可直接去接一句观点：</span>
                {card.commentable.remainingViews !== null && <span className="num">12 小时内预计还能涨约 {compact(card.commentable.remainingViews)} 浏览</span>}
              </div>
              <div className="flex items-start gap-2.5">
                <SourceAvatar name={card.commentable.handle} size={28} />
                <div className="min-w-0 flex-1">
                  <span className="num text-xs font-bold text-ink">@{card.commentable.handle}</span>
                  <p className="mt-0.5 line-clamp-2 break-words text-[12.5px] leading-relaxed text-ink">{card.commentable.text || "（无文字）"}</p>
                </div>
              </div>
              <div className="num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3 pt-2 border-t border-line-soft">
                <span>浏览 {compact(card.commentable.views)}</span>
                <span>回复 {card.commentable.replies}</span>
                <a href={card.commentable.url} target="_blank" rel="noreferrer" className="ml-auto text-accent hover:underline font-bold">去 X 回复 →</a>
              </div>
            </div>
          )}
          {/* 一键去发 / 去回 / 看事件：卡片的核心动作，别在改版里丢。 */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[12.5px]">
            <a
              href={card.links.post}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[32px] items-center rounded-full bg-ink px-3.5 py-1 font-medium text-bg transition-opacity hover:opacity-90"
            >
              去发 →
            </a>
            {card.links.reply && (
              <a
                href={card.links.reply}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[32px] items-center rounded-full border border-line bg-surface px-3.5 py-1 text-ink-2 transition-colors hover:border-accent hover:text-accent"
              >
                去回 →
              </a>
            )}
            <Link
              to={card.topic.url}
              className="inline-flex min-h-[32px] items-center rounded-full border border-line bg-surface px-3.5 py-1 text-ink-2 transition-colors hover:border-accent hover:text-accent"
            >
              看事件
            </Link>
            <Link to="/x-people/alerts" className="ml-auto text-[11.5px] text-ink-4 transition-colors hover:text-accent">
              每天发到飞书 →
            </Link>
          </div>
          {/* 填了 handle 才有：这个账号自己的诊断，不填就不占地方。 */}
          {card.me && (
            <p className="text-[12px] leading-relaxed text-ink-3">
              <span className="text-ink-4">你的账号　</span>@{card.me.handle} ·{" "}
              {card.me.followers === null ? "粉丝快照积累中" : `${compact(card.me.followers)} 粉`} · {card.me.verdict}
            </p>
          )}
        </section>
      )}

      {data.topics.length === 0 && (
        <p className="mt-6 rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-3">
          热点榜还没有数据：等内容入库、事件归组跑完，这里会自动出现选题。
        </p>
      )}

      {/* 选题列表卡片化展示 */}
      <ol className="space-y-3 pt-1">
        {data.topics.map((t, index) => (
          <li key={t.storyId} className="rounded-card border border-line bg-surface p-4 lg:p-5 shadow-sm space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="num text-xs font-bold text-ink-4 px-2 py-0.5 rounded-control bg-bg-sunk">#{String(index + 1).padStart(2, "0")}</span>
              <span className="text-[11px] text-ink-4 num font-medium">热度 {compact(t.heat)} · {t.posts} 条 X 帖 · {t.reports} 篇报道{t.repliesPerK > 0 ? ` · 每千曝光回复 ${t.repliesPerK}` : ""} · 最近 {stamp(t.latestAt)}</span>
            </div>
            <Link to={t.url} className="block break-words text-[16px] font-bold leading-snug text-ink hover:text-accent transition">
              {t.title}
            </Link>
            <div className="rounded-control bg-bg-sunk/60 p-2.5 text-[12.5px] leading-relaxed text-ink-2">
              <div><span className="text-ink-4 font-semibold mr-1">怎么写：</span>{t.angle}</div>
              <div className="mt-1 text-ink-3"><span className="text-ink-4">为什么：</span>{t.why}</div>
            </div>
            {t.commentables.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] text-ink-4 font-medium">现在能接一句 · 中文区 · 1–12 小时前发的：</span>
                {t.commentables.slice(0, 2).map((tw) => (
                  <div key={tw.url} className="rounded-control bg-bg-sunk/50 border border-line-soft p-2.5 text-[12px] leading-relaxed text-ink-2 flex flex-col justify-between gap-1">
                    <p className="line-clamp-2 break-words">{tw.text || "（无文字）"}</p>
                    {tw.reason && <p className="text-[11px] text-ink-4">为什么现在接：{tw.reason}</p>}
                    <div className="num mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-4">
                      <span className="font-semibold text-ink-3">@{tw.handle}</span>
                      <span>浏览 {compact(tw.views)}</span>
                      <span>回复 {tw.replies}</span>
                      <a href={tw.url} target="_blank" rel="noreferrer" className="ml-auto text-accent hover:underline font-medium">看原帖 →</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="text-[11.5px] leading-relaxed text-ink-4 pt-2">
        热点来自站内入库的事件聚类；X 讨论量只数最近 48 小时本站采集到的帖子，不等于全网总量。
        建议只说明怎么切入，不保证发了就有流量。
      </p>
    </div>
  );
}
