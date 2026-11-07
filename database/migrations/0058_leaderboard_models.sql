-- 4.0.0 removed the model leaderboard (0053_drop_leaderboard_monitor.sql); this site runs it as the
-- module modules/leaderboard, so its tables are rebuilt here at the shape they had when they were dropped:
-- as 0003 created them, minus the columns 0049, 0050 and 0052 had already dropped. One statement per file
-- from 0055 on. The rows come from the backup taken before the drop.
CREATE TABLE IF NOT EXISTS lb_models (
  id                           text PRIMARY KEY,
  slug                         text NOT NULL UNIQUE,
  name                         text NOT NULL,
  provider                     text,
  provider_slug                text,
  released_at                  timestamptz,
  release_date_source          text,
  context_window_tokens        integer,
  metadata_source              text,
  metadata_updated_at          timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
