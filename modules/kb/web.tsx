// 本模块接到网页上的部分（apps/web/app/modules.ts 的 WebModule；清单在 site/modules/web.ts）。
//
// 知识库不进公开前台（它是站内与 agent 侧的资产），所以这里只有后台的一条：页面本身在 module.ts 里声明。
import { defineWebModule, type WebModule } from "@aihot/web/modules";

export const kbWebModule: WebModule = defineWebModule({
  name: "kb",
  // 后台导航的「内容」一节：放在信源之后（内容诊断、信源、本模块、反馈）。
  // count: "kb" 对应 server.ts 的 admin.counts.kb（最近 24 小时有更新的卡片数）。
  admin: { content: [{ to: "/admin/kb", label: "知识库", count: "kb", tone: "accent" }] },
});
