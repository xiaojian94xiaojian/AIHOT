-- 账号的类型与主类目：模型初标（Top100），可再人工改；没有行时用代码里的类型表。
CREATE TABLE IF NOT EXISTS x_account_meta (
  handle text PRIMARY KEY,
  kind text NOT NULL,
  category text,
  confidence numeric(3,2),
  reason text,
  model text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
