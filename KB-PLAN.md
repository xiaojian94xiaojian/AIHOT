# 雷达知识库模块（第一期）方案

> 写给**没有上下文的新会话**。按顺序读：本文件 → `docs/architecture.md` 的“模块”一节 →
> `packages/contracts/src/modules.ts` 与 `packages/backend/src/modules.ts`（模块插口定义）→
> 现成模块 `modules/chronicle/`（骨架参考）。
>
> 分支：`upgrade-4.0`（站内功能都提交在这里）。`feat/archive-analysis-switch` 是给上游的 PR 分支，**不要**在上面加站内功能。
> 相关背景：`DEPLOY-NOTES.md`（部署、信源、配额、观察清单），`UPGRADE-HANDOFF.md`（升级与上游动态）。

## 0. 已定决策（2026-10-09，用户拍板）

| 决定 | 选择 |
|---|---|
| 第一期范围 | **只做知识库层**（落盘 + 读取出口 + 后台页面），选题助手留第二期 |
| 落盘哪些内容 | **事件卡 + 报告卡 + 精选条目卡**（三类都要） |
| 知识库目录 | **部署数据目录下**（`AIHOT_DATA_DIR` 那卷，不进 git） |
| 与 Nodus 的关系 | **借它的文件格式与语义，不接它的运行时**；笔记 frontmatter 与它严格兼容，将来可原样导入 |

## 1. 目标与非目标

**目标**：给雷达补一个**主动输出**的落点 —— 把已经筛选、评判、写作好的内容，以**可被其它工具（人、编辑器、agent）直接消费的 Markdown 知识文件**沉淀下来，并可从后台 / HTTP / MCP 读取。

**非目标（第一期）**：向量检索与 RAG；选题助手（第二期）；向 Nodus 真实写入；任何 Nodus 仓库内的改动；公开前台页面（知识库是站内/agent 侧资产，不进公开出口）。

## 2. 已核实的事实

### 2.1 Nodus 侧：为什么只能“借格式”，不能“接进来”

| 事实 | 证据（`E:\Nodus`） |
|---|---|
| 合法输入类型只有 `pdf/docx/pptx/xlsx/png/jpeg/tiff` + 音视频 | `src/nodus/worker/inspection.py:19,23-25` |
| **Markdown / 纯文本 / HTML 不是合法输入** | 同上；`markitdown_adapter.py:31` 只吃四种 Office/PDF |
| 没有 `POST /api/ingest`、没有创建 job 的 HTTP 接口 | `src/nodus/api/daemon.py:234-354`（全部路由） |
| 唯一可编程摄取是 CLI，且 `source_path` 必须在数据根 `uploads/` 内 | `src/nodus/core/file_ingest.py:715-738`；`adapters/cli.py:158-166` |
| 外部推送入口（`nodus-ingest` + `ingest-control` IPC）**已设计、未实现** | `docs/adr/0005:202-217`；`docs/delivery/roadmap.md:199-201`（F2b2c） |
| 它正卡在 F2b2b Round 12 复审，候选未提交、部署被阻塞 | `docs/handoff/CURRENT.md:3-4,339-367`；`BLOCKED_DEPLOYMENT_ASSET` |
| Vault 的唯一正式写入者是 Write Gateway；写入需 staging → Preview → 显式确认 | `docs/architecture/baseline.md:19,73-84`；`gateway/service.py:583-594` |
| note 契约严格：**恰好 9 个必填字段，多一个键即非法** | `contracts/machine/note.schema.json:7-8`；`gateway/notes.py:80-84` |
| 检索是确定性关键词打分（无向量库/RAG） | `core/vault.py:319-384`（title×100 / tags×70 / source_refs×60 / 章节标题×40 / 正文×20） |
| `ai_access: allow/deny` 在遍历与读取两层过滤 | `core/vault.py:271-289,291-298` |

