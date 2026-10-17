// Jev 影子（P0）：见 backend/shadow.ts 与 JEV-PLAN.md。开关是 JEV_SHADOW_ENABLED（默认关），
// 换官方线路只改 JEV_SHADOW_* 三个变量。
import type { ServerModule } from "@aihot/backend/modules";
import { runShadow, shadowSettings } from "./backend/shadow.ts";

export const jevShadowServerModule: ServerModule = {
  name: "jev-shadow",
  schedules: [
    {
      name: "jev.shadow",
      cron: "*/10 * * * *",
      missed: "skip",
      // 关着的时候连定时任务都不注册；打开需要重启 worker（安全阀的惯例）。
      when: () => shadowSettings().enabled,
      run: () => runShadow(),
      runOnStart: async () => shadowSettings().enabled,
    },
  ],
};
