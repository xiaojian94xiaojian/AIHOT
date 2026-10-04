-- The monitor's own state, including which posts have already been processed. Losing it makes the
-- monitor treat old posts as new and alert on them again.
CREATE TABLE IF NOT EXISTS monitor_state (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
