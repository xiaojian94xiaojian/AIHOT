# 交接说明（截至 2026 年 10 月 7 日）

这份文档描述**当前状态**。升级到上游 4.0.0 的过程记录不再需要（`git log` 里都有），
本文件只写：现在是什么样、哪些事已做完并验证过、哪些坑已经踩过、下一步能做什么。

---

## 一、分支与线上状态

```
分支 upgrade-4.0：领先上游 origin/main 24 个提交，落后 0
远端：已推 fork（xiaojian94xiaojian/AIHOT），本地与远端一致
线上：https://hot.jian.ing 正在跑，健康（**但还没部署这次合并**；线上镜像仍是 10-07 13:55 UTC 那个）

（2026-10-08：已合并上游 7 个提交，其中 #153 修的就是本文档发现的那条框架问题 —— 见「下一步」与
「上游动态」。他们的实现已进入本分支，我们原来那处改动（只跳过两次评分）交还给上游；
`tests/analyze.test.ts` 的冲突按上游版本解决。框架侧剩下的差异见下一节。）
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

**框架侧（`packages/`、`apps/`）一共 4 个文件**，逐一列清，避免下次误判：

| 文件 | 改动 | 性质 |
|---|---|---|
| `apps/web/app/app.css` | +36 行 | 恢复 4.0.0 删掉的 `cal-*` 变量与动画（模块要用） |
| `apps/web/tests/navigation-performance.test.ts` | +6 行 | 给那条用例的 WebKit 上下文摘掉 `startViewTransition`（见「教训 1」） |
| `tests/outbound-protocol.standalone.test.ts` | +17/-4 | 缺 `openssl` 时跳过那 4 条并写明原因 |
| `tests/sign-in-page.standalone.test.ts` | 新增 | 抓取守卫的单元测试 |

（`tests/analyze.test.ts` 原来也在这个表里 —— 改 `BARE` 的断言。上游 #153 用同一处断言自己实现了
这条，合并时已按上游版本解决，不再算我们的改动。）

其余框架文件不是「改」，而是**新增**引擎插口或共享代码（上游没有这些文件）：
`packages/backend/src/lib/http.ts`（各响应助手）、`packages/backend/src/admin/auth.ts`
（`adminHandler` 移进来）、以及三处插口字段/小改动：
`packages/backend/src/modules.ts`（+`Scheduled.runOnStart`）、`apps/worker/src/schedules.ts`（用上它）、
`packages/backend/src/editorial/analyze.ts`（已只剩评分预算 32 768 这一处 —— 「无正文不评分」
由上游 #153 实现并已并入）、
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
5. **无正文条目不评分**：`missingEvidence(a)` 为真时跳过两次付费评分。**旧版这段写的数字是错的，
   已按生产库更正**：4169 是那批条目的**全部**付费调用（评分是每条 2 次，见 `SCORE_CALLS`），
   不是评分调用；「均分 15.4、入选 0」也不成立。改动前 6 天（10-01 00:00 → 10-07 00:00 UTC）
   实测：11 620 条里 377 条只有标题的条目花了 731 次评分调用（另有 45 次理解写作、7 次摘要写作），
   其中 **29 条凭标题写出的摘要被选中**、均分 73.5，23 条的摘要里模型自己写着正文没取到。
   这条已提上游（#152），上游当天在 #153 用更窄的判据自行修好并署名，**并在本次合并里进入本分支** ——
   所以现在线上跑的是我们的版本（只跳过两次评分），仓库里是他们的版本（预筛之后直接停下，
   评分、结构抽取、写作都不启动），下次部署会把两者统一。
6. **出站协议测试**：夹具证书必须真证书（Node 签不了），缺 `openssl` 时连同原因跳过那 4 条。
7. **登录页守卫的测试**改成 `*.standalone.test.ts`（纯函数测试，不该占用数据库）。

---

## 二、下一步可以做的（按价值排序）

### A. 给上游提 issue（已做：第一条被上游修好，第二条不提）

**第一条已提，上游当天修好。** 2026-10-07 用 `xiaojian94xiaojian` 提了
[AIHOT#152](https://github.com/KKKKhazix/AIHOT/issues/152)：只有标题、没有正文的条目仍会走两次评分，
分数够高就凭标题写出摘要并入选（论点按生产库实测写成：377 条、731 次评分调用、29 条入选、均分 73.5）。
维护者用已有真实响应离线重放确认了这条链，采纳了较窄的判据 —— 没有材料**且**没有可展示原帖才停下 ——
并且连结构抽取和写作一起跳过，在 [#153](https://github.com/KKKKhazix/AIHOT/pull/153) 合并，
把仓库作者记为共同作者。**本分支的实现（只跳过两次评分、没有原帖判据）在合并上游后按他们的版本走。**

**第二条不提，原因记在这里，免得下次再翻出来。** 原先准备的「`isPoolEligible` 不检查标题是否有意义
（标题是 `220` 的条目进公开池，77 条，均分 1.7）」经生产数据复核站不住：那批 `220` 就是 `web-arxiv`
收进来的 133 条登录页文章（见「教训 5」），它们的公开条目现在都是 `withdrawn`（现存 158 条 withdrawn
里 52 条是纯数字标题，全来自这个源）。当前公开池 12 468 条里，纯数字标题 0 条、不含字母数字 0 条、
URL 标题 0 条；剩下 4 条纯数字的公开条目（X 的 `2003`、`web-preferred` 的分页页 `2`/`3`/`22`）本来就
`eligible = false`，不在池里。也就是说这是源配置的后果，正是「教训 5」那一类，不该当成框架缺陷。
#152 末尾把它作为线索附了一句，没有单独占一条 issue。

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

2026-10-08 又多一例：合并上游 #151 后，`apps/web/tests/native-video.test.ts` 里 WebKit 那条
（原生视频播放）在本机 30 秒超时失败，同一用例的 Chromium 那条通过 —— 同一份代码、同一次运行，
差别只在引擎。别把它当回归。

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
- `Docker Desktop` 与 `aihot-testdb` 关机后不自启，先 `docker start aihot-testdb`。Docker Desktop
  也要等它起来：刚启动时 Postgres 还在恢复，这时跑测试会在建库阶段撞上
  `57P03 the database system is starting up`，等 `pg_isready` 说 accepting connections 再跑。
- **全量 `npm test` 在本机会随机有整文件失败**：`PostgresError: database "aihot_ci_f<pid>_ci" already
  exists`（`42P04`）。每个测试文件的库副本按进程号命名（`tests/databases.ts` 的
  `${name}_f${process.pid}_${suffix}`），而 Windows 会很快复用进程号，于是后一个文件撞上前一个留下的
  副本，表现是那个文件在 ~250ms 内失败（单跑同一个文件却通过）。这是夹具的问题，不是代码 ——
  分批跑（每组十来个文件，每组开头会清掉上一组留下的副本）或重跑即可。2026-10-08 合并上游后文件更多，
  撞上的概率更高；上游 CI 是 Linux，没这个现象。
- 本机缺 `pg_dump`、`sh`、`openssl`，所以备份类测试与出站协议测试在本机会跳过或失败 ——
  那是环境，不是代码。
- **依赖子进程 + SIGTERM 的关停测试在本机会挂到超时**（`tests/analyze-shutdown.test.ts`、
  `tests/translate-shutdown.test.ts` 等 5 条）：这些用例 `spawn` 一个 worker 子进程，再给它发 SIGTERM，
  等子进程回一条 `{stopping:true}`。Windows 上发给子进程的 SIGTERM 不会触发它的
  `process.on('SIGTERM')`（实测：子进程只回了 `{ready:true}`，处理器始终没跑），于是父进程一直等。
  和代码无关，上游 Linux CI 正常；合并上游时不要拿这几条当回归判据。

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

2026-10-07 提的 #152（无正文条目仍评分并凭标题入选）当天被修好：上游在
[#153](https://github.com/KKKKhazix/AIHOT/pull/153) `fix: wait for article evidence before scoring and
writing` 里实现并合并，把仓库作者记为共同作者。他们的版本与我们的略有出入：判据更窄（没有材料
**且**没有可展示原帖才停，可展示的空文字、纯链接 X 原帖继续原有评分与原样展示），而且连结构抽取与
写作一起跳过 —— 我们只跳过了两次评分，结构抽取照跑。**这次合并已经把他们的版本并进来**，
本分支不再自己持有这处改动。
