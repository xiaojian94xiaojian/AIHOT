CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS x_alert_subs_handle_idx ON x_alert_subscriptions (handle) WHERE handle IS NOT NULL;
