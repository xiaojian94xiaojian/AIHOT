# 交接说明（截至 2026 年 10 月 7 日）

这份文档描述**当前状态**。升级到上游 4.0.0 的过程记录不再需要（`git log` 里都有），
本文件只写：现在是什么样、哪些事已做完并验证过、哪些坑已经踩过、下一步能做什么。

---

## 一、分支与线上状态

```
分支 upgrade-4.0：领先上游 origin/main 21 个提交，落后 0
远端：已推 fork（xiaojian94xiaojian/AIHOT），本地与远端一致
线上：https://hot.jian.ing 正在跑，健康
```

最近几个提交（都在这个分支上，已部署）：

| 提交 | 内容 |
|---|---|
| `8f04804` | 撤掉 WebKit 视图过渡的规避（见「教训」一节） |
| `5ce2532` | 修 iPhone 白屏（同上，其生产改动已撤销） |
| `7ed6576` | 出站协议测试缺 `openssl` 时跳过而不是失败 |
| `76c351d` | 登录页守卫的测试改名为 `*.standalone.test.ts` |
| `5343cda` | 评分预算补回 32768；无正文条目不评分 |
| `f7b343a` | 预筛收紧判据 |
| `ac96c18` | 抓取守卫 + 下线 133 条登录墙文章 |
| `cb63e99` | 合并上游（含 #119 的注释修正与 sendFile 文档） |

### 相对上游改了什么

**框架侧（`packages/`、`apps/`）一共 5 个文件**，逐一列清，避免下次误判：

| 文件 | 改动 | 性质 |
|---|---|---|
| `apps/web/app/app.css` | +36 行 | 恢复 4.0.0 删掉的 `cal-*` 变量与动画（模块要用） |
| `apps/web/tests/navigation-performance.test.ts` | +6 行 | 给那条用例的 WebKit 上下文摘掉 `startViewTransition`（见「教训 1」） |
| `tests/analyze.test.ts` | 改断言 | 「无正文条目不评分」后 `BARE` 的预期：`score` 由 `FLOOR-3` 改为 `null`，调用序列去掉两次 `score` |
| `tests/outbound-protocol.standalone.test.ts` | +17/-4 | 缺 `openssl` 时跳过那 4 条并写明原因 |
| `tests/sign-in-page.standalone.test.ts` | 新增 | 抓取守卫的单元测试 |

其余框架文件不是「改」，而是**新增**引擎插口或共享代码（上游没有这些文件）：
`packages/backend/src/lib/http.ts`（各响应助手）、`packages/backend/src/admin/auth.ts`
（`adminHandler` 移进来）、以及三处插口字段/小改动：
`packages/backend/src/modules.ts`（+`Scheduled.runOnStart`）、`apps/worker/src/schedules.ts`（用上它）、
`packages/backend/src/editorial/analyze.ts`（评分预算 + 无正文不评分）、
`packages/backend/src/content/extract.ts`（登录页守卫）、
`packages/backend/src/providers/llm.ts`（网关的会话头适配）、
`apps/api/src/http/respond.ts` 与 `apps/api/src/routes/admin-auth.ts`（改为 re-export）。

`modules/`、`site/`、`industry/`、`database/` 里的差异是这个站自己的定制（三个模块、
站点身份、提示词、迁移），不是对框架的修改。

### 已完成的本次工作（都有生产数据或实跑验证）

1. **预筛收紧**（`industry/prompts/prefilter.md`）：原判据里「正文中的具体AI功能或使用事实已足够」
   被模型当成通行证。用标注的 63 条对比四版提示词，定稿版把误放行从 9 降到 2，
   准确率 85.7% → 95.2%（同模型 `deepseek-flash`，只换提示词）。已上线。
2. **抓取守卫**（`packages/backend/src/content/extract.ts` 的 `isSignInRedirect`）：请求地址与
   最终地址比对，路径落在登录/注册/授权/OAuth/SSO 就拒绝。**这是防御性加固，不是修框架洞** ——
   触发它的是某个源自己的取法（见「教训」）。已上线。
3. **下线 133 条登录墙文章**：用后台的 `setVisibility(id, {visibility:"withdrawn"})`（不是 DELETE），
   保留历史与审计、可恢复。理由写在 `editorial_overrides.reason`。
