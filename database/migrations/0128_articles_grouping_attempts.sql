-- 归组失败自动重试：记录失败次数（1h/6h/24h 三次退避，之后留给人工）。
ALTER TABLE articles ADD COLUMN IF NOT EXISTS grouping_attempts integer NOT NULL DEFAULT 0;
