# 安全审查报告（雷达站 / hot.jian.ing）

> 依据 `SECURITY-PLAN.md` 执行。本文件只写必要证据，漏洞细节按 `SECURITY.md` 的口径处理。
> 代码基线：本次在分支 `feat/kb-module`（`d589bff`）上审查；工作树另有未跟踪的转储与导出文件（见 §5）。
> 生产验证**未执行**：本报告不含任何对生产环境的请求。

## 1. 范围与方法

- **静态审查**：按 `SECURITY-PLAN.md` §3 的入口逐个读鉴权、校验、限额，再跟数据流到 DB / 文件 / 外部请求 / 渲染。
- **动态验证（只在本机）**：直接用 Node 24 运行仓库源码中的纯函数与真实路由，构造 payload 观察输出；
  不连外部服务、不调用模型、不起站点、不写库。
- **浏览器验证**：用本机 Playwright 的 Chromium 与 Firefox 打开清洗后的正文，确认是否真的执行脚本（§3.1 的关键证据）。
- **子代理分工**：SSRF（§4.7）、提示注入（§4.8）、知识库模块（§10）三块由独立子代理审查，
  其结论凡进入本报告的都经我复核（复核方式在条目内注明）。
- 严重度沿用 `SECURITY-PLAN.md` §7：**S1** 拿下会话/密钥/改内容；**S2** 存储型 XSS、越权、SSRF 到内网、
  成本可被持续滥用；**S3** 信息泄露、配置缺失、限流不足；**S4** 加固建议。

### 需要先纠正的两处方案事实（会影响后续审查）

1. **§4 的文件路径有一半不存在**：仓库里没有 `packages/backend/src/content/url.ts` 或 `content/http-fetch.ts`。
   SSRF 闸在 `packages/backend/src/lib/url.ts` 与 `lib/http-fetch.ts`。
   按方案给的路径 grep 会**静默通过**（看起来"没有这个文件"而不是"没有这个漏洞"）。
2. **§2/§3 若干说法与代码不符**：`content:encoded` 走 CDATA 且转义 `]]>`；公开面没有 SQL 拼接；
   OG 分享图**不做任何外部取图请求**（satori + 本地字体 + 内存数据），方案里的"OG 取图"不是一个取内容路径。

## 2. 发现清单

### [S3] 清洗器的惰性属性绕过：`data:` 文档地址进入 `<img src>` —— 方案预期的 S2 存储型 XSS 不成立

- **位置**：`packages/backend/src/content/sanitize.ts:74-101`（transformTags）→ 渲染 `apps/web/app/features/item/ArticleBody.tsx:152`、
  `apps/web/app/features/copy/CopyPage.tsx:71`
- **根因**（读 sanitize-html 源码确认，`node_modules/sanitize-html/index.js:256-284` 与 `:384-390`）：
  1. `transformTags` 在**任何**属性检查**之前**执行；
  2. 方案里的 scheme 闸 `naughtyHref` 随后遍历的是 `frame.attribs` —— 一个在 transform 之前就快照好的模块级变量，
     transform 里 `{ ...attribs, src: 新值 }` 产生的是新对象，`frame.attribs` 虽被重新赋值，但被遍历的仍是旧对象。
  **结论：transform 最终写入的地址从不经过 scheme 白名单**。`data-src` / `data-original` / `data-poster`
  的值（它们本身只被当作未知属性丢弃，不受 `allowedSchemesAppliedToAttributes` 约束）就这样落进 `src` / `poster`。
- **复现**（本机跑真实 `sanitizeBody`）：
  ```
  输入 <p><img data-src="data:text/html,<script>alert(1)</script>" src="https://x/a.png"></p>
  输出 <p><img src="data:text/html,<script>alert(1)</script>"></p>
  ```
  `data-original` 同理；`data:video/mp4` 进 `<source src>` 同理。**二次清洗不会修好它**（幂等）。
- **浏览器验证（关键，推翻了 S2 判断）**：把上面这段存储态 HTML 放进真实文档，用 Chromium 与 Firefox 打开：
  `window.__xss` 恒为 `undefined`、无 `pageerror`。`data:` 在 `<img>` 上下文按图片处理，`text/html` 不被当作文档渲染；
  `image/svg+xml` 会渲染（naturalWidth=300）但**不执行脚本**。故方案 §4.1 预期的"存储型 XSS"**不成立**。
