-- 采集成本看板：每天一行，记 SocialData 的调用数、空抓数、返回对象数、花费与覆盖源数。
CREATE TABLE IF NOT EXISTS x_collect_stats (
  day             date PRIMARY KEY,          -- 北京时间的那一天
  calls           int NOT NULL,
  empty_calls     int NOT NULL,
  objects         int NOT NULL,
  usd             numeric(10,4) NOT NULL,
  sources         int NOT NULL,              -- 当天实际被调用的源数
  enabled_sources int NOT NULL,              -- 当天结束时启用中的 X 源总数
  updated_at      timestamptz NOT NULL DEFAULT now()
);
