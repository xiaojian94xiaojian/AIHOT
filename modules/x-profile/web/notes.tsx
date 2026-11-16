// 统一的「测不准」写法（W6）：能测的给置信度，测不了的集中写清楚，别在每页各写一套。
// 置信度是模型对结论证据强弱的自评（高/中/低），不是概率；「测不了」只列本站数据看不到的东西。
import type { ReactNode } from "react";

const CONFIDENCE = {
  high: { label: "高", hint: "样本和口径都够，换一周也大致成立" },
  medium: { label: "中", hint: "方向可信，但样本或口径有限，别当定论" },
  low: { label: "低", hint: "只说明这一次的观察，证据不足" },
} as const;

export function Confidence({ level }: { level: keyof typeof CONFIDENCE }) {
  const meta = CONFIDENCE[level];
  return (
    <span className="inline-flex items-baseline gap-1" title={meta.hint}>
      <span className="text-ink-4">置信度</span>
      <span className="rounded-full bg-bg-sunk px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-2">{meta.label}</span>
    </span>
  );
}

export function Untestable({ title = "我们测不了的部分", items }: { title?: string; items: Array<{ label: string; text: ReactNode }> }) {
  return (
    <section className="rounded-card border border-line-soft bg-bg-sunk/50 p-4 text-[12.5px] leading-relaxed text-ink-2 space-y-2">
      <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
        <span aria-hidden="true">ℹ</span> {title}
      </h2>
      <ul className="space-y-1.5 text-ink-3">
        {items.map((item) => (
          <li key={item.label}>
            <b className="text-ink">{item.label}：</b>
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
