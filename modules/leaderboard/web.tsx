// 本模块接到网页上的部分（apps/web/app/modules.ts 的 WebModule；清单在 site/modules/web.ts）。
// 页面本身在 module.ts 里声明（web/ 目录那批文件），这里只声明导航项、手机端标签、品牌标与后台运行页的部件。
import { defineWebModule, type WebModule } from "@aihot/web/modules";
import { IconChart } from "@aihot/web/components/icons";

export const leaderboardWebModule: WebModule = defineWebModule({
  name: "leaderboard",
  // 桌面侧栏：旧站（4.0.0 前的 nav.ts）把模型榜放在「模型」一节里，这里沿用同名的一节，
  // 排在引擎的「内容」与「更多」之间；同一节的模块会合并到一起。
  sidebar: { section: "模型", items: [{ to: "/leaderboard", label: "模型榜", icon: IconChart }] },
  // 手机标签栏：与旧站的 TABS 一样，「模型榜」在「日报」之后、「我的」之前。
  tabs: [{ key: "leaderboard", to: "/leaderboard", label: "模型榜", icon: IconChart }],
  // Kimi 的 K 画成白色，要放在自己的深色底上（旧站是 features/leaderboard/BrandMark 的 DARK_TILE，
  // 4.0.0 起由 components/BrandMark.tsx 读模块这里的清单）。
  darkMarks: ["/model-providers/moonshot.svg"],
  // 后台运行页：本模块那块（旧版 runs.tsx 的「模型榜评测来源」卡片），数据来自 server.ts 的 runsPart。
  // 本文件在模块根，部件在 web/ 下（apps/web/tsconfig.json 的 include 只收 web.tsx 与 web/**），所以是 ./web/runs。
  admin: { runs: () => import("./web/runs") },
});
