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

每个任务**做完、部署之前**，先让一个独立的审查 agent 看这次改动，审完再上线：

1. 审查范围：`git diff <上一个已部署提交>..HEAD`，加上它碰到的现有代码；
2. 必查项：正确性；安全（SSRF、注入、密钥、限流、token 泄露）；迁移规则（一个文件一条语句、索引 `CONCURRENTLY IF NOT EXISTS`）；时区与日期计算；外部调用失败与重试；测试是否覆盖边界；有没有死代码；
3. 结论是 **FAIL 就返工**——改完重跑 `npm run typecheck` 和全量测试，再复审一次；
4. **PASS 才部署**；部署完把快照推到公开仓库。
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
