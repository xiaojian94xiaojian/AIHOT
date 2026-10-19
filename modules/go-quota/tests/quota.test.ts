// Go 套餐额度：解析、速度外推、以及"该不该报给站主"。用真实答复的形状与真实出现过的数字做例子。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyTag, outlook, parseUsage, quotaFindings, ratePerDay, type QuotaState } from "../backend/quota.ts";

const REAL = {
  usage: {
    rolling: { status: "ok", percent: 10, resetsAt: "2026-10-15T15:26:12.000Z" },
    weekly: { status: "ok", percent: 11, resetsAt: "2026-10-19T00:00:00.000Z" },
    monthly: { status: "ok", percent: 60, resetsAt: "2026-10-27T01:58:51.000Z" },
  },
};

const state = (windows: QuotaState["windows"], history: QuotaState["history"] = {}): QuotaState => ({
  checkedAt: "2026-10-15T14:00:00.000Z",
  keyTag: "700a89",
  windows,
  history,
});

test("the gateway's usage answer becomes three windows", () => {
  const windows = parseUsage(REAL);
  assert.deepEqual(Object.keys(windows), ["rolling", "weekly", "monthly"]);
  assert.equal(windows.weekly!.percent, 11);
  assert.equal(windows.monthly!.resetsAt, "2026-10-27T01:58:51.000Z");
  assert.throws(() => parseUsage({ error: "nope" }), /没有 usage 对象/);
  assert.throws(() => parseUsage({ usage: { weekly: { status: "ok" } } }), /没有可用的窗口/);
});

test("the burn rate is read from the last stretch that did not reset", () => {
  const at = (minutes: number) => new Date(Date.parse("2026-10-15T00:00:00.000Z") + minutes * 60_000).toISOString();
  const now = Date.parse(at(24 * 60));
  // 每周 11% 涨到 23%：12 个百分点 / 12 小时 = 每天 24 个百分点。
  const rising = [0, 360, 720].map((m, i) => ({ at: at(m), percent: [11, 17, 23][i]! }));
  assert.equal(ratePerDay(rising, now), 24);
  // 中间重置过（11 → 40 → 3 → 9）：只用重置之后那段（3 → 9，2 小时 = 每天 72 点）。
  const reset = [0, 360, 600, 720].map((m, i) => ({ at: at(m), percent: [11, 40, 3, 9][i]! }));
  assert.equal(ratePerDay(reset, now), 72);
  // 只有一条样本、或没有增长：不猜。
  assert.equal(ratePerDay([{ at: at(0), percent: 5 }], now), null);
  assert.equal(ratePerDay([{ at: at(0), percent: 5 }, { at: at(720), percent: 5 }], now), null);
});

test("plenty of headroom is not worth telling anyone about", () => {
  const now = Date.parse("2026-10-15T14:00:00.000Z");
  assert.deepEqual(quotaFindings(state(parseUsage(REAL)), now), [], "11% 周额度不该打扰站主");
});

test("a window that runs out before it resets is reported, with the estimate", () => {
  const now = Date.parse("2026-10-15T14:00:00.000Z");
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const history = {
    weekly: [
      { at: at(720), percent: 71 },
      { at: at(360), percent: 80 },
      { at: at(0), percent: 89 },
    ],
  };
  const windows = { weekly: { percent: 89, resetsAt: "2026-10-19T00:00:00.000Z", status: "ok" } };
  const [finding] = quotaFindings(state(windows, history), now);
  assert.ok(finding, "89% 且按速度会在重置前用尽，应当报");
  assert.equal(finding.level, "today");
  assert.match(finding.title, /Go 套餐本周额度已用 89%/);
  // 12 小时涨 18 个百分点 = 每天 36 点：剩下的 11 点只够 7 小时，而它 82 小时后才重置。
  assert.match(finding.impact!, /还能撑 7 小时/);
  assert.match(finding.detail!, /密钥指纹 700a89/);
});

test("near the ceiling it is reported at once, without waiting for a rate", () => {
  const now = Date.parse("2026-10-15T14:00:00.000Z");
  const windows = { rolling: { percent: 98, resetsAt: "2026-10-15T15:26:12.000Z", status: "ok" } };
  const [finding] = quotaFindings(state(windows), now);
  assert.ok(finding, "快到顶时没有样本也要报");
  assert.equal(finding.level, "now");
  assert.match(finding.impact!, /外推不出来/);
  const [o] = outlook(state(windows), now);
  assert.equal(o!.tell, true);
  assert.equal(o!.daysLeft, null);
});

test("the key fingerprint is a tag, not the key", () => {
  const tag = keyTag("sk-example-key");
  assert.equal(tag.length, 6);
  assert.match(tag, /^[0-9a-f]{6}$/);
  assert.ok(!tag.includes("sk-"));
});
