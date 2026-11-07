-- A run's board rows; 0050 dropped the five columns nothing wrote or read.
CREATE TABLE IF NOT EXISTS lb_rankings (
  id          bigserial PRIMARY KEY,
  run_id      text NOT NULL REFERENCES lb_runs (id) ON DELETE CASCADE,
  board       text NOT NULL,
  model_id    text NOT NULL REFERENCES lb_models (id),
  rank        integer NOT NULL,
  score       double precision,
  coverage    double precision,
  detail      jsonb,
  UNIQUE (run_id, board, model_id)
);
