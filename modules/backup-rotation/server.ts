// 备份桶保留策略的定时任务：每天 04:40（备份 04:10 之后）跑一轮，见 backend/rotate.ts。
// 开关 BACKUP_ROTATION_ENABLED 默认关；打开需要重启 worker（安全阀的惯例）。
import type { ServerModule } from "@aihot/backend/modules";
import { rotate } from "./backend/rotate.ts";

export const backupRotationServerModule: ServerModule = {
  name: "backup-rotation",
  schedules: [{
    name: "backup.rotate",
    cron: "40 4 * * *",
    missed: "skip",
    when: () => (process.env.BACKUP_ROTATION_ENABLED ?? "").trim() === "true",
    run: () => rotate(),
  }],
};