- **真实影响**（这才定级 S3 的依据）：
  1. 清洗器**宣称的白名单不再是它输出的性质** —— 一个安全边界性质的回归，且二次清洗修不回来，任何"再洗一遍就安全"的假设都失效；
  2. 正文里的任意 `data:` 文档**原样进入每个读者**、进入全量 RSS、`/api/v1`、Agent Markdown、Markdown 导出
     （`bodyToMarkdown` 实测输出 `![](data:text/html,...)`）与 `publications.search_text`；
  3. `data:` 没有长度上限，`POST /api/ingest/items` 也不接受正文（`ingest/items.ts:19-25` 只收 title/url/author/publishedAt/raw），
     但**采集路径**的正文没有大小闸：一条大 `data:` 正文会长期占库并放大每个出口的带宽。
- **修复（已实现）**：新增 `ADDRESS_ATTRIBUTES` 策略表 + `dropUnallowedAddresses()`，在 `sanitizeHtml` **之后**按标签校验
  每个地址属性的最终值（`http`/`https`；`img` 额外只允许 `data:image/...`，因为"内联图片"才是这个例外要表达的东西），
  并让失去地址的 `<img>` 一并移除以保证幂等。测试：`tests/sanitize-body.standalone.test.ts`（先失败后通过）。
- **状态**：已修（本工作树未提交），本机 `typecheck` 通过、25 个 standalone 测试通过，容器全套见 §6。

### [S3] 全站没有安全响应头（CSP / HSTS / 框架限制 / Referrer-Policy）—— 静态四项已修，CSP 待验证

- **位置**：`deploy/Caddyfile:1-6` 只有 `encode` + `reverse_proxy`；`site/site.ts:100` 的 `POLICY.terms.headers` 默认 `null`；
  `apps/web/server.ts:68-73` 只给**静态资源**加了 `X-Content-Type-Options`（HTML 页面没有）。
- **唯一的例外**是图片代理自己：`apps/api/src/routes/media.ts:48-49` 设了 `nosniff` 和
  `default-src 'none'; style-src 'unsafe-inline'; sandbox` —— 说明仓库里已有正确写法，只是没有推广到页面。
- **影响**：站点把第三方正文用 `dangerouslySetInnerHTML` 注入每个读者的浏览器。一旦清洗器或某个渲染路径出错，
  没有 CSP 作为第二道闸；同时缺 HSTS、`X-Frame-Options`/`frame-ancestors`（点击劫持）、`Referrer-Policy`（后台地址与令牌进 Referer）。
- **建议**：在 `deploy/Caddyfile` 的站点块里加 `header`（HSTS、`X-Content-Type-Options`、`Referrer-Policy: strict-origin-when-cross-origin`、
  `X-Frame-Options: DENY`）。这四个不依赖任何站点代码，可以先落地，风险很低。
- **CSP 的起点（10-10 晚已按要求数完真实 HTML，结论：hash 不可行，只剩 nonce）**：
  - 客户端构建产物 `apps/web/build/client/assets` 里确实没有内联 `<script>`；内联脚本**全部来自服务端渲染**。
  - 本机构建产物实测（`WEB_PORT` + 桩 api 起 `apps/web/server.ts` 抓真实 HTML）：`/`、`/all` 各 **6 段内联脚本**：
    主题脚本（常量）、历史状态恢复（常量）、`window.__reactRouterContext`（常量）、路由模块 `import` 脚本
    （**按路由变**）、loader 数据流 `streamController.enqueue(...)`（**每请求变**）、`close()`（常量）。
  - 生产站实测：`/` 有 **10 个 script 标签，全部内联**（外加 JSON-LD、`id="_R_"` 的 React 流式占位、`$RC(...)`），
    最大一段 **41KB** 就是 loader 数据流；连抓 3 次 `/`、`/all`、一个条目页，**3 次得到 3 种不同的脚本集合**。
    → 固定 hash 在原理上不可能（只会把整站脚本全部挡掉）；nonce 是唯一可行写法。
  - **nonce 与既有缓存策略互斥**（这是需要站主决定的取舍）：页面声明 `max-age`（首页 60 秒、条目页 600 秒，
    浏览器上限 300 秒，`lib/api.server.ts:66`）。浏览器若复用缓存里的 HTML，而响应头带的是**新** nonce，
    内联脚本会被 CSP 挡掉、页面不再 hydrate。因此 nonce 方案必须同时让 HTML 不可复用（`no-cache`/`no-store`）；
    这条改动会让重复访问重新下载 HTML（首页约 215KB，含 41KB 数据）。
  - 其余指令风险已核清：站内资源全部同源（图片走 `/api/img-proxy`，字体是系统字体、无外链），
    唯一的第三方地址是正文里**未代理**的 `<video src>`（`media/imgproxy.ts:72-95` 只代理 `poster`）
    → `media-src` 必须放行第三方 https，否则正文视频会消失。
  - **落地位置的一处坑（本次用 caddy:2-alpine 实测发现）**：不要在 Caddyfile 里用 `header >Content-Security-Policy`
    （`defer` 会在上游写头**之后**覆盖）。实测这样会把**图片代理自己那条 `default-src 'none'; style-src 'unsafe-inline'; sandbox`
    顶掉**，等于为了页面的 CSP 弄丢图片路由最严的那条。改成：Caddy 用 `request_header X-CSP-Nonce "{http.request.uuid}"`
    生成每请求 nonce（实测每次不同、上游能收到），页面 CSP 由应用写（`apps/web/server.ts` 的 `pageResponse` 本来就是
    "页面响应头唯一写者"，`sendFile`/图片路由各自写的头不受影响，实测透传正常）。
