-- 0064 建过这张表，但本站 10-11 的手工清理脚本把它 DROP 了，而迁移账本仍记着 0064 已应用，
-- 于是模型榜每 6 小时在 calibrationFor 处报 42P01。这里补一条幂等的建表，生产和新库都能自愈。
CREATE TABLE IF NOT EXISTS lb_calibrations (
  methodology_version text NOT NULL,
  unit                text NOT NULL,
  protocol            text NOT NULL,
  calibration         jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (methodology_version, unit, protocol)
);
