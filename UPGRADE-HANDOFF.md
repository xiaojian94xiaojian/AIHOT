# 升级到上游 4.0.0 —— 交接说明

> 状态：**阶段 1 与 1B 完成**。剩余阶段 2–4 未做。写这份文档时的上下文已接近上限，
> 所以把「已完成什么、下一步精确怎么做、哪些约定是实测出来的」写全，便于直接接手。

## 一、当前状态（已核实）

```
分支        upgrade-4.0（7 个提交领先 origin/main）
类型检查    根 0 错误 / web 0 错误
main        未改动 —— 服务器仍跑旧版
服务器      5 个容器 Up（web/worker/api/caddy/db），站点正常
```

提交链：

```
bb069e9  依赖锁：加入 @aihot/chronicle 模块
0c91a09  阶段1B：主题大事记模块端到端接通（后端插口 + web 部件）
237fb9a  阶段1B：主题大事记做成 modules/chronicle/ 模块（框架零改动）
6fe90bd  阶段1 完成：恢复上游 topics.ts，契约对齐模块机制
a655da7  阶段1：补齐 contracts 类型与 chronicle 定义
d6417f9  阶段1：恢复 49 个后端文件
4e8a2c2  升级到上游 4.0.0：信源、文档、网关适配
```

## 二、背景：为什么不能直接 rebase

上游 `1ca5d6d`（4.0.0，293 文件）混了两件事：

1. **移除三个功能**：模型榜、Codex 重置监控、主题大事记 —— 用户要求**全部恢复**
2. **引擎改为从线上导出 + 结构重组**（`industry/` 只留行业知识，站点身份搬到 `site/`，
   模型预设进 `site/models.ts`，`modules/` 给自有功能）—— **必须保留**

revert 会把结构改回去，导致其后 16 个提交全部冲突。

**做法**：从 `1ca5d6d` 的父提交 **`cc66cce`**（删除前的最后状态）取回被删文件，按 4.0.0 的
**模块机制**重新接入。已验证这些代码只依赖稳定接口（`db.ts`、`config.ts`、`lib/http-fetch.ts`、
`providers/receipts.ts`）。

## 三、已完成

### 1. 信源与文档
- `industry/sources.json`：450 条（字段与上游兼容；`first_party`/`enabled` 上游 `seed.ts` 本来就支持）
- `DEPLOY-NOTES.md`（1843 行）、`DEPLOY-GCP.md`（226 行）

### 2. 网关适配（Go 网关 `opencode.ai/zen/go/v1`）
- `site/models.ts`：预设参数名 `thinking` → `reasoning_effort`；`deepseek` 的 model id 固定为
  `deepseek-v4.1-flash`；`-think` 与 scorer 补 `reasoningTokens: 4000`
- `packages/backend/src/providers/llm.ts`：请求加可选 `x-opencode-session` 头（凭据 `LLM_SESSION_ID`），
  未设时不改变行为

### 3. 三个功能的后端代码已恢复（暂只有 chronicle 被引用）
```
packages/backend/src/leaderboard/（38 文件）、monitor/（5）、admin/monitor.ts
packages/backend/src/publication/{chronicles,monitor,topic-chronicle}.ts
packages/contracts/src/{leaderboard,monitor}.ts
packages/contracts/src/taxonomy.ts 补回 LEADERBOARD_* 常量
packages/backend/package.json 补回 highs@1.15.3、hyparquet@1.31.1
industry/chronicle.ts、industry/topics.json（恢复 chronicleTerms/orgNames）
```

### 4. 主题大事记已做成模块（阶段 1B，端到端可用）
```
modules/chronicle/
  package.json  module.ts  server.ts  web.tsx  topic-part.tsx  Chronicle.tsx
  backend/{rules.ts,chronicle.ts,curated.ts}
登记：site/modules/{index.ts,server.ts,web.ts}、site/package.json 依赖、Dockerfile COPY
框架零改动 —— 上游 topics.ts 已实现插口遍历
```

