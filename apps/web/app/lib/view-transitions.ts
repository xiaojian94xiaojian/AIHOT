// WebKit terminates the page's renderer while it composites a view transition: on the live site, an iPhone
// reader who tapped any card got a blank page instead of the article, while a full page load of the same
// article was fine (that starts no transition) and Chromium never crashed. The phone page transition is the
// only thing asking for one, so this is where the engine is told to do without.
//
// Its own module, with no imports, so a test can run it in the plain node environment without the app's
// bundler-style imports (tests/view-transition-webkit.standalone.test.ts).

/**
 * Makes `document.startViewTransition` unavailable to a WebKit browser. Every other engine keeps it.
 *
 * Detected by user agent because there is no other way to tell one engine from another. Chrome on iOS says
 * CriOS and Edge says EdgiOS, and they are deliberately NOT excluded: on iOS every browser is WebKit
 * underneath, and measured on the live site Chrome on iOS crashed exactly as Safari did.
 */
export function dropViewTransitionsOnWebKit() {
  if (typeof navigator === "undefined" || typeof document === "undefined") return;
  const ua = navigator.userAgent;
  const chromium = /Chrome\/|Chromium\/|Edg\/|EdgA\//i.test(ua);
  if (!/AppleWebKit/i.test(ua) || chromium) return;
  if (typeof document.startViewTransition !== "function") return;
  // Shadowed, not deleted: in WebKit the method lives two levels up the prototype chain (on
  // Document.prototype), not on this document, so `delete document.startViewTransition` reports success and
  // changes nothing. A shadowing own property makes the read below not a function, which is what React
  // Router checks when it commits a navigation with `viewTransition` (components.js
  // `isViewTransitionAvailable`); it then navigates without a transition, the way it already does in a
  // browser that has no such API. A stub that still returns a transition object would not help.
  Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true, writable: true });
}

