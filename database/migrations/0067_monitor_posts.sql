-- 4.0.0 removed the Codex reset monitor (0053_drop_leaderboard_monitor.sql); this site runs it as the
-- module modules/monitor, so its tables are rebuilt here at the shape they had when they were dropped
-- (0003, plus the display and activity columns of 0008). One statement per file from 0055 on.
--
-- `activity` is a source post's role in an event (announce/confirm/amend/withdraw) or a related
-- interaction that never changes reset status by itself.
CREATE TABLE IF NOT EXISTS monitor_posts (
  id             text PRIMARY KEY,
  author         text NOT NULL,
  published_at   timestamptz NOT NULL,
  text           text NOT NULL,
  url            text NOT NULL,
  context        jsonb NOT NULL DEFAULT '[]',
  raw            jsonb,
  translation    text,
  recognition    jsonb,
  receipt_id     bigint,
  origin         text NOT NULL DEFAULT 'live' CHECK (origin IN ('live', 'imported')),
  collected_at   timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  activity       jsonb,
  outage         jsonb
);
