-- 归组失败自动重试：下一次重试的时间（NULL 表示不自动重试）。
ALTER TABLE articles ADD COLUMN IF NOT EXISTS grouping_retry_at timestamptz;
