// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { chronicleWebModule } from "@aihot/chronicle/web";
import { kbWebModule } from "@aihot/kb/web";
import { leaderboardWebModule } from "@aihot/leaderboard/web";
import { monitorWebModule } from "@aihot/monitor/web";

export const WEB_MODULES: readonly WebModule[] = [leaderboardWebModule, monitorWebModule, chronicleWebModule, kbWebModule];
