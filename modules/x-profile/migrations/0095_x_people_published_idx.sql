-- 博主画像是按 source_id + published_at 扫 X 账号的帖子；没有这个索引时是 12 万行全表扫（约 6 秒）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_x_account_published_idx
  ON articles (published_at DESC)
  WHERE source_id LIKE 'x-account-%';
