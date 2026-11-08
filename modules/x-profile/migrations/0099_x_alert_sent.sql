CREATE TABLE IF NOT EXISTS x_alert_sent (
  id bigserial PRIMARY KEY,
  subscription_id bigint NOT NULL REFERENCES x_alert_subscriptions (id) ON DELETE CASCADE,
  -- 去重键：card:2026-11-08 / reply:<tweet id>。
  key text NOT NULL
);
