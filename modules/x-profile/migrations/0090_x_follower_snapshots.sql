-- X 粉丝快照（模块 x-profile）：每个账号每天一行，记录当天最后一次抓到的粉丝数。
-- 数据来自采集回执（receipts.response 里每条推文的 user.followers_count），回执只保留 30 天，
-- 这张表是涨粉榜自己的历史，不随回执清理。
CREATE TABLE IF NOT EXISTS x_follower_snapshots (
  handle      text NOT NULL,                -- 小写的 handle，账号的稳定键
  captured_on date NOT NULL,                -- 北京时间的那一天
  screen_name text NOT NULL,                -- 抓到时的大小写写法，页面显示用
  name        text,
  avatar_url  text,
  followers   bigint NOT NULL CHECK (followers >= 0),
  captured_at timestamptz NOT NULL,         -- 当天最后一次快照的时刻
  receipt_id  bigint NOT NULL,              -- 来源回执，便于核对
  PRIMARY KEY (handle, captured_on)
);
