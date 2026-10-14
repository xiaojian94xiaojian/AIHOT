# 交接：当前状态与未结事项（2026-10-14 更新）

> 新会话从这里开始。更细的内容按需查：`DEPLOY-NOTES.md`（全站运行日志，3000+ 行，几乎所有历史事实都在里面）、
> `KB-PLAN.md`（知识库模块方案）、`SECURITY-PLAN.md` / `SECURITY-REVIEW.md`（安全审查）。
> 草稿与脚本在 `E:\cs\hot\`（不在 git 里）。

## 0. 一分钟版本

- **生产**：https://hot.jian.ing 跑镜像 `34b6b14b0c24`（标签 `merge-0eba7db`），回滚点 `bf8ba6060e97`。
  三页 200、容器稳定、抓取正常。
- **代码**：工作树在 `upgrade-4.0`，HEAD = 合并 `d9ee498` + 本轮一个只改 `industry/sources.json` 的提交，
  **落后上游 0 个提交**，已推 `fork`。
- **测试**：容器全套 **694 通过 / 0 失败**（`pwsh scripts/test-in-container.ps1`，需 `aihot-testdb` 在跑）；
  本轮没改代码，未重跑。
- **未部署的提交**：合并 `d9ee498` + 本轮的源修复。**都可以不急**——源配置的运行时真身在库里（已直接改库改到位），
  镜像里那份 `industry/sources.json` 只影响全新部署的种子。
- **本轮已结**：§1① 的 5 个网页源已全部处置并逐条验证（4 个改选择器、1 个停用）。
- **最要紧的未结事项**：**#195 的 PR 已提（#202）**，等上游看（§1②）。


## 1. 未结事项（按优先级）

### ① 5 个网页源静默漏收 —— **已修完（2026-10-14）**

逐个抓它自己的列表页、用采集器的真实解析（`fromHtml`）核对，再逐个改 `industry/sources.json` → 改生产库 →
容器内手动跑一次抓取验证。全部达成 `new_count > 0` 且新条目有日期。完整记录见
`DEPLOY-NOTES.md` 的「五个网页源『静默漏收』的排查与修复（2026-10-14）」。

| 源 | 真因 | 处置 | 验证（生产库实测） |
|---|---|---|---|
| `web-blog` CMU | 最新的在特稿位（`aside.default-post-style` + `h2`），旧选择器只有 `h3` | `aside.type-post` + `h2,h3` + `.date`；**重新武装**（漏的 08-10 低于 48h 门槛） | found 9→10、**new 1**（Forking-Sequences Part II，08-10） |
| `web-bfl` | hero 是裸 `<a>`，旧选择器只认 `a.group`；还误收 3 个导航链接 | `a[href^="/blog/"]` + `h2` 标题；**重新武装** | found 12→10、**new 1**（FLUX 3 Action，09-24） |
| `web-cursor` | directory 其实没漏；漏的是「客户案例」4 篇（`a.card--feature`） | 选择器加 `a.card--feature:has(time)` + `p` 标题 + `initialBackfillLimit` 8→16；**重新武装** | found 12→16、**new 4**（Grab/Basis/Nokia/IMDEX） |
| `web-sarvam` | hero（`a.block > h2`）就是页面最新那条，且 hero 不带日期 | `a.group, a:has(h2)` + `h2,h3` + `div.type-supporting span`；日期走 `detail` 的 JSON-LD 兜底 | found 21、**new 1**（Bulbul V4 Flash，10-13） |
| `web-blogs` NVIDIA | **不是漏收，是重复源**：页面 15 条里 13 条已在 `rss-nvidia-blog` 名下（按 URL 去重 → 永远 new=0） | 站主决定**停用**（与 `web-blogs-2` 一致），内容一篇没动 | — |

**三条判据教训（下次别再踩）**：

1. **审计扫日期前先去掉 HTML 注释**：CMU 页面上的「2026-10-14」是 W3 Total Cache 的页脚注释
   （`Served from: … @ 2026-10-14 08:29:36`），CMU 博客真实最新是 08-10（它自己的 `/feed/` 也只有这一条）。
   `web-cursor` 的「10-13」同样是页面底部「更新日志」区的卡片，不是博客文章。
2. **比对要按 URL 看全库**：`identity_key` 是全站按 URL 去重的，同一条内容可能挂在别的源名下
   （NVIDIA 就整页都在 RSS 源名下）。只看「这个源自己的 `max(published_at)`」会误报漏收。
3. **修好选择器 ≠ 收得进来**：`collect.ts` 的后续抓取有 48h 发现门槛
   （`publishedAt < cursor.initializedAt − STALE_ON_DISCOVERY_MS(48h)` 的新身份直接丢），补漏条目通常都在门槛下。
   走框架自己的机制：删掉 `cursor.initializedAt` → 下一次按有界首导（`initialBackfillLimit` + 12 个月）
   收进来，并按 `backfill` 归档（不进事件、不推送、站上不当时效新闻）。
4. **列表页最新的那条常常在 hero/特稿位**，标记与列表区不同（CMU 用 `h2`、bfl 是裸 `<a>`、sarvam 是 `a.block`）。
   选择器不认特稿位，就等于**每个新帖在它当特稿的那段时间里永远看不到**——这是这类「静默漏收」的共同形态。


### ② #195 的 PR —— **已提（PR #202，等上游看）**

上游回复要点：**按收窄范围提 PR** —— 用**已有、去重后的发现历史**判断是否超出该源自身节奏；
**不新增配置、不引入外部付费调用**；历史不足、从未发现内容的源**仍需可见**；采集失败与实际漏收的证据要保留；
**`interval_minutes` 是抓取频率，不能当发布节奏**。还要先给证据（窗口、倍数、排序）、
回归覆盖正常低频/高频/漏收/历史不足四类、拿真实订阅做前后对照、给出有界查询与性能依据。

**已做**：分支 `fix/source-silence-rhythm`（从 `origin/main` 的 `e57da5a` 开，单个提交 `65731da`，已推 `fork`），
**PR https://github.com/KKKKhazix/AIHOT/pull/202**。范围：`sources/health.ts`（节奏判据）、
`operations/alerts.ts` + `operations/reports.ts`（日报/周报措辞）、`tests/source-health.test.ts`、`docs/sources.md`。

判据：产出日 = 最近 90 天收到的内容按各自日期（有发布时间用它，没有用发现那天）去重到「天」；
节奏 = 相邻产出日间隔的中位数；至少 4 个产出日、静默超过中位间隔的 **4 倍** 才算「超出自身节奏」；
历史不足或从未收到内容的仍列出；7 天 0 发现仍是触发条件；`interval_minutes` 不参与。

**生产库实测**（524 个在用源、建站 14 天）：现行判据 55 个 → 新判据 **14 个超出 + 2 个历史不足（仍列出）+ 39 个回到节奏内**；
倍数 2/3/4/5/6 分别列出 31/22/14/10/6 个；能核对的 3 个（`rss-answer`、`web-tensorzero`、`src-huggingface`）
都是源站自己没更新；节奏 CTE 在 6.3 万篇文章上 176 ms（用 `discovered_at` 设界，比 `OR published_at` 快 3 倍且结果一致）。
验证：typecheck ✓、容器全套 **581 通过 / 0 失败**（干净库 `DB_NAME=aihot_clean_ci`）、
GitHub CI 两个任务（`check` / `docker`）**都通过**、PR 状态 `CLEAN`（可合并）。
发布公告、GitHub 通知都还没动（等上游反应）。

### ③ 5 条未确认的付费请求（**要站主本人**）

`deepseek/score_article`（3 条自 10-07）+ `embedding`（自 10-02/10-13）。要在后台「运行」页核对
「供应商是否已计费」后放行。涉及付费记录，不要替站主判断。它们卡着对应文章的评分。

### ④ 归组积压 733 篇（建议不动）

`grouping_status='failed'`、`selection_candidate` **全是 false** → 不进精选，只影响事件页/时间线的历史补全。
归组队列是**串行**的（`localConcurrency: 1`），一次灌 733 个任务会把当天新文章的归组推迟约一小时。
要补就**选择性重跑**（`rerun(id, "group", …)`），别一次全灌。

### ⑤ 知识库模块（搁置）

活在 `feat/kb-module`（已推），未合并未部署，站主认为形态太粗。

## 2. 本轮做了什么（2026-10-11 ~ 10-14）

| 提交 | 内容 |
|---|---|
| `970b8da` | **修回 `DB_BACKUP_STORE_PATH_STYLE`** —— 备份从 10-03 起在 R2 上一直 403（这个开关被 4.0.0 同步覆盖掉了），失败的 dump 堆 9 天到 12 GB 把磁盘写满，导致 10-12 数据库恢复循环、站点 503 |
| `2a7518e` | 503 事故记录（处置、判据、仍未解决的告警收件人问题） |
| `6fe7cee` `bfe1472` | 接上**飞书内部告警**（自建应用，一个群）；内容群机器人关键词改 IP 白名单并重发 3 条积压卡片 |
| `de2a130` | **删掉 6 个坏信源**（`rss-developers` 403、Golem.de 从不成功、Techmeme 超时、新浪科技 feed 停在 2018、Big Technology 7 天 0 入库、Nikkei 160 篇全 skipped）；包 + 库两处 |
| `cd9b397` | **额度用尽不再让归组永久停摆**（`BudgetExceededError` → 留 `pending`）；已报上游 #196 |
| `09c8f9f` | 联系上游维护者的有效渠道（只走 GHSA 4 天无人看，站点反馈表单几分钟见效） |
| `0eba7db` `d9ee498` | 两次合并上游（含维护者对我们 4 份报告的安全修复、以及他实现的我们那条修法） |
| `4a0aed6` | SocialData 花费排查（真因见 §3 的坑） |
| （本轮） | **修 5 个网页源**：4 个改选择器（CMU / bfl / cursor / sarvam，共补回 6 条、39 条标题被改正）+ 停用重复源 `web-blogs`；包 + 库两处，逐条在生产容器里手动抓取验证。详见 §1① 与 `DEPLOY-NOTES.md` |
| （本轮） | **#195 的 PR**：静默判据改成按信源自己的节奏（90 天产出日的中位间隔、4 倍、至少 4 天），历史不足/从未收到的仍列出 —— PR **#202**，分支 `fix/source-silence-rhythm` |


**安全报告结局**：清洗器惰性属性绕过、SSRF 结尾点绕过 → **已 published**（报告人是我们）；
提示词缺条款、Caddyfile 缺安全头 → closed（上游静默修掉）；那份误提交的 probe → closed。

## 3. 判据与坑（别再踩）

- **定时任务全在 `Asia/Shanghai`**（实测 `pgboss.schedule.timezone`）：备份**北京 04:10**、系统日报**北京 09:00**、
  告警每 10 分钟、留存 03:30。别按 UTC 算。
- **备份判据**：看 `settings.backup.last` 的 `at` 是否超过一天没更新、`/data/backups` 的文件数是否只涨不降
  （正常 ≤3 对）。不看磁盘等于没看。
- **`DB_BACKUP_STORE_PATH_STYLE` 是我们的补丁，上游没有**（`.env.example` 里也要留着）。
  每次合并后必须确认它还在——丢了就会静默停备。
- **归档门是我们的永久分叉**：`packages/backend/src/editorial/analyze.ts` + `tests/history-limit.test.ts`。
  **每次合并后必须重验**（跑整套测试即可覆盖）。
- **别把 feed 顶层的 `<updated>` 当文章日期**（Atom 每次请求都刷新它）。只取 `<item>`/`<entry>` 内部的日期。
  用错会把「源站没更新」误判成「我们漏收」（我误报过 185 天）。
- **「7 天 0 新增」必须拿源站最新一条与库里比对**才算数；X 账号要用服务商 API 验证（LeCun 最新原创是 08-16、
  吴恩达 09-29、DeepSeek 10-02——都是真安静，不是漏收）。
- **非生产栈绝不用生产的付费密钥。** 本地测试栈（compose 项目 `aihot-test`）曾用生产的 SocialData key，
  10-11 一天花掉 $1.81、把余额压到 $0.25，而**生产的预算与账本完全看不见**（两套库）。
  该栈已删除、本地 `.env` 的 key 已移除、`COLLECT_ENABLED`/`MODEL_CALLS_ENABLED` 已改回 `false`。
  **key 从未进过 git**（`.env.*` 被忽略），所以轮换是可选的。
- **Docker Desktop 在这台机器上一天挂四次**：本地测试前先确认守护进程在跑、`aihot-testdb` 已启动
  （`test-in-container.ps1` 里写死了 `172.17.0.2`，Docker 重启后 IP 可能变，必要时先重启该容器）。
- **pre-push 钩子（ECC）会在 Docker 挂掉时误报失败**：先用容器套件自己验一遍，再用 `ECC_SKIP_PREPUSH=1` 推。
- **PowerShell 引号**：别写嵌套引号的内联命令（这一天踩了四五次），一律写成 `.sh`/`.py` 文件再 `scp`/执行。
- **连生产不用 gcloud**（本地 Docker 没跑时 `gcloud compute ssh` 会因写 `%APPDATA%\gcloud\credentials.db` 被拒）：
  `ssh -i $env:USERPROFILE\.ssh\google_compute_engine weijianlin@34.96.136.13`
  （实例 `aihot`、zone `asia-east2-c`；IP 在 `%APPDATA%\gcloud\logs\*.log` 里那行 `plink … weijianlin@<ip>`）。
  一次一个脚本：本地写 `.sh` → `scp` 到 `/tmp` → `sed -i 's/\r$//'` → `sh` 跑；中间产物放 `E:\cs\aihot\.cache\hot\`。
- **上游 `SECURITY.md` 明说不承诺响应时间**；只走 GHSA 报告可能几天没人看（GitHub 只在维护者 watch 成
  All Activity/Security alerts 且开邮件通知时才发信）。**要另走一条能推送到人的渠道**。

## 4. 上游状态

- **落后 0 个提交**（`d9ee498`）；本轮只在本地加了一个只改 `industry/sources.json` 的提交。
- **#195**（信源静默判据）：open，**上游要求我们提 PR**（范围见 §1②）。
- **#196**（额度导致的归组终态）：closed，已在 **#198** 按我们的最小改法修好，**提交里记了我们的共同作者**。
- 安全公告：2 published、3 closed（详见 §2）。
- 上游最后一个是 10-14 04:07 的 SelectBench 修复。

## 5. 新会话开局建议

1. `git log --oneline -3` 看 HEAD（应是本轮的源修复提交压在 `d9ee498` 上），
   `git fetch origin && git rev-list --count HEAD..origin/main` 看有没有新提交。
2. 若要跑测试：先确认 Docker 在跑 + `aihot-testdb` 已启动，再 `pwsh scripts/test-in-container.ps1`。
3. **建议第一件事**：§1② 的 **#195 PR**——上游明确要，范围已划好，从 `origin/main` 开干净分支。
