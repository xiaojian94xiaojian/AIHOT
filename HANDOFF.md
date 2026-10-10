# 交接：当前状态与未结事项（2026-10-10 23:30 更新）

> 新会话从这里开始。更细的内容按需查：`DEPLOY-NOTES.md`（全站运行日志，2500+ 行，几乎所有历史事实都在里面）、
> `KB-PLAN.md`（知识库模块方案）、`SECURITY-PLAN.md` / `SECURITY-REVIEW.md`（安全审查）、
> `UPGRADE-HANDOFF.md`（4.0 升级的旧交接）。工作目录 `E:\cs\hot\` 里是方案草稿、待提交的报告与密码文件（不在 git 里）。

## 0. 一分钟版本

- **生产**：https://hot.jian.ing 跑镜像 `8c320b323bf4`（含上游 10-10 合并 + 我们的安全修复），
  回滚点 `app:rollback-93e05c10da45`（更早的回滚标签也都在）。站点三页 200、worker 零报错。
- **代码**：工作树在 `upgrade-4.0`（`bc27846`），**落后上游 0 个提交**，已推 `fork/upgrade-4.0`。
- **今晚新增（两个提交，已提交未部署）**：① 后台登录失败写进程日志（`dcdcd45`）
  ② 写作提示词补「不可信数据」条款（`bc27846`，含规则测试）。容器全套 **677 通过 / 0 失败**。
- **飞书精选推送已接通**（生产 `.env` + `notify_targets`，测试卡实测送达，见 `DEPLOY-NOTES.md`）。
- **未结一件**：知识库模块，活在 `feat/kb-module`（已推），未合并未部署（站主试用后认为形态太粗）。
- **安全审查剩余**：CSP 未做（站主选了「先不管 CSP」；勘查结论是 hash 不可行、nonce 与页面缓存互斥）。

## 1. 未结事项

### ① 私密报告：全部提交完成 ✅（10-10 23:16 / 23:19）

| 报告 | GHSA | 状态 |
|---|---|---|
| 清洗器惰性属性绕过 | `GHSA-727h-m5jh-46mj` | ✅ 已提交，triage（上游未修 `sanitize.ts`）|
| SSRF 结尾点绕过 | `GHSA-596c-jrmp-xhm6` | ✅ 已提交，triage（上游未修 `blockedHostname`）|
| 五份提示词缺「不可信数据」条款 | `GHSA-gj3j-rgpx-m32p` | ✅ **10-10 23:16 提交**，triage |
| 默认 Caddyfile 无安全响应头 | `GHSA-j954-mqhh-3pjp` | ✅ **10-10 23:19 提交**，triage |
| 误建的 `probe` 空报告 | `GHSA-2ffm-xwrw-622h` | 无法撤回，已在报告 1 里说明请维护者关闭 |

- **待发清单已清空**，不用再等配额。状态存在 `E:\cs\hot\advisories-state.json`（从 API 取的实况）、
  提交记录在 `E:\cs\hot\advisories-result.txt`。
- **教训**：GitHub 的「内容创建」次级限流是**账号级约 24 小时**窗口，从创建第 3 份那一刻算起；期间 API 与网页都挡
  （10-10 07:57 试 API、08:19 试网页都被挡）。**撞到就记时间、等满 24 小时再发一次**，中途重试只会续期。

### ② 归档闸门是永久 fork 本地分叉（上游已拒）

议题 **#172 结论**（维护者原话要点）：历史归档不进今天/不推送/不建事件，但**仍有阅读与精选价值**；
加开关会**多一套要长期验证的规则** → 「暂不收这个开关，也不把历史归档改成默认停在预筛」。

我们的处置：**保留闸门**（省约 180 次评分调用/天，站主决定），代价是放弃约 6% 的归档条目可能进精选。
**每次同步上游后必须核对**：`analyze.ts` 里的 `opts.sweep && !opts.attemptTag && isHistorical(...)` 与 `tests/history-limit.test.ts`
（4.0.0 升级时丢过一次）。`feat/archive-analysis-switch` 分支已无用。

### ③ 安全审查：只剩 CSP（站主已明确「先不管」）

1. ~~提示词加固~~ —— **已做**（六份提示词，规则测试在 `tests/architecture.test.ts`）。报告建议的「`summaryZh` 一致性校验」
   **量过之后没有上**：任何「数字必须在正文里找到」的硬闸都会误伤 11–14% 的正常摘要（数据见 `SECURITY-REVIEW.md` [S3]）。
   **样本回放仍未做**（需要真实模型调用）。
2. ~~后台登录失败不审计~~ —— **已做**（`dcdcd45`）：记进程日志不记 `audit_log`（后者可被未认证者灌）。
3. **CSP**：勘查完成 —— 真实 HTML 每页 6 段内联脚本，含 41KB 的 loader 数据流，**同一路径连抓 3 次得 3 种不同集合**
   → 固定 hash 不可能；nonce 唯一可行但与页面 `max-age` 互斥；另实测到 `header >Content-Security-Policy` 会**覆盖**
   图片代理自己的 CSP。**站主选了先不做**，要做时按 `SECURITY-REVIEW.md` [S3] 的落地位置改。

### ④ 知识库模块搁置在 `feat/kb-module`

模块 + 5 个测试 + 后台页面都写完、容器内通过、公开的 agent/MCP 出口已按安全结论摘掉（`1edce5f`）。
站主试用后认为形态太粗，**暂不合并**。要拿起来看 `KB-PLAN.md`；注意它改过
`docs/architecture.md`、`docs/deploy.md`、`Dockerfile`、`.env.example`，合并时这几处要和上游的改动一起看。

### ⑤ 飞书：只接通了「精选推送」一条线

- 已接：内容群 webhook（`FEISHU_PUSH_WEBHOOK_URL` + `FEISHU_CONTENT_PUSH_ENABLED=true` + 目标 `feishu-content-main` 已 enable）。
- **没接**：内部告警群/反馈转发（需自建应用 + `FEISHU_APP_ID`/`SECRET` + chat_id）、飞书账号登录后台（需另一个应用 + 白名单）。
- 细节与踩坑（**别在服务器上跑裸 `docker compose up`**，会触发本地构建）见 `DEPLOY-NOTES.md`。

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

**部署与重启（10-10 新增的坑）**：
- 生产用**部署脚本那份 compose**：`cd ~/aihot && sudo docker compose -f docker-compose.server.yml up -d --no-deps api worker`。
  仓库根那份 `docker-compose.yml` 带 `build: .`，在服务器上跑会触发**本地构建**（已踩：跑到 `npm run build -w @aihot/web` 失败，
  容器没换、白等几分钟）。
- **`env_file` 只在创建容器时读**：`docker restart` 不够，要 `up -d` 重建（输出里出现 `Recreated` 才算数）。
- 只改 `.env` 不换镜像 → 用上面的 `--no-deps`；换了镜像内容才走 `scripts/deploy-server.sh`（它会 `pull` 仓库镜像）。

**合并上游后的固定动作**（10-10 那次踩坑得来）：

```powershell
git fetch origin; git merge origin/main
git diff --name-status <合并前> HEAD -- industry/ database/ scripts/   # 找出挂载目录里的改动
# 逐个 scp 到服务器对应目录，并 sed -i 's/\r$//'
# 重启 api/worker（上面的 compose 命令），然后单独跑迁移（deploy-server.sh 不跑迁移！）
gcloud compute ssh weijianlin@aihot --zone=asia-east2-c --command="sudo docker exec aihot-worker-1 node scripts/migrate.ts"
# 核验：容器不是 Restarting、日志无 ERR_MODULE_NOT_FOUND、账本出现新迁移、站点 200
```

判据速查：**容器 `Restarting` + 日志 `ERR_MODULE_NOT_FOUND` = 挂载目录缺新文件**；
**迁移说「up to date」但你刚合并了新迁移 = 服务器上压根没有那个迁移文件**。

**测试**：本机唯一能全绿的是 `pwsh -File scripts/test-in-container.ps1`（Linux/Node 24/pg_dump）。
**10-10 晚实测这个脚本已经能用**（它自己把 here-string 的 CRLF 换成 LF，并在容器里补 git）。
用全新库名（`$env:DB_NAME='aihot_verify_ci'`）——本机 `aihot_ci` 有 4.0.0 删掉的 13 张残留表，会让架构测试失败。
本机裸跑 `npm test` 有约 28 条环境性失败（shutdown 超时、uv assertion、文件级 DB 争用），
**与改动无关**：同一套在干净基线上也失败 31–32 条，且两次失败集合不同。
网页测试本机有 2 条已知无关失败（上游 #151 的 WebKit 视频、`deep reading` 夹具）。

**提交与推送**：中文 commit message 用文件（`git commit -F`）；预推钩子在本机必挂 → `$env:ECC_SKIP_PREPUSH='1'`；
**预提交钩子也会误报密钥**（10-10 新增：`tests/admin-login-logging.test.ts` 里的 `"test-admin-password-…"` 被拦），
确认没有真密钥后用 `$env:ECC_SKIP_PRECOMMIT='1'`。
构建镜像时把 `E:\cs\aihot\*.sql.gz`（4 个共 545 MB 转储）移出构建上下文。

**密钥**：服务器 `.env`（600）；管理员密码 10-10 已轮换，新值在
`/home/weijianlin/admin-password-2026-10-10.txt`（600）与 `E:\cs\hot\admin-password-2026-10-10.txt`（存进密码管理器后可删）。
飞书 webhook 只在服务器 `.env`（600），本机副本 `E:\cs\hot\feishu.txt` 的 ACL 已收紧到仅本人。
旧 `.env` 备份已删；`.env` 是 CRLF（应用会去掉行尾 CR，用别的工具读要留意）。

**写文档的坑（10-10 新增）**：`DEPLOY-NOTES.md` 是**混合换行**（2467 CRLF + 160 裸 LF）。用工具编辑会整体转成 CRLF，
diff 会炸成 2500 行；要追加内容就用 Python 按字节拼接并把新内容写成 CRLF，改完 `git diff --stat` 核一下
（只该多出你加的那几十行）。

**GitHub**：内容创建类接口（issue/评论/advisory）有独立配额，**别连发**；我们因为连发三份报告被挡过一次（24 小时窗口）。

## 4. 上游的取向（省得重复试错）

- 近 40 个提交里只有 **1 个 `feat`**，其余是 fix/文档/测试/依赖 → 他在**加固期**，不是加功能期；
- 拒绝理由几乎都是「**多一个来源 / 多一套要长期验证的规则**」（#77 与我们的 #172 都是这个死法）；
  要提功能先写清「场景 + 现有配置为何不够 + 对所有站都成立」；
- 他习惯**自己实现并把报告者记为共同作者**（#152→#153、#163→#164、#177→#179）→
  最好的贡献形态是「**可复现缺陷 + 最小复现**」，这也正是我们四份安全报告的形状；
- 每个修复他都要求：**先有会失败的回归**、范围收敛（不改定义/Prompt/门槛）、真实环境核验（真实路由 + 系统 Chrome）、
  诚实标注证据边界（「回归通过 ≠ 已证明生产事故」）。

## 5. 建议的第一步

1. `git log --oneline -5`、`git status`，确认工作树在 `upgrade-4.0` 且干净；
2. **要不要把今晚这两个提交部署上去**：登录日志在镜像里（要重建），提示词在 `industry/`（scp 就生效）；
3. 想做功能 → §1④ 知识库模块，或站内新需求（先读 `CONTRIBUTING`/`AGENTS.md` 的口径）；
4. 想继续加固 → §1③ 只剩 CSP，且站主已明确先不做。

