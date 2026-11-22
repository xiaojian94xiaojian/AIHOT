CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_x_zh_published_idx ON articles (published_at DESC) WHERE x_post IS NOT NULL AND coalesce(x_post->>'lang', language) = 'zh';
