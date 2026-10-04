// Shared HTTP helpers. They live in the backend package (lib/http.ts) so a module's own routes
// (modules/<name>/server.ts `http`) can answer exactly like the engine's; this file re-exports them.
export {
  applyPublicHeaders,
  etagMatches,
  looseQuery,
  QueryError,
  sendJsonWithEtag,
  sendJsonWithNotice,
  sendProblem,
  sendTextWithEtag,
  strictQuery,
  weakEtag,
  type ProblemInit,
  type PublicHeadersOptions,
} from "@aihot/backend/lib/http";