- **修复（已实现）**：`deploy/Caddyfile` 增加 HSTS（2 年、含子域、preload）、`X-Frame-Options: DENY`、
  `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`。
  放在 Caddy 而不是应用里，是因为 Caddy 是唯一公网入口，一处覆盖页面、feed、JSON API 与图片代理；
  没有设置 CSP，所以图片代理自己那条 `default-src 'none'; … sandbox` 不会被覆盖。
  验证：用 `caddy:2-alpine` 跑 `caddy validate` 通过，并 `caddy adapt` 确认五个 `headers` 处理器都在
  `reverse_proxy` 之前生效（见 §6）；10-09 晚已同步到服务器并 `caddy reload`，生产实测五个头在线。
- **状态**：静态四项**已部署**（`f7c1f64`，10-09 晚随镜像上线，服务器侧实测五个头在线）；页面 CSP 的勘查已完成
  （结论与取舍见上），**等站主在 nonce（需让 HTML 不可缓存）与保留缓存之间选一个再落地**。

### [S3] 知识库模块经公开出口可匿名读取，且答案路径绕过唯一读取层（分支 `feat/kb-module`）

- **位置**：注册 `modules/kb/server.ts:134-203` → 挂载 `apps/api/src/routes/agent.ts:106-111`（`publicHandler`，无鉴权）
  → 同样三条以匿名 MCP 工具暴露 `apps/api/src/routes/mcp.ts:224-234`；答案直接读文件 `modules/kb/backend/read.ts:9-11`。
- **复核**：我自己读了上述三处注册/挂载代码，确认模块 `abilities` 确实经 `publicHandler`（引擎把 agent/MCP 出口定义为公开，
  `packages/backend/src/modules.ts:146-150`，`publication/agent.ts:274` 也公开承诺"匿名只读、不需要 API Key"）。
  子代理用真实 `buildApp` + `app.inject` 实测：`GET /api/v1/agent/kb` 200、`get_kb_recent` 200，而未登录
  `GET /api/modules/kb/notes` 401 —— 即**公开面与后台面确实分开了，但知识库落在了公开面**。
- **与意图冲突**：模块注释与 `KB-PLAN.md:23` 都写"知识库是站内与 agent 侧资产，不进公开出口"，而 `KB-PLAN.md:204` 又要求
  注册 `agent.abilities` —— 在这个引擎里 `agent.abilities` **就是**公开出口。这是需要决策的矛盾，不是纯技术缺陷。
- **附带问题**（子代理实测，我未逐条复跑）：
  1. 答案读文件不读 `publication/`，撤回的条目/报告仍可能被读到（`withdrawnReports` 是死代码、`sweepOrphans` 跳过条目卡）；
  2. 公开 MCP 的 `structuredContent` 直接回吐磁盘相对路径、文件 sha256、完整 frontmatter（含 `ai_access`）与整篇卡片正文；
  3. `search_kb` 忽略自己声明的 `limit`，每次调用最多读 500 个文件（实测 limit=10 仍 500 命中、约 630 ms，且无进程内缓存）。
- **路径穿越是安全的**：读写两侧都以索引为间接层，9 个恶意 id（`../`、`..%2f`、反斜杠、绝对路径、UNC、NUL）全部 404，
  合法 id 200；`modules/leaderboard/server.ts:156` 与 `modules/monitor/server.ts:124-130` 的静态参数也都有白名单。
  但 `noteFile`/`writeNote`/`sendFile` 自身没有 `startsWith(kbRoot())` 兜底（见 §4 建议）。
- **状态**：待决策（收口公开出口，或明确接受公开并先修 2、3 两条）。该分支尚未随镜像上线。

### [S3] 采集侧 SSRF 闸有一处名列表绕过：`blockedHostname` 未归一化结尾的点 —— 已修

- **位置**：`packages/backend/src/lib/url.ts:140-147`（`blockedHostname`）、`:159`（`assertPublicUrl` 调用点）、`:178`（`guardedLookup` 调用点）
- **根因**：WHATWG 解析器**保留**结尾的点（`new URL("http://localhost./").hostname === "localhost."`），
  于是 `host === "localhost"`、`endsWith(".localhost")`、`endsWith(".internal")` 全部为假，名列表被绕过。
