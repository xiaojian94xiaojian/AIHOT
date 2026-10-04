-- Exchange rates the leaderboard's prices are shown with; nothing else used this table.
CREATE TABLE IF NOT EXISTS fx_rates (
  as_of        date NOT NULL,
  pair         text NOT NULL,
  rate         numeric(12, 6) NOT NULL,
  source_name  text NOT NULL,
  source_url   text,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (as_of, pair)
);
