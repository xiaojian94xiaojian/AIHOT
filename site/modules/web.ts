// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { chronicleWebModule } from "@aihot/chronicle/web";
import { leaderboardWebModule } from "@aihot/leaderboard/web";
import { monitorWebModule } from "@aihot/monitor/web";
import { xProfileWebModule } from "@aihot/x-profile/web";

// 顺序同时决定桌面侧栏的分组顺序和手机底栏模块标签的顺序（手机底栏的模块标签排在「我的」之前）。
// 工具放最后，这样手机底栏是：精选 / 热点 / 日报 / 模型榜 / 工具 / 我的。
export const WEB_MODULES: readonly WebModule[] = [leaderboardWebModule, monitorWebModule, chronicleWebModule, xProfileWebModule];