- **复现（我用真实函数 + 桩解析器跑过）**：
  ```
  http://localhost/                     → rejected: Blocked host localhost
  http://localhost./                    → ACCEPTED（名检查被绕过）
  http://metadata.google.internal./     → ACCEPTED
  http://anything.internal./            → ACCEPTED
  ```
  桩解析器固定返回公网地址，所以这里的"ACCEPTED"只证明**名列表**被绕过。
- **第二层仍然有效**：`assertPublicUrl` 的地址检查与 `guardedLookup` 会拒绝私有/环回/元数据地址
  （`http://localhost./` 实际仍被拒；`127.0.0.1`、`::1`、`0.0.0.0`、`169.254.169.254`、`10.0.0.1`、`foo.internal` 全 EBLOCKED）。
  子代理本机实测 `anything.internal.` 被本机过滤型解析器解析成 `198.20.0.41`（不在 `isBlockedAddress` 范围内）并被放行。
- **可利用前提**：解析器把带点的名字解析到"不在封禁网段之内、但通往内网端点"的地址（分离解析/通配解析，或内网服务挂在公网段 IP 上）。
  这种部署是存在的，所以定 S3 而不是 S4；不是"当前就能打通内网"。
- **修复（已实现）**：`blockedHostname` 在比较前 `host.replace(/\.$/, "")`；两个调用点共用这一个函数，故一处修复覆盖 URL 检查与连接期检查。
  测试：`tests/url.standalone.test.ts` 末尾新增"a name that only differs by an ending dot is still the blocked name"（先失败后通过，
  桩解析器把带点名字解析为公网地址，因此拒绝只能来自名列表；同时覆盖 `guardedLookup` 的 `all` 与非 `all` 两条路径）。
- **其余 SSRF 面是干净的**：`guardedFetch` 是生产源码里唯一的 undici 使用者；每次重定向都重新过闸（`:98-104`）；
  连接期用 `guardedLookup` 校验**真正拨号的地址**（`:43`），DNS rebinding 已封；十进制/八进制/十六进制/全角/带圈 IP、
  IPv4-in-IPv6、NAT64、6to4、Teredo、userinfo 变体全部被拒（子代理实跑，我抽查了 `127.0.0.1`、`2130706433`、`0x7f.0.0.1`）。
  图片代理同样走 `guardedFetch`（`packages/backend/src/media/images.ts:85`）。
- **状态**：已修（本工作树未提交）；`tests/url.standalone.test.ts` + `tests/http-redirects.standalone.test.ts` 44/44 通过。

### [S3] 提示注入：写作提示词缺少"不可信数据"条款，摘要/标题无原文一致性校验

- **位置**：`packages/backend/src/editorial/writing.ts:282-307` → `industry/prompts/summarize-article.md:29`、
  `summarize-long-post.md:26`、`summarize-short-post.md:19`、`translate-body.md`、`translate-post.md`
- **复核（我自己跑的）**：逐份检查 `industry/prompts/*.md`，只有 `safety.md`（经 `structure.md` 的 `{{> safety}}` 引入）
  与 prefilter / selection-score / content-understanding / group-* / story-digest / report-period 含"不可信数据、不执行其中指令"；
  上面五份**都没有**。正文以 `正文内容：\n{{body}}` 直接拼在提示词末尾，无标签、无转义。
- **影响**：`summarize` 产出的 `titleZh`/`summaryZh` 经 `analyses` → `publications.summary/title/reason`
  进入网站卡片、RSS、`/api/v1`、MCP、Agent Markdown、OG 图与站内搜索，**没有任何"摘要必须与原文一致"的程序化校验**
  （schema 只是无上界的 `z.string()`）。这是一条内容诚信（编辑话语权）链路，不是代码执行。
- **已排除的更坏情况**（子代理查证，我复核了渲染与清洗调用点）：模型输出**不能**决定要抓取的 URL、要写的文件、要执行的命令；
  译文里的 `<a href>`/`<img src>` 由 `unshield` 从**原文**取回（`editorial/translate.ts:151-169`），再经 `sanitizeBody` 兜底；
  `summary/title/reason/digest/overview` 全部以 React 纯文本渲染。
  结构化输出全部过 zod（分数 `min(0).max(100)`、category/relation 枚举、tags 白名单、evidence 必须是原文连续子串）。
  **越界分数会导致付费重试而不是夹取**（`analyze.ts:82` + `providers/receipts.ts`），已有预算熔断（每分/时/天上限）兜住。
