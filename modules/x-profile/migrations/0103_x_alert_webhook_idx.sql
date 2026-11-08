CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS x_alert_subs_webhook_idx ON x_alert_subscriptions (webhook_hash) WHERE webhook_hash IS NOT NULL;
