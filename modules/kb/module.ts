// 雷达知识库：把已经筛选、评判、写作好的内容落成可被其它工具直接消费的 Markdown 笔记
// （事件卡、报告卡、精选条目卡），并给出读取出口。
//
// 文件语义借用 Nodus（顶层 inbox/notes/archive、恰好 9 个字段的 frontmatter、Markdown 是唯一事实源），
// 但只借格式，不接它那条 Write Gateway / Job / Preview 的运行时：这里写的是本模块自己的派生数据。
// 知识库是站内与 agent 侧资产，不进公开出口，所以没有 pages，只有后台页面。
import { defineModule } from "@aihot/contracts/modules";

export const kbModule = defineModule({
  name: "kb",
  adminPages: [{ path: "admin/kb", file: "web/Kb.tsx" }],
  // 后台接口走 /api/modules/kb/*（模块自己的地址空间，见 KB-PLAN.md §5.5）；
  // 认领它，网页进程才不会被当成页面路由。
  apiPaths: [/^\/api\/modules\/kb\//],
});
