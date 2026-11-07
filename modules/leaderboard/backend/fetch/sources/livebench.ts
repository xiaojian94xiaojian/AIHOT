// LiveBench (Apache 2.0): the latest release's per-task table; category scores are means of unrounded
// task scores, and each board averages its category pair (general: all categories).
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { configurationOf, peelEffortSuffix, slug } from "../configuration.ts";
import { parseCsv } from "../csv.ts";
import type { FetchResult, Fetcher, ParsedRow } from "../types.ts";

const BOARDS = [
  { key: "livebench-general", name: "LiveBench Global Average", categories: null as string[] | null, url: "https://livebench.ai/" },
  { key: "livebench-writing", name: "LiveBench · 语言与指令", categories: ["Language", "IF"], url: "https://livebench.ai/#/?cats=Language%2CIF&ft=1" },
  { key: "livebench-coding", name: "LiveBench · 编程综合", categories: ["Coding", "Agentic Coding"], url: "https://livebench.ai/#/?cats=Coding%2CAgentic+Coding&ft=1" },
  { key: "livebench-reasoning", name: "LiveBench · 推理与数学", categories: ["Reasoning", "Mathematics"], url: "https://livebench.ai/#/?cats=Reasoning%2CMathematics&ft=1" },
];

const mean =(xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// The site's deploy has twice dropped the data files while the homepage kept listing their release:
// 2026-10-19 it served a bundle naming 2026-09-10 with no categories/table at all. The repository the
// site is built from keeps every release, so the same file is read from there when the site lacks it.
const DATA_BASES = [
  "https://livebench.ai",
  "https://raw.githubusercontent.com/LiveBench/livebench.github.io/main/public",
];

/** Every release date the bundle carries, newest first. */
async function releaseDates(): Promise<string[]> {
  const home = (await guardedFetch("https://livebench.ai/", { timeoutMs: 30_000 })).text();
  const js = /src="\.?\/?(static\/js\/main\.[a-z0-9]+\.js)"/.exec(home)?.[1];
  if (!js) throw new Error("livebench: bundle not found");
  const bundle = (await guardedFetch(`https://livebench.ai/${js}`, { timeoutMs: 30_000, maxBytes: 16 * 1024 * 1024 })).text();
  const dates = new Set<string>();
  for (const m of bundle.matchAll(/\[((?:"\d{4}-\d{2}-\d{2}",?){2,})\]/g)) {
    for (const date of m[1]!.match(/\d{4}-\d{2}-\d{2}/g)!) dates.add(date);
  }
  if (!dates.size) throw new Error("livebench: release list not found");
  return [...dates].sort().reverse();
}

/** The rows of every board for one release's table. */
function buildBoards(release: string, categories: Record<string, string[]>, lines: Record<string, string>[], upstream: string | null): FetchResult[] {
  const modelColumn = Object.keys(lines[0] ?? {})[0];
  const out: FetchResult[] = [];
  for (const b of BOARDS) {
    const cats = b.categories ?? Object.keys(categories);
    const rows: ParsedRow[] = [];
    for (const line of lines) {
      const model = modelColumn ? line[modelColumn]?.trim() : null;
      if (!model) continue;
      const categoryScores: number[] = [];
      for (const c of cats) {
        const vals = (categories[c] ?? []).map((t) => line[t]?.trim()).filter((v) => v != null && v !== "").map(Number).filter(Number.isFinite);
        if (vals.length === (categories[c] ?? []).length && vals.length) categoryScores.push(mean(vals));
      }
      if (categoryScores.length !== cats.length) continue;
      const peeled = peelEffortSuffix(model);
      rows.push({
        sourceModelName: model,
        keyName: slug(model),
        baseName: peeled.base,
        configuration: configurationOf(peeled.tier ? [peeled.tier] : []),
        metricKey: b.key,
        metricName: b.name,
        rawScore: mean(categoryScores),
        // Each category's own score, shown beside the pair on a model's evidence.
        metadata: {
          release, categories: cats.join(" + "), categoryCount: cats.length, metricDirection: "HIGHER",
          ...Object.fromEntries(cats.map((c, i) => [`livebenchCategoryScore:${c}`, categoryScores[i]!])),
          livebenchTaskScores: Object.fromEntries(cats.flatMap((c) => (categories[c] ?? []).map((task) => [task, Number(line[task])]))),
        },
      });
    }
    out.push({
      sourceKey: b.key,
      sourceName: b.name,
      sourceUrl: "https://livebench.ai/",
      license: "Apache 2.0",
      attributionUrl: b.url,
      publishedAt: upstream ? new Date(upstream).toISOString() : null,
      rows,
      metadata: { release, taskGroups: Object.fromEntries(cats.map((c) => [c, categories[c]])), upstreamPublishedAt: upstream ? new Date(upstream).toISOString() : null, sourceOperator: "LiveBench", sourceFamily: "rolling-objective", metricCount: 1 },
    });
  }
  return out;
}

export const livebench: Fetcher = {
  sourceKeys: BOARDS.map((b) => b.key),
  async fetch() {
    // Releases are not all full tables: 2026-06-25 re-scored 28 models, while the release before it
    // lists 127. Taking the newest unconditionally shrinks the board to a fraction of its rows, which
    // the admission check refuses. Keep the newest release that is still a full-sized table.
    const candidates: Array<{ built: FetchResult[]; rows: number }> = [];
    for (const release of (await releaseDates()).slice(0, 4)) {
      const tag = release.replaceAll("-", "_");
      try {
        for (const base of DATA_BASES) {
          const categories = await guardedFetch(`${base}/categories_${tag}.json`, { timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024 });
          if (categories.status !== 200) continue;
          const table = await guardedFetch(`${base}/table_${tag}.csv`, { timeoutMs: 30_000 });
          if (table.status !== 200) continue;
          const built = buildBoards(release, JSON.parse(categories.text()) as Record<string, string[]>, parseCsv(table.text()), table.headers.get("last-modified"));
          // A release mid-publish (a category names a task its table lacks) yields no complete rows for
          // some board; the previous release still describes the benchmark, so use it instead.
          if (built.every((b) => b.rows.length > 0)) candidates.push({ built, rows: Math.min(...built.map((b) => b.rows.length)) });
          break;
        }
      } catch {
        // One bad or unroutable release does not hide the others.
      }
    }
    if (!candidates.length) throw new Error("livebench: no release produced complete rows");
    const largest = Math.max(...candidates.map((c) => c.rows));
    return (candidates.find((c) => c.rows >= largest * 0.5) ?? candidates[0]!).built;
  },
};
