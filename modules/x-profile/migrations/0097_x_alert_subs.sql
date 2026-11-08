CREATE TABLE IF NOT EXISTS x_alert_subscriptions (
  id bigserial PRIMARY KEY,
  -- 绑定的账号；群版不填。
  handle text,
  -- 飞书自定义机器人 webhook，加密存储（AES-256-GCM，密钥由 SESSION_SECRET 派生）。
  webhook text NOT NULL,
  -- 要哪些提醒：card（每天一张卡）、reply（回复机会）。
  kinds text[] NOT NULL DEFAULT '{card}',
  -- 每个订阅一个退订令牌，消息底部带链接。
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  sent_on date,
  sent_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  ip_hash text
);