## 四、实测出来的约定与坑（上游没有示例模块，这些只能靠实测）

| # | 结论 | 说明 |
|---|---|---|
| **1** | **部件文件放模块根目录，不要放 `web/` 子目录** | `apps/web/tsconfig.json` 的 include 写了 `"../../modules/*/web/**/*"`，但**该子目录下的文件不参与检查**。放 `web/` 里时 `web.tsx` 动态 import 它报 `TS2307`（`.tsx` 后缀与无后缀都试过）；移到模块根目录即正常 |
| **2** | 模块 `package.json` 要给**显式 exports** | `"./*": "./*"` 解析不到 `./module`；照 `site/package.json` 的写法逐条列出 |
| **3** | 从模块 import 引擎用**包别名** | `@aihot/web/modules`、`@aihot/backend/publication/topics`；不要用 `../../../apps/...`。`@aihot/backend` 的 exports 是 `"./*": "./src/*.ts"`（不带 `.ts` 后缀） |
| **4** | **不要**往 `modules/tsconfig.json` 加 `*/web/**/*.tsx` | 它不是 JSX 配置（缺 `--jsx`，moduleResolution 要求 `.js` 后缀），加了会一次冒出 74 个错误。web 侧交给 `apps/web` 自己的 tsconfig |
| **5** | 验证模块真在检查范围内 | 类型检查通过可能是假象（文件没被 include）。**故意插一个类型错误，确认能被检出**再相信 0 错误 |

## 五、剩余阶段

### 阶段 2：模型榜与 Codex 监控做成模块

**先读 `modules/chronicle/` 作为范本**，照同样结构做。可能应拆成**两个模块**（`leaderboard`、`monitor`），
因为它们功能独立、页面不同。

**被删的文件（从 `cc66cce` 取）**，按目录分组：

| 目录 | 数量 | 内容 |
|---|---|---|
| `packages/backend/src/leaderboard/` | 38 | 抓取 14 个评测源 + 排名算法（`method/`）+ 读取（`read.ts`）|
| `packages/backend/src/monitor/` | 5 | `assemble/read/recognize/scan/time` |
| `packages/backend/src/admin/monitor.ts` | 1 | 后台数据 |
| `packages/backend/src/publication/monitor.ts` | 1 | 公开读取 |
| `packages/contracts/src/{leaderboard,monitor}.ts` | 2 | 已恢复 |
| `apps/api/src/routes/leaderboard.ts` | 1 | API 路由 |
| `apps/web/...` | 17 | `features/leaderboard/*`、`features/monitor/*`、`routes/leaderboard*.tsx`、`routes/admin/monitor.tsx` |
| `assets/leaderboard-sources/` | 14 | 榜单来源图标 |
| `tests/` | 10 | 见下 |
| `docs/leaderboard.md` | 1 | |

**要接的插口**（`packages/backend/src/modules.ts` 的 `ServerModule`）：
- `http?: (app) => void` —— 模型榜的 API 路由
- `schedules?: Scheduled[]` —— 抓取与刷新的定时任务（旧版在哪调度：用
  `git diff cc66cce..origin/main -- packages/backend/src/jobs/sources.ts` 与
  `apps/worker/src/schedules.ts` 看 4.0.0 删了哪些 glue）
- `admin?: { counts, runs }` —— 后台徽章与运行页
- `agent?: { abilities }` —— MCP 工具与 Agent 指南（旧版有）
- `alerts?: (now) => Finding[]` —— 监控的健康告警（旧版在 `operations/alerts.ts`）
- `models?: Record<string, ModelStep>` —— 监控用的 `MONITOR_MODEL`
- 页面用 `module.ts` 的 `pages` / `adminPages`，web 部件用 `web.tsx` 的 `topicPage`(已示范) 等

**`TopicMilestone` 之外的契约**：`TopicPage` 已定稿，不要再加字段。

### 阶段 3：我们自己的迁移重建表

`0053_drop_leaderboard_monitor.sql` 删 8 张 `lb_*` + 4 张 `monitor_*` + `fx_rates`；
`0045_drop_topics.sql` 删 `topics`。**不改这两个上游迁移**，另加我们自己的迁移重建表结构。