**结论**：今天往 Nodus 里塞 Markdown 无路可走。所以第一期**不碰 Nodus**，只在雷达侧实现同一套文件语义。

### 2.2 借什么 / 不借什么

| 借 | 内容 | 出处 |
|---|---|---|
| 目录契约 | 顶层 `inbox/ notes/ projects/ archive/`，分类靠 metadata 不靠深层目录 | `E:\Nodus\vault\README.md` |
| frontmatter | 恰好 9 字段：`id/title/created_at/updated_at/tags/source_refs/status/ai_access` + 非空 body | `contracts/machine/note.schema.json` |
| 事实源原则 | Markdown 是唯一事实源；数据库只放派生索引/状态 | `E:\Nodus\AGENTS.md:7` |
| 确定性检索 | 关键词子串 + 五处加权 | `core/vault.py:319-384` |
| 来源可追溯 | `source_refs` 承载原文引用（= 雷达“每条精选链原文”） | `contracts/machine/note.schema.json:19-23` |
| AI 访问边界 | `ai_access` 默认 `allow` | `vault/README.md` |

| 不借 | 为什么 |
|---|---|
| Write Gateway / Job / Preview / confirm 四件套 | 那是为“单用户 + 多进程 + 可审计正式写入”付的代价；我们写的是**自己模块的派生数据**，不是别的事实源 |
| Source Store（内容寻址原件库）、加密备份、Feishu/媒体 Worker、AgentRuntime | 第一期用不到；雷达原件本来就有 URL 与自己的库 |

### 2.3 雷达侧：可用的读取面与硬规则

读取层（`packages/backend/src/publication/`，**所有出口只能从这里读**）：

```ts
loadHot(): Promise<HotResponse>                       // 热度榜：rank/heat/trend/badges/participants/summary/latest/spark
loadStoryDetail(storyId: number, now?): Promise<StoryDetail | null>   // 事件：digest/latest/reportCount/whyHot/firstReportAt
loadReport(kind: ReportKind, key: string): Promise<ReportDetail | null>   // 日报/周报/月报
listReports(kind: ReportKind, limit?): Promise<ReportIndexEntry[]>
dailyWithNotes(date | "latest")
v1Period(kind: PeriodKind, key | "latest")
loadItemDetail(id: string, language?, now?): Promise<Detail… | null>      // 单条精选
exportMarkdown(id: string): Promise<{ filename: string; body: string } | null>
```

模块插口（`packages/backend/src/modules.ts`，`defineServerModule`）：

- `http?: (app) => void` —— 自己的路由，注册在引擎 v1 兜底之前
- `agent?: { abilities?: AgentAbility[] }` —— 同时给出 `/api/v1/agent/<path>` 与同名 MCP 工具（`agent/mcp.checkArgs` 供 `scripts/mcp-check.ts` 检查）
- `schedules?: Scheduled[]` —— worker 的 cron（Asia/Shanghai，记进 `job_runs`）
- `queues?: ModuleQueue[]` —— 自己的 pg-boss 队列
- `admin?: { counts?, runs? }` —— 后台导航徽标与运行页
- `retention?: (now) => Promise<Record<string, unknown>>` —— 参与每日保留作业
- `on?: Partial<EngineHooks>` —— `articleChanged`（含 `reduced`：公开内容变少/撤回）、`reportsChanged`

必须守住的规则（`AGENTS.md`）：只从 `publication/` 读；页面不调模型；付费请求走回执与预算；模块自带迁移与测试；新环境变量写进 `.env.example`；**停用功能时同一改动删干净代码/测试/文档/状态**。

### 2.4 部署侧

- `AIHOT_DATA_DIR=/data`，对应命名卷 `aihot_data`（服务器 `docker inspect` 已确认）；bind mount 只有 `database/`、`industry/`、`scripts/`。
- **因此知识库放 `/data/kb/…`**：活过镜像重建与 `docker compose up -d`。
- 卡片是**派生数据**（可从库里重新生成）→ 不必进备份策略；但要有 `retention` 清理与“重新导出”的路径。
- ⚠️ `modules/` 不在挂载目录里 → **模块代码改动必须重建镜像并部署**（改 `industry/`、`scripts/` 才不用）。

