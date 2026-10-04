# 升级到上游 4.0.0 —— 交接说明

> 状态：**阶段 1、1B、2、3、4、5 全部完成**。三个功能都已做成 `modules/` 下的模块并端到端跑通
> （真实备份数据 + 真实 HTTP 请求 + 17 个恢复的测试全部验证过）。**已提交**在 `upgrade-4.0` 分支
> （提交「升级到上游 4.0.0（本机，第二步）：模型榜与 Codex 重置监控做成模块」，169 个文件）；
> `main` 与服务器**未动**，仍跑旧版。
> 部署步骤见「阶段 4」，其中「核对 13 张表真的在」那一步不能省。

## 零、这份文档里已被实测推翻的一条

| 旧结论 | 实测结果 |
|---|---|
| 旧第 76 行：「部件文件放模块根目录，**不要**放 `web/` 子目录」 | **反了**。`apps/web/tsconfig.json` 的 include 是 `"../../modules/*/web.tsx"` 与 `"../../modules/*/web/**/*"`，它**只**覆盖 `web/` 子目录里的文件（以及 `web.tsx` 本身）；模块根目录下的 `.tsx` **不在** `apps/web` 的检查范围，`modules/tsconfig.json` 又只有 `*/*.ts`（不带 `x`），所以根目录的 `.tsx` 两边都不查。**网页代码一律放 `modules/<名字>/web/`**，`modules/chronicle/` 里那几个放错位置的文件应当在下次改动时一并挪进去。 |

验证方式：在 `modules/leaderboard/` 下放四个探针，`npm run typecheck -w @aihot/web` 只报出 `web/` 子目录里的两个（`board.tsx`、`BoardTable.tsx`），根目录下的两个完全没被读到。


## 一、当前状态（已核实）

```
分支        upgrade-4.0（领先 origin/main 9 个提交，含下面这个；没有 push）
类型检查    contracts / backend / api / worker / modules 全部 0 错误，web 0 错误
main        未改动 —— 服务器仍跑旧版
服务器      5 个容器 Up（web/worker/api/caddy/db），站点正常
本机验证    临时库（docker aihot-testdb）+ 真实备份数据，17 条模块路由全部 200
测试        模块测试 107/107（干净库）；web 测试 33/33
```

### 三个模块

```
modules/leaderboard/   package.json module.ts server.ts web.tsx web/{board,boards,model,rules,source,sources,BoardTable,BoardTabs,StatusChip,format}.tsx
                       backend/{access,directory,prices,providers,read,registry}.ts + backend/fetch/** + backend/method/**
modules/monitor/       package.json module.ts server.ts web.tsx web/{reset,admin,PostCard,ResetCalendar,format}.tsx
                       backend/{admin,answer,assemble,read,recognize,scan,site-page,time}.ts
modules/chronicle/     （阶段 1B 已完成）
```

登记在 `site/modules/{index,server,web}.ts`；依赖写在 `site/package.json`；`Dockerfile` 逐个 COPY 三个 `package.json`。
`modules/*/package.json` 的 exports 逐条列出（`./module`、`./server`、`./backend/*`、`./web`），与 `site/package.json` 同写法。

