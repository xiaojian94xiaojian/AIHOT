-- One read of one evaluation source; a failing source keeps its last snapshot.
CREATE TABLE IF NOT EXISTS lb_snapshots (
  id               text PRIMARY KEY,
  source_key       text NOT NULL,
  source_name      text NOT NULL,
  source_url       text,
  license          text,
  attribution_url  text,
  content_hash     text,
  published_at     timestamptz,
  fetched_at       timestamptz NOT NULL,
  record_count     integer NOT NULL DEFAULT 0,
  metadata         jsonb NOT NULL DEFAULT '{}'
);
