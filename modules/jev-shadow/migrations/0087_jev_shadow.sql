-- Jev 影子（P0）：每篇材料一行，存生产判定与 Jev 在同一次请求里给出的答案。
-- 只对照，不改任何判定；一行对应一篇材料的一个修订版本，重跑时覆盖。
CREATE TABLE jev_shadow (
  id                        bigserial PRIMARY KEY,
  article_id                text NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  input_revision            integer NOT NULL,
  model                     text NOT NULL,
  source_id                 text NOT NULL,
  source_tier               text,
  our_relevance             text,
  our_score                 numeric(5, 2),
  threshold                 integer,
  jev_prefilter             text,
  jev_prefilter_confidence  real,
  jev_score                 numeric(6, 2),
  jev_score_raw             numeric(5, 2),
  jev_score_confidence      real,
  latency_ms                integer,
  error                     text,
  raw                       jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, input_revision, model)
);
