// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { chronicleServerModule } from "@aihot/chronicle/server";
import { leaderboardServerModule } from "@aihot/leaderboard/server";
import { monitorServerModule } from "@aihot/monitor/server";

export const SERVER_MODULES: readonly ServerModule[] = [leaderboardServerModule, monitorServerModule, chronicleServerModule];
