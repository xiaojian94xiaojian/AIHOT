// 飞书提醒的纯逻辑：webhook 校验、加解密、卡片结构。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-for-alerts-0123456789";
const alerts = await import("../backend/alerts.ts");
after(async () => {
  const { closeDb } = await import("@aihot/backend/db");
  await closeDb();
});

test("只接受飞书自定义机器人的 https 地址", () => {
  const ok = "https://open.feishu.cn/open-apis/bot/v2/hook/abcd-1234-efgh";
  assert.equal(alerts.parseWebhook(ok), ok);
  assert.equal(alerts.parseWebhook("http://open.feishu.cn/open-apis/bot/v2/hook/abcd-1234"), null);
  assert.equal(alerts.parseWebhook("https://evil.example.com/open-apis/bot/v2/hook/abcd-1234"), null);
  assert.equal(alerts.parseWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/"), null);
  assert.equal(alerts.parseWebhook("https://open.feishu.cn.evil.com/open-apis/bot/v2/hook/abcd-1234"), null);
  assert.equal(alerts.parseWebhook("不是地址"), null);
});

test("webhook 落库前加密，解出来还是原地址", () => {
  const url = "https://open.feishu.cn/open-apis/bot/v2/hook/abcd-1234-efgh";
  const stored = alerts.encryptWebhook(url);
  assert.ok(stored && stored.startsWith("v1:"));
  assert.notEqual(stored, url);
  assert.equal(alerts.decryptWebhook(stored!), url);
  assert.equal(alerts.decryptWebhook("v1:bad:bad:bad"), null);
});

test("测试卡片说清绑了什么，并带退订链接", () => {
  const card = alerts.testCard("1xiaojian", "https://hot.jian.ing/unsub?token=x");
  assert.match(card.header.title.content, /绑定成功/);
  const text = JSON.stringify(card);
  assert.match(text, /@1xiaojian/);
  assert.match(text, /08:30/);
  assert.match(text, /unsub/);
});

test("每日卡片带选题、怎么写、去发按钮", () => {
  const card = alerts.dailyCard(
    {
      generatedAt: "2026-11-08T08:30:00.000Z",
      topic: { storyId: 1, publicId: "p1", title: "某模型开源", url: "https://hot.jian.ing/p/p1", rank: 1, heat: 1, posts: 45, reports: 3, repliesPerK: 3, angle: "做对比", why: "还在扩散", latestAt: "", commentables: [] },
      angle: "做对比、清单或实测。",
      numbers: [{ label: "48 小时 X 帖", value: "45 条" }],
      commentable: null,
      me: { handle: "1xiaojian", followers: 12, verdict: "偏讨论型" },
      links: { post: "https://x.com/intent/tweet?text=x", reply: null, story: "https://hot.jian.ing/p/p1" },
    } as never,
    "https://hot.jian.ing/unsub?token=x",
  );
  const text = JSON.stringify(card);
  assert.match(text, /某模型开源/);
  assert.match(text, /做对比/);
  assert.match(text, /去发/);
  assert.match(text, /退订/);
});

test("回复机会卡片带账号、浏览和去回按钮", () => {
  const card = alerts.opportunityCard(
    { id: "a1", handle: "shao__meng", text: "一条帖", url: "https://x.com/a/1", views: 500, replies: 4, ageHours: 1.5, median: 200 },
    "https://hot.jian.ing/unsub?token=x",
  );
  const text = JSON.stringify(card);
  assert.match(text, /@shao__meng/);
  assert.match(text, /去回/);
  assert.match(text, /500/);
});
