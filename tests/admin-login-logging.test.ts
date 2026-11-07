// A refused admin sign-in leaves a line an operator can find: the admin keeps no other record of an
// attempt (only a completed sign-in is audited), so the process log is the only place a password being
// guessed shows up. Also what a refusal must never leave behind: the password itself, a session, or
// rows in audit_log.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";

const PASSWORD = "test-admin-password-for-logging";
const original = { password: config.adminPassword, environment: config.environmentName };
config.adminPassword = PASSWORD;
config.environmentName = "test";

const lines: string[] = [];
const app = Fastify({ logger: { level: "warn", stream: { write: (line: string) => { lines.push(line); } } } });
registerAdminAuth(app);
let base = "";
const realFetch = globalThis.fetch;
before(async () => {
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});
after(async () => {
  await app.close();
  globalThis.fetch = realFetch;
  config.adminPassword = original.password;
  config.environmentName = original.environment;
  await closeDb();
});

/** One sign-in attempt with the given password; answers the redirect it was sent to. */
async function attempt(password: string): Promise<{ location: string; cookies: string[] }> {
  const res = await realFetch(`${base}/api/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "synthetic-agent/1.0" },
    body: new URLSearchParams({ password, return: "/admin" }).toString(),
    redirect: "manual",
  });
  return { location: res.headers.get("location") ?? "", cookies: res.headers.getSetCookie() };
}

const refusals = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event === "admin_login_refused");

test("a wrong password is refused, logged with its attempt number, and never writes the password", async () => {
  lines.length = 0;
  const auditBefore = (await sql`SELECT count(*)::int AS n FROM audit_log`)[0]!.n;
  const response = await attempt("not-the-admin-password");
  const entries = refusals();
  assert.equal(entries.length, 1, "one refused attempt leaves one line");
  assert.deepEqual(
    { method: entries[0]!.method, reason: entries[0]!.reason, attempt: entries[0]!.attempt, msg: entries[0]!.msg },
    { method: "password", reason: "wrong", attempt: 1, msg: "admin sign-in refused" },
  );
  assert.ok(entries[0]!.client, "the line names the address the attempt limit counts");
  assert.equal(entries[0]!.userAgent, "synthetic-agent/1.0");
  assert.match(response.location, /error=wrong/, "the reader is told the password was wrong");
  // Nothing that a refusal must not leave: no password anywhere in the process log, no session, no audit row.
  assert.doesNotMatch(lines.join("\n"), new RegExp(PASSWORD));
  assert.doesNotMatch(lines.join("\n"), /not-the-admin-password/);
  assert.deepEqual(response.cookies, [], "a refused attempt sets no cookie");
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log`)[0]!.n, auditBefore, "a refusal is not an audit entry");
});

test("a password nobody has set is refused as the site's state, not as an attempt", async () => {
  lines.length = 0;
  config.adminPassword = "";
  try {
    const response = await attempt("anything");
    assert.match(response.location, /error=unset/, "the sign-in page says the password is not configured");
    assert.equal(refusals()[0]?.reason, "unset");
  } finally {
    config.adminPassword = PASSWORD;
  }
});

// Last: this one deliberately exhausts the address's attempts, and the window is shared by every test here.
test("attempts against one address are counted, and the one past the limit says so", async () => {
  lines.length = 0;
  // The limit is 10 per address per 15 minutes and these tests share one address, so keep going until
  // the route itself says the limit is reached rather than assuming a fresh window.
  let refusedForRate = false;
  for (let i = 0; i < 12 && !refusedForRate; i += 1) {
    const response = await attempt("still-not-the-password");
    if (/error=too-many/.test(response.location)) refusedForRate = true;
  }
  assert.ok(refusedForRate, "the eleventh attempt within the window is refused for rate, not for the password");
  const entries = refusals();
  assert.equal(entries.at(-1)!.reason, "too-many", "the line distinguishes a rate refusal from a wrong password");
  assert.ok(entries.slice(0, -1).every((entry) => entry.reason === "wrong"), "attempts under the limit are recorded as wrong passwords");
  const numbers = entries.slice(0, -1).map((entry) => entry.attempt as number);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), "attempt numbers only grow, so a burst is visible in the log");
  assert.doesNotMatch(lines.join("\n"), /still-not-the-password/);
});
