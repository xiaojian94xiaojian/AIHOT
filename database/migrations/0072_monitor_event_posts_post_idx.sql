-- An event's posts are found by event_id through the primary key; the reverse lookup needs this.
CREATE INDEX CONCURRENTLY IF NOT EXISTS monitor_event_posts_post_idx ON monitor_event_posts (post_id);
