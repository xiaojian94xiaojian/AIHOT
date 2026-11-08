/** 页面上的数字格式：一万以上用「万」，其余带千分位；百分数保留一位。 */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return n.toLocaleString("en-US");
}

export const percent = (n: number) => `${n.toFixed(1).replace(/\.0$/, "")}%`;

/** 带正负号的数字：正数带 +，负数带 -，不出现 +-，0 显式输出 0 */
export function signed(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "-"}${compact(Math.abs(n))}`;
}

/** 带正负号的百分比 */
export function signedPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0%";
  return `${n > 0 ? "+" : "-"}${Math.abs(n).toFixed(1).replace(/\.0$/, "")}%`;
}

/** 北京时间：由 contracts/time.ts 统一转换。 */
export { beijingStamp as stamp } from "@aihot/contracts/time";

/** 分析里的分类键翻成人话；不认识的照原样显示。 */
const CATEGORIES: Record<string, string> = {
  "ai-models": "模型", "ai-products": "产品", industry: "产业", paper: "论文", opinion: "观点",
  // 标注与详情里的这几种（画像的分类枚举）；早期只分到 tip，页面上不该露英文。
  model: "模型", product: "产品", tip: "教程",
  "research": "研究", "open-source": "开源", "policy": "政策", "funding": "融资", "hardware": "硬件",
  "robotics": "机器人", "safety": "安全", "science": "科学", "applications": "应用",
};

export const categoryName = (key: string) => CATEGORIES[key] ?? key;

const LANGUAGES: Record<string, string> = { en: "英文", zh: "中文", ja: "日文", ko: "韩文", und: "未识别", zxx: "无语言", other: "其他" };

export const languageName = (key: string) => LANGUAGES[key] ?? key;

const MEDIA: Record<string, string> = { image: "图片", photo: "图片", video: "视频", animated_gif: "动图", text: "纯文字", 文字: "纯文字", 媒体: "媒体" };

export const mediaName = (key: string) => MEDIA[key] ?? key;
