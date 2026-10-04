// Codex 重置监控：盯 X 上 @thsottiaux 的额度重置与发卡公告，识别、确认、推送，并给出公开页面。
//
// 4.0.0 把这个监控移出了框架（提交 1ca5d6d），这里是本站按模块机制把它接回来的实现。
// 框架只在 apps/api/src/app.ts 里遍历 `http` 插口注册路由、在 routes.ts 里读本文件的 `pages` /
// `adminPages`，从不 import 本模块，所以合并上游更新时不会冲突。
import { defineModule } from "@aihot/contracts/modules";

export const monitorModule = defineModule({
  name: "monitor",
  pages: [
    { path: "codex-reset", file: "web/reset.tsx" },
    { path: "codex-reset/history/:date", file: "web/reset.tsx", id: "codex-reset-day" },
  ],
  adminPages: [{ path: "admin/monitor", file: "web/admin.tsx" }],
  // 公开读取走 /api/v1/codex-resets* 与 /api/site/codex-reset*，后台修正走 /api/admin/monitor*。
  apiPaths: [/^\/api\/(?:v1\/codex-resets|site\/codex-reset|admin\/monitor)/],
});
