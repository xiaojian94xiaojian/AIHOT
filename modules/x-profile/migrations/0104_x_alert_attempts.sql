CREATE TABLE IF NOT EXISTS x_alert_attempts (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
