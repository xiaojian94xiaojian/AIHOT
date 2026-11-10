// 页面上的小图表：全是 div 拼的柱状图，不引第三方图形库。
import { useId, useState } from "react";

export interface BarDatum {
  label: string;
  value: number;
  formatted?: string;
}

/**
 * 一排竖柱。`height` 是绘图区的高度（px）；`format` 决定悬停提示里的数；
 * `labelEvery` 控制横轴标签的疏密（24 小时只标每 3 个）。
 */
export function Bars({ data, height = 80, format = (n: number) => n.toLocaleString("en-US"), labelEvery = 1 }: {
  data: BarDatum[];
  height?: number;
  format?: (n: number) => string;
  labelEvery?: number;
}) {
  const [activeBar, setActiveBar] = useState<BarDatum | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const id = useId();
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }} role="group" aria-labelledby={id}>
        {data.map((d, index) => {
          const isActive = activeBar?.label === d.label;
          return (
            <button
              key={`${d.label}-${index}`}
              type="button"
              onClick={() => setActiveBar((curr) => (curr?.label === d.label ? null : d))}
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setActiveBar(d); }}
              aria-pressed={isActive}
              tabIndex={isActive || (activeBar === null && index === 0) ? 0 : -1}
              data-bar={`${id}-${index}`}
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const nextIndex = (index + step + data.length) % data.length;
                setActiveBar(data[nextIndex]);
                document.querySelector<HTMLElement>(`[data-bar="${id}-${nextIndex}"]`)?.focus();
              }}
              aria-label={`${d.label}：${d.formatted ?? format(d.value)}`}
              className="group relative flex h-full flex-1 items-end focus-visible:ring-2 focus-visible:ring-accent focus:outline-none"
              title={`${d.label}：${d.formatted ?? format(d.value)}`}
            >
              <div
                className={`w-full rounded-t-mark transition-colors ${
                  isActive ? "bg-accent" : "bg-accent/70 group-hover:bg-accent"
                }`}
                style={{ height: `${Math.max(d.value > 0 ? 4 : 1, (d.value / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {data.map((d, index) => (
          <div key={`${d.label}-${index}-l`} className="num flex-1 truncate text-center text-[10px] leading-tight text-ink-4">
            {index % labelEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
      {activeBar && (
        <div aria-live="polite" className="mt-1 flex items-center justify-between rounded-control border border-line-soft bg-bg-sunk/40 px-2 py-0.5 text-[11px] text-ink-3">
          <span>{activeBar.label}</span>
          <span className="num font-bold text-accent">{activeBar.formatted ?? format(activeBar.value)}</span>
        </div>
      )}
      <span id={id} className="sr-only">柱状图，最大值 {format(max)}</span>
    </div>
  );
}

/** 横向条形：分类、标签这类名字较长的分布。 */
export function Rows({ data, format = (n: number) => n.toLocaleString("en-US") }: {
  data: BarDatum[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-3 text-[13px]">
          <span className="w-24 shrink-0 truncate text-ink-2">{d.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg-sunk">
            <span className="block h-full rounded-full bg-accent/75" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </span>
          <span className="num shrink-0 text-right text-[12px] text-ink-3">{d.formatted ?? format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** KPI 卡片里的迷你趋势线：只表达形状，不加坐标轴。 */
export function Spark({ points, width = 120, height = 30, className }: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return <div className={className} style={{ height }} />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const xy = points.map((value, index) => [index * step, height - 2 - ((value - min) / span) * (height - 4)]);
  const line = xy.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const [lastX, lastY] = xy[xy.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={area} className="fill-accent/10" />
      <path d={line} className="fill-none stroke-accent" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.2} className="fill-accent" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 时间序列的折线/面积图：给趋势看，带三条参考线和坐标标签。 */
export function AreaChart({ data, height = 140, format = (n: number) => n.toLocaleString("en-US") }: {
  data: BarDatum[];
  height?: number;
  format?: (n: number) => string;
}) {
  const width = 560;
  const padTop = 8;
  const padBottom = 18;
  const inner = height - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const xy = data.map((d, index) => [index * step, padTop + inner - (d.value / max) * inner] as const);
  const line = xy.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${padTop + inner} L0 ${padTop + inner} Z`;
  const ticks = [0, 0.5, 1].map((ratio) => ({ y: padTop + inner - ratio * inner, value: Math.round(max * ratio) }));
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="时间趋势">
        {ticks.map((tick) => (
          <line key={tick.y} x1={0} x2={width} y1={tick.y} y2={tick.y} className="stroke-line-soft" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} className="fill-accent/10" />
        <path d={line} className="fill-none stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {xy.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={2.4} className="fill-accent" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-4">
        {data.map((d, index) => (index % Math.ceil(data.length / 6) === 0 || index === data.length - 1 ? <span key={d.label}>{d.label}</span> : <span key={d.label} />))}
      </div>
      <div className="mt-1 flex justify-end gap-3 text-[10px] text-ink-4">
        <span>峰值 {format(max)}</span>
      </div>
    </div>
  );
}

/** 7×24 热力图：周几 × 小时，颜色深浅 = 该时段的指标。支持移动端点按与桌面端悬浮即时数值检查。 */
export function Heatmap({ cells, metric, format = (n: number) => n.toLocaleString("en-US") }: {
  cells: Array<{ weekday: number; hour: number; posts: number; medViews: number }>;
  metric: "posts" | "medViews";
  format?: (n: number) => string;
}) {
  const [activeCell, setActiveCell] = useState<{ weekday: number; hour: number; posts: number; medViews: number } | null>(null);
  const values = cells.map((c) => c[metric]);
  const max = Math.max(1, ...values);
  // 徽标说的是曝光，基准也要用浏览的最大值，不能跟着当前指标变。
  const maxViews = Math.max(1, ...cells.map((c) => c.medViews));
  const get = (weekday: number, hour: number) => cells.find((c) => c.weekday === weekday && c.hour === hour);
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  return (
    <div>
      <div className="overflow-x-auto pb-1">
      {/* 24 列在 393px 下每格只有 10px 左右：给一个最小宽度横向滚动，点按才有落点。 */}
      <div className="grid min-w-[1146px] lg:min-w-0 gap-[3px]" style={{ gridTemplateColumns: "18px repeat(24, minmax(0, 1fr))" }}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="num text-center text-[9px] leading-none text-ink-4">{hour % 3 === 0 ? hour : ""}</span>
        ))}
        {labels.map((day, index) => (
          <div key={day} className="contents">
            <span className="text-[10px] leading-[14px] text-ink-4">{day}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = get(index + 1, hour);
              const value = cell?.[metric] ?? 0;
              const intensity = value / max;
              const isSelected = activeCell?.weekday === index + 1 && activeCell?.hour === hour;
              return (
                <button
                  key={hour}
                  type="button"
                  onClick={() => setActiveCell((curr) => (curr?.weekday === index + 1 && curr?.hour === hour ? null : cell ?? { weekday: index + 1, hour, posts: 0, medViews: 0 }))}
                  onPointerEnter={(event) => { if (event.pointerType === "mouse" && cell) setActiveCell(cell); }}
                  aria-pressed={isSelected}
                  tabIndex={isSelected || (activeCell === null && index === 0 && hour === 0) ? 0 : -1}
                  onKeyDown={(event) => {
                    const day = index + 1;
                    const horizontal = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                    const vertical = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                    if (!horizontal && !vertical) return;
                    event.preventDefault();
                    const nextHour = horizontal ? (hour + horizontal + 24) % 24 : hour;
                    const nextDay = vertical ? ((day - 1 + vertical + 7) % 7) + 1 : day;
                    setActiveCell(get(nextDay, nextHour) ?? { weekday: nextDay, hour: nextHour, posts: 0, medViews: 0 });
                    // 焦点跟着选中格走，否则连续按方向键仍在原按钮上。
                    document.querySelector<HTMLElement>(`[data-heat="${nextDay}-${nextHour}"]`)?.focus();
                  }}
                  data-heat={`${index + 1}-${hour}`}
                  aria-label={`周${day} ${hour}:00 · ${metric === "medViews" ? "中位浏览" : "发帖"} ${format(value)}`}
                  className={`block h-6 lg:h-4 w-full rounded-none transition-all focus-visible:ring-2 focus-visible:ring-accent focus:outline-none ${
                    isSelected ? "ring-2 ring-accent scale-110 z-10 shadow-xs" : ""
                  }`}
                  style={{ backgroundColor: value ? `color-mix(in srgb, var(--color-accent) ${Math.max(10, Math.round(Math.sqrt(intensity) * 100))}%, transparent)` : "var(--bg-sunk)" }}
                />
              );
            })}
          </div>
        ))}
      </div>
      </div>
      {/* 交互检查面板：支持触屏点按与悬停查看具体时段数据 */}
      <div aria-live="polite" className="mt-2.5 flex min-h-[30px] flex-wrap items-center justify-between gap-2 rounded-control border border-line-soft bg-bg-sunk/40 px-3 py-1.5 text-[11.5px]">
        {activeCell ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold text-ink">
              周{labels[activeCell.weekday - 1]} {String(activeCell.hour).padStart(2, "0")}:00
            </span>
            <span className="text-ink-2">
              中位浏览 <b className="num text-accent">{format(activeCell.medViews)}</b>
            </span>
            <span className="text-ink-3">
              发帖 <b className="num text-ink">{activeCell.posts}</b> 条
            </span>
            {activeCell.medViews >= maxViews * 0.75 && activeCell.medViews > 0 && (
              <span className="rounded-mark bg-accent-soft px-1.5 py-0.2 text-[10px] font-bold text-accent">
                高曝光黄金期
              </span>
            )}
          </div>
        ) : (
          <span className="text-ink-4">点击或悬停网格查看时段曝光与发帖数</span>
        )}
        <div className="flex items-center gap-1.5 text-[10px] text-ink-4 ml-auto">
          <span>少</span>
          {[20, 40, 60, 80, 100].map((pct) => (
            <span key={pct} className="block size-2.5 rounded-none" style={{ backgroundColor: `color-mix(in srgb, var(--color-accent) ${pct}%, transparent)` }} />
          ))}
          <span>多</span>
        </div>
      </div>
    </div>
  );
}
