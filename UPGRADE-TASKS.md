# 恢复三个功能的移植进度（upgrade-4.0 分支）

## 背景

上游 4.0.0（提交 `1ca5d6d`，293 文件重构）**把三个功能移出框架**：模型榜、Codex 重置监控、主题大事记。
用户决定**全部恢复**。

`1ca5d6d` 不能直接 revert —— 它在移除功能的同时还做了「引擎改为从线上导出 + 结构重组」，
revert 会把结构改回去，导致其后 16 个提交全部冲突。

**做法**：从 `1ca5d6d` 的父提交 `cc66cce`（= 删除前的最后状态）取回被删文件，适配 4.0.0 结构。
耦合情况已测：这些代码对框架只依赖 `db.ts` / `config.ts` / `lib/http-fetch.ts` / `providers/receipts.ts`，都是稳定接口。

## 基准提交

```
cc66cce  leaderboard: drop the stored date official prices were read (#91)   ← 取文件用这个
1ca5d6d  4.0.0：…模型榜、Codex 重置监控和主题大事记移出框架 (#92)              ← 移除提交
2908224  origin/main（4.0.0 之后又 16 个提交）                                ← 我们的升级基准
```

## 已完成

| 项 | 状态 |
|---|---|
| 备份 15 张会被删的表（含 monitor_state） | ✅ 本地 + 服务器双份，已验证 |
| `upgrade-4.0` 分支、450 信源、网关补丁 | ✅ 提交 `4e8a2c2` |
| 恢复 backend 功能代码 49 个文件 | ✅ `<leaderboard>` 38 + `monitor/` 5 + `admin/monitor.ts` + `publication/{chronicles,monitor,topic-chronicle}.ts` + `contracts/{leaderboard,monitor}.ts` |
| `taxonomy.ts` 加回 `LEADERBOARD_*` 常量 | ✅ |
| `package.json` 加回 `highs@1.15.3`、`hyparquet@1.31.1` | ✅ 已安装 |
| 修 `@aihot/industry/site` → `@aihot/site`（3 文件） | ✅ |

## 剩余 ~15 个类型错误，分三类

### A. contracts 里缺的类型（两个文件）

| 目标文件 | 缺的导出 | 旧版来源 |
|---|---|---|
| `packages/contracts/src/admin.ts` | `AdminMonitorEventPost`(283) `AdminMonitorEvent`(293) `AdminMonitorEvents`(312) `AdminMonitorPost`(316) `AdminMonitorPosts`(336) | `cc66cce:packages/contracts/src/admin.ts` 第 283–340 行左右 |
| `packages/contracts/src/site.ts` | `TopicMilestoneKind`(440) `TopicKind`(443) `TopicEvent`(452) `TopicMonth`(464) `TopicMilestone`(471) | `cc66cce:packages/contracts/src/site.ts` 第 440–490 行左右 |

**注意**：`topic-chronicle.ts(47)` 还有 3 个 `'k' is of type 'unknown'` 错误 —— 那是 `TopicMilestoneKind` 缺失的连带错误，补上类型后应消失。若仍在，说明旧版那个类型是具体联合而非 `string`，要照抄旧版定义。

### B. 缺 `industry/chronicle.ts`（主题大事记的行业定义）

```
packages/backend/src/publication/topic-chronicle.ts(9,27):
  Cannot find module '@aihot/industry/chronicle'
```

从 `cc66cce:industry/chronicle.ts`（262 行）取回。**同时确认**它依赖的 `industry/topics.json`（238 行）是否需要一并恢复 —— 4.0.0 里 `industry/topics.json` 是否还在要查。

### C. 其余

`admin/monitor.ts` 的错误应在 A 完成后消失。全部修完后重跑 `npm run typecheck` 确认 0 错误。

## 阶段 1 收官：`topics.ts` 的结构冲突（需决策）

**已完成**：backend 功能代码、contracts 类型（`admin.ts` 补 5 个 monitor 类型；`site.ts` 补 5 个
topic 类型 + `TopicPage` 合并保留 `modules`）、`industry/chronicle.ts`、依赖、import 路径。

