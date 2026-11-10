# 这个分支加了什么

这是 [AIHOT](https://github.com/KKKKhazix/AIHOT) 框架的一个部署分支，跑在 **https://hot.jian.ing**：一个中文 AI 圈的 X 运营工作台。
框架本身（采集、归并、打分、日报/周报/月报）保持上游原样；下面这些是本分支自己的东西，全部在 `modules/x-profile/` 里。

## 四个工具

| 页面 | 做什么 |
|---|---|
| **X 涨粉榜** `/x-people/growth` | 7 日 / 30 日的涨粉数、涨粉率、每千曝光效率；按中文区、粉丝档（1 千以下 → 100 万以上）筛，榜内名次重排；`?mine=你的账号` 直接看自己的位置 |
| **博主画像** `/x-people/:handle` | 单个账号的发帖节奏、互动结构、代表帖、最佳时段；每个账号有涨粉周报的 **RSS**：`/feed/x/<handle>.xml` |
| **今天发什么** `/x-people/today` | 站内热点榜 × 48 小时内的 X 讨论量，每题给出热度、讨论量、一句「怎么写」，再挂 2–3 条现在就能接一句的中文帖 |
| **算法视角** `/x-people/algorithm` | 拿 X 公开的 For You 权重，用本站数据回测「同日连发衰减 / 外链限流 / 讨论率涨粉」三个说法，并写明我们测不了什么 |

另外：`/x-people/methodology` 是跨账号的内容方法论（形式、字数、时段、题材的爆款率）。

## 数据侧

- **X 帖子采集**：`x_search` 源按 `from:<handle>` 抓中文 AI 博主，SocialData 计费，走框架的回执与预算熔断；
- **粉丝快照**：从采集回执里解析粉丝数，按天落库，涨粉榜和「我的账号」都基于它；
- **账号收录**：读者可以自助提交收录申请（每个 IP 每天 5 次），后台审核通过后自动按同一路径建源；
- **周报**：每周一生成上周的涨粉总结，既是站内页面也是 RSS。

## 口径（重要）

- 互动数（浏览、赞、转、评、引）是**采集那一刻的快照**，适合横向比较，不是帖子的最终值；
- X 的排序权重乘的是「预测概率」，**不是互动计数**——不要把「回复权重 5.0、点赞 0.708」读成「一条回复等于七个赞」；
- 所有分析只读本站已采集的数据，页面打开不触发模型调用。

## 怎么部署

见 `deploy/release.sh`：拉镜像 → 把 `industry/ database/seeds/ scripts/` 同步成镜像里的版本（这几个目录在服务器上是挂载的）→ 跑迁移 → 重建 api / worker / web → 冒烟。

## 开发流程（本站约定）

一个任务 = 一张任务卡（`docs/task-card.md`）+ 一个分支 + 一次自动检查 + 最多两轮审核返工。
线上事故走热修例外：先合并部署，事后补任务卡与审核。

**角色**：我 = Planner + Orchestrator + Worker；子 agent = Reviewer（只读，不改代码）；`scripts/` = Gate。
不写自己审自己：reviewer 必须用另一个会话，且**默认用另一个模型**（见下）。

### 状态

`TODO → IN_PROGRESS → GATE → REVIEW → MERGE_READY → MERGED → DEPLOYED`

- GATE 失败：退回 Worker，不计返工轮次、不消耗 reviewer；
- REVIEW 不通过：REWORK（计 1 轮）→ 重跑 Gate → 复审；
- **最多 2 次返工（3 次审核）**，仍有 blocker 就 ESCALATED：停下来问人，不再自动改。

### 1. 任务卡（动手前写）

用 `docs/task-card.md` 的模板，必须写明：允许/禁止改的范围、**每条验收标准怎么验证**、风险等级。
验收标准要可执行（命令、测试名、截图尺寸），不要写「体验良好」「代码质量高」。
预计 diff 超过 ~500 行就拆任务——上一轮 UI 任务 1200 行、返工 5 次，就是没拆。

### 2. 分支

```bash
git switch -c task/<slug> upgrade-4.0     # 记录基线 commit
```

并行任务用 `git worktree add .worktrees/<task> task/<slug>`，两个 agent 不同目录。
迁移编号合并前对一遍；已推送的任务分支不 rebase。

### 3. 开发与提交

- 只改任务卡范围；要超范围先停下来说明，不自行扩大；
- 先补测试再实现；小步提交，一个 commit 一件事；
- **改完必须提交**，留干净工作区——审核对象是 commit，不是工作区。

### 4. 自动检查（Gate）

```bash
pwsh -File scripts/gate.ps1          # typecheck + build + architecture + 全量测试 + diff 规模
```

失败就修，不过 Gate 不进 review。Gate 报告贴进审核包。

### 5. 审核

送审前先跑：

```bash
pwsh -File scripts/review-precheck.ps1 -Since <上轮审核的 commit>
```

不通过（HEAD 没变 / diff 为空）直接退回，不消耗 reviewer。

**审核包**：任务卡 + `git diff upgrade-4.0...task/<slug>`（附基线/HEAD sha）+ Gate 报告 + 交付说明；
复审再加：上轮报告、修复说明、`git diff <上轮审核 commit>..HEAD`。

**reviewer 用另一个模型**：

```
provider: opencode-go-glm
model: glm-5.3-flash
```

（同一个 OpenCode Go 套餐，和 Worker 的 `deepseek-v4.1-flash` 不同源。首审用新会话；复审可以新会话喂上轮报告，也可以续用同一个 reviewer。）

**审核规则**：

- 先按任务卡验收标准逐条判，再看实现质量；
- 问题分三级：**blocker**（不满足验收标准 / 功能错 / 数据损坏 / 安全 / 挂测试）、**major**、**minor**；
- 只有 blocker 阻止合并；major/minor 记入待办，不要求本轮修；
- **不得提出任务卡之外的新需求**——想加标准就写进下一张任务卡；
- 每条问题给 `文件:行` + 期望结果 + 验证方式；说「未修复」必须指到当前 HEAD 的具体位置；
- reviewer 只读：审完 Orchestrator 必须 `git status` 确认仓库干净，reviewer 写下的文件一律丢弃。

**复审范围锁定**：只验上轮 blocker 是否解决、增量 diff 有没有引入回归。
新 blocker 必须说明是返工引入的回归，或解释首审为何遗漏；否则记待办。

### 6. 合并与部署

```bash
git switch upgrade-4.0
git merge --no-ff task/<slug>        # commit message 引用任务
# 部署：构建镜像 → 推送 merge-<sha> 与 latest → release.sh（迁移+重启+冒烟）
# 冒烟失败立即回滚，任务回 IN_PROGRESS
```

部署后确认：`/api/health`、目标页面 200、关键行为抽查（数据类跑一次真实 SQL，UI 类拍 1280/393 截图）。
之后 `publish-public.ps1` 发公开快照，删任务分支与 worktree，major/minor 写进待办。

### 7. 防循环

| 机制 | 规则 |
| --- | --- |
| 轮次上限 | 2 次返工；第 3 次审核仍有 blocker → ESCALATED |
| 范围锁定 | 复审只验 blocker 与回归，不重新全面审查 |
| 问题编号 | ISSUE-01 贯穿全程，状态 open / fixed / wontfix |
| 震荡检测 | 同一 issue 连续两轮未修、同一处来回改、reviewer 前后要求矛盾 → 立即升级 |
| 证据 | 「未修复」要指到当前 HEAD 行号；「已修复」要有验证命令或测试 |
| 仲裁 | 有争议按任务卡验收标准裁决；标准不清就停下来问人 |

### 8. 人工检查点

- 任务卡确认（尤其高风险：迁移、权限、支付、删除类）；
- 任何 ESCALATED；
- 合并部署前的最终看一眼。
## 这个仓库怎么更新

公开的这个 fork 只放**上游公开历史 + 我们的一次性快照提交**，不放开发历史；完整历史在私有仓库里。所以更新分两步：

```powershell
# 1) 先合上游，再看一眼测试
git fetch origin
git merge origin/main
npm run typecheck

# 2) 把当前代码压成一个 sync 提交，推到 fork 的 main
pwsh -NoProfile -File E:\cs\aihot-notes\publish-public.ps1
```

- 每次发布是一个普通提交（`sync: 2026-11-07 22:10`），diff 就是这次改了什么，不需要 force push；
- **不要** `git push fork upgrade-4.0`：本地分支带完整历史，推上去等于把内部记录也公开了；
- 要提 PR 给上游时，从 `main` 拉分支即可，这个 fork 和上游是同一条历史线。
## 代码位置

```
modules/x-profile/
  module.ts            路由与接口路径声明
  server.ts            /api/site/x-people/*、/feed/x/:handle.xml、/api/admin/x-people/*
  web.tsx              侧栏、手机底栏、后台入口
  web/*.tsx            六个页面
  backend/*.ts         聚合查询、涨粉榜、周报、收录申请、今天发什么、算法回测
  migrations/*.sql     快照、账号标注、收录申请
  scripts/*.ts         一次性脚本（回填、标注、加账号）
```

## 上游

框架是 MIT；这个分支的改动同样开源。上游的更新按 `upgrade-4.0` 分支定期合并，站点自己的扩展（`adminPages`、`ServerModule.admin`、`WebModule.admin`）在合并时保留，写在这里以免以后忘掉。
