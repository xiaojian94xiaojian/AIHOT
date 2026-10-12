// The object store's URL form. Cloudflare R2 answers only path-style requests
// (…/<bucket>/<key>); a bucket in the host name — what Tencent COS wants — comes back 403, which is
// how this deployment's backups silently stopped. The switch is what the rest of the store settings
// already assume, so it is a setting, not a second code path.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { runBackup } from "@aihot/backend/operations/backup";

const T = tag();
const originalFetch = globalThis.fetch;
const env = {
  DB_BACKUP_STORE_SECRET_ID: "test-backup-id", DB_BACKUP_STORE_SECRET_KEY: "test-backup-key",
  DB_BACKUP_STORE_BUCKET: "test-bucket", DB_BACKUP_STORE_REGION: "auto", DB_BACKUP_STORE_DOMAIN: "backup.invalid",
  FEISHU_INTERNAL_ENABLED: "false",
};
const originalEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));

/** Every request the backup makes, so the URL form can be asserted instead of assumed. */
const requests: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, "https://backup.invalid", "the backup fixture must not contact any real service");
  requests.push(`${url.host}${url.pathname}`);
  // Drain the file stream the backup is sending, so the upload finishes.
  for await (const _ of init!.body as unknown as AsyncIterable<Uint8Array>) void _;
  return new Response(null, { status: 200 });
}) as typeof fetch;

after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await closeDb();
});

test("with the path-style switch the bucket is in the path, which is the only form R2 accepts", async () => {
  Object.assign(process.env, env, { DB_BACKUP_STORE_PATH_STYLE: "true" });
  requests.length = 0;
  // 2026-11-01 is a Sunday and the first of the month, so one run writes all three retention prefixes.
  const summary = await runBackup(new Date("2026-11-01T04:00:00Z"));
  assert.equal(summary.uploaded, true);
  assert.ok(requests.length > 0, "the backup uploaded something");
  for (const request of requests) {
    assert.ok(
      request.startsWith(`backup.invalid/${env.DB_BACKUP_STORE_BUCKET}/`),
      `R2 wants /${env.DB_BACKUP_STORE_BUCKET}/<key> in the path, got ${request}`,
    );
  }
  // The stored key is the retention prefix and file name, with no bucket in it: a bucket in the path
  // must not leak into the object's own name.
  const { objects } = summary as { objects: Array<{ key: string }> };
  const stem = sql.options.database.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.deepEqual(
    objects.map((o) => o.key).sort(),
    ["daily", "weekly", "monthly"].flatMap((p) => [`${p}/${stem}-202611010400.dump`, `${p}/${stem}-files-202611010400.tar.gz`]).sort(),
  );
  assert.ok(requests.every((r) => !r.includes(`/${env.DB_BACKUP_STORE_BUCKET}/daily/${env.DB_BACKUP_STORE_BUCKET}`)),
    "the bucket name must not appear twice");
});
