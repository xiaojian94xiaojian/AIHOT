-- 粉丝快照的扫描按 (received_at, id) 往后推进，并且每轮回看十分钟；没有索引时每 5 分钟
-- 都要扫一遍 socialdata 的整段历史（回执行不会被删除，只会变多）。只索引扫描用到的两类回执。
CREATE INDEX CONCURRENTLY IF NOT EXISTS receipts_socialdata_received_idx
  ON receipts (received_at, id)
  WHERE service = 'socialdata' AND purpose = 'source_fetch';