## 3. 数据布局

```
$AIHOT_DATA_DIR/kb/
  inbox/                                  # 落盘中间态（临时文件 + 原子改名；正常应为空）
  notes/
    events/<yyyy-mm>/<story-public-id>.md # 事件卡
    reports/<daily|weekly|monthly>/<key>.md
    items/<yyyy-mm>/<item-id>.md          # 精选条目卡
  archive/                                # 撤回/过期卡片（保留 7 天后真删）
  projects/                               # 第二期：选题候选
  kb-index.json                           # 最近一次导出的清单：版本、窗口、各类计数、每个文件的 sha256
```

文件名用**稳定 id**（不是时间戳），重复导出 = 覆盖同一文件 → 天然幂等。

## 4. 笔记契约

### 4.1 frontmatter（严格 9 字段，一个都不能多）

```markdown
---
id: kb-event-3f2a91
title: 某公司发布某模型
created_at: 2026-10-09T03:10:00Z
updated_at: 2026-10-09T03:10:00Z
tags: ["radar", "event", "ai-models"]
source_refs: ["https://example.com/news/1", "https://example.com/news/2"]
status: active
ai_access: allow
---

# 某公司发布某模型

## 摘要
…（事件的 digest / 代表报道摘要）

## 热度
- 当前热度 128（24 小时 +42%），参与方 9（媒体 5 / 讨论 4）
- 首次报道 2026-10-08T22:10:00Z，最近更新 2026-10-09T03:00:00Z

## 时间线
- 2026-10-08 22:10 某媒体：……（原文链接）
- 2026-10-09 01:30 官方账号：……（原文链接）
```

**字段映射**

| 卡片 | `id` | `tags` | `source_refs` | `status` |
|---|---|---|---|---|
| 事件卡 | `kb-event-<story publicId>` | `["radar","event",<分类>…]` | 全部公开报道的**原文 URL**（代表报道在前） | `active`；事件 `settled` 且超出窗口 → `archived` |
| 报告卡 | `kb-report-<daily\|weekly\|monthly>-<key>` | `["radar","report","daily"]` | 当期引用的原文 URL | `active` |
| 精选卡 | `kb-item-<item id>` | `["radar","item",<分类>]` | 该条的原文 URL | `active` |

**三条硬约束**：frontmatter 不许加键（加了将来 Nodus 导入即 `invalid_note`）；body 必须非空且首行 `# <title>`；来源引用只能放 `source_refs`。

**许可**：正文只放读取层已经公开给读者的内容（摘要 + 链接为默认）；`site_fulltext` 关的信源不得落全文。撤回或不再公开的内容**不得留在卡片里**（见 §5.4）。

## 5. 模块形状

### 5.1 文件清单（照 `modules/chronicle/` 的骨架）

```
modules/kb/
  module.ts            defineModule：name:"kb"，apiPaths（/api/modules/kb/…），adminPages（列表页）
  server.ts            defineServerModule：http / agent.abilities / schedules / queues / admin.counts / retention / on
  web.tsx              defineWebModule：后台页面（列表 + 搜索 + 单篇）
  package.json         名为 "@aihot/kb"
  backend/
    layout.ts          目录与路径规则、原子写、frontmatter 渲染与转义
    cards.ts           三类卡片：从读取层的对象生成 Markdown（纯函数，最该被测试）
    export.ts          导出作业：取数 → 生成 → 写盘 → 更新 kb-index.json
    read.ts            读取：列表、按 id 取、关键词搜索（确定性打分）
    prune.ts           保留与撤回传播（archive → 删除）
  web/Kb.tsx           后台页面组件
  tests/cards.test.ts       卡片渲染：frontmatter 恰好 9 键、body 非空、引用完整
  tests/export.test.ts      落盘：幂等（同 id 覆盖）、原子（不出现半成品）、索引与文件一致
  tests/read.test.ts        搜索打分与筛选
  tests/withdraw.test.ts    撤回 → 卡片被移除/归档
```

