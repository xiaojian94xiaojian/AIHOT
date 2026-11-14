-- 报告里每个账号实际测量的起点（基线快照那天）；旧报告没有记录，读取时按窗口兜底。
ALTER TABLE x_growth_reports ADD COLUMN from_on date;
