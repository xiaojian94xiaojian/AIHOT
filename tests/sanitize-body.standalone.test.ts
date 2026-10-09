// A sanitised body is the only body the site, its feeds and its exports ever hold, so its output must
// satisfy the allowlist it declares: cleaning it again changes nothing, and no address a browser would
// execute or a reader would not expect can arrive through a lazy attribute.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeBody } from "@aihot/backend/content/sanitize";

const base = "https://publisher.example/posts/article";

test("a lazy attribute cannot carry an address the tag's own allowlist refuses", () => {
  // The transform copies data-src / data-original / data-poster over src and poster. sanitize-html checks
  // the attribute the source page actually wrote, and it does so before transformTags runs, so whatever
  // those attributes hold reaches the stored body without ever meeting a scheme allowlist.
  const lazy = [
    '<p><img data-src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" src="https://publisher.example/a.png"></p>',
    '<p><img data-original="data:text/html,<script>alert(1)</script>" src="https://publisher.example/a.png"></p>',
    '<p><img data-src="data:application/xhtml+xml,<script>alert(1)</script>" src="https://publisher.example/a.png"></p>',
    '<video data-poster="data:text/html,<script>alert(1)</script>" src="https://publisher.example/v.mp4"></video>',
  ];
  for (const html of lazy) {
    const cleaned = sanitizeBody(html, base);
    assert.doesNotMatch(cleaned, /<script|data:text\/html|data:application/, `${html} kept a document address: ${cleaned}`);
    assert.equal(sanitizeBody(cleaned, base), cleaned, "cleaning a cleaned body changes nothing");
  }
});

test("an inline picture is the only data: address a body keeps", () => {
  // data: is allowed on img for pictures embedded in a feed; a data: document is not a picture, so the
  // address goes and an <img> with nothing to show does not survive cleanup.
  const kept = sanitizeBody('<p><img src="data:image/png;base64,iVBORw0KGgo="></p>', base);
  assert.match(kept, /^<p><img src="data:image\/png;base64,/);

  const mixed = sanitizeBody(
    '<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p>' +
      '<p><img src="data:text/html,<script>alert(1)</script>"></p>' +
      '<p><a href="//evil.example/x">link</a></p>' +
      '<video src="//evil.example/v.mp4" poster="data:text/html,x"></video>',
    base,
  );
  assert.match(mixed, /src="data:image\/gif;base64,/);
  assert.match(mixed, /href="https:\/\/evil\.example\/x"/);
  assert.doesNotMatch(mixed, /data:text\/html|<script/);
  assert.doesNotMatch(mixed, /poster=/);
  assert.equal(sanitizeBody(mixed, base), mixed);
});
