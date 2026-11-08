CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS x_alert_sent_sub_key_idx ON x_alert_sent (subscription_id, key);