**唯一剩余错误**：

```
packages/backend/src/publication/topics.ts(327,3)
  Type ... is missing: kinds, chronicle, milestones, highlights
```

**原因 —— 两套结构不同，不是简单叠加**：

| | 旧版（`cc66cce`） | 4.0.0（`2908224`） |
|---|---|---|
| `loadTopicPage` 返回 | `kinds` `chronicle` `milestones` `highlights` | **`modules: Record<string, unknown>`** |
| 页面组装 | `topics.ts` 直接用 `chronicles.ts` / `topic-chronicle.ts` 的纯函数 | 搬到 **web 模块**，各模块自己画自己那块 |
| `topics.ts` 依赖 | `./chronicles.ts`、`./topic-chronicle.ts`、`@aihot/industry/chronicle`、`@aihot/industry/features` | 模块机制 |

**三条路**：

| 路 | 做法 | 代价 |
|---|---|---|
| **A. 用旧版 `topics.ts` 覆盖** | 从 `cc66cce` 取回旧文件，再手工补回 `modules` 字段 | 上游的模块机制对主题页失效；`@aihot/industry/features` 在 4.0.0 已删，要一并处理 |
| **B. 适配模块机制** | 把 chronicle 做成 `site/modules/` 的一个模块，通过 `modules` 字段提供 | **最符合 4.0.0 设计**，但要先读懂模块机制（`site/modules/*.ts` + `docs/architecture.md` 的「模块」） |
| **C. 暂时保留旧结构** | 先 A 让功能跑起来，之后再转 B | 阶段性方案 |

**建议 B**：它正是 4.0.0 为「只属于自己站的功能」准备的机制，且长期不与上游冲突。
但需要先读模块机制，是独立的一步。

## 后续阶段（阶段 1 之后）

### 阶段 2：我们自己的迁移重建表

`0053_drop_leaderboard_monitor.sql` 会删表，`0045_drop_topics.sql` 删 `topics`。**不改这两个上游迁移**，
另加我们自己的迁移重建表结构（从旧迁移文件取 DDL：`0003` `0007` `0008` `0011`，以及 topics 相关迁移）。

### 阶段 3：恢复入口与 web

需要恢复并适配 4.0.0 结构：
- 入口/定时任务：旧版在 `packages/backend/src/jobs/sources.ts` 与 `operations/alerts.ts` 里有引用（用
  `git diff cc66cce..origin/main -- <file>` 看 4.0.0 删了哪些 glue）
- `apps/api/src/routes/leaderboard.ts`（1 个）
- `apps/web` 17 个：`features/leaderboard/*`、`features/monitor/*`、`features/topic/Chronicle.tsx`、
  `routes/{leaderboard*,topic,topics,admin/monitor}.tsx`
- `assets/leaderboard-sources/*`（14 个，榜单来源图标）
- `docs/leaderboard.md`

### 阶段 4：导入备份数据

```bash
gunzip -c /home/weijianlin/backups/dropped-tables-20261004T112629Z.sql.gz \
  | docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot
```

**`monitor_state`（3 行）最重要** —— 它记录已处理过的帖子，丢失会导致对旧帖子重复告警。

### 阶段 5：恢复 tests 并跑套件

被删的测试（10 个）：
```
tests/leaderboard-{access,filter-pages,oss-read,oss-snapshots,worker}.test.ts
tests/monitor{,-oss-scan,-oss-reliability,-oss-receipt}.test.ts
tests/topic-{detail-counts,release}.test.ts
tests/{chronicles,topic-chronicle,topics-rules}.test.ts
```

## 重要提醒

- `main` 分支**未被改动**，服务器仍跑旧版，随时可停
- 这些代码恢复后**只存在于我们的 fork**；每次跟进上游都要处理 `0053`/`0045` 的冲突
- 若希望长期减少维护成本，可考虑整理成 `site/modules/` 的正规模块并向上游提 PR