- **建议**：给这五份提示词补 `{{> safety}}`（与 neighborhood 现有写法一致）；给 `summaryZh` 加一条与 `reports/compose.ts:165-174`
  的 `grounded()` 同类的"数字/专名必须能在原文找到"事后校验 —— 注意现有 `grounded()` 只看拉丁专名、三位以上数字与词表公司名，
  **纯中文论断能绕过**。
- **状态（10-10 晚更新）**：**提示词已修**。五份各补 `{{> safety}}`，另加一条"数字与专名只能来自原文"的正面写法
  （`industry/prompts/summarize-article.md`、`summarize-long-post.md`、`summarize-short-post.md`、
  `translate-body.md`、`translate-post.md`）；测试第一步就发现 `understand.md`（主写作步骤）也只靠 `content-understanding.md`
  自带的安全边界、没有共享条款，一并补上。规则测试写在 `tests/architecture.test.ts`
  （"every prompt that carries collected material includes the safety clause"）：按这几个提示词族扫描，新族要显式加进清单，
  漏加即失败。版本哈希因此轮换（`summarize…@b9917be0c9` → `@e29a635c9d`、`translate…@738a6a83a9` → `@76235d1e61`），
  旧结果不会被当作同版本复用。
- **程序化一致性校验：量过之后没有上（结论与证据）**。在本地那份生产数据副本上（1500 条已发布且有正文的摘要）量了三种写法：
  | 规则 | 误伤率 | 主要误伤来源 |
  |---|---|---|
  | 直接复用 `grounded()`（数字+拉丁专名） | 11.4%（800 条中 91） | `state-of-the-art` 被译成 `SOTA`、`数十亿` 被写成 `数亿` |
  | 数字校验（含中文数词、排除"数十/几百"这类约数） | 14.1%（1500 条中 211） | `9 月` 与 `September`、`82 亿` 与 `8.2 billion`、单位换算、vision 从图里读出的数字 |
  | 加月份归一化 | 14.1%（未下降） | 上面几类之外，`一`/`1` 这类量词与单位换算仍会误伤 |
  也就是说**任何一条"数字必须在正文里能找到"的硬闸都会拒掉约 11–14% 的正常摘要**（现状是照发），
  代价高于它拦下的东西；`grounded()` 目前只用在报告概览（`reports/compose.ts:223`），不动它。
  真正拦住"编造数字"的是提示词那一条 + `mendWording` 已有的"数字不许变"约束（`analyze.ts:425-426`）。
  复查的数据与脚本没有进仓库（`.data/`），结论可复现：同一批 `publications` × 同一批 `articles.body_text`。
- **仍未做的**：五份提示词改动的**样本回放**（同一批真实订阅在改动前后各跑一次模型，比较摘要质量与数字保真度）。
  这需要真实模型调用，本机开发环境按规矩保持 `MODEL_CALLS_ENABLED` 关闭，因此这条证据边界如实标注：**改动未经真实模型回放**。

### [S5] 后台登录失败无任何记录（**已补**：进程日志，不写 audit_log）

- **位置**：`apps/api/src/routes/admin-auth.ts` 的密码表单路由与飞书回调；`packages/backend/src/admin/auth.ts`。
- **问题**：只有**成功**的登录写审计（`auth.ts:230`、`:249` 的 `auth.login`）。密码错误、飞书状态不符/不在白名单这些
  拒绝路径只把用户送回登录页（`error=wrong`），15 分钟窗口的计数（`admin-auth.ts:34-46`）也不落任何地方 ——
  运维看不出是不是有人在猜密码，站主自己也不知道后台有没有被敲。
- **修法（边界：进程日志，不写 `audit_log`）**：**记进程日志，不记 `audit_log`**。
  - 每次拒绝 `req.log.warn({ event: "admin_login_refused", method, reason, attempt, client, userAgent })`：
    `reason` 区分 `wrong`（密码不对）/ `unset`（站点还没设密码，属站点状态不是攻击）/ `too-many`（超出 15 分钟窗口）/
    `callback`（飞书回调被拒，原因记在页面上、不在这里展开，避免变成一个探测白名单的接口）；
    `attempt` 是这次尝试在该地址窗口内的序号，所以日志里能直接看出"短时间内第 10 次"。
  - **没有记密码**（测试里断言整段日志既不含配置的密码、也不含提交的值）。
  - 不写 `audit_log` 的理由：那是"人工改动"台账（`audit.ts` 的注释与后台审计页），而未认证的调用者可以任意灌它 ——
    等于用一个不需要凭据的写放大去换可见性。进程日志同样可查，且没有这个口子。
- **测试**：`tests/admin-login-logging.test.ts`（3 条，先失败后通过；把三条日志调用去掉后 3 条全失败，
  确认测试有牙齿）。断言含：拒绝写日志且带序号、拒绝不建会话也不写 `audit_log`、日志里没有密码。
