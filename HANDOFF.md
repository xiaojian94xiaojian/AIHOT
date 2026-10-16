# 交接：当前状态与未结事项（2026-10-14 更新）

> 新会话从这里开始。更细的内容按需查：`DEPLOY-NOTES.md`（全站运行日志，3000+ 行，几乎所有历史事实都在里面）、
> `KB-PLAN.md`（知识库模块方案）、`SECURITY-PLAN.md` / `SECURITY-REVIEW.md`（安全审查）。
> 草稿与脚本在 `E:\cs\hot\`（不在 git 里）。

## 0. 一分钟版本

- **生产**：https://hot.jian.ing 跑镜像 `34b6b14b0c24`（标签 `merge-0eba7db`），回滚点 `bf8ba6060e97`。
  三页 200、容器稳定、抓取正常。信源：**启用 552 / 合计 655**（10-14 新加 29 个，见 §2）。
- **代码**：工作树在 `upgrade-4.0`，HEAD = 合并 `d9ee498` + 本轮的源修复、补源与交接文档提交，
  **落后上游 0 个提交**，已推 `fork`。
- **测试**：容器全套 **694 通过 / 0 失败**（`pwsh scripts/test-in-container.ps1`，需 `aihot-testdb` 在跑）。
- **未部署的提交**：合并 `d9ee498` + 本轮的源改动。**都可以不急**——源配置的运行时真身在库里（已直接改库改到位），
  镜像里那份 `industry/sources.json` 只影响全新部署的种子。
- **本轮已结**：§1① 的 5 个网页源（4 修 1 停）、§1③ 的 4 条未确认回执（已放行）、#195 的 PR（#202）、
  从两份源清单里补 29 个源。
- **最要紧的未结事项**：**#195 的 PR（#202）第二轮意见已改完并回复，等上游复审**（§1②）。


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


### ② #195 的 PR —— **已提（PR #202）｜第二轮评审意见已改完并回复，等复审**

上游回复要点：**按收窄范围提 PR** —— 用**已有、去重后的发现历史**判断是否超出该源自身节奏；
**不新增配置、不引入外部付费调用**；历史不足、从未发现内容的源**仍需可见**；采集失败与实际漏收的证据要保留；
**`interval_minutes` 是抓取频率，不能当发布节奏**。还要先给证据（窗口、倍数、排序）、
回归覆盖正常低频/高频/漏收/历史不足四类、拿真实订阅做前后对照、给出有界查询与性能依据。

**第二轮（10-14 18:04Z）维护者 CHANGES_REQUESTED 三条 + 已改完（10-15）**：

1. **首次导入必须折成一天**（原来按 `coalesce(published_at, discovered_at)` 分天，一次导入被算成多个产出日：
   他给的样例是同日导入 4 篇、发布在 8/9/10/11 天前 → 原实现 `evidence_days=4`、中位间隔 1 天 → 误判 overdue；
   反向还会用跨月导入撑大中位间隔、掩盖安静的源）→ 改：`first-import` 行取**发现日**。
2. **窗口语义**：行按「发现或发布任一落在窗口内」读，产出日再 `BETWEEN 窗口起点 AND 今天` 夹一次。
3. **`evidence_days === 0` ≠ 从未收到内容** → 新增 `ever_output`，三种措辞分开；日报/周报分别给两个数量。

**已做**：分支 `fix/source-silence-rhythm`（从 `origin/main` 开，提交 `65731da` → 并入 `540c477` 的 `e4ae403`
→ 修改 `08238c3`，已推 `fork`），**PR https://github.com/KKKKhazix/AIHOT/pull/202**，CI 两个任务（`check` 3m50s、`docker` 52s）通过，
已回评（comment 6192261636）。范围：`sources/health.ts`（节奏判据）、`operations/alerts.ts` + `operations/reports.ts`
（日报/周报措辞）、`tests/source-health.test.ts`、`docs/sources.md`。

判据：产出日 = 最近 90 天**窗口内**的产出日期（有发布时间用它，没有用发现那天；**首次导入折回发现日**）
去重到「天」；节奏 = 相邻产出日间隔的中位数；至少 4 个产出日、静默超过中位间隔的 **4 倍** 才算「超出自身节奏」；
判断不了的两类（窗口内没有可比较的产出 / 从未收到内容）仍列出；7 天 0 发现仍是触发条件；`interval_minutes` 不参与。

**改后在生产库上的对照**（550 个在用信源）：超出节奏 15 → **2**，判断不了 2 → **49**（本站 09-29/09-30 整包首次导入，
73 个源的窗口内产出日全部来自那次导入 → 确实「没有可比较的历史」）；查询 822ms → 987ms。

**生产库实测**（524 个在用源、建站 14 天）：现行判据 55 个 → 新判据 **14 个超出 + 2 个历史不足（仍列出）+ 39 个回到节奏内**；
倍数 2/3/4/5/6 分别列出 31/22/14/10/6 个；能核对的 3 个（`rss-answer`、`web-tensorzero`、`src-huggingface`）
都是源站自己没更新；节奏 CTE 在 6.3 万篇文章上 176 ms（用 `discovered_at` 设界，比 `OR published_at` 快 3 倍且结果一致）。
验证：typecheck ✓、容器全套 **581 通过 / 0 失败**（干净库 `DB_NAME=aihot_clean_ci`）、
GitHub CI 两个任务（`check` / `docker`）**都通过**、PR 状态 `CLEAN`（可合并）。
发布公告、GitHub 通知都还没动（等上游反应）。

### ③ 4 条未确认的付费请求（**要站主本人**）

**现在只剩 4 条**（原来记的 5 条里，10-13 那条 embedding 已经不是 unknown 了）。都在「自动放行过一次、
再放行时要人工核对」的状态（`attempts=2`；`recover.ts` 的设计如此），历史 730 次放行**全是自动**（`ops.recover`），
人工放行一次都没有过：

| 回执 | 服务 / 模型 / 用途 | 时间（北京） | 卡着谁 | 影响 |
|---|---|---|---|---|
| `59261` | `embedding` / text-embedding-v4 / 向量 | 10-02 23:47（`TypeError: fetch failed`） | `x-account-arena` 的《How to design rewards for post-training…》 | 文章**已分析、已发布、读者可见**；只差向量（相关推荐/归组的相似度） |
| `118453` | `deepseek` / score_article | 10-07 14:49（超时） | `rss-arxiv`《Recommender system in X inadvertently profiles…》 | `processing_state=failed`、0 条分析、从未进公开面 |
| `119163` | `deepseek` / score_article | 10-07 15:17（超时） | `rss-arxiv-2`《Even Small Reasoners Should Quote Their Sources…》 | 同上 |
| `119327` | `deepseek` / score_article | 10-07 15:25（超时） | `rss-arxiv-2`《Inductive Claims Extraction at Scale》 | 同上 |

**要做的两步**：① 到供应商控制台看那几个时间点有没有计费（DeepSeek 开放平台；那条 embedding 走
`EMBEDDING_BASE_URL` 那个自填端点）；② 后台「运行」页 →「N 个付费请求的结果尚未确认」→ 逐条选
「已计费 / 未计费」+ 备注 →「记录并放行」。放行后回执标 `failed`、请求可重发，3 篇 arXiv 文章回到处理队列
（分析后才谈公开与精选），那条 embedding 补上向量。

**费用可忽略**：这 4 条在账本里 `cost` 都是 0（DeepSeek 应答没有计费字段），10-07 全天 14,227 条请求合计
$0.289 ——这是「账要记准」的决定，不是钱的决定。涉及付费记录，不要替站主判断。

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
| （本轮） | **放行 4 条未确认回执**（站主指示）：1 条 embedding 按「未送达」、3 条 deepseek 超时按「可能已计费」记录并放行，3 篇 arXiv 回到处理队列；见 §1③ |
| （本轮） | **从两份源清单里补 29 个源**（22 精选 + 7 氛围）：先去重（清单里 66 个名字有 48 个本站已有）、再逐个实测地址、按分级口径定权重，包 620→649 并用 `scripts/seed.ts` 入库；顺带找到 Impress Watch 的 feed。详见 `DEPLOY-NOTES.md` |
| （本轮） | **换回 Go 网关的另一把 key**（10-15）：在用的 key 周额度用尽（16:00 起每次模型调用都 429），`OPENCODE_OLD_KEY` 那把周额度已重置、实测可用 → 对调并 `--force-recreate api worker web`。当天量：deepseek 11,478 次 / 2,704 万 token。详见 `DEPLOY-NOTES.md` §二 |
| （本轮） | **#195 的 PR 第二轮**：维护者 CHANGES_REQUESTED 三条（首次导入折成一天、窗口语义、区分两种「判断不了」）已改完并回评；CI check+docker 通过；生产对照 超节奏 15→2、判断不了 2→49。详见 §1② 与 `DEPLOY-NOTES.md` |
| （本轮） | **停用三个 arXiv 源**（10-15，站主决定）：`rss-arxiv`(cs.AI) / `-2`(cs.CL) / `-3`(cs.LG) 占当天 **64% 的模型调用**却从不进精选（`EXCLUDE_MP` → `selection_candidate=false`）。停源后待处理文章全来自别的源；今天的论文仍留在「全部动态」（站主确认不用管）。详见 `DEPLOY-NOTES.md` |
| （本轮） | **10-15 增量包 + linux.do**：11 个候选去重后真加 5 个（张小珺播客、中华网科技 GN 兜底、4 个 X 账号——其中 yetone 也进了），跳过 5 个（界面新闻/Tom Huang 站内已有、OpenAI Developers 复测仍 403、Ideogram 整站 CF、博客园 feed 500）；**linux.do 用框架自带的 Jina 通路接上**（本站采集器被 CF TLS 指纹挡、curl 却 200）。包 649→**656**，全站启用 **556/662**。详见 `DEPLOY-NOTES.md` |
| （本轮） | **并入上游 `540c477`**（翻译修复 + 迁移 0086）：无冲突，重验五个分叉与关键测试（`translate` 7/7、`history-limit` 3/3、`source-health` 5/5）。带迁移，`setup` 服务会在部署时自动补。 |
| （本轮） | **「新内容卡住了」持续 19h50m 的根因**：待处理 1,351 篇**全是氛围源**、全部已排队（0 篇漏排）；氛围源不走分析队列，`content.ts:80` 直接进**归组队列**（`events.group`，`jobs/events.ts:11` 有意串行 `localConcurrency: 1`），靠 `settleNonEditorial()` 落成 skipped。实测消化 **约 450/小时**，与日报第 8 条同源 → 告警会长期红。三选：A 归组改并发安全（框架级，先开 Issue）、B 减氛围源入料、**C（推荐先做）按站点规模改告警口径**（"队列在涨才报"）。已记 `DEPLOY-NOTES.md` |
| （本轮） | **10-16 日报 8 条**：修好 5 个源地址（TNW feedburner 404 → `thenextweb.com/feed/`；开源中国/掘金/36氪 的 rssforever 实例超时 → `hub.slarker.me`；`web-eugeneyan` 改走 Jina + `parseMode:html`）。查清不是问题：71 个"静默"编辑源是低频更新（feed 都好，最新本来就旧）、deepseek 日额度是清积压时撞到自设上限且已自行恢复、events.group 每小时消化 400–460 个、`rss-ithome` 是目标站不稳（87% 成功）、`rss-youtube` 频道 RSS 只到 2023-06（建议停用）、t3n 的 406 是采集器 Accept 头太严（`rss.ts:148`，值得提上游）。**查出大问题**：X 分片 93% 抓空（24 小时 10,883/11,700），20+ 账号自 10-08/09 起 0 产出，而直接搜 `from:claudeai` 有 20 条 —— `collect.ts:327` 把整片最新推文写进每个成员的游标、`coveredTo()` 取分片最小值，安静账号的水位被抬高且无 backlog 可补。**明天第一件事：临时库复现 + 修法（各成员只推进到自己的最新推文）+ 提上游**。详见 `DEPLOY-NOTES.md` |
| （本轮） | **处理 Codex 重置监控的 11 条「需复核」**（站主指示按建议弄）：全部走 `resolveMonitorPost(..., {action:"reviewed"})`（带审计），需复核 11→0，告警自动收尾（`monitor.review:recovered`），告警状态清空。**坑**：`skip` 是给未识别、堵队列的帖子（`processed_at IS NULL`），`reviewed` 才是给已识别但结论挂起的；用错只报错不改数据。**明天可选**：识别提示词加「玩笑/寒暄直接判无关」，能砍掉大半复核量（那 11 条里 9 条是噪声）|
| （本轮） | **巡检 + 额度遗留清理**：`grouping_status='pending'` 的 14,431 条里只有 1,107 条真在等（8,313 是 skipped、5,000 是 `blocked` 主动拦截）—— 看 pending 必须按 `processing_state` 拆再套归组门槛；清理了 11 篇处理失败（`requeueFailedArticles`）与 1,895 条因额度失败而归组的文章（`groupingReset()`），归组失败 1,902→7，管道 0 失败。另附「额度花在哪一步」表：`score_article` 31% + `group_article` 23% = 54%，`score_article` 每次吐 2,181 输出 token 是最大单点。详见 `DEPLOY-NOTES.md` |
| （本轮） | **Go 额度可见（go-quota 模块，已上线）**：网关有只读接口 `GET {LLM_BASE_URL}/usage`（滚动/周/月三个百分比），做成站点模块（`modules/go-quota/`）：每 30 分钟采样、按「没重置过的那一段」外推「还能撑几天」，窗口 ≥70% 且会在重置前用尽、或 ≥95% 时报给站主；**额度按 key 算**（换 key 即换额度，旧 key 留着就是备份额度）。镜像 `0b904ed57eb3`。详见 `DEPLOY-NOTES.md` |
| （本轮） | **部署上线**（站主批准，10-15 22:05）：镜像 `a1587d2c3116`（`merge-060c5a6`），带上上游合并、`540c477` 翻译修复 + 迁移 0086（setup 自动跑，账本 80 条）、告警时长修复、额度熔断；站点五页 200、容器重启 0 次、模型调用 220/0 失败。回滚点 `rollback-before-060c5a6`（仓库 + 服务器都在）。详见 `DEPLOY-NOTES.md` |
| （本轮） | **额度熔断**（站主选）：账务类拒绝不再当限流（3 小时白撞 1,374 次的病根），改为记成预算耗尽 + 熔断 900 秒 + 立刻告警 → 上游 **PR #205**，并已并进我们的树（`84534a9`）。详见 `DEPLOY-NOTES.md` |
| （本轮） | **恢复演练**（站主选，第一次真做）：最新 dump 恢复进临时库，`pg_restore -j4` 退出码 0、244 秒，文章 64,584 / 迁移 79 条，时间线自洽；临时库已删。脚本 `.cache/hot/restore-drill.sh` |
| （本轮） | **修积压告警的「已持续」时长**：`content.process` 原来把「最老一篇仍卡着的文章」当 `since`，一篇遗留文章把 3 小时的积压报成 47 小时 → 提 **PR #204** 并同时并进我们的树（`4bcbdbd`，**下次部署生效**）。详见 `DEPLOY-NOTES.md` |


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
- **Go 套餐的额度是这套部署最脆弱的一环**：$10/月的额度撑不住本站的量（10-15 一天 deepseek 11,478 次、
  2,704 万 token），周额度一到顶就**全站模型调用 100% 失败**（文章堆在 `processing_state='new'`）。
  两把 key 轮着用可以顶一阵：老 key 留在 `.env` 的 `OPENCODE_OLD_KEY` 里，**周额度重置后还能用**。
  换 key 一定要 `up -d --force-recreate api worker web`（`restart` 不重读 `.env`），并核对哈希：
  `.env` 与容器里 `LLM_API_KEY` 的 sha256 前 12 位必须一致。**长期解**是按量计费 API（改三个变量，
  去掉 `LLM_EXTRA_JSON`/`LLM_SESSION_ID`），按当天量粗算约 $5–8/天。
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
- **新加的 X 账号第一次是「单独读」**：`shardHandle` 要求源已经有 `lastTweetId` 水位才进分片，
  所以首读窗口大、容易超时，并**留下一张未确认回执**。此时**别手动重跑**——回执未确认时会被直接拒绝
  （「Receipt N has an unknown outcome…」），只会多记一次失败；等 `ops.recover` 30 分钟后自动放行一次，
  下一次调度（约 2 小时后）自己会重试。首读成功拿到水位后，之后就跟别的账号一起走分片。
- **reddit 的 `.rss` 按 IP 频控**：短时间连发会 429（同一时刻另一个子版块还是 200）。加 reddit 源要留长间隔，
  别一次试好几个子版块。

## 4. 上游状态

- **落后 0 个提交**：已并入上游最新 `540c477`（翻译修复 + 迁移 `0086`），**已于 10-15 22:05 部署上线**（镜像 `a1587d2c3116`；回滚点 `rollback-before-060c5a6`）。本地另有源修复、源补充、积压告警修复与交接文档若干提交（已推 `fork/upgrade-4.0`）。**未部署**；部署时 `setup` 服务会自动补迁移（`docker compose pull && up -d` 即可），不必手动跑 `scripts/migrate.ts`。
- **#195**（信源静默判据）：**PR #202** 第二轮意见（首次导入折成一天、窗口语义、区分两种「判断不了」）已改完并回评，等复审。
- **PR #204**（积压告警的「已持续」时长，10-15 提）：改 `operations/alerts.ts` 的 `content.process` 不再用最老一篇的年龄当 `since`；**同一改动已并进我们的树**（`4bcbdbd`），下次部署生效。
- **#196**（额度导致的归组终态）：closed，已在 **#198** 按我们的最小改法修好，**提交里记了我们的共同作者**。
- 安全公告：2 published、3 closed（详见 §2）。
- 上游最新是 10-15 10:22 的 `540c477`（翻译修复）。

## 5. 新会话开局建议

1. `git log --oneline -3` 看 HEAD（应是本轮的源修复/补源提交压在 `d9ee498` 上），
   `git fetch origin && git rev-list --count HEAD..origin/main` 看有没有新提交。
2. 若要跑测试：先确认 Docker 在跑 + `aihot-testdb` 已启动，再 `pwsh scripts/test-in-container.ps1`。
3. **先看三件事**：① 上游有没有新提交 / PR **#202 / #204 / #205** 有没有回复（#204、#205 的 CI 都是双绿）；
   ② 10-14 与 10-15 加的新源过了第一个整天后的表现（后台「信源」页：`rss-reddit-localllama` 之前 429、
   5 个首读超时的 X 账号、以及 linux.do 走 Jina 的稳定性）；
   ③ `settings.go.quota` 的速度外推准不准（10-15 深夜上线，第一个"还能撑几天"的估计在采样满一小时后出现）。

## 6. 明天的观察点与待选项（10-15 深夜留）

**观察点（不用操作，自己会跑）**：

- `go.quota` 每条 30 分钟采样一次，速度估计满一小时后出现；若"会在重置前用尽"，站主会收到
  「Go 套餐…额度已用 X%」的告警（替换 key 或等重置后自动收尾）。
- 额度熔断已上线：再遇到额度用尽，调用会**立刻停在熔断上**（不再白撞上千次）、文章留待处理、告警几分钟内到。
- 积压告警的「已持续」现在报的是**本轮**时长（旧的是最老一篇的年龄）。

**待选项（站主已看过菜单，点一个就做）**：

| 选项 | 内容 | 备注 |
|---|---|---|
| A | 给最贵的两步瘦身：`score_article`（31%，每次吐 2,181 输出 token）+ `group_article`（23%）= 54% 的额度 | 先做对照实验再改 `site/models.ts`；这是直击"两次停摆的那个约束"的动作 |
| B | R2 生命周期（日备 7 / 周备 4 / 月备 6）+ 存储盘点（库 2.9G、约 +250MB/天） | 十几分钟 |
| C | 精选门槛校准（标 100 篇 → `scripts/eval-selection.ts` → 调 `industry/selection.ts`） | 需要站主 20 分钟标注 |
| D | linux.do 自建代理（去掉 Jina 依赖）/ 知识库模块 `feat/kb-module` 的去留 | 可选项 |

**未做完的小事**：归组失败还剩 7 条（内容是输出/格式问题，不是额度）；`x_article` 步骤有 2 次调用没记 usage（可查可不查）。
