// 博主画像：把本站采集的 X 账号数据做成列表页、每人一页、并排对比与跨账号内容方法论。
// 框架只在 routes.ts 里读这里的 pages、在 api 里按 apiPaths 转发请求，从不 import 本模块。
import { defineModule } from "@aihot/contracts/modules";

export const xProfileModule = defineModule({
  name: "x-profile",
  pages: [
    { path: "x-people", file: "web/people.tsx", id: "x-people" },
    { path: "x-people/growth", file: "web/growth.tsx", id: "x-growth" },
    { path: "x-people/growth/report", file: "web/growth-report.tsx", id: "x-growth-report" },
    { path: "x-people/weekly", file: "web/weekly.tsx", id: "x-weekly" },
    { path: "x-people/today", file: "web/today.tsx", id: "x-today" },
    { path: "x-people/algorithm", file: "web/algorithm.tsx", id: "x-algorithm" },
    { path: "x-people/compare", file: "web/compare.tsx", id: "x-compare" },
    { path: "x-people/methodology", file: "web/methodology.tsx", id: "x-methodology" },
    { path: "x-people/alerts", file: "web/alerts.tsx", id: "x-alerts" },
    { path: "x-people/:handle", file: "web/person.tsx", id: "x-person" },
  ],
  // 网页与 api 是两个进程：公开查询走 /api/site/x-people*，审核走 /api/admin/x-people*，都由 api 进程回答。
  apiPaths: [/^\/api\/site\/x-people(\/|$)/, /^\/api\/admin\/x-people(\/|$)/, /^\/feed\/x-people\//, /^\/feed\/x\//],
  // 账号收录申请的后台页（本站保留了 adminPages 插口）。
  adminPages: [
    { path: "admin/x-people", file: "web/admin-requests.tsx" },
    { path: "admin/x-collect", file: "web/admin-collect.tsx" },
  ],
});