### 5.2 接线（四处，缺一不可）

1. `site/modules/index.ts` 加地址；`site/modules/server.ts` 加后端；`site/modules/web.ts` 加网页
2. `site/package.json` 的 `dependencies` 加 `"@aihot/kb": "*"`
3. `Dockerfile` 加 `COPY modules/kb/package.json modules/kb/`
4. 模块自己的迁移（若第一期就用派生索引表）

### 5.3 环境变量（写进 `.env.example`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `KB_EXPORT_ENABLED` | `false` | 导出作业总开关（照“安全阀只有 true 才打开”的规矩）|
| `KB_INTERVAL_MINUTES` | `30` | 导出间隔（事件/精选的刷新频率）|
| `KB_ITEM_RETENTION_DAYS` | `90` | 精选卡保留天数；事件卡与报告卡长期保留 |
| `KB_REPORTS_LOOKBACK` | `8` | 回补最近几期报告 |

### 5.4 数据流

1. `schedules`：`kb.export` 每 `KB_INTERVAL_MINUTES` 分钟入队一次（`queues` 里的 `kb.export`，批处理）。
2. 作业：读 `loadHot()` → 对每个事件 `loadStoryDetail()` → 生成事件卡；读最近 `KB_REPORTS_LOOKBACK` 期报告 → 报告卡；读窗口内精选 → 精选卡。
3. 落盘：`inbox/<id>.tmp` → `fsync` → `rename` 到目标路径（同目录 rename 才原子）；目录按需 `mkdir -p`。
4. `kb-index.json`：本次导出的 id 清单 + 每个文件 sha256 + 计数 + 时间；**它只是清单，事实源仍是 Markdown**。
5. **撤回传播**：`on.articleChanged({reduced:true, …})` 与 `on.reportsChanged` → 把受影响卡片移进 `archive/`（保留 7 天）并更新索引；保留作业兜底清理。
6. **保留作业**：`retention(now)` → 删过期精选卡、清 `archive/` 中超期文件，返回计数（进每日保留报告）。
7. **零模型调用**：导出只读库、只写文件 → 不花一分钱；这也是把它放在第一期的原因。

### 5.5 读取出口

- HTTP（只给管理员，照后台路由的做法）：`GET /api/modules/kb/notes?kind=&tag=&limit=`、`GET /api/modules/kb/note?id=`、`GET /api/modules/kb/search?q=`、`GET /api/modules/kb/index`
- Agent/MCP：`kb_recent`、`kb_search`、`kb_topics`（走 `agent.abilities`，同名 MCP 工具；`mcp.checkArgs` 给能在空库上成功的参数）
- 后台页面：列表（按类型/标签/时间筛选）+ 搜索 + 单篇 Markdown 预览
- 搜索第一期直接读文件 + 确定性打分（title×100 / tags×70 / source_refs×60 / 章节标题×40 / 正文×20）。**不建索引**；等卡片上万再考虑派生索引表（届时它必须可重建）。

## 6. 验收与验证

**改动完必须跑**（本机唯一能全绿的路子是容器）：

```powershell
npm run typecheck
pwsh -File scripts/test-in-container.ps1                                   # 全套，按上游 CI 环境（Linux/Node24/pg_dump）
pwsh -File scripts/test-in-container.ps1 tests/cards.test.ts               # 单文件也可以
npm run build -w @aihot/web; node --test apps/web/tests/*.test.ts          # 网页；本机有 2 条已知无关失败（#151 WebKit 视频、deep reading 夹具）
```

**验收清单**（逐条可勾）：

