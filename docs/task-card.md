# 任务卡模板

复制下面整块，填完再动手。验收标准是**开发与审核共用的唯一标准**——reviewer 不能临场加标准，worker 也不能少做。

```
任务ID：T-YYYYMMDD-<短名>
标题：
背景与目标：（一段话，写清读者/用户看到的变化）
风险等级：低 / 中 / 高（高 = 需人工检查点：迁移、权限、支付、删除类）

允许修改：
  - modules/x-profile/web/**
  - 其它要动的地方逐条列出
禁止修改：
  - modules/x-profile/types.ts 的字段名
  - backend / migrations / packages（除任务卡明确的文件）
依赖任务：无 / T-xxx（没有它就别开始）

验收标准（每条都要能执行）：
  1. [功能] ……
     验证：`npm run typecheck` + 具体测试名，或一条可复现的手工步骤
  2. [数据] ……
     验证：在测试库跑这条 SQL，期望结果为 ……
  3. [界面] ……
     验证：1280px / 393px 截图各一张；393px 下 document.scrollWidth 等于 clientWidth
  4. [不回归] 改动前后这条命令输出一致：……

设计约束：
  - 圆角只用 rounded-control/-tile/-card/-panel/-sheet/-full/-mark
  - 颜色只用 app.css 的 token；时间只用 @aihot/contracts/time；剪贴板只用 copyText
  - 不新增依赖；不整文件重排；不改数据口径

预计规模：约 N 行 / N 个文件（超过 500 行先拆）
```

## 好的验收标准 vs 坏的

| 坏 | 好 |
|---|---|
| 代码质量良好 | `npm run typecheck` 与 `node --test tests/architecture.test.ts` 通过 |
| 手机端体验好 | 393px 截图无横向滚动；按钮点按区 ≥ 32px |
| 「我的名次」要正确 | 造 3 条数据：1 条无资格、2 条有资格，我的账号显示第 2 名，不是第 3 |
| 数据要准 | 测试库执行 `SELECT days FROM …`，同一天 5 条帖结果为 1 |
| 不要破坏现有功能 | 基线命令 `curl … | jq .me.posts` 输出 >0 |

## 常见任务的附加检查

**UI / 前端**

- 1280px、393px 截图；深色模式各一张；
- `document.documentElement.scrollWidth === clientWidth`（393px）；
- 交互清单逐条保留（按钮、入口、链接目标），写进任务卡的「必须保留」；
- 无 `rounded`、`text-white`、`Asia/Shanghai`、`any`。

**数据 / 后端**

- 关键 SQL 在真实测试库跑一次，贴出改动前后结果；
- 时区相关：用北京时间 23:30 与次日 00:30 两条数据验证；
- 空数据、null、0 分母各一个用例。

**安全 / 接口**

- 输入校验（长度、字符集、URL 白名单）；
- 限流与幂等各一条测试；
- 失败路径：上游 500、超时、非 JSON 响应。

**迁移**

- 一个文件一条语句；索引 `CONCURRENTLY IF NOT EXISTS`；
- 加列可空、无 `DEFAULT now()`；破坏性变更写明回滚方式；
- 编号与主支对一遍。

## 交付说明（worker 写）

```
任务ID / 轮次：
改动概述：
对应验收标准：
  - 标准1：怎么满足 → 文件:行 → 验证结果（命令输出 / 截图名）
  - 标准2：……
返工（按 issue 编号）：
  - ISSUE-01：文件:行 / commit → 修复思路 → 验证结果
有异议的意见及理由：
已知限制：
```

## 审核报告（reviewer 写）

```
任务ID / 审核轮次 / 审核 commit：
结论：通过 / 不通过 / 需升级
验收标准逐条：
  - 标准1：满足 / 不满足 — 证据
问题清单：
  ISSUE-01 | blocker | 文件:行 | 描述 | 期望结果 | 验证方式
  ISSUE-02 | major   | ……
复审（上轮 issue）：
  ISSUE-01 | 已修复 | 证据
  ISSUE-02 | 未修复 | 当前 HEAD 的文件:行
待办（major/minor）：
```

## 判定口径

- **blocker**：不满足任务卡验收标准，或功能错、数据损坏、安全问题、挂现有测试；
- **major**：明显的设计/可维护性问题，不阻止合并；
- **minor**：风格、命名、优化建议；
- 任务卡本身有歧义 → reviewer 判「需升级」，由人补标准，不要自己发明。
