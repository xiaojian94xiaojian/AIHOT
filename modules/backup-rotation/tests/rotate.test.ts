// 备份桶保留策略：只删三个前缀里过期的对象，分页也要跟上；不认识的键一律不动。
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { expired, rotate } from "../backend/rotate.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-10-18T04:40:00Z");
const ago = (days: number) => new Date(now - days * DAY);

test("only daily/, weekly/ and monthly/ expire, by last-modified age", () => {
  assert.equal(expired("daily/a.dump", ago(8), now), true);
  assert.equal(expired("daily/a.dump", ago(6), now), false);
  assert.equal(expired("weekly/a.dump", ago(29), now), true);
  assert.equal(expired("weekly/a.dump", ago(27), now), false);
  assert.equal(expired("monthly/a.dump", ago(181), now), true);
  assert.equal(expired("monthly/a.dump", ago(179), now), false);
  assert.equal(expired("other/a.dump", ago(999), now), false);
  assert.equal(expired("daily-2026.dump", ago(999), now), false);
  assert.equal(expired("daily/a.dump", "not a date", now), false);
});

test("a rotation pass deletes only expired objects and follows pagination", async () => {
  const deleted: string[] = [];
  const contents = (items: Array<[string, number]>) => items.map(([key, days]) =>
    `<Contents><Key>${key}</Key><LastModified>${ago(days).toISOString()}</LastModified><Size>1</Size></Contents>`).join("");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "DELETE") {
      deleted.push(decodeURIComponent(url.pathname.split("/b/")[1] ?? ""));
      res.writeHead(204);
      res.end();
      return;
    }
    const second = url.searchParams.get("continuation-token") === "p2";
    const body = second
      ? contents([["monthly/old.dump", 200], ["monthly/new.dump", 10], ["other/old.dump", 400], ["noSlash", 400]])
      : contents([["daily/old.dump", 8], ["daily/new.dump", 2], ["weekly/old.dump", 30]])
        + "<IsTruncated>true</IsTruncated><NextContinuationToken>p2</NextContinuationToken>";
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult>${body}</ListBucketResult>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  try {
    const result = await rotate({
      now,
      store: { secretId: "id", secretKey: "key", bucket: "b", region: "auto", endpoint: (key) => `http://127.0.0.1:${port}/b/${key}` },
    });
    assert.equal(result.scanned, 7);
    assert.deepEqual(result.deleted.sort(), ["daily/old.dump", "monthly/old.dump", "weekly/old.dump"]);
    assert.deepEqual(deleted.sort(), result.deleted.sort());
    assert.deepEqual(result.failed, []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("an unconfigured store does nothing", async () => {
  assert.deepEqual(await rotate({ store: null }), { scanned: 0, deleted: [], failed: [] });
});
