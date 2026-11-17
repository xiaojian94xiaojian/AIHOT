// 发布前检查的硬规则（W8）：字数、话题数、夸张词、链接。只在浏览器里算，正文不上传。
export const BANNED = ["必火", "保证涨粉", "稳赚", "100%", "最强", "买粉", "互关", "刷粉", "包上热门", "第一"];

const URL_LENGTH = 23;

/** X 的计长：链接固定 23，CJK/全角按 2，其余按 1。 */
export function xLength(text: string): number {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, "x".repeat(URL_LENGTH));
  let total = 0;
  for (const char of withoutUrls) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    total += wide ? 2 : 1;
  }
  return total;
}

export interface DraftCheck {
  empty: boolean;
  length: number;
  hashtags: number;
  links: number;
  banned: string[];
  ok: boolean;
}

export function checkText(text: string): DraftCheck {
  const empty = text.trim().length === 0;
  const length = xLength(text);
  const hashtags = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const links = (text.match(/https?:\/\/\S+/g) ?? []).length;
  const banned = BANNED.filter((word) => text.includes(word));
  return {
    empty,
    length,
    hashtags,
    links,
    banned,
    ok: !empty && length <= 280 && hashtags <= 2 && banned.length === 0,
  };
}