- **验证**：本机与容器（`scripts/test-in-container.ps1`，Linux / Node 24）各跑一遍通过；`npm run typecheck` 通过。
- **证据边界**：证明的是"拒绝会留下日志行"，**不是**"生产上已经有人在试密码"——真实后台的日志要人去看。

### [S4] 其余疑点的核实结论（**不成立**，留档以免重复怀疑）

| 疑点 | 结论 | 证据 |
|---|---|---|
| §4.3 图片代理 16 hex 签名可伪造 | **不成立**。签名覆盖 `u\|mode\|exp`，`exp` 有效期约 2-3 天，64 位 HMAC 无法在线爆破（约 2^64 次请求）；密钥缺失时 `imgproxy.ts:21-25` 直接抛错，生产启动强制校验（`config.ts:97-106`）。旧全长 64 hex 与 `mode=default` 仍被接受是**有意兼容**（`:60-62`），不降低强度 | 本机跑 `verifyProxyRequest` 14 组用例：错 16 hex / 15 hex / 17 hex / 空 / 大写 / 改 exp 全部拒绝 |
| §4.3 `u` 可当跳板 | **不成立**。`u` 只接受 `http(s)` 且取内容走 `guardedFetch`（SSRF 闸）+ 上游流量预算（`media/upstream.ts`），不能用来读内网 | `media/media.ts:16-28`、`media/images.ts:82-91` |
| §4.4 `x-real-ip` 可伪造绕过反馈限流 | **不成立**。`apps/web/server.ts:154-159` 在转发给 api 时**无条件覆写** `x-real-ip`/`x-forwarded-for`（`proxyToApi` 的 `set` 在过滤之后合并），api 侧 `feedback.ts:34` 读到的就是这一跳写下的值；`TRUST_PROXY=true` 时取 `X-Forwarded-For` 最后一段，而 Caddy 忽略客户端自带的 `X-Forwarded-*`（[官方文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)：默认忽略入站 XFF 值以防伪造） | 读代码 + Caddy 官方文档 |
| §4.5 ingest 可触发付费 | **分级成立但已被闸住**。token 需 ≥16 字符、非常见占位符、常数时间比较；模型调用由 `MODEL_CALLS_ENABLED`（`providers/llm.ts:132`）+ `budgets` 表每分/时/天上限（`providers/receipts.ts:98-127`）拦；ingest 限流默认 10/分（compose 设置，`INGEST_RATE_LIMIT=0` 才是关掉）。**注意**：带代理时该限流以同样可被左端伪造的 `req.ip` 为键，但到这一步已经需要有效 token，爆炸半径有限 | 读代码 |
| §4.11 静态文件路径穿越 | **不成立**。`static.ts` 只用固定路径；`/contact/:file`（`:157`）与 leaderboard `:file`（`modules/leaderboard/server.ts:156`）有正则白名单，monitor `:date` 有日期往返校验；模块经 `%2f` 的穿越尝试实测 404 | 子代理实测，我复核了正则 |
| §4.2 图片代理没有安全头 | 图片代理**有**（`media.ts:48-49`）；缺的是页面，见上面 S3 条 | 读代码 |
| §4.13 后台越权 | 未发现。`apps/api/src/routes/admin.ts` 全部 34 个端点都经 `adminHandler`（会话 + 写操作 CSRF），审计覆盖人工变更；GET 未发现副作用 | 通读路由表 |
| §4.14 留存与擦除 | 未发现缺陷。`admin/feedback.ts:74` 的 erase 把 `content` 占位、`email`/`page_url`/`screenshot_key` 置空并记审计；截图另有"已转出即删"与 8 天清理（`operations/retention.ts:43`） | 读代码 |
| 后台登录失败没有记录（**已补**） | 复核成立：只有**成功**的登录写 `audit_log`（`admin/auth.ts:230`、`:249`），失败的尝试只在 15 分钟窗口里计数（`routes/admin-auth.ts:34-46`），进程日志里也没有 —— 看不出有没有人在猜密码 | 读代码 + `tests/admin-login-logging.test.ts`（先失败后通过） |
| §4.15 成本与资源滥用 | 搜索容量闸、图片上游预算、OG 缓存与图片缓存的定期清理（`operations/retention.ts:45` 按 mtime 30 天清 `imgcache`/`ogcache`）、MCP 30 秒结果复用都在；`OG` 图不做任何外部请求，渲染受内存 LRU 与磁盘清理双重约束。KB 模块的搜索放大是例外（见上） | 读代码 |
| §4.12 依赖与供应链 | **未发现漏洞**。`npm audit --omit=dev --registry=https://registry.npmjs.org` → 0（全部维度 0）；含 dev 的完整 audit 同样 0。audit 未改动 `package-lock.json`（`git status` 无变化） | 本机实跑，2026 年当次快照 |

