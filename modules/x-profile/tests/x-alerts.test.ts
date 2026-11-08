// 飞书提醒的纯逻辑：webhook 校验、加解密、卡片结构。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-for-alerts-0123456789";
const alerts = await import("../backend/alerts.ts");
const { sql, closeDb } = await import("@aihot/backend/db");
after(async () => {
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
  assert.match(text, /每天早上/);
  assert.match(text, /unsub/);
});

test("每日卡片带选题、怎么写、去发按钮，markdown 元字符被转义", () => {
  const card = alerts.dailyCard(
    {
      generatedAt: "2026-11-08T08:30:00.000Z",
      topic: { storyId: 1, publicId: "p1", title: "某模型*开源*[中]&ok", url: "/story/p1", rank: 1, heat: 1, posts: 45, reports: 3, repliesPerK: 3, angle: "做对比", why: "还在扩散", latestAt: "", commentables: [] },
      angle: "做对比、清单或实测。",
      numbers: [{ label: "48 小时 X 帖", value: "45 条" }],
      commentable: null,
      me: { handle: "1xiaojian", followers: 12, verdict: "偏讨论型" },
      links: { post: "https://x.com/intent/tweet?text=x", reply: null, story: "/story/p1" },
    } as never,
    "https://hot.jian.ing/unsub?token=x",
    "https://hot.jian.ing",
  );
  const text = JSON.stringify(card);
  assert.match(text, /&#42;开源&#42;/);
  assert.match(text, /&#91;中&#93;/);
  assert.match(text, /&#38;ok/);
  assert.match(text, /https:\/\/hot\.jian\.ing\/story\/p1/, "URL 不能被转义");
  assert.match(text, /做对比/);
  assert.match(text, /去发/);
  assert.match(text, /退订/);
  // 站内相对路径要变成绝对地址，否则飞书按钮打不开。
  assert.match(text, /https:\/\/hot\.jian\.ing\/story\/p1/);
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

test("IP 只存带密钥的指纹：稳定、不可反推、不同用途不同结果", async () => {
  const { hashIp } = await import("../backend/hash.ts");
  const a = hashIp("203.0.113.7", "x-alert");
  const b = hashIp("203.0.113.7", "x-alert");
  const c = hashIp("203.0.113.7", "x-account-request");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
  assert.ok(!a.includes("203"));
});

test("同一个机器人重复绑定只留一行；别人的账号不能被接管；退订后释放账号", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const handle = `alerts-test-${suffix}`;
  const webhookA = `hash-a-${suffix}`;
  const webhookB = `hash-b-${suffix}`;
  const tokenA = `tok-a-${suffix}`;
  const tokenB = `tok-b-${suffix}`;
  const tokenD = `tok-d-${suffix}`;

  assert.equal(await alerts.activeTokenFor(webhookA), null, "没绑之前没有 token");

  const first = await alerts.claimSubscription({ handle, secret: "v1:x", webhookHash: webhookA, kinds: ["card"], token: tokenA });
  assert.equal(await alerts.activeTokenFor(webhookA), tokenA);

  // 活跃重绑：换一个 token 也不会覆盖已经发出去的那个。
  const again = await alerts.claimSubscription({ handle, secret: "v1:y", webhookHash: webhookA, kinds: ["card", "reply"], token: tokenB });
  assert.equal(again.id, first.id, "同一个 webhook 再绑是更新，不新增");
  const [kept] = await sql<{ token: string }[]>`SELECT token FROM x_alert_subscriptions WHERE id = ${first.id}`;
  assert.equal(kept?.token, tokenA, "活跃重绑保留旧 token");

  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM x_alert_subscriptions WHERE webhook_hash = ${webhookA}`;
  assert.equal(row?.n, 1);

  await assert.rejects(
    () => alerts.claimSubscription({ handle, secret: "v1:z", webhookHash: webhookB, kinds: ["card"], token: `tok-e-${suffix}` }),
    (error: unknown) => error instanceof alerts.AlertRejected && error.status === 409,
    "账号被别的机器人绑了要拒绝，不能改写",
  );

  // 先塞一条去重记录：退订+重绑不能把它弄丢，否则同一天会再发一张卡。
  await sql`INSERT INTO x_alert_sent (subscription_id, key, created_at) VALUES (${first.id}, ${`card:test-${suffix}`}, now())`;

  assert.equal(await alerts.unsubscribe(tokenA), true);
  const [after] = await sql<{ handle: string | null; status: string; token: string; webhook: string; webhook_hash: string }[]>`
    SELECT handle, status, token, webhook, webhook_hash FROM x_alert_subscriptions WHERE id = ${first.id}`;
  assert.equal(after?.status, "unsubscribed");
  assert.equal(after?.handle, null, "退订要释放 handle");
  assert.equal(after?.webhook, "", "退订要清掉群凭证");
  assert.equal(after?.webhook_hash, webhookA, "保留指纹，重绑才能命中同一行");
  assert.notEqual(after?.token, tokenA, "退订后旧 token 作废");
  assert.equal(await alerts.activeTokenFor(webhookA), null);

  const [sent] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM x_alert_sent WHERE subscription_id = ${first.id} AND key = ${`card:test-${suffix}`}`;
  assert.equal(sent?.n, 1, "退订不丢去重记录");

  // 重新绑定：复用同一行、用这次的新 token；旧链接永久失效。
  const back = await alerts.claimSubscription({ handle, secret: "v1:w", webhookHash: webhookA, kinds: ["card"], token: tokenD });
  assert.equal(back.id, first.id);
  const [reactivated] = await sql<{ token: string; status: string }[]>`SELECT token, status FROM x_alert_subscriptions WHERE id = ${first.id}`;
  assert.equal(reactivated?.status, "active");
  assert.equal(reactivated?.token, tokenD, "重新绑定用新 token");

  const takeover = await alerts.claimSubscription({ handle: `${handle}-other`, secret: "v1:z", webhookHash: webhookB, kinds: ["card"], token: `tok-c-${suffix}` });
  assert.notEqual(takeover.id, first.id, "换一个机器人是另一行");

  await sql`DELETE FROM x_alert_subscriptions WHERE webhook_hash IN (${webhookA}, ${webhookB})`;
});