### 框架侧改了 7 处（都是通用插口或共享代码，不含功能代码）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `packages/backend/src/lib/http.ts` | **新增**：`sendProblem`/`sendJsonWithEtag`/`weakEtag`/`strictQuery`/… | 模块自己的路由（`ServerModule.http`）要用与引擎一致的应答；`apps/api/src/http/respond.ts` 改成从这里 re-export，引擎各处不用动 |
| `packages/backend/src/admin/auth.ts` | `adminHandler` 从 `apps/api/src/routes/admin-auth.ts` 搬到这里 | 模块的后台路由要同一个会话 + CSRF 守卫；`admin-auth.ts` 原样 re-export，`admin.ts` 与测试的 import 不变 |
| `packages/backend/src/modules.ts` | 新增 `staticAssets?` 与 `Scheduled.runOnStart?` 两个插口 | 前者：模块要把 `assets/` 下的图片挂到自己的地址（`/model-providers`、`/leaderboard-sources`）。后者：旧版 `apps/worker/src/main.ts` 在库里还没有 published run 时立刻算一轮榜单，`when` 做不到这件事（它在起进程时求值一次，之后不再变） |
| `apps/worker/src/schedules.ts` | 注册定时任务时读 `runOnStart` | 上面那个插口的实现：为真就立刻 `boss.send` 一次，pg-boss 的 singleton 策略保证与 cron 那次不重叠 |
| `apps/api/src/routes/static.ts` | 遍历 `serverModules()` 的 `staticAssets` 注册 `:file` 路由 | 上面那个插口的实现（`^[a-z0-9-]+\.(svg\|png)$` 白名单，`public, max-age=604800`） |
| `apps/web/app/app.css` | 补回 4.0.0 删掉的 35 行 | 监控页的日历配色、状态卡渐变与呼吸点、月份滑入动画；逐行与 `cc66cce` 一致（只多 4.0.0 自己加的 5 行 `@source`） |
| `site/site.ts` | `CARDS` 加 `leaderboard`、`codex-reset` 两条 | 两个页面的分享图 `/og/pages/*.png` 否则 404（4.0.0 把卡片文案搬进了 site.ts） |

提交链（到交接文档为止）：

