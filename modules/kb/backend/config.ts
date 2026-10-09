// 本模块的环境变量，全部有默认值，不填就能跑（照 .env.example 的写法）。
//
// `KB_EXPORT_ENABLED` 是安全阀：只有写成 true 才导出。它在 worker 的任务里读，所以改了要重启 worker。
import path from "node:path";
import { config } from "@aihot/backend/config";
import { kbRoot } from "./layout.ts";

export interface KbConfig {
  /** 导出作业总开关。 */
  exportEnabled: boolean;
  /** 导出间隔（分钟）：事件与精选的刷新频率。 */
  intervalMinutes: number;
  /** 精选卡的保留天数；事件卡与报告卡长期保留。 */
  itemRetentionDays: number;
  /** 每次回补最近几期报告（每种各算）。 */
  reportsLookback: number;
  /** 知识库根目录（只读，方便日志与后台显示）。 */
  root: string;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 写成 true 才算打开，照框架里所有 *_ENABLED 开关的规矩。 */
function bool(name: string): boolean {
  return process.env[name] === "true";
}

export function kbConfig(): KbConfig {
  return {
    exportEnabled: bool("KB_EXPORT_ENABLED"),
    intervalMinutes: int("KB_INTERVAL_MINUTES", 30),
    itemRetentionDays: int("KB_ITEM_RETENTION_DAYS", 90),
    reportsLookback: int("KB_REPORTS_LOOKBACK", 8),
    root: kbRoot(),
  };
}

/** 导出的 cron：每 N 分钟一次（N 最多 59，再长就按小时取整会失去意义，所以夹在 1..59）。 */
export function exportCron(): string {
  return `*/${Math.min(Math.max(kbConfig().intervalMinutes, 1), 59)} * * * *`;
}

/** 知识库相对数据目录的位置，写日志和后台提示用。 */
export function kbDisplayPath(): string {
  return path.relative(config.dataDir, kbRoot()) || "kb";
}
