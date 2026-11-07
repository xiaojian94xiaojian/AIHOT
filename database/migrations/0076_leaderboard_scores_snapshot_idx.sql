-- A snapshot's scores (the foreign key also needs it).
CREATE INDEX CONCURRENTLY IF NOT EXISTS lb_scores_snapshot_idx ON lb_scores (snapshot_id);
