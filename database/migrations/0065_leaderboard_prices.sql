-- Official, subscription and third-party relay prices are kept apart (0007); only 'official' is shown
-- as the API price. Prices never affect ranking. Per million tokens, in `currency`.
CREATE TABLE IF NOT EXISTS lb_prices (
  model_id      text NOT NULL REFERENCES lb_models (id),
  kind          text NOT NULL CHECK (kind IN ('official', 'subscription', 'relay')),
  currency      text NOT NULL CHECK (currency IN ('CNY', 'USD')),
  input         numeric(14, 6),
  output        numeric(14, 6),
  cached_input  numeric(14, 6),
  source_url    text,
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, kind)
);
