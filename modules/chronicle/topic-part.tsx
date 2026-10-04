// 主题页上本模块的部件（apps/web/app/modules.ts 的 TopicPagePart）。
// 数据来自 server.ts 插口写进 TopicPage.modules.chronicle 的那份，形状见 server.ts 的 ChroniclePart。
import type { TopicPagePart } from "@aihot/web/modules";
import type { TopicSummary } from "@aihot/contracts/site";
import { ChronicleBand, ChronicleRail } from "./Chronicle.tsx";
import type { ChroniclePart } from "./server.ts";

/** 把 data.modules.chronicle 收窄成本模块自己的形状；不是它就没有部件。 */
function asPart(data: unknown): ChroniclePart | null {
  const p = data as Partial<ChroniclePart> | null;
  return p && typeof p === "object" && p.kinds ? (p as ChroniclePart) : null;
}

const hasChronicle = (p: ChroniclePart): boolean =>
  p.milestones.length > 0 || p.chronicle.some((month) => month.events.length > 0);

const part: TopicPagePart = {
  // 页面标题里接在「最新动态与」之后。
  name: "大事记",

  shows(data) {
    const p = asPart(data);
    return !!p && hasChronicle(p);
  },

  // 公司画编年史带，方向/形态画月份时间线（与旧版 topic.tsx 的分支一致）。
  Block({ data, topic }: { data: unknown; topic: TopicSummary }) {
    const p = asPart(data);
    if (!p) return null;
    return topic.group === "company"
      ? <ChronicleBand milestones={p.milestones} kinds={p.kinds} />
      : <ChronicleRail months={p.chronicle} kinds={p.kinds} />;
  },

  // 结构化数据里的条目，最新在前；有事件页的链到事件页。
  entries(data) {
    const p = asPart(data);
    if (!p) return [];
    return p.milestones.length
      ? [...p.milestones].reverse().map((ms) => ({ title: ms.title, href: ms.href }))
      : p.chronicle.flatMap((m) => m.events.map((e) => ({ title: e.label, href: e.href })));
  },

  // 搜索摘要用最重要的近期事件标题。
  news(data) {
    const p = asPart(data);
    return p ? p.highlights.map((e) => e.title) : [];
  },
};

export default part;