4. **评分预算**（`packages/backend/src/editorial/analyze.ts` 的 `SCORE_CALL`）：
   `deepseek-v4.1-flash-scorer` 以前落到默认 1024（+4000 推理额度 = 5024），而
   completion 恰好 5024 的有 103 次、邻近值只有 4–6 次 —— 是硬顶。实测：32768 下失败率 0.14%、
   5024 下 1.0%。已补成 `temperature 1, maxTokens 32768, timeoutMs 300000`。
5. **无正文条目不评分**：`missingEvidence(a)` 为真时跳过两次付费评分（7 天省 4169 次调用，
   这类条目均分 15.4、入选 0）。`relevance` 的判定没变 —— 没有中文标题摘要的本来就不公开。
6. **出站协议测试**：夹具证书必须真证书（Node 签不了），缺 `openssl` 时连同原因跳过那 4 条。
7. **登录页守卫的测试**改成 `*.standalone.test.ts`（纯函数测试，不该占用数据库）。

---

## 二、下一步可以做的（按价值排序）

### A. 给上游提 issue：两条真正的框架层问题（未做）

只用这两条，**不要**夹带预筛提示词和登录页守卫：

1. **`analyze.ts`：没有正文的条目仍然花两次付费评分。** 预筛把 BLOCK 降级成 UNKNOWN 放行
   （原有设计，保留）后，无正文条目照样走评分。生产数据：7 天 1028 条、均分 15.4、入选 0 条，
   却花掉 4169 次评分调用。改法：`missingEvidence(a)` 为真时不评分。
2. **`publication/rules.ts` 的 `isPoolEligible` 不检查标题是否有意义。** 它只要求
   `!!title && (!!summary || originalPost)`，于是标题是 `"220"` 的条目照样进公开池
   （生产里 77 条进了，均分 1.7、入选 0）。改法方向：拒绝退化的标题（纯数字/纯符号）。

两条都有生产数据、改法小、与站点配置无关。**这个分支上已经有可用实现**（见上面 1、5），
可以直接引用或作为参考。

### B. 未查清的一条（可提可不提）

同一篇文章被重复分析：7 天 15456 篇文章产生 16792 次分析（多 1336 次），
重复回执 6043/67074（9%），单篇最高 12 次。**没有查出触发条件**，只能给现象。

### C. 杂项

- 服务器上 `industry/`、`database/`、`scripts/` 是**挂载**的（`site/` 与 `packages/` 不挂载，
  走镜像）。改挂载目录里的文件要重启对应容器；改 `packages/`、`site/`、`modules/` 必须重建镜像。
- 服务器上还留着 24 个旧运维脚本（`apply-*.ts`、`probe-*.ts` 等），不属于这个仓库，不影响运行。
- 备份仍在 `/home/weijianlin/backups/dropped-tables-20261004T155523Z.sql.gz`
  （md5 `6601d0b51d82e82a66f5dbc6756a5040`）。**建议拷回本机一份**，并改名避开 `ls -t` 误选。
- 告警里长期有一条「数据库备份超过一天没成功」—— 与「我文档里的错」那节有关。

---

## 三、教训（下次别再踩）

### 1. Playwright 的 WebKit ≠ Safari

**本机是 Windows**（`10.0.19045`），装的是 Playwright 为 Windows 构建的 WebKit
（`webkit-2311`，自报版本 26.5，UA 硬编码成 macOS Safari，所以日志看着像 Safari）。

- 真 iPhone Safari：**不崩**（真机实测过）
- 上游 Linux CI 的同一构建号：**通过**
- 本机 Windows 的这份构建：**崩**

我在这个问题上错过两次：先把 Windows 构建的行为当成 Safari 的，报了「iPhone 读者点开任何文章
都会白屏」这个假事故；又在生产代码里加了个不必要的规避，最后撤回。

**规则**：凡是要下「真实用户受影响」的结论，先说清证据来自哪个环境、缺哪一环。
判 WebKit 行为的唯一可靠办法是**真机**（或至少 macOS / 真 Safari），不能靠 Playwright。

### 2. 真机上验证的办法（没有 Mac 也能做）

iPhone 上用**书签**注入代码，不需要电脑、不需要扩展：存一个书签 → 编辑地址 → 粘贴这行：

```
javascript:(()=>{const b=typeof document.startViewTransition;const r=delete document.startViewTransition;alert('删除前='+b+'\n删除返回='+r+'\n现在='+typeof document.startViewTransition)})()
```

