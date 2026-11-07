-- 公开的账号收录申请（模块 x-profile）：人自己提交 handle，后台审核通过后建成 hot_signal 源。
-- 一个 handle 一行，重复提交只更新这一行；ip_hash 只用于限频，不存原始 IP。
CREATE TABLE IF NOT EXISTS x_account_requests (
  handle      text PRIMARY KEY CHECK (handle = lower(handle)),
  note        text,
  contact     text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason      text,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text
);