DDL 来源：`0003_monitor_leaderboard_notify.sql`、`0007_leaderboard_prices.sql`、
`0008_monitor_display.sql`、`0011_lb_alias_unique.sql`，以及 `topics` 的相关迁移。
从 `cc66cce` 用 `git show` 取。

**注意迁移约定**（`docs/architecture.md`）：从 `0055` 起每个文件只放一条允许在线执行的语句，
PR 会检查；索引用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`；大批回填不放进发布迁移。
我们的新迁移编号要**大于 `0057`**（上游最大），放 `modules/<名字>/migrations/` 也按文件名排序。

### 阶段 4：导入备份数据并验证

```bash
gunzip -c /home/weijianlin/backups/dropped-tables-20261004T112629Z.sql.gz \
  | docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot
```

**备份内容**（15 张表，4.68 MB，本地 `E:\cs\backups\` 与服务器各一份，字节数已核对）：

| 表 | 行数 | | 表 | 行数 |
|---|---|---|---|---|
| `lb_scores` | 11124 | | `lb_snapshots` | 81 |
| `lb_aliases` | 7117 | | `lb_prices` | 53 |
| `lb_rankings` | 5611 | | `topics` | 38 |
| `lb_models` | 2189 | | `lb_runs` | 12 |
| `monitor_posts` | 158 | | `monitor_event_posts` | 9 |
| | | | `monitor_events` | 6 |
| | | | `fx_rates` | 4 |
| | | | `monitor_state` | 3 |

⚠️ **`monitor_state`（3 行）最重要** —— 记录已处理过的帖子，丢失会导致对旧帖子重复告警。

### 阶段 5：测试与上线

被删的 10 个测试（从 `cc66cce` 取，放 `modules/<名字>/tests/`）：
```
tests/leaderboard-{access,filter-pages,oss-read,oss-snapshots,worker}.test.ts
tests/monitor{,-oss-scan,-oss-reliability,-oss-receipt}.test.ts
tests/topic-{detail-counts,release}.test.ts
tests/{chronicles,topic-chronicle,topics-rules}.test.ts
```

然后：
```bash
npm run typecheck
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
# 干净库上跑套件（名字须以 _test 或 _ci 结尾）
npm test
```

**上线前**：备份数据库（`scripts/backup-dropped-tables.sh` 已有；也应在服务器上存回滚标签，
`scripts/save-rollback-tag.sh`）、构建镜像、部署、验证页面与模型调用。

## 六、部署相关的既知坑（来自 DEPLOY-NOTES.md）

| 坑 | 要点 |
|---|---|
| Artifact Registry 凭据过期 | `compose pull` 与 `sudo docker pull` **读不同配置**（`~/.docker/config.json` vs `/root/.docker/config.json`）。`oauth2accesstoken` 是短期 token，两处都要用当前 gcloud 凭据刷新 |
| 镜像标签 | `.env` 里 `AIHOT_IMAGE` **自带 `:latest`**，拼回滚标签前要先剥掉（`${AIHOT_IMAGE%%:*}`）|
| `docker compose restart` 不重读 `.env` | 必须 `up -d --force-recreate` |
| 迁移文件 | `database/` 是挂载的，新迁移文件要 **scp 上传**，否则 `migrate.ts` 说"已是最新"而新列不存在 |
| `gcloud compute ssh` 不返回 ≠ 命令没跑完 | 输出是缓冲的。**直接查数据库状态**，不要等 |

## 七、另一个未完成的事项（与本升级无关）

上游维护者在 PR #79 的评论里说"没有 Windows 实机，欢迎帮忙确认"。
**已在 Windows 实机验证并回报**（`gh pr comment 79`）：
`main@2908224` 的 9 项架构测试 **9/9 通过**，并验证守卫不是空壳
（插探针能被检出、报出正斜杠路径）。三个 PR 均已合入 #105，署名保留。
