// The phone page transition rides on the browser's view-transition API. WebKit terminates the page's
// renderer while it composites one, so an iPhone reader who tapped any card got a blank page instead of the
// article (a full page load of the same article was fine). These cases pin the removal to WebKit and leave
// the Chromium and Gecko engines' transitions alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropViewTransitionsOnWebKit } from "../apps/web/app/lib/view-transitions.ts";

/**
 * Engines that must lose the API. iOS is the one that matters: every browser there is WebKit underneath, and
 * measured on the live site the tap into an article crashed under Chrome on iOS (CriOS) exactly as it did
 * under Safari — so the iOS browsers belong here however they name themselves.
 */
const WEBKIT: Array<[string, string]> = [
  ["Safari on iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"],
  ["Safari on macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"],
  ["Chrome on iOS (CriOS)", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.92 Mobile/15E148 Safari/604.1"],
  ["Firefox on iOS (FxiOS)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/129.0 Mobile/15E148 Safari/605.1.15"],
  ["Edge on iOS (EdgiOS)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/127.0 Mobile/15E148 Safari/605.1.15"],
];
/** Engines measured not to crash, which keep their page transition. */
const OTHERS: Array<[string, string]> = [
  ["Chrome on Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"],
  ["Chrome on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"],
  ["Edge on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0"],
  ["Firefox on Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0"],
];

/** Runs the check against one browser, with the globals put back afterwards. */
function keptAfterCheck(userAgent: string, documentValue: unknown = { startViewTransition: () => ({}) }): boolean {
  const beforeDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "document", { value: documentValue, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: { userAgent }, configurable: true, writable: true });
  try {
    dropViewTransitionsOnWebKit();
    return typeof (documentValue as { startViewTransition?: unknown }).startViewTransition === "function";
  } finally {
    if (beforeDocument) Object.defineProperty(globalThis, "document", beforeDocument);
    else delete (globalThis as unknown as Record<string, unknown>).document;
    if (beforeNavigator) Object.defineProperty(globalThis, "navigator", beforeNavigator);
    else delete (globalThis as unknown as Record<string, unknown>).navigator;
  }
}

test("WebKit loses the view-transition API, so the router navigates without one", () => {
  for (const [name, ua] of WEBKIT) assert.equal(keptAfterCheck(ua), false, name + " must not keep the API");
});

test("the engines that did not crash keep their page transition", () => {
  for (const [name, ua] of OTHERS) assert.equal(keptAfterCheck(ua), true, name + " must keep the API");
});

test("a document that never had the API is left alone", () => {
  assert.equal(keptAfterCheck(WEBKIT[0]![1], {}), false);
});
