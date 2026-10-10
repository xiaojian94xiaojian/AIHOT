# 交接：当前状态与未结事项（2026-10-10）

> 新会话从这里开始。更细的内容按需查：`DEPLOY-NOTES.md`（全站运行日志，2500+ 行，几乎所有历史事实都在里面）、
> `KB-PLAN.md`（知识库模块方案）、`SECURITY-PLAN.md` / `SECURITY-REVIEW.md`（安全审查）、
> `UPGRADE-HANDOFF.md`（4.0 升级的旧交接）。工作目录 `E:\cs\hot\` 里是方案草稿、待提交的报告与密码文件（不在 git 里）。

## 0. 一分钟版本

- **生产**：https://hot.jian.ing 跑镜像 `8c320b323bf4`（含上游 10-10 合并 + 我们的安全修复），
  回滚点 `app:rollback-93e05c10da45`（更早的回滚标签也都在）。站点三页 200、worker 零报错、近 10 分钟 37 条回执、后台会话数 0。
- **代码**：工作树在 `upgrade-4.0`（`1a3c6d3`），**落后上游 0 个提交**，已推 `fork/upgrade-4.0`。
- **未结三件**：① 两份安全报告还没提交出去（GitHub 配额）② 安全审查剩 CSP / 提示词加固 ③ 后台登录失败不审计。
- **搁置一件**：知识库模块，活在 `feat/kb-module`（已推），未合并未部署（站主试用后认为形态太粗）。

## 1. 未结事项

### ① 两份私密安全报告没提交出去（进度 2/4）

| 报告 | 状态 |
|---|---|
| 清洗器惰性属性绕过 | ✅ 已提交 `GHSA-727h-m5jh-46mj`（上游仍在 triage，`sanitize.ts` 未修）|
| SSRF 结尾点绕过 | ✅ 已提交 `GHSA-596c-jrmp-xhm6`（上游仍在 triage，`blockedHostname` 未归一化）|
| 五份提示词缺「不可信数据」条款 | ⏸ 待提交 |
| 默认 Caddyfile 无安全响应头 | ⏸ 待提交 |
| 误建的 `probe` 空报告 | `GHSA-2ffm-xwrw-622h`，无法撤回，已在报告 1 里说明请维护者关闭 |

- **卡点**：GitHub 对这个账号的「创建 advisory」有配额（API 与网页都挡）。触发时间 10-09 15:14–15:16 UTC 建了 3 份之后；
  **最早 10-10 15:15 UTC（北京 23:15）之后**再试。**封锁期间不要反复重试**（官方说会续期，我们已经吃过一次）。
- **做法**：网页 https://github.com/KKKKhazix/AIHOT/security/advisories/new 按字段粘（推荐）——
  草稿与**按表单五个字段拆好的版本**在 `E:\cs\hot\form-report3-prompts.md`、`form-report4-headers.md`；
  或 `pwsh -File E:\cs\hot\submit-advisories.ps1`（每份只发一次、被挡即停）。
  表单填法：Affected products 留空、Severity 选 Low、CWE 报告 4 可选 693、
  **「I used AI assistance」要勾**（如实声明）。
- 提交后把 GHSA 编号记进 `DEPLOY-NOTES.md` 与 `E:\cs\hot\advisories-state.json`。

### ② 归档闸门是永久 fork 本地分叉（上游已拒）

议题 **#172 结论**（维护者原话要点）：历史归档不进今天/不推送/不建事件，但**仍有阅读与精选价值**；
加开关会**多一套要长期验证的规则** → 「暂不收这个开关，也不把历史归档改成默认停在预筛」。

我们的处置：**保留闸门**（省约 180 次评分调用/天，站主决定），代价是放弃约 6% 的归档条目可能进精选。
**每次同步上游后必须核对**：`analyze.ts` 里的 `opts.sweep && !opts.attemptTag && isHistorical(...)` 与 `tests/history-limit.test.ts`
（4.0.0 升级时丢过一次）。`feat/archive-analysis-switch` 分支已无用。

### ③ 安全审查剩下三项（都不紧急）

1. **CSP**：前置动作是先数真实 HTML 里的内联脚本（已勘查：客户端构建产物无内联脚本；服务端只有
   `apps/web/app/root.tsx:60` 的主题脚本与 `:61` 的模块 bootScript；需确认 React Router 的 `<Scripts/>` 是否注入内联 hydration 数据），
   再决定 hash 还是 nonce。别直接上 `default-src 'self'`。
2. **提示词加固**（就是待提交的报告 3）：五份 `summarize-*`/`translate-*` 补 `{{> safety}}`；
   给 `summaryZh` 加原文一致性校验 —— 现有 `grounded()`（`reports/compose.ts:165-174`）只查拉丁专名、三位以上数字与词表公司名，
   **纯中文论断能绕过**。按仓库规矩：改提示词要附真实订阅的前后对比。
3. **后台登录失败不写 `audit_log`**：有 15 分钟窗口的尝试次数限制（`admin-auth.ts:36`），但看不出有没有人在试密码。
   想补就按仓库规矩先写会失败的测试。

### ④ 知识库模块搁置在 `feat/kb-module`

模块 + 5 个测试 + 后台页面都写完、容器内 667/667 通过、公开的 agent/MCP 出口已按安全结论摘掉（`1edce5f`）。
站主试用后认为形态太粗，**暂不合并**。要拿起来看 `KB-PLAN.md`；注意它改过
`docs/architecture.md`、`docs/deploy.md`、`Dockerfile`、`.env.example`，合并时这三处要和上游的改动一起看。

## 2. 分支清单（哪些是活的、哪些是死的）

| 分支 | 状态 |
|---|---|
| `upgrade-4.0` | **主线**，生产从这里构建；落后上游 0 个提交 |
| `feat/kb-module` | 知识库模块（搁置），已推 |
| `main` | 4.0 之前的旧线（含升级时丢掉的那些提交），留档用 |
| `feat/archive-analysis-switch` | 死（上游 #172 已拒）|
| `fix/architecture-test-windows-paths` | 死（上游已自行修好，本机架构测试 8/8 通过）|
| `fix/fill-published-at-on-later-report` | 死（主线里的 `fillPublicationTime` 已覆盖且更完整）|
| `fix/media-test-queue-creation` | 死（容器全套 673/673 通过）|
| `feat/module-static-assets` | 待判：上游现在建议模块用 `apps/api/src/routes/static.ts` 的 `sendFile` 发自己的文件，这个 `staticAssets` 插口可能已被替代 |

## 3. 环境与操作要点（都是踩过的坑）

**挂载目录 vs 镜像**：`industry/`、`database/`、`scripts/` 是**挂载**（改了要 scp 上去）；其它（`modules/`、`site/`、
`packages/`、`apps/`）在**镜像**里 → 必须重建镜像并重新部署。

**合并上游后的固定动作**（10-10 那次踩坑得来）：

```powershell
git fetch origin; git merge origin/main
git diff --name-status <合并前> HEAD -- industry/ database/ scripts/   # 找出挂载目录里的改动
# 逐个 scp 到服务器对应目录，并 sed -i 's/\r$//'
# 重启 api/worker，然后单独跑迁移（redeploy.sh 不跑迁移！）
gcloud compute ssh weijianlin@aihot --zone=asia-east2-c --command="sudo docker exec aihot-worker-1 node scripts/migrate.ts"
# 核验：容器不是 Restarting、日志无 ERR_MODULE_NOT_FOUND、账本出现新迁移、站点 200
```

判据速查：**容器 `Restarting` + 日志 `ERR_MODULE_NOT_FOUND` = 挂载目录缺新文件**；
**迁移说「up to date」但你刚合并了新迁移 = 服务器上压根没有那个迁移文件**。

**测试**：本机唯一能全绿的是 `pwsh -File scripts/test-in-container.ps1`（Linux/Node 24/pg_dump）。
用全新库名（`$env:DB_NAME='aihot_verify_ci'`）——本机 `aihot_ci` 有 4.0.0 删掉的 13 张残留表，会让架构测试失败。
网页测试本机有 2 条已知无关失败（上游 #151 的 WebKit 视频、`deep reading` 夹具）。

**提交与推送**：中文 commit message 用文件（`git commit -F`）；预推钩子在本机必挂 → `$env:ECC_SKIP_PREPUSH='1'`。
构建镜像时把 `E:\cs\aihot\*.sql.gz`（4 个共 545 MB 转储）移出构建上下文。

**密钥**：服务器 `.env`（600）；管理员密码 10-10 已轮换，新值在
`/home/weijianlin/admin-password-2026-10-10.txt`（600）与 `E:\cs\hot\admin-password-2026-10-10.txt`（存进密码管理器后可删）。
旧 `.env` 备份已删；`.env` 是 CRLF（应用会去掉行尾 CR，用别的工具读要留意）。

**GitHub**：内容创建类接口（issue/评论/advisory）有独立配额，**别连发**；我们因为连发三份报告被挡过一次。

## 4. 上游的取向（省得重复试错）

- 近 40 个提交里只有 **1 个 `feat`**，其余是 fix/文档/测试/依赖 → 他在**加固期**，不是加功能期；
- 拒绝理由几乎都是「**多一个来源 / 多一套要长期验证的规则**」（#77 与我们的 #172 都是这个死法）；
  要提功能先写清「场景 + 现有配置为何不够 + 对所有站都成立」；
- 他习惯**自己实现并把报告者记为共同作者**（#152→#153、#163→#164、#177→#179）→
  最好的贡献形态是「**可复现缺陷 + 最小复现**」，这也正是我们两份安全报告的形状；
- 每个修复他都要求：**先有会失败的回归**、范围收敛（不改定义/Prompt/门槛）、真实环境核验（真实路由 + 系统 Chrome）、
  诚实标注证据边界（「回归通过 ≠ 已证明生产事故」）。

## 5. 建议的第一步

1. `git log --oneline -5`、`git status`，确认工作树在 `upgrade-4.0` 且干净（另一个会话可能在 `feat/kb-module` 上动过）；
2. 想在今天收尾安全反馈 → 看 §1① 的时间窗口（北京 23:15 后），按表单字段拆分稿提交两份报告；
3. 想继续加固 → §1③ 里挑一项（CSP 的数内联脚本那步只读、无风险；提示词那条要样本回放）；
4. 想做功能 → §1④ 知识库模块，或站内新需求（先读 `CONTRIBUTING`/`AGENTS.md` 的口径）。