**注（§4.12）**：本机默认 registry 是 `registry.npmmirror.com`，按方案要求显式改用 `registry.npmjs.org` 才拿到 advisories。
这次结果干净，所以没有"受影响包 / 传递路径 / 是否有可用修复"可列；但这是**当次快照**，
不构成"以后也不会出现"的结论 —— 建议把这条命令放进定期检查，而不是只跑一次。

### 一处仍未验证的项（需要登服务器，本次未做）

§4.9 **生产配置**：`DEV_AUTH_ROLE` 是否未设置、`.env` 权限、多余端口、容器 `docker.sock`/`privileged`、GCE 防火墙、SSH 来源。
代码侧能确认的部分：生产启动会**拒绝**启动于任何 `DEV_AUTH_*`、`ALLOW_PRIVATE_NETWORK_FETCH` 或缺失/占位关键密钥
（`packages/backend/src/config.ts:96-106`，`apps/api/src/main.ts:12`、`apps/worker/src/main.ts:18` 调用）——
但该检查要求 `NODE_ENV=production`，裸机部署漏设就没有这层保护。

## 3. 未决问题（需要站点所有者决定）

1. **知识库要不要公开**：收口（去掉 `agent.abilities` 三条）还是明确接受公开读取？后者需要先修撤回一致性与搜索放大。
2. **CSP 的取舍**（静态四项响应头已部署）：勘查结论是 **hash 不可行、nonce 唯一可行**，但 nonce 与页面缓存互斥
   —— 选中 nonce 就等于接受 HTML 不再被浏览器复用（首页约 215KB 重新下载），选中缓存就等于 `script-src` 里
   不设 nonce（仍能拦住外部脚本源、`object-src`、`base-uri`、`frame-ancestors`）。**等站主决定后落地**。
3. **`summarize-*` 补安全条款后**是否需要一次样本回放，确认摘要质量没有被"不许执行材料指令"影响。
   客户端已实现，但**回放本身没做**（需要真实模型调用，开发环境按规矩关着）。
4. **是否授权部署**：`deploy/Caddyfile` 的静态四项**已部署**（10-09 晚）；页面 CSP 未实现，等第 2 条。
5. §4.9 的生产核对需要有人（或授权我）登服务器跑只读命令。

## 4. 加固建议（不改变现有行为、代价小）

- `modules/kb/backend/layout.ts:88-91` 的 `noteFile`/`writeNote` 加 `path.resolve` 包含性断言与 id 字符白名单；
  引擎的 `sendFile`（`apps/api/src/routes/static.ts:99-107`）自身不含包含性检查，调用方必须校验（当前两处都校验了）。
- `modules/leaderboard/backend/fetch/sources/artificial-analysis.ts:23` 是采集侧唯一没过 `guardedFetch` 的 `fetch`
  （主机名固定、参数是整数，当前不可被攻击者影响），但它同时绕过了出口代理路由；建议统一走 `guardedFetch`，避免以后有人把外部数据放进这个 URL。
- `isBlockedAddress` 未覆盖 `192.31.196.0/24`、`192.52.193.0/24`（AS112/AMT 专用单播）。不是私有网段、无元数据服务，仅记录。

## 5. 工作树里的敏感文件（提醒）

仓库根有 4 个 `aihot-db-*.sql.gz`（约 545 MB）与 `aihot-upload.zip`，另有 `watchdog-log.txt`、`web-list-*.json`。
本次审查**没有读取**其中内容（方案 §11 的要求）。它们仍未跟踪、未提交。若确认含真实反馈邮箱，建议移出仓库目录并确认备份策略。

## 6. 复测记录

