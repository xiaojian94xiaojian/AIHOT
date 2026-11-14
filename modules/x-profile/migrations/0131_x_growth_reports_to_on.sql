-- 报告里每个账号实际测量的终点（最近一次快照那天），用来把效率的分母折算到窗口上。
ALTER TABLE x_growth_reports ADD COLUMN to_on date;
