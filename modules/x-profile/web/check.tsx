// 发布前检查（W8）：把自己的草稿贴进来，过一遍字数、话题数、夸张词和链接，再一键去 X 发。
// 所有检查都在浏览器里算，正文不上传；去 X 发是官方 Web Intent，最后一步仍由你自己点。
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { pageMeta } from "@aihot/web/lib/seo";
import { KEYS, readRaw, writeRaw } from "@aihot/web/lib/local-state";
import { copyText } from "@aihot/web/lib/clipboard";
import { IconCopy } from "@aihot/web/components/icons";
import { checkText } from "./check-rules";
import { IconCheck } from "./icons";

export function meta() {
  return pageMeta({
    title: "发布前检查：发之前先过一遍",
    description: "贴进你的 X 草稿，检查字数、话题数、夸张词和链接；正文不上传，去 X 发用官方 Web Intent。",
    path: "/x-people/check",
  });
}

export const handle = { tab: "x-tools", name: "发布前检查" } as const;

export default function CheckPage() {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    setText(readRaw(KEYS.xDraft) ?? "");
  }, []);

  useEffect(() => {
    writeRaw(KEYS.xDraft, text);
  }, [text]);

  const check = useMemo(() => checkText(text), [text]);
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

  const rows = [
    { label: "有正文", ok: !check.empty, note: check.empty ? "先写点什么" : "" },
    { label: "不超过 280 字（中文按 2、链接按 23）", ok: !check.empty && check.length <= 280, note: `${check.length} 字` },
    { label: "话题标签不超过 2 个", ok: check.hashtags <= 2, note: `${check.hashtags} 个` },
    { label: "没有夸张承诺", ok: check.banned.length === 0, note: check.banned.length ? `出现：${check.banned.join("、")}` : "" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-4 lg:px-6 space-y-4">
      <nav className="text-[12px] text-ink-3">
        <Link to="/x-people/today" className="hover:text-ink">今天发什么</Link>
        <span className="mx-1.5 text-ink-4">/</span>
        <span className="text-ink-2">发布前检查</span>
      </nav>

      <header>
        <h1 className="text-[24px] font-black tracking-[-0.02em] text-ink lg:text-[28px]">发布前检查</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
          把草稿贴进来，过一遍硬规则再发。检查全在浏览器里完成，正文不会上传；去 X 发用官方 Web Intent，最后一步还是你自己点。
        </p>
      </header>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={9}
        placeholder="把准备发的帖子贴在这里…"
        aria-label="草稿正文"
        className="w-full resize-y rounded-card border border-line bg-surface p-3.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-accent"
      />

      <section className="rounded-card border border-line bg-surface p-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold text-ink">硬规则</h2>
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${check.ok ? "bg-accent-soft text-accent" : "bg-hot-soft text-hot"}`}>
            {check.ok ? "可以发" : check.empty ? "还没写" : "还有要改的"}
          </span>
        </div>
        <ul className="space-y-1.5 text-[12.5px] text-ink-2">
          {rows.map((row) => (
            <li key={row.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={row.ok ? "text-accent" : "text-hot"}>{row.ok ? "✓" : "!"}</span>
              <span>{row.label}</span>
              {row.note && <span className="num text-[11px] text-ink-4">{row.note}</span>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line-soft pt-2 text-[11px] leading-relaxed text-ink-4">
          机器只能查这些；观点是否站得住、数字是否来自原文、外链放在正文还是评论区，仍要你自己过一遍。带链接不一定会被限流（本站回测里带与不带持平），但链接会占一个卡片位置。
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={intent}
          target="_blank"
          rel="noreferrer"
          aria-disabled={check.empty}
          onClick={(event) => { if (check.empty) event.preventDefault(); }}
          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold ${check.empty ? "cursor-not-allowed border border-line bg-bg-sunk text-ink-4" : "bg-ink text-bg hover:opacity-90"}`}
        >
          去 X 发 →
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await copyText(text);
              setCopyFailed(false);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
              setCopyFailed(true);
            }
          }}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          {copied ? <IconCheck size={12} className="text-ok" /> : <IconCopy size={12} />}
          {copyFailed ? "复制失败，请手动选中" : copied ? "已复制" : "复制正文"}
        </button>
        <button
          type="button"
          onClick={() => setText("")}
          className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:border-hot hover:text-hot"
        >
          清空
        </button>
        <Link to="/x-people/today" className="ml-auto text-[12.5px] text-accent hover:underline">回今天发什么 →</Link>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-4">
        去 X 发只带文字；图片、视频和投票要在 X 的发布框里自己加。草稿只存在这个浏览器里。
      </p>
    </div>
  );
}
