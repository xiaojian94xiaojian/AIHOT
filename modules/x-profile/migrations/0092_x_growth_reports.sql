-- 每周涨粉报告：模型根据发帖与同期报道写的观察，按账号和周期各存一份。
CREATE TABLE IF NOT EXISTS x_growth_reports (
  handle text NOT NULL,
  screen_name text NOT NULL,
  name text,
  avatar_url text,
  window_days int NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  model text,
  growth bigint NOT NULL,
  followers bigint NOT NULL,
  posts int NOT NULL,
  views bigint NOT NULL,
  report jsonb NOT NULL,
  PRIMARY KEY (handle, window_days, period_end)
);
