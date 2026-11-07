-- One model's scores across snapshots.
CREATE INDEX CONCURRENTLY IF NOT EXISTS lb_scores_model_idx ON lb_scores (model_id);
