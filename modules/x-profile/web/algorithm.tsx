// 算法视角：X 公开的 For You 权重 × 本站数据，回测三个常见说法；只写我们真能测的。
import { Link, useLoaderData } from "react-router";
import type { XAlgorithmResponse } from "../types";
import { edgeTtl, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { stamp } from "./format";

export async function loader({ request }: { request: Request }) {
  return loadOr404<XAlgorithmResponse>("/api/site/x-people/algorithm", { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "算法视角：用数据回测 X 的排序规则",
    description: "X 公开了 For You 的权重，我们拿本站采集的帖子回测「连发衰减、外链限流、讨论率涨粉」三个说法。",
    path: "/x-people/algorithm",
  });
}

export function headers() {
  return edgeTtl(600);
}

export const handle = { tab: "x-tools", name: "算法视角" } as const;

const TONE: Record<string, string> = {
  成立: "border-ok/40 bg-ok/10 text-ok",
  不成立: "border-line bg-bg-sunk text-ink-2",
  看不清: "border-accent/30 bg-accent/5 text-accent",
};

export default function AlgorithmPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 lg:px-6">
      <nav className="mt-1 text-[12px] text-ink-3">
        <Link to="/x-people" className="hover:text-ink">博主画像</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">算法视角</span>
      </nav>

      <header className="mt-2">
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">算法视角</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          X 把 For You 的排序代码和权重公开了（<a href="https://github.com/xai-org/x-algorithm" target="_blank" rel="noreferrer" className="text-accent hover:underline">xai-org/x-algorithm</a>）。
          但「官方说会这样」不等于「我们的数据里真是这样」——下面三个说法，我们用本站采集的帖子各回测了一遍。
        </p>
        <div className="mt-2 text-[11.5px] text-ink-4">
          数据 {stamp(data.generatedAt)} · 窗口 120 天 · 只算原创帖
          <Link to="/x-people/methodology#algorithm" className="ml-3 text-accent hover:underline">官方权重表 →</Link>
        </div>
      </header>

      <ol className="mt-4 space-y-3">
        {data.checks.map((check, index) => (
          <li key={check.key} className="rounded-card border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="num text-[12px] text-ink-4">{String(index + 1).padStart(2, "0")}</span>
              <h2 className="text-[14px] font-semibold text-ink">{check.claim}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE[check.verdict] ?? "border-line text-ink-2"}`}>{check.verdict}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{check.summary}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {check.rows.map((row) => (
                <div key={row.label} className="rounded-card bg-bg-sunk/60 px-3 py-2">
                  <div className="num text-[16px] font-semibold text-ink">{row.value}</div>
                  <div className="text-[11px] text-ink-3">{row.label}</div>
                  {row.hint && <div className="num text-[10.5px] text-ink-4">{row.hint}</div>}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-4 rounded-card border border-line-soft bg-bg-sunk/50 p-4 text-[12.5px] leading-relaxed text-ink-2">
        <h2 className="text-[13px] font-semibold text-ink">我们测不了的三件事</h2>
        <ul className="mt-2 space-y-1.5">
          <li><b className="text-ink">48 小时窗口：</b>只看排序，看不到每条帖子的曝光曲线；我们的快照只记采集那一刻的值，无法还原「过 48 小时就掉」。这条我们照官方文档写，没法自证。</li>
          <li><b className="text-ink">负向信号（举报、静音、不想看）：</b>这些动作发生在别人的信息流里，本站看不到。</li>
          <li><b className="text-ink">「预测概率」本身：</b>权重乘的是模型对每个人会不会互动的预测概率，我们没有这个概率，只能用互动计数做代理。</li>
        </ul>
      </section>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-4">
        口径：只算 120 天内的原创帖（不含回复）；「×倍数」= 该群体浏览中位 ÷ 该账号自己的浏览中位，按账号逐一对照，避免大号把结论带偏。
        相关性用曝光过万的账号算（n 写在卡片里），样本少时宁可写「看不清」。
      </p>
    </div>
  );
}
