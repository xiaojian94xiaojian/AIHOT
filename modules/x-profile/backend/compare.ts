// 账号对比：最多三个账号的汇总并排。只读聚合，口径与个人页一致。
import { sql } from "@aihot/backend/db";
import { BEIJING_TIMEZONE } from "@aihot/contracts/time";
import { posts, SUMMARY, toSummary, type SummaryRow } from "./data.ts";
import type { XCompareResponse } from "../types.ts";

export async function loadCompare(handles: string[]): Promise<XCompareResponse> {
  const wanted = [...new Set(handles.map((h) => h.toLowerCase()))].slice(0, 3);
  if (wanted.length < 2) return { people: [] };

  const [rows, weeks] = await Promise.all([
    sql<SummaryRow[]>`
      WITH p AS (${posts()}),
           want AS (SELECT DISTINCT source_id FROM p WHERE lower(handle) = ANY(${wanted}))
      SELECT ${SUMMARY} FROM p WHERE source_id IN (SELECT source_id FROM want) GROUP BY source_id
    `,
    sql<{ source_id: string; week: string; posts: number }[]>`
      WITH p AS (${posts()}),
           want AS (SELECT DISTINCT source_id FROM p WHERE lower(handle) = ANY(${wanted}))
      SELECT p.source_id,
             to_char(date_trunc('week', p.published_at AT TIME ZONE ${BEIJING_TIMEZONE}), 'YYYY-MM-DD') AS week,
             count(*)::int AS posts
      FROM p WHERE p.source_id IN (SELECT source_id FROM want)
      GROUP BY 1, 2 ORDER BY 2
    `,
  ]);

  const summaries = rows.map(toSummary);
  const byHandle = new Map(summaries.map((s) => [s.handle.toLowerCase(), s]));
  const spark = new Map<string, number[]>();
  for (const row of weeks) {
    const list = spark.get(row.source_id) ?? [];
    list.push(row.posts);
    spark.set(row.source_id, list);
  }
  return {
    people: wanted
      .map((handle) => byHandle.get(handle))
      .filter((person): person is NonNullable<typeof person> => !!person)
      .map((person) => ({ ...person, spark: (spark.get(person.sourceId) ?? []).slice(-12) })),
  };
}
