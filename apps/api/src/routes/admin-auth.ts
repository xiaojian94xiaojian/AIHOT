// Admin sign-in and the /api/admin guard. Public routes never read the session.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { safeReturn, SIGN_IN_HOME } from "@aihot/contracts/admin";
import { ADMIN } from "@aihot/site";
import { config } from "@aihot/backend/config";
import {
  cookie,
  endSession,
  LoginRejected,
  passwordLogin,
  SESSION_COOKIE,
  SESSION_DAYS,
  sessionPrincipal,
  type AdminPrincipal,
} from "@aihot/backend/admin/auth";
import { previewPrincipal } from "@aihot/backend/admin/preview";
import type { Previewer } from "@aihot/backend/modules";
import { sendProblem } from "../http/respond.ts";

/**
 * A cookie is Secure when the request itself arrived over HTTPS: the browser judges it against the
 * page's origin, so a plain-HTTP entry (a LAN address, a published container port) drops a Secure
 * cookie at sign-in and the session never sticks. Behind a TLS-terminating proxy, trustProxy makes
 * `req.protocol` reflect X-Forwarded-Proto, so the public HTTPS entry keeps its Secure cookie.
 */
const secure = (req: FastifyRequest) => req.protocol === "https";

/**
 * Password attempts: at most 10 per client address and 50 in all per 15 minutes. The overall cap holds
 * even when a client forges its address; with a 12+ character password that is far too slow to guess.
 */
const attempts = new Map<string, number[]>();
function over(key: string, _limit: number, now: number): number {
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length;
}
function tooManyAttempts(ip: string): { refused: boolean; attempt: number } {
  const now = Date.now();
  if (attempts.size > 5000) attempts.clear();
  const perClient = over(`ip:${ip}`, 10, now);
  const overall = over("all", 50, now);
  return { refused: overall > 50 || perClient > 10, attempt: perClient };
}

const loginPage = (returnTo: string, error?: string) => `/admin/login?${new URLSearchParams({ return: safeReturn(returnTo), ...(error ? { error } : {}) })}`;

/**
 * A refused sign-in attempt, as a line an operator can find. The admin has no per-attempt record
 * anywhere else (only a *completed* sign-in is audited), so without this nobody can tell whether the
 * password is being guessed. Logged rather than audited: an unauthenticated caller could fill the audit
 * page and the table at will. The password itself is never named, and the address comes from the same
 * value the attempt limit counts.
 */
type LoginRefusal = "unset" | "too-many" | "wrong";
function logRefusedLogin(req: FastifyRequest, method: "password", reason: LoginRefusal, attempt: number) {
  req.log.warn({
    event: "admin_login_refused", method, reason, attempt, client: req.ip,
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 120),
  }, "admin sign-in refused");
}

// The guard lives in the backend package so a module's own admin routes (modules/<name>/server.ts) use the same one.
export { adminHandler, type AdminHandler } from "@aihot/backend/admin/auth";

function handlerError(req: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: error.issues.map((issue) => `${issue.path.join(".") || "请求"}: ${issue.message}`).join("; ").slice(0, 300) });
  }
  if ((error as { statusCode?: number }).statusCode === 400 || error instanceof SyntaxError) {
    return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: String((error as Error).message).slice(0, 300) });
  }
  if ((error as { code?: string }).code === "conflict") return sendProblem(req, reply, { status: 409, code: "conflict", detail: (error as Error).message });
  req.log.error({ err: error, path: req.url.split("?")[0] }, "admin api error");
  return sendProblem(req, reply, { status: 500, code: "internal_error", detail: String((error as Error).message).slice(0, 300) });
}

/** Gray data is read-only, for engine admins or module-approved previewers. */
export function previewHandler(fn: (req: FastifyRequest, reply: FastifyReply, previewer: Previewer) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      reply.header("Allow", "GET, HEAD");
      return sendProblem(req, reply, { status: 405, code: "method_not_allowed", detail: "Preview data is read-only." });
    }
    const previewer = await previewPrincipal(req.headers.cookie);
    if (!previewer) return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "Preview access required." });
    try {
      return await fn(req, reply, previewer);
    } catch (error) {
      return handlerError(req, reply, error);
    }
  };
}

export function registerAdminAuth(app: FastifyInstance) {
  app.get("/api/admin/preview", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const previewer = await previewPrincipal(req.headers.cookie);
    if (!previewer) return sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "Preview access required.", cacheControl: "private, no-store" });
    return { name: previewer.name };
  });
  if (!ADMIN) return;

  // The web admin sends a signed-out visitor here with ?return=.
  app.get("/api/auth/login", async (req, reply) => {
    const returnTo = String((req.query as Record<string, string>).return ?? SIGN_IN_HOME);
    // A live session does not need signing in again: go straight to where the visitor was headed.
    if (await sessionPrincipal(req.headers.cookie)) return reply.header("Cache-Control", "no-store").redirect(safeReturn(returnTo), 302);
    return reply.header("Cache-Control", "no-store").redirect(loginPage(returnTo), 302);
  });

  app.get("/api/auth/options", async (_req, reply) => reply.header("Cache-Control", "no-store").send({ password: !!config.adminPassword }));

  // The sign-in and sign-out forms post as plain HTML forms; only these routes read that format.
  app.register(async (form) => {
    form.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
    form.post("/api/auth/password", async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, string>;
      const returnTo = String(b.return ?? SIGN_IN_HOME);
      reply.header("Cache-Control", "no-store");
      const { refused, attempt } = tooManyAttempts(String(req.ip));
      if (refused) {
        logRefusedLogin(req, "password", "too-many", attempt);
        return reply.redirect(loginPage(returnTo, "too-many"), 303);
      }
      // A password nobody has set is the site's own state, not an attempt against it.
      const unset = !config.adminPassword || config.adminPassword.length < 12;
      try {
        const { token, returnTo: target } = await passwordLogin(String(b.password ?? ""), returnTo, req.headers["user-agent"]);
        reply.header("Set-Cookie", cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400, secure(req)));
        return reply.redirect(target, 303);
      } catch (error) {
        if (!(error instanceof LoginRejected)) req.log.error({ err: error }, "admin login failed");
        const reason: LoginRefusal = unset ? "unset" : "wrong";
        logRefusedLogin(req, "password", reason, attempt);
        return reply.redirect(loginPage(returnTo, reason), 303);
      }
    });
    // Signing out is a plain form too: outside this scope its empty urlencoded body would be a 415.
    form.post("/api/auth/logout", async (req, reply) => {
      await endSession(req.headers.cookie);
      reply.header("Set-Cookie", cookie(SESSION_COOKIE, "", 0, secure(req))).header("Cache-Control", "no-store");
      return reply.redirect("/", 303);
    });
  });
}