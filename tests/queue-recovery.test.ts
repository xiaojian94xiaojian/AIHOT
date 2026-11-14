import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { getBoss, enqueue, QUEUES, recordRun, stopBoss } from "@aihot/backend/jobs/queue";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";

import { closeDb, sql } from "@aihot/backend/db";

after(async () => { await stopBoss(); await closeDb(); });

test("a failed first database connection does not poison all later queue requests", async () => {
  const original = config.databaseUrl;
  const missing = new URL(original);
  missing.pathname = "/aihot_missing_queue_recovery_test";
  config.databaseUrl = missing.toString();
  try {
    await assert.rejects(getBoss(), /does not exist/);
  } finally {
    config.databaseUrl = original;
  }
  const boss = await getBoss();
  const id = await enqueue(QUEUES.analyze, { articleId: "recovered" });
  assert.ok(id);
  assert.equal((await boss.getJobById<{ articleId: string }>(QUEUES.analyze, id))?.data.articleId, "recovered");
});

test("a scheduled run stopped by the budget is recorded as skipped, not failed", async () => {
  const job = `test.budget.${Date.now()}`;
  await assert.rejects(recordRun(job, async () => { throw new BudgetExceededError("socialdata", "hour", 600); }), /Budget/);
  const [skipped] = await sql`SELECT status, error FROM job_runs WHERE job = ${job}`;
  assert.equal(skipped!.status, "skipped", "预算熔断是预期节流");
  assert.match(String(skipped!.error), /Budget/);
  const failedJob = `${job}.failed`;
  await assert.rejects(recordRun(failedJob, async () => { throw new Error("real failure"); }), /real failure/);
  const [failed] = await sql`SELECT status FROM job_runs WHERE job = ${failedJob}`;
  assert.equal(failed!.status, "failed", "其它错误仍然记失败");
  await sql`DELETE FROM job_runs WHERE job IN (${job}, ${failedJob})`;
});

// API or inspection clients must not steal cron forwarding; only the designated worker dispatches.
test('ordinary clients leave timer dispatch to the designated worker', async () => {
  const boss = await getBoss();
  await boss.createQueue('ownership.target');
  await boss.createQueue('__pgboss__send-it');
  const id = await boss.send('__pgboss__send-it', { name: 'ownership.target', key: '', data: {}, options: {} });
  assert.ok(id);
  await new Promise(resolve => setTimeout(resolve, 6500));
  assert.equal((await sql`SELECT state FROM pgboss.job WHERE id=${id}`)[0]!.state, 'created');
  assert.equal((await sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name='ownership.target'`)[0]!.count, 0);
  await stopBoss();
  await getBoss({ supervise: true });
  const deadline = Date.now() + 12000;
  while ((await sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name='ownership.target'`)[0]!.count === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name='ownership.target'`)[0]!.count, 1);
});
