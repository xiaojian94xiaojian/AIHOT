# 升级到 4.0.0 收尾时用的本机验证工具

这两个脚本是升级收尾时**临时**用的，只为在没有线上环境的情况下验证三个恢复出来的模块。
服务器上不需要它们；确认无事之后可以整目录删掉（删的时候记得同时删 `UPGRADE-HANDOFF.md` 里提到它们的那句）。

## 前提：起一个临时数据库

不需要碰正式的库；容器删掉即可，不留痕迹。

```powershell
docker run -d --name aihot-testdb -e POSTGRES_USER=aihot -e POSTGRES_PASSWORD=aihot `
  -e POSTGRES_DB=aihot_test -p 55432:5432 postgres:17-alpine
```

灌数据的顺序**很重要**（`UPGRADE-HANDOFF.md` 的「阶段 4」有完整说明）：备份是迁移前的 pg_dump，
自己带 `CREATE TABLE`，所以必须「先导入主库备份 → 删掉 0053/0045 要删的表 → 再导入
`dropped-tables-*.sql.gz` → 最后跑 `node scripts/migrate.ts`」。顺序错了会撞
`relation already exists` 而留下空表。

## `run-api-locally.ts`

把 api 指向临时库（55432）在 3001 端口起来，关掉采集、模型调用与所有推送阀门：
`node scripts/pending-upgrade-4.0/run-api-locally.ts`

## `smoke-modules.ts`

直接调用三个模块的插口与读取层，逐项打印检查结果（有一项不通过就退出码 1）：

```powershell
$env:DATABASE_URL = 'postgres://aihot:aihot@127.0.0.1:55432/aihot_test'
node scripts/pending-upgrade-4.0/smoke-modules.ts
```

它检查的是：榜单与模型详情能读出真实数据（含厂商标志、价格与汇率换算）、评测来源列表、
口径说明、codex 快照/页面/日历/版本、Agent 答案、两者的告警、后台徽章与运行页数据、
以及 MCP 工具的返回。跑通即说明「模块 → 插口 → 读取层 → 真实数据」这条链是通的。
