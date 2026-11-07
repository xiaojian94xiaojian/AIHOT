-- How each evaluation source names a model (0044 rebuilt the display names from these).
CREATE TABLE IF NOT EXISTS lb_aliases (
  id                text PRIMARY KEY,
  source_key        text NOT NULL,
  alias             text NOT NULL,
  normalized_alias  text NOT NULL,
  model_id          text NOT NULL REFERENCES lb_models (id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
