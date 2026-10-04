// 模型榜：14 个评测来源的抓取、排名算法与网页。
//
// 4.0.0 把模型榜移出了框架（提交 1ca5d6d），这里是本站按模块机制把它接回来的实现。
// 框架只在 apps/api/src/app.ts 里遍历 `http` 插口注册路由、在 routes.ts 里读本文件的 `pages`，
// 从不 import 本模块，所以合并上游更新时不会冲突。
import { defineModule } from "@aihot/contracts/modules";

// 网页代码都放在 web/ 子目录：apps/web/tsconfig.json 的 include 列了 modules/*/web.tsx 与
// modules/*/web/**/*，而 modules/tsconfig.json 只管后端（它的 */*.ts 会连后端文件一起收进来）。
export const leaderboardModule = defineModule({
  name: "leaderboard",
  // 榜单与榜单页共用一层（BoardTabs），分类页是同一个 route 的另一个 id。
  pages: [
    {
      layout: "web/boards.tsx",
      id: "leaderboard-boards",
      pages: [
        { path: "leaderboard", file: "web/board.tsx", id: "leaderboard" },
        { path: "leaderboard/category/:key", file: "web/board.tsx", id: "leaderboard-category" },
      ],
    },
    { path: "leaderboard/sources", file: "web/sources.tsx" },
    { path: "leaderboard/sources/:key", file: "web/source.tsx" },
    { path: "leaderboard/rules", file: "web/rules.tsx" },
    // 放在 category / sources / rules 之后：这个通配段会匹配任何 slug。
    { path: "leaderboard/:slug", file: "web/model.tsx" },
  ],
  // 网页与 api 是两个进程，这两组地址都归 api 进程答：
  //   /api/site/leaderboard*  —— 网页各页的取数
  //   /model-providers/*、/leaderboard-sources/* —— 页面上的厂商标志与评测来源图标
  //     （由 server.ts 的 staticAssets 发出）。**这一条不能少**：引擎只把这里列出的地址
  //     转发给 api，漏了就会被 web 进程当成页面路由，结果是 404。
  apiPaths: [/^\/api\/site\/leaderboard\//, /^\/(model-providers|leaderboard-sources)\//],
});