- [ ] `typecheck` 通过；容器内全套通过（含新增模块测试）
- [ ] 卡片渲染：frontmatter **恰好 9 键**、body 非空、`source_refs` 完整、原文链接可点
- [ ] 幂等：同一 id 重复导出得到同一文件（内容 hash 一致）
- [ ] 原子：导出过程中不出现半成品文件，`inbox/` 结束为空
- [ ] 索引与文件一致：`kb-index.json` 的 id/hash 与磁盘一致
- [ ] 撤回：把一条精选标记撤回后，对应卡片离开 `notes/`（进 `archive/`），索引同步
- [ ] 后台页面可开、搜索可用；MCP `kb_recent` 能答（`scripts/mcp-check.ts` 通过）
- [ ] 生产部署后：`/data/kb/notes/…` 出现文件、worker 零报错、站点四个页面仍 200

**生产部署步骤**（照 `DEPLOY-NOTES.md` 里的现成流程）：

1. 把 `E:\cs\aihot\*.sql.gz` 四个转储移到 `E:\cs\_deploy_tmp`（545 MB，别进构建上下文）
2. `docker build --platform linux/amd64 -t asia-east2-docker.pkg.dev/project-79671177-5fb1-4881-a7c/aihot/app:latest .` → `docker push`
3. 服务器上打回滚标签 `app:rollback-<当前短 id>` → `bash /home/weijianlin/redeploy.sh`
4. 验证：`docker exec aihot-worker-1 node -e "…"` 或直接 `ls /data/kb`（卷在容器里挂 `/data`）

## 7. 第二期预告（选题助手，本期不做）

- 模块 `models` 插口加一步（例如 `topic_ideas`，走 `site/models.ts` 的模型与 `.env` 的 key）
- worker 作业：读近 N 天事件卡 + 报告卡 → 产出**选题候选卡**（标题 / 切入口 / 为什么是现在 / 证据链接 / 风险 / 适合平台）→ `projects/topics/`
- 后台页面：候选列表，可改、可标记“采用/放弃”，采用后落成一份 `projects/` 下的工作稿
- 与 Nodus 的衔接：等它 F2b2c（`nodus-ingest`）落地后，这些卡片可以按同一套 frontmatter 原样导入，不需要返工；**导入必须走它的确认流程，不要直接写它的 Vault**

## 8. 待定问题（开工前最好定）

1. 精选卡保留期：默认 90 天是否合适？（我们的精选量约每天 20–40 条 → 90 天约 2–4 千个文件）
2. 事件卡窗口：只导出“当前热榜上的事件”，还是也回补最近 N 天已从榜上掉下来的？
3. 知识库是否要 git 版本化（便于 diff 与回滚）？若需要，`/data/kb` 要额外做导出到仓库或私有仓库。
4. 是否需要给下游一个“打包下载”出口（把一段时间的事件卡打成 zip）。

## 9. 已知坑（前几轮踩过，别再踩）

- **挂载文件是手动同步的**：`industry/`、`scripts/`、`database/` 改了要自己 `gcloud compute scp` 上去并核对 md5；`modules/` 相反——它在镜像里，必须重建镜像。
- **本机测试库有残留**：`aihot_ci` 里有 4.0.0 已删除的 13 张表（`lb_*`/`monitor_*`），会让架构测试失败；容器测试用全新库名（`DB_NAME=aihot_verify_ci`）。
- **PowerShell 里的中文 commit message 会炸**：写进文件再 `git commit -F`。
- **预推钩子在本机必挂**（它跑 `npm test`）：`$env:ECC_SKIP_PREPUSH='1'`。
- **文件换行**：仓库工作副本是 CRLF，脚本改文件要按原文换行写回（否则每次 diff 全文件）。
- **容器测试入口**：`scripts/test-in-container.ps1`（本机 bash 是 WSL 且连不到 Docker，只有这个能跑全套）。
