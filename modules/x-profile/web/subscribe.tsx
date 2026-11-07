// 「订阅周报」的入口：手机上直接打开 RSS 链接，iOS 会弹「无法打开网页，这是 RSS 提要链接」。
// 所以不直接跳转，而是弹一个小面板：说明 + 可复制的订阅地址 + 常用阅读器的订阅链接。
import { useEffect, useState } from "react";
import { copyText } from "@aihot/web/lib/clipboard";

const READERS = [
  { name: "Feedly", url: (feed: string) => `https://feedly.com/i/subscription/feed/${encodeURIComponent(feed)}` },
  { name: "Inoreader", url: (feed: string) => `https://www.inoreader.com/?add_feed=${encodeURIComponent(feed)}` },
];

export function SubscribeButton({ handle, label = "订阅周报", className = "" }: { handle: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // 绝对地址在浏览器里算：SSR 时没有 location。
  const [feed, setFeed] = useState(`/feed/x/${handle}.xml`);
  useEffect(() => {
    if (typeof window !== "undefined") setFeed(new URL(`/feed/x/${handle}.xml`, window.location.origin).toString());
  }, [handle]);
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const copy = async () => {
    try {
      await copyText(feed);
      setCopied(true);
    } catch {
      // 复制失败（极少数内嵌浏览器）：地址框就在上面，手动选中也能复制。
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={`订阅 @${handle} 的涨粉周报`}>
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-md rounded-sheet bg-raised p-5 shadow-2xl ring-1 ring-line-strong">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-ink">订阅 @{handle} 的涨粉周报</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭" className="rounded-full px-2 py-0.5 text-[13px] text-ink-3 hover:bg-bg-sunk hover:text-ink">
                ✕
              </button>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
              每周一条：涨了多少粉、在榜上第几名。把下面的地址加到 RSS 阅读器里就行；浏览器直接点开会打不开（Safari 会提示这是 RSS 提要）。
            </p>
            <div className="mt-3 flex gap-2">
              <input
                id={`feed-${handle}`}
                readOnly
                value={feed}
                onFocus={(event) => event.currentTarget.select()}
                className="num min-w-0 flex-1 rounded-control border border-line bg-bg-sunk px-2.5 py-1.5 text-[12px] text-ink-2"
              />
              <button type="button" onClick={copy} className="shrink-0 rounded-control bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg">
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-ink-4">一键订阅：</span>
              {READERS.map((reader) => (
                <a
                  key={reader.name}
                  href={reader.url(feed)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-2.5 py-0.5 text-ink-2 hover:border-accent hover:text-accent"
                >
                  {reader.name}
                </a>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
              不想用阅读器？也可以直接收藏画像页，每周一看就行。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
