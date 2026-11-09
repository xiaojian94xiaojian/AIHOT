// 画像的互动结构：每千次曝光拆成赞/转/评/引，对应 X 公开的 For You 打分动作。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { toSummary, type SummaryRow } from "../backend/data.ts";
import { structureVerdict } from "../backend/structure.ts";

after(closeDb);

function row(overrides: Partial<SummaryRow> = {}): SummaryRow {
  return {
    source_id: "x-account-probe",
    handle: "probe",
    author: "Probe",
    avatar: null,
    posts: 10,
    active_days: 5,
    first_at: new Date("2026-10-01T00:00:00Z"),
    last_at: new Date("2026-10-20T00:00:00Z"),
    avg_views: "1000",
    med_views: "900",
    p90_views: "2000",
    avg_likes: "10",
    med_likes: "8",
    top_likes: "30",
    engagement_rate: "1.00",
    like_per_k: "10.4",
    repost_per_k: "2.55",
    reply_per_k: "1.5",
    quote_per_k: "0.44",
    media_pct: "50",
    reply_pct: "0",
    quote_pct: "0",
    zh_pct: "100",
    en_pct: "0",
    top_category: null,
    language: "zh",
    ...overrides,
  };
}

test("每千曝光的互动结构按官方动作拆开，保留一位小数", () => {
  const summary = toSummary(row());
  assert.deepEqual(summary.perK, { likes: 10.4, reposts: 2.6, replies: 1.5, quotes: 0.4 }, "each action is counted per 1,000 views");
});

test("同一天发多条只算 1 天，跨北京时间的零点才不会多算", () => {
  const sameDay = toSummary(row({ first_at: new Date("2026-11-01T01:00:00Z"), last_at: new Date("2026-11-01T10:00:00Z"), posts: 5 }));
  assert.equal(sameDay.days, 1, "09:00 和 18:00（北京时间）是同一天");
  const acrossMidnight = toSummary(row({ first_at: new Date("2026-11-01T15:30:00Z"), last_at: new Date("2026-11-01T16:30:00Z") }));
  assert.equal(acrossMidnight.days, 2, "北京时间 23:30 与次日 00:30 是两天");
});
test("没有浏览数据的账号结构全是 0，不会出现 NaN", () => {
  const summary = toSummary(row({ like_per_k: null, repost_per_k: null, reply_per_k: null, quote_per_k: null }));
  assert.deepEqual(summary.perK, { likes: 0, reposts: 0, replies: 0, quotes: 0 });
});

const mine = (likes: number, replies: number, quotes: number) => ({ likes, reposts: 0, replies, quotes });
const base = { likes: 10, reposts: 0, replies: 1, quotes: 0.2 };

test("回复/引用是点赞的 1.5 倍以上，判成讨论型", () => {
  const verdict = structureVerdict(mine(10, 3, 0.5), base);
  assert.match(verdict, /讨论型/);
  assert.match(verdict, /1 个赞/);
});

test("回复/引用明显低于中位，判成点赞型", () => {
  assert.match(structureVerdict(mine(10, 0.3, 0.1), base), /点赞型/);
});

test("接近中位时说接近，没有互动时直说样本太少", () => {
  assert.match(structureVerdict(mine(10, 1.2, 0.2), base), /接近全站中位/);
  assert.match(structureVerdict(mine(0, 0, 0), base), /互动还太少/);
  assert.match(structureVerdict(mine(0, 2, 0), base), /只有回复/);
});