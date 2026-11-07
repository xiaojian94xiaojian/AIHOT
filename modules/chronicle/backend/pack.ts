// 行业包（industry/topics.json）里大事记用到、而框架的 Topic 不再带着的那几个字段。
//
// 4.0.0 的 publication/topics.ts 只把 slug、name、group、definition、entityId、tags、pattern、aliases
// 收进 Topic，方向/形态主题的 chronicleTerms 与公司的 orgNames 都留在了文件里。旧版框架自己把它们读进
// Topic（`terms: termPattern(t.chronicleTerms)`、`orgNames: t.orgNames`），模块机制下改由本模块读，
// 这样框架不必为了某个站的模块恢复字段（见 docs/architecture.md「模块」）。语义与旧版一致。
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";

interface PackTopic {
  slug: string;
  chronicleTerms?: string[];
  orgNames?: string[];
}

/**
 * 方向/形态主题的词表：任一词出现在标题里就算这个主题的事。
 *
 * 与 4.0.0 之前框架里那份逐字一致（`git show 1ca5d6d^:packages/backend/src/publication/topics.ts`）：
 * 不分大小写；拉丁词要么从词首开始，三个字母以内还要整词命中（`SWE` 不该在 `SWEbench` 里命中）；
 * 中日韩词直接子串匹配。少一样就会漏掉小写的组织名（"agent 框架"）或多认一堆子串。
 */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const term = (w: string) => (!/^[A-Za-z]/.test(w) ? escape(w) : `(?<![A-Za-z])${escape(w)}${w.length <= 3 ? "(?![A-Za-z])" : ""}`);
const termPattern = (terms: readonly string[]): RegExp | null => (terms.length ? new RegExp(terms.map(term).join("|"), "i") : null);

const file = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/topics.json"), "utf8")) as { topics: PackTopic[] };

const BY_SLUG = new Map(file.topics.map((t) => [t.slug, t]));

/** 这个主题的方向/形态词表（公司主题没有）；没有词表时返回 null，规则里就只按类型与分数判。 */
export function termsOf(slug: string): RegExp | null {
  return termPattern(BY_SLUG.get(slug)?.chronicleTerms ?? []);
}

/** 这家公司自己的公告会用的名字（“<它> 发布 X”）；没有就返回空数组。 */
export function orgNamesOf(slug: string): string[] {
  return BY_SLUG.get(slug)?.orgNames ?? [];
}