| 时间 | 范围 | 结果 |
|---|---|---|
| 本次 | `npm run typecheck` | 通过 |
| 本次 | standalone：`tests/sanitize-body.standalone.test.ts`、`native-video`、`sources`、`rss-xhtml` | 25/25 通过 |
| 本次 | standalone：`tests/url.standalone.test.ts`、`tests/http-redirects.standalone.test.ts` | 44/44 通过（含新增的结尾点用例） |
| 本次 | `npm audit`（生产与全量，显式 `registry.npmjs.org`） | 0 漏洞；`package-lock.json` 未被改动 |
| 本次 | 容器全套（`aihot-app:latest`，`aihot_verify_2126_ci` 全新库名，`NODE_ENV=test`，130 个测试文件） | **667 通过 / 0 失败**（约 52.8 s），含新增的 `tests/sanitize-body.standalone.test.ts` |
| 本次 | **两处修复后的容器全套复跑**（`aihot_verify_2127_ci` 另一个全新库名） | **667 通过 / 0 失败**（约 52.8 s），含 `tests/url.standalone.test.ts` 的新用例 |
| 本次 | `deploy/Caddyfile`（`caddy:2-alpine`） | `caddy validate` → Valid configuration；`caddy adapt` 确认五个 `headers` 处理器列在 `encode`/`reverse_proxy` 之前 |
| 10-10 晚 | 生产响应头复测（`https://hot.jian.ing/`） | 五个头都在；图片代理仍带自己的 CSP |
| 10-10 晚 | CSP 前置勘查 | 本机构建产物起 `apps/web/server.ts` + 桩 api 抓真实 HTML：`/`、`/all` 各 6 段内联脚本；生产 `/` 有 10 个 script 标签全部内联、最大 41KB；同一路径连抓 3 次得 3 种不同脚本集合 → **hash 不可行、nonce 唯一可行** |
| 10-10 晚 | Caddy 与图片代理的 CSP 优先级（`caddy:2-alpine` 实测） | `header >Content-Security-Policy`（defer）会**覆盖**上游图片路由自己的 `default-src 'none'; … sandbox`；不加该指令时上游 CSP 原样透传；`request_header … "{http.request.uuid}"` 每请求生成 nonce 且上游能收到 |
| 10-10 晚 | 摘要数字一致性规则的量测（本地生产数据副本：1500 条已发布且有正文的摘要） | 直接复用 `grounded()` 误伤 **11.4%**；含中文数词的数字校验误伤 **14.1%**；加月份归一化后仍 **14.1%** → 结论：**不上硬闸**，理由与样本见 [S3] |

需要修复工具本身的一点：仓库自带的 `scripts/test-in-container.ps1` 在本机跑不起来。它把 here-string 交给
`sh -c` 时首行被拼成 `sh: 1: set: Illegal option -`（脚本文件本身无 BOM，是 PowerShell here-string 的换行处理），
即使绕过这一层，内层 `node ... $TEST_ARGS` 也会把整段脚本当成模块名。
我改用等价的 `docker run`（同一镜像、同一数据库、同样的测试文件列表）跑通了全套，命令见 §7 第 6 条。

## 7. 修复清单（按仓库规矩：一个提交一个问题，带测试）

1. 清洗器惰性属性绕过 —— **已实现**（`packages/backend/src/content/sanitize.ts` + `tests/sanitize-body.standalone.test.ts`），待提交与容器复测。
2. `blockedHostname` 结尾点归一化 —— **已实现**（`packages/backend/src/lib/url.ts` + `tests/url.standalone.test.ts`），待提交与容器复测。
3. 知识库公开出口与撤回一致性 —— 待决策后做。
4. `summarize-*`/`translate-*`/`understand` 补安全条款 —— **已实现**（五份 + `understand.md`，规则测试在 `tests/architecture.test.ts`；
   见 [S3] 的版本哈希与证据边界）。**摘要一致性校验：量过之后决定不上硬闸**（误伤 11–14%，数据见 [S3]）；
   真正拦住编造数字的是提示词那一条与 `mendWording` 既有的"数字不许变"约束。
5. Caddy 安全响应头 —— **静态四项已实现并部署**（`deploy/Caddyfile`；生产实测五个头在线）。
   CSP：勘查已完成（hash 不可行、nonce 唯一可行、与页面缓存互斥），**等站主取舍后落地**，落地位置与那处 Caddy 覆盖坑见 [S3]。
6. `scripts/test-in-container.ps1` 的 here-string 缺陷 —— **10-10 晚复跑已正常**：脚本自己把 here-string 的 CRLF 换成 LF
   （"Pass LF to the container whatever the file holds"），并在容器里补齐 git。本机实测：指定文件与全套都能跑，
   Linux / Node 24 / pg_dump 17.11，`tests/admin-login-logging.test.ts` 20/20 通过。此处保留旧的手工等价命令备查：
   ```powershell
   # 把内层脚本渲染成无 BOM 的 /tmp/run.sh 再执行（$env:TEMP\aihot-inner.sh 由脚本正文抽取）
   docker run --rm --user root -v "${PWD}:/src:ro" -v "${PWD}\.git:/gitdir:ro" -w /work `
     -e "DATABASE_URL=postgres://aihot:aihot@172.17.0.2:5432/aihot_verify_2126_ci" -e NODE_ENV=test `
     -e GIT_DIR=/gitdir -e GIT_WORK_TREE=/work -e LOG_LEVEL=error -e "TEST_ARGS=$tests" `
     aihot-app:latest sh -c $inner
   ```
7. 后台登录失败写日志 —— **已实现**（`apps/api/src/routes/admin-auth.ts` + `tests/admin-login-logging.test.ts`，3 条先失败后通过）。
   记进程日志而不是 `audit_log`，理由见 [S5]。