```
831dbb4  交接文档：升级到 4.0.0 的完整说明；备份文件移出版本控制
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
| **1** | **网页代码放 `web/` 子目录**（含页面） | 见第零节：`apps/web/tsconfig.json` 只 include `modules/*/web.tsx` 与 `modules/*/web/**/*`。模块根的 `.tsx` 不在任何项目的检查范围内，写了也不会被查出错误 |
| **2** | 模块 `package.json` 要给**显式 exports** | `"./*": "./*"` 解析不到 `./module`；照 `site/package.json` 的写法逐条列出（`./module`、`./server`、`./backend/*`、`./web`） |
| **3** | 从模块 import 引擎用**包别名，且不带 `.ts`** | `@aihot/backend/db`（exports 是 `"./*": "./src/*.ts"`，写 `db.ts` 会解析成 `src/db.ts.ts`）、`@aihot/site`、`@aihot/contracts/*`、`@aihot/web/*`。模块**内部**互相引用才用相对路径 + `.ts` |
| **4** | **不要**往 `modules/tsconfig.json` 加 `*/web/**/*.tsx` | 它不是 JSX 配置（缺 `--jsx`，moduleResolution 要求 `.js` 后缀），加了会一次冒出 74 个错误。web 侧交给 `apps/web` 自己的 tsconfig |
| **5** | 验证模块真在检查范围内 | 类型检查通过可能是假象（文件没被 include）。**故意插一个类型错误，确认能被检出**再相信 0 错误。三次任务里每个子代理都被要求做这一步 |
| **6** | 模块页面**没有** `+types` | React Router 的 typegen 只注解 app 目录内的路由文件；模块页面手写 loader/meta/组件参数类型 |
| **7** | 模块不能 import `apps/` | `@aihot/web/*` 只是构建期别名，`tsconfig` 与 vite 里各配一份。要在模块的路由里用引擎的 HTTP 助手，就把它放进 `packages/backend/src/lib/http.ts`（本次已放） |
| **8** | 模块自己的后台路由用 `@aihot/backend/admin/auth` 的 `adminHandler` | 同一个会话 + CSRF 守卫；守卫本身已从 `apps/api` 搬进 backend 包，模块与引擎共用一份 |


## 五、阶段 2–5 的做法与结果

### 阶段 2：模型榜与 Codex 监控做成模块（完成）

**4.0.0 删掉、但恢复后仍然要用的东西**（只补被删的文件本身，不改上游代码）：

| 位置 | 数量 | 为什么必须要 |
|---|---|---|
| `assets/leaderboard-sources/` | 14 | 评测来源的图标（`registry.ts` 给 `/leaderboard-sources/<file>`） |
| `assets/model-providers/` | 17 | 厂商标志（`registry.ts` 给 `/model-providers/<file>`；缺了页面只显示首字母） |
| `database/seeds/lb-models-*.json` | 1 | `backend/directory.ts` 读它算展示名与厂商；**文件不在会直接抛错** |
| `database/seeds/lb-official-prices-*.json` | 2 | `backend/prices.ts` 读它算官方 API 价格 |
| `scripts/{import-leaderboard-prices,lb-round,lb-fetch-check}.ts` | 3 | 补价格、手动跑一轮、比对抓取结果；import 改成 `@aihot/leaderboard/backend/*` |
| `docs/leaderboard.md` | 1 | 口径说明 |

**文件搬家规则**（旧 → 新），只有三件事要做：

| 旧位置 | 新位置 | 说明 |
|---|---|---|
| `packages/backend/src/leaderboard/**`（38） | `modules/leaderboard/backend/**` | 目录结构原样保留（`fetch/`、`method/` 不变） |
| `packages/backend/src/monitor/*.ts`（5） | `modules/monitor/backend/*.ts` | 平铺 |
| `packages/backend/src/admin/monitor.ts` | `modules/monitor/backend/admin.ts` | |
| `packages/backend/src/publication/monitor.ts` | `modules/monitor/backend/site-page.ts` | |
| `apps/api/src/routes/leaderboard.ts` | `modules/leaderboard/server.ts` 的 `http` 插口 | |
| `apps/web/app/routes/leaderboard*.tsx`（6） | `modules/leaderboard/web/*.tsx` | |
| `apps/web/app/features/leaderboard/*`（4） | `modules/leaderboard/web/*` | `BrandMark.tsx` 不要搬（见下） |
| `apps/web/app/routes/codex-reset.tsx` | `modules/monitor/web/reset.tsx` | |
| `apps/web/app/routes/admin/monitor.tsx` | `modules/monitor/web/admin.tsx` | |
| `apps/web/app/features/monitor/*`（3） | `modules/monitor/web/*` | |

**import 改写规则**（三条，其余不用动）：
1. 指向 `packages/backend/src/<rest>` 的旧相对路径 → `@aihot/backend/<rest>`，**不带 `.ts`**（exports 是 `"./*": "./src/*.ts"`，写 `db.ts` 会变成 `src/db.ts.ts`，报 TS2307 —— 两个子代理各自独立实测确认）
2. 指向 `apps/web/app/<rest>` 的旧相对路径 → `@aihot/web/<rest>`（别名在 `apps/web/tsconfig.json` 与 `apps/web/vite.config.ts` 两处都配了）
3. 模块内部互相引用 → 保持相对路径，**带 `.ts` 后缀**
4. `@aihot/industry/site` → `@aihot/site`；`@aihot/industry/features` 在 4.0.0 已经不存在，旧的 `FEATURES.*` 开关一律丢掉（4.0.0 用插口的 `when` 与运行时常量取代）

**已接的插口**（`packages/backend/src/modules.ts`）：

| 插口 | leaderboard | monitor |
|---|---|---|
| `http` | `/api/site/leaderboard/{boards/:key,models/:slug,sources,sources/:key,rules}` | `/api/v1/codex-resets{,/recent}`、`/api/site/codex-reset{,/days/:date,/version}`、`/api/admin/monitor/*`（7 条） |
| `schedules` | `leaderboard.round`（`5 2,8,14,20 * * *`） | `monitor.tick`（每 10 分钟）、`monitor.lookback`（`40 4 * * *`） |
| `models` | `leaderboard`（`LEADERBOARD_MODEL`） | `monitor`（`MONITOR_MODEL`，`monitor.recognize`/`monitor.context`） |
| `staticAssets` | `/model-providers`、`/leaderboard-sources` | — |
| `admin` | `counts.leaderboard`（缺厂商标志的模型数）、`runs`（评测来源抓取状态） | `counts.monitor`（待识别 + 需复核） |
| `alerts` | 来源超一天没抓到、模型缺标志 | 卡住、需复核 |
| `agent` | `/leaderboard` + MCP `get_leaderboard` | `/codex-resets` + MCP `get_codex_resets` |

**没有搬的东西**（有意）：
- `apps/web/app/features/leaderboard/BrandMark.tsx`：4.0.0 已把它提升为共享组件 `apps/web/app/components/BrandMark.tsx`，而 `LbBrand`（`contracts/leaderboard.ts`）与 `Brand`（`contracts/site.ts`）字段完全相同，调用处一行都不用改。旧的 `DARK_TILE`（Kimi 的白 K）改由 `web.tsx` 的 `darkMarks: ["/model-providers/moonshot.svg"]` 声明。
- `apps/web/app/components/Logo.tsx`：4.0.0 删了，但被搬的两个页面都没用它（用它的 `routes/admin/layout.tsx` 是引擎文件，已改用 `site/brand/Logo.tsx` 的 `RingMark`）。
- 模块页面**没有** `+types`：React Router 的 typegen 只注解 app 目录内的路由文件（`@react-router/dev` 的 `isInAppDirectory`），模块页面在 `apps/web/app` 之外，生成的 `+routes.ts` 里它们只是 `unknown`，也不会生成 `modules/.../+types/`。**做法**：删掉 `import type { Route } from "./+types/x"`，loader / meta / 组件参数手写类型并加一行注释说明原因。`useLoaderData<typeof loader>()` 仍能从 loader 推出 DTO。

### 阶段 3：我们自己的迁移重建表（完成）

`database/migrations/0058`–`0077`，共 20 个文件，**一个文件一条语句**（`scripts/migration-safety.ts` 从 `0055` 起强制，用 `migrationPlan()` 单独校验过 20/20 通过）：

```
0058–0066  lb_models, lb_aliases, lb_snapshots, lb_scores, lb_runs, lb_rankings,
           lb_calibrations, lb_prices, fx_rates                  (CREATE TABLE IF NOT EXISTS)
0067–0070  monitor_posts, monitor_events, monitor_event_posts, monitor_state
0071–0077  七个索引 (CREATE INDEX CONCURRENTLY IF NOT EXISTS)
```

DDL 取自 `cc66cce` 的 `0003`/`0007`/`0008`/`0011`/`0048`，并减去 `0049`/`0050`/`0052` 在删表前已经删掉的列（即删表那一刻的真实形状）。
**`topics` 没有重建** —— 主题索引从 `industry/topics.json` 读，数据库里那份 0045 删掉后就没人读了（`publication/topics.ts` 只读 JSON 文件）。

### 阶段 4：导入备份数据（本机验证完成，服务器待做）

**导入顺序很重要**（第一次做错了，记下来）：备份是**迁移前**的 pg_dump，它自己带 `CREATE TABLE`。所以不能建完表再导入，也不能在已有表的库上导入 —— 会撞 `relation already exists` 而 `ON_ERROR_STOP` 直接中止，表留空。正确顺序是：

1. 导入主库备份（`aihot-db-clean-*.sql.gz`）
2. **删掉** 0053/0045 要删的那 13 张表（照 0053/0045 的清单，`DROP TABLE IF EXISTS ... CASCADE`）
3. 导入 `dropped-tables-*.sql.gz`
4. `node scripts/migrate.ts` 把我们自己的迁移补上

服务器上如果库还是旧版（表本来就在），则只需 `gunzip -c ... | docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot` 之后跑迁移；**但升级部署会先执行 0053 删表**，所以正式流程应当是「先备份 → 部署 → 按上面 2–4 导入」。

导入后实测行数与交接文档完全一致（`lb_scores` 11124、`lb_aliases` 7117、`lb_rankings` 5611、`lb_models` 2189、`monitor_posts` 158、`monitor_state` 3 …）。
⚠️ **`monitor_state`（3 行）最重要** —— 记录已处理过的帖子，丢失会导致对旧帖子重复告警。

⚠️ **再踩过的坑：`schema_migrations` 里会有「记着已执行、表却不在」的行。**
第一次按上面的顺序做完后，`0064_leaderboard_calibrations.sql` 的账是 `13:50:47` 记上的，但 `lb_calibrations`
并不存在——那一行的写入早于覆盖导入，而覆盖导入里的 `DROP TABLE` 把表删了，migrate 看账本就说「已是最新」，
于是**永远不会再建**。`modules/leaderboard/backend/method/inputs.ts` 要读写这张表，一旦某轮要冻结标定就会报错。
**部署后必须核对表真的在**，不要只看 `migrate.ts` 的输出：

```bash
docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot -c \
  "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname ~ '^(lb_|monitor_|fx_)' ORDER BY 1;"
```

应当列出 13 张：`fx_rates`、`lb_aliases`、`lb_calibrations`、`lb_models`、`lb_prices`、`lb_rankings`、
`lb_runs`、`lb_scores`、`lb_snapshots`、`monitor_event_posts`、`monitor_events`、`monitor_posts`、`monitor_state`。
少一张就删掉对应的账本行再跑迁移（我们的迁移一律 `IF NOT EXISTS`，重跑安全）：

```bash
docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot -c \
  "DELETE FROM schema_migrations WHERE name = '0064_leaderboard_calibrations.sql';"
```

### 阶段 5：测试（17 个已放回 `modules/*/tests/`）

拷贝后用脚本改 import（`@aihot/backend/{leaderboard,monitor}/x` → `../backend/x.ts`，`@aihot/backend/publication/{chronicles,topic-chronicle}` → `../backend/{curated,chronicle}.ts`，`@aihot/backend/{admin,publication}/monitor` → `../backend/{admin,site-page}.ts`，`./setup.ts` → `../../../tests/setup.ts`）。
两处**不是**改路径而是改语义的地方：

| 测试 | 旧写法 | 新写法 | 原因 |
|---|---|---|---|
| `monitor.test.ts` | `codexAnswer(page, now)` 来自 `publication/agent` | `codexPageAnswer(page, now)` 来自 `../backend/answer.ts` | 这段 Markdown 生成搬进了模块；模块另导出 `codexAnswer(now)`（自己读页面数据）给 Agent 出口用 |
| `topics-rules.test.ts` | `page.chronicle` / `page.highlights` / `page.milestones` | `page.modules.chronicle` 下的同名字段 | 4.0.0 的模块机制：主题页各部分归各模块，测试要先 `installModules([chronicleServerModule])` |

⚠️ **跑这套测试要注意两件事**（都踩过）：
1. `tests/databases.ts` 用 `CREATE DATABASE ... TEMPLATE aihot_test` 给每个测试文件复制一份库，**只要还有别的会话连着 `aihot_test`，复制就会失败**（`55006 source database is being accessed by other users`）。所以别在本机同时跑 `scripts/pending-upgrade-4.0/run-api-locally.ts` 或任何指向该库的进程。
2. 这个模板库要按「阶段 4」的顺序灌好数据；空库也能跑，但榜单/监控相关的用例没有真实数据可断言。

`npx tsc -p modules --noEmit` 对这 17 个文件是干净的（它们由 `modules/tsconfig.json` 的 `*/tests/**/*.ts` 收进来）。
**实测结果**：干净迁移出来的库（`aihot_ci`，即 CI 与 `AGENTS.md` 用的环境）上 **107 个用例全通过**；
在按阶段 4 灌了真实数据的 `aihot_test` 上是 **102/107** —— 那 5 个失败是**真实数据顶掉了测试自己的前置条件**
（`leaderboard-read` 的三条被 12 个真实 run 里最新的那个抢了先；`anthropic` 主题有 111 个真实成员、6 条真实里程碑；
`monitor-amendments` 有一条真实帖子落在 36 小时推送窗口里，于是多出一张卡）。这些断言写的时候假设库是空的，
**所以测试的正式环境是干净库，不要改成迁就真实数据**（没有删断言、没有 `.skip`）。

两处按 4.0.0 的模块机制必须补的前置（子代理实测）：
- 用到模块路由的测试要先 `installModules([monitorServerModule])`——`buildApp()` 只从 `serverModules()` 注册那些路由
- `monitor-reliability.test.ts` 要 `process.env.MONITOR_MODEL ??= "deepseek-flash"`：没有这个步骤
  `editorial/models.ts` 会抛 `unknown model step: monitor`；步骤在、环境变量没设则解析成站点的通用默认模型，
  测试的桩服务根本不会被访问（上游的 `tests/setup.ts` 以前会设它，现在不设了）

```bash
npm run typecheck
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
# 干净库上跑套件（名字须以 _test 或 _ci 结尾）
npm test
```

### 大事记的两个真 bug（都是实测发现的，已修）

**一、`toChronicleTopic` 读不到词表。** 它原本从 `ask.topic` 上读 `chronicleTerms` / `orgNames`（旧版框架把它们读进了 `Topic`），
而 4.0.0 的 `publication/topics.ts` 只映射八个字段，两个字段永远是 `undefined`。后果：
**所有方向主题（`group: "field"`，agent、coding、reasoning……）的 `terms` 是 null，报告全被判掉，
大事记与 highlights 永远为空**；公司主题的 `orgNames` 是 `[]`，事件名回退成标题原句。

**修法（改了模块，没动框架）**：新增 `modules/chronicle/backend/pack.ts`，自己按 `REPO_ROOT` 读
`industry/topics.json`（与 `backend/curated.ts` 读 `industry/chronicles/` 同一套做法），导出
`termsOf(slug)` 与 `orgNamesOf(slug)`；`server.ts` 改成调它们。

实测（真实备份数据）：修复前 `agent` 是 `months=0 events=0`，修复后 `months=6 events=15 highlights=3`；
`/api/site/topics/openai` 返回 7 条 milestones + 3 条 highlights。

**二、`part` 丢掉重读的结果。** `topics.page` 的契约说 `part(current)` 拿到的是「按现在重读过的成员」，
撤回与更正应当立刻生效（索引本身是一分钟前的）。原来的实现把 `part` 提前算好、忽略 `current`，
所以更正要等索引过期（最多 60 秒）才反映到页面上，而且模块请页面重读的那些 id 读了却被扔掉。
改成在 `part(current)` 里先按 `current` 过滤 `named`（掉了的不进大事记）再算，与 4.0.0 之前的做法一致。
`topics-rules.test.ts` 的「cached milestone eligibility follows current score, launch tag and fact subject corrections」
就是抓这个的——修之前它在**干净库上也失败**。

**三、`pack.ts` 的词表正则。** 第一版写的 `new RegExp(`(${terms.map(escape).join("|")})`)` 少了两件事：
不分大小写、以及拉丁词的词首/整词规则。后果是漏掉小写的组织名（`agent 框架` 匹配不上）又多认子串
（`SWEbench` 会被 `SWE` 命中）。现在逐字复刻 4.0.0 之前框架里那份（`/i`；拉丁词从词首开始，三个字母以内整词命中；
中日韩词子串匹配），并用 13 个探针串与旧实现对照，**0 处不一致**。

```bash
npm run typecheck
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
# 干净库上跑套件（名字须以 _test 或 _ci 结尾）
npm test
```

### 本次本机验证的结论（可复现）

用 `docker run -d --name aihot-testdb -p 55432:5432 postgres:17-alpine` 起临时库，按阶段 4 的顺序灌入真实数据，然后：

- `node scripts/migrate.ts` → 77 个迁移全部应用，20 个新迁移的 `kind` 与预期一致
- 17 条模块路由**全部 200**：榜单 5 条、codex 4 条、Agent 2 条、分享图 2 张、图标 2 类；条件请求返回 **304**；未知榜单与非法文件名返回 **404**；`/api/admin/monitor/*` 匿名访问返回 **401**
- 路径穿越（`%2e%2e%2f`、`..%2f`、大写、下划线）全部 **404**（`^[a-z0-9-]+\.(svg|png)$` 白名单挡住）
- 13 张模块表全部存在且行数与备份一致；`topics` 表刻意不重建（改从 `industry/topics.json` 读）
- 三个模块的插口一起装进一个 app 后路由正常注册；17 个模块测试在干净库上 **107/107**
- 引擎原有出口回归：`/api/v1/items`、`/api/v1/hot-topics`、`/api/v1/agent`、`/llms.txt`、`/openapi-v1.json` 全部 200
- 读取层直接调用：综合榜 30 行（榜首 Claude Opus 5.5、19 个来源、价格与汇率正常）、模型详情 5 组证据、69 个评测来源、codex 6 个事件与 6 格日历、`codexAnswer` 33 行、两条告警、后台待处理 3 条

**上线前**：备份数据库（`scripts/backup-dropped-tables.sh` 已有；也应在服务器上存回滚标签，
`scripts/save-rollback-tag.sh`）、构建镜像、部署、验证页面与模型调用。

**已知缺口**：`lib/useLoaderData` 之外，`codex-reset` 的**分享图与 CSS 已补**；但 chroncle 模块的 web 文件仍在模块根目录（见第零节），哪天动它时顺手挪进 `web/`。


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
