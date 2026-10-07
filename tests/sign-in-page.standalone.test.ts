// A fetch that ended on a sign-in form is not the article: it must yield "unconfirmed", never a body.
// The cases are the real ones from a HuggingFace source that answered every paper URL with its login
// page, plus the redirects that must stay fetchable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSignInRedirect } from "../packages/backend/src/content/extract.ts";

const REFUSED: Array<[string, string, string]> = [
  [
    "https://arxiv.org/abs/2609.38721",
    "https://huggingface.co/login?next=%2Fpapers%2F2609.38721",
    "the real case: a source built an arxiv URL and HuggingFace answered with its login page",
  ],
  ["https://huggingface.co/papers/2609.38721", "https://huggingface.co/login?next=%2Fpapers%2F2609.38721", "same host, bounced to the login form"],
  ["https://example.com/a", "https://example.com/login", "same host, the article needs signing in"],
  ["https://example.com/a", "https://example.com/sign-in", "sign-in"],
  ["https://example.com/a", "https://example.com/authorize/step2", "a multi-step authorisation"],
  ["https://example.com/a", "https://accounts.example.com/o/oauth2/auth?client_id=x", "an identity provider"],
  ["https://news.example.com/a", "https://news.example.com/sso?return=%2Fa", "single sign-on"],
  ["https://example.com/a", "https://example.com/register", "a registration wall"],
];

const FETCHED: Array<[string, string, string]> = [
  ["https://example.com/a", "https://example.com/a", "no redirect at all"],
  ["https://example.com/a", "https://www.example.com/a", "only the host normalised to www"],
  ["https://example.com/a", "https://example.com/a/", "only a trailing slash was added"],
  ["https://example.com/a?x=1", "https://example.com/a?x=1", "the same address"],
  ["https://example.com/a", "https://example.com/blog/login-tips", "an article whose path mentions login"],
  ["https://example.com/a", "https://example.com/2026/10/05/authentication-in-practice", "an article about authentication"],
  ["https://example.com/a", "https://example.com/author/jane", "a redirect to the author's page"],
];

test("a fetch that ended on a sign-in form is refused", () => {
  for (const [asked, landed, why] of REFUSED) {
    assert.equal(isSignInRedirect(asked, landed), true, `${asked} → ${landed} (${why})`);
  }
});

test("an ordinary redirect is still the article", () => {
  for (const [asked, landed, why] of FETCHED) {
    assert.equal(isSignInRedirect(asked, landed), false, `${asked} → ${landed} (${why})`);
  }
});

test("an address that did not move is never judged a sign-in page", () => {
  // The guard reads a redirect; a page that is itself at /login is the source's own business.
  assert.equal(isSignInRedirect("https://example.com/login", "https://example.com/login"), false);
});