坑：**书签不要改 DOM**。我第一版会插入一个面板，而插入 DOM 会触发 React 提交 →
`useLayoutEffect` 再跑 → 刚删掉的东西被重新施加，测了个假结果。`alert` 不改 DOM，才可靠。

### 3. 网页与 api 是两个进程，谁收请求由 `apiPaths` 决定

给 api 加了路由却 404，是因为地址没被认领：引擎只把 `ENGINE_API_PATHS` 和模块 `module.ts` 的
`apiPaths` 里声明的地址转发给 api，其余交给网页进程。模型榜的图标踩过
（只加了 `staticAssets` 没加 `apiPaths` → 404）。**声明了才算数。**

### 4. 起本地站点验证时，重建后要重启服务

React Router 的服务端在**启动时**缓存构建清单。重建产物但不重启，页面仍在引用旧的 js，
于是「修复没生效」。我在这上面白查了一轮。

### 5. 源取法的问题不要当成框架缺陷

那 133 条登录墙文章的根因是**某个源当时的取法**（`identity_key` 是
`url:https://huggingface.co/login?next=...`，而现配置的 `urlTemplate` 拼的是 `arxiv.org` ——
模板永远产不出那个地址）。全站只有 4 个源出现过登录类 URL（一个 133 条，另外三个各 1 条），
不是普遍现象。抓取守卫拦的是这类配置问题的**后果**。

### 6. 我文档里的错（已在本版更正）

- 旧版写过「`scripts/backup-dropped-tables.sh` 已有、`scripts/save-rollback-tag.sh` 应在服务器上」
  —— **这两个脚本在这个仓库里不存在**，只出现在 `DEPLOY-NOTES.md`（运维笔记）里。
  上游的 `docs/deploy.md` 是干净的。
- 旧版写过「模块的网页代码放模块根目录」—— **是反的**，只能放 `modules/*/web/` 或
  `modules/*/web.tsx`（`apps/web/tsconfig.json` 的 include 只有这两处，
  `modules/tsconfig.json` 只管后端）。实测方式：在 `modules/leaderboard/` 放四个探针，
  只有 `web/` 子目录里的两个被 typecheck 读到。

---

## 四、环境与常用命令

### 本机

```bash
npm run typecheck                 # 类型检查
npm run test:standalone           # 无需数据库的测试（缺 openssl 那 4 条会 skip）
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts   # web 测试
DATABASE_URL=postgres://aihot:aihot@127.0.0.1:55432/aihot_ci npm test  # 后端与模块测试
```

- 测试库：docker 容器 `aihot-testdb`，端口 55432，库 `aihot_ci`（干净）与 `aihot_test`（真实数据）。
  库名必须以 `_test` 或 `_ci` 结尾。
- `Docker Desktop` 与 `aihot-testdb` 关机后不自启，先 `docker start aihot-testdb`。
- 本机缺 `pg_dump`、`sh`、`openssl`，所以备份类测试与出站协议测试在本机会跳过或失败 ——
  那是环境，不是代码。

### 部署

```bash
# 改挂载目录（industry/ database/ scripts/）：同步文件后重启对应容器即可
# 改 packages/ site/ modules/：必须重建镜像
docker build --platform linux/amd64 -t asia-east2-docker.pkg.dev/project-79671177-5fb1-4881-a7c/aihot/app:latest .
docker push asia-east2-docker.pkg.dev/project-79671177-5fb1-4881-a7c/aihot/app:latest
gcloud compute ssh weijianlin@aihot --zone=asia-east2-c --command="bash /home/weijianlin/redeploy.sh"
```

`~/redeploy.sh` 会先刷新 Artifact Registry 凭据（短期 token，会过期）再拉取重建。

**顺序的坑**：`database/` 是挂载的，**迁移文件不能早于新镜像同步**，
否则回滚（旧镜像 + 新迁移）会挂。另外改 `industry/` 后要跑一次 `setup` 或重启相应容器才进库。

### 上游动态

上游引擎与这个仓库会同步（他们的提交里有 `Engine-Commit:` 一行），所以框架层的修法在引擎仓库里，
这个仓库只是同步目标 —— 提 issue 时这一点要说清。上游已合并的 #119 里，有两处是我们
（#117、#118）发现的问题，注释与文档里署了名。
