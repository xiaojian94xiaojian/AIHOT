-- One computation of the boards: the public pages read the latest published run.
CREATE TABLE IF NOT EXISTS lb_runs (
  id                   text PRIMARY KEY,
  methodology_version  text NOT NULL,
  generated_at         timestamptz NOT NULL,
  source_snapshot_ids  text[] NOT NULL DEFAULT '{}',
  summary              jsonb NOT NULL DEFAULT '{}',
  status               text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'failed', 'shadow', 'historical')),
  origin               text NOT NULL DEFAULT 'computed' CHECK (origin IN ('computed', 'imported')),
  created_at           timestamptz NOT NULL DEFAULT now()
);
