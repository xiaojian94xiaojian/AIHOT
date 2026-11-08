CREATE INDEX CONCURRENTLY IF NOT EXISTS x_alert_attempts_ip_idx ON x_alert_attempts (ip_hash, created_at DESC);
