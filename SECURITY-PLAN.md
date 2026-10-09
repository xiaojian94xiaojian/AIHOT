# 雷达站安全审查方案（AIHOT / hot.jian.ing）

> 写给**没有上下文的新会话**。目标：对雷达站做一次全面安全审查，产出可复现的发现（含证据与利用条件）、
> 一份 `SECURITY-REVIEW.md`，以及按本仓库规矩修复+验证的清单。
>
> 先读：本文件 → `AGENTS.md`（工程边界）→ `docs/deploy.md`（部署与更新）→
> `SECURITY.md`（**漏洞上报口径，别把未修复细节公开**）→ `DEPLOY-NOTES.md`（部署事实、密钥位置、观察清单）。
>
> 代码基线：分支 `upgrade-4.0`；生产 https://hot.jian.ing（GCE `project-79671177-5fb1-4881-a7c` /
> `asia-east2-c` / VM `aihot`）。

## 1. 范围与非目标

**范围**：仓库 `E:\cs\aihot`（框架 + 站点 + 模块）+ 生产部署（GCE 主机、Docker Compose、Caddy、PostgreSQL、备份）。

**非目标（这次不查）**：`E:\Nodus`（另开一份）；第三方服务自身的安全（模型厂商、SocialData、飞书）；
需要破坏性手段才能验证的项（DoS 压测、暴力破解、供应链投毒实操）；社工。

## 2. 资产与信任边界

| 资产 | 在哪 | 被攻破的后果 |
|---|---|---|
| 付费 API 密钥 | 服务器 `.env`（LLM / SocialData / 公众号 / Jina / GitHub / 飞书）| 直接烧钱、冒名调用 |
| 管理员会话 | `/admin`、`aihot_admin` cookie（`SESSION_SECRET` 签名）| 改信源、撤回内容、重跑付费作业 |
| 数据库 | Postgres 容器（含反馈邮箱、审计、全部正文）| 数据泄露、内容被篡改 |
| 采集到的第三方正文 | 公开页面（`dangerouslySetInnerHTML` 渲染）| **存储型 XSS** 打到所有读者 |
| 公网入口 | Caddy → web/api（80/443）| 任意面 |
| 采集与推送入口 | `POST /api/ingest/items`（`INGEST_TOKEN`）| 投毒内容 + **触发付费分析**（成本 DoS）|
| 备份 | R2/COS/S3（`DB_BACKUP_STORE_*`）| 全库泄露 |

**信任边界**：公网 → Caddy → web/api；**采集内容（不可信）** → 抽取/清洗 → DB → 公开页面；
**LLM 输出（不可信）** → 标题摘要卡片；管理员（已认证）→ 后台；worker（持密钥）→ 付费服务；容器 → 宿主。

## 3. 攻击面清单（先照这张表过一遍）

| 入口 | 位置 | 端点量 | 备注 |
|---|---|---|---|
| 站点页面 / 搜索 | `apps/api/src/routes/site.ts` | 22 | 有 `search_capacity_exhausted` 容量闸 |
| v1 公开 API | `apps/api/src/routes/v1.ts` | 13 | JSON + ETag |
| Agent Markdown | `apps/api/src/routes/agent.ts` | 10 | 同 MCP 答案 |
| MCP | `apps/api/src/routes/mcp.ts` | — | Host/Origin 校验、`no-store` |
| RSS/Feed | `apps/api/src/routes/feeds.ts` | 5 | |
| 文章正文/媒体 | `apps/api/src/routes/media.ts` | 1 | + `imgproxy` 签名代理 |
| OG 分享图 | `apps/api/src/routes/og.ts` | 7 | 内容进渲染器 |
| 静态文件 | `apps/api/src/routes/static.ts` | 10 | `sendFile`，路径校验 |
| 反馈提交 | `apps/api/src/routes/feedback.ts` | 1 | multipart ≤12 MB、5 次/分 |
| 外部推送 | `apps/api/src/routes/ingest.ts` | 1 | `INGEST_TOKEN` + 限流 |
| 后台 | `apps/api/src/routes/admin.ts` + `admin-auth.ts` | 34 + 7 | 会话 + CSRF |

## 4. 优先看的疑点（**开工前先看这些**，都还没验证，不许当结论）

1. **存储型 XSS（最高优先）**：正文用 `dangerouslySetInnerHTML` 渲染（`apps/web/app/features/item/ArticleBody.tsx:152`、`features/copy/CopyPage.tsx:71`；语法高亮另写 `innerHTML`，同文件 `:88`）。清洗在 `packages/backend/src/content/sanitize.ts`：
   - `allowProtocolRelative: true` + `allowedSchemes: ["http","https"]`（`:60-63`）→ 协议相对 `//evil` 是否可绕过 scheme 限制？
   - `allowedSchemesByTag: { img: ["http","https","data"] }`（`:62`）→ `data:` 图片是否可做 SVG/超大 payload？
   - `<video>/<source>` 被放行（`:51-52,79-83`）→ 能否挂外部媒体、做钓鱼/信息泄露？
   - 重点核对：**每条进入渲染的路径都过清洗**（正文抽取、翻译 `textToHtml`、X 长文 `x_article`、简报/报告正文、模块渲染）。
2. **缺少安全响应头**：`deploy/Caddyfile` 只有 `encode` + `reverse_proxy`，没有 HSTS/CSP/X-Content-Type-Options/Referrer-Policy/框架限制 → 放大任何 XSS 的影响。
3. **图片代理签名**：`packages/backend/src/.../imgproxy.ts` 签名截断到 **16 hex（64 位）**、有效期 **1 天**、且“旧的全长签名仍接受”（`:1-5,19`）→ 评估伪造成本；确认 `u` 是否只允许站内/允许清单图片（是否可能被当跳板）。
4. **IP 信任链**：`feedback.ts:34` 取 `x-real-ip`，`TRUST_PROXY` 决定是否信代理头 → 配错就等于限流与封禁可被伪造绕过；核对生产 `TRUST_PROXY` 与 Caddy 是否重写该头。
5. **外部推送 = 付费触发**：`ingest.ts` 带 token 就能投条目 → 条目会走预筛/评分（付费）。核对：token 强度与轮换、限流是否够、`MODEL_CALLS_ENABLED`/预算熔断能否兜住被滥用的成本、token 泄露的爆炸半径。
6. **MCP 的 Host 允许名单**：`apps/api/src/routes/mcp.ts:258-263` 里固定包含 `localhost`、`127.0.0.1`、`[::1]`
   （外加 `SITE_ADDRESS.hostname`、模块 `hosts`、`MCP_ALLOWED_HOSTS`）→ 核对生产接受这些 Host 的后果
   （Host 头绕过、缓存投毒、内网暴露面）。
7. **采集侧 SSRF**：`content/url.ts:141-149`（`assertPublicUrl` / `guardedLookup`）、`http-fetch.ts:41,77`、`allowPrivateNetworkFetch` 默认 false → 核对生产值与全部取内容路径（正文抽取、`web_list` 列表、`fetchPublicContent`、图片代理、OG 取图）是否都过闸。
8. **提示注入（AI 特有）**：采集到的第三方正文直接进模型提示（预筛/评分/结构化/写作/日报）→ 构造一篇文章能否操纵“是否入选/怎么写作/日报怎么写”；评估影响面与现有的提示词防御（`industry/prompts/`）。
9. **生产配置（需登服务器核对）**：`DEV_AUTH_ROLE=admin` 是否**未**设置（否则绕过登录）；`.env` 权限；是否有多余端口开放；容器是否有 `docker.sock`/`privileged`；GCE 防火墙规则；SSH 是否限来源。
10. **密钥与文件泄露**：git 历史里是否出现过密钥；工作目录里的 `aihot-db-*.sql.gz` 转储与 `aihot-upload.zip` 是否含真实用户数据（**反馈邮箱**）且是否曾被提交；容器镜像层里是否烤进 `.env`（重建镜像时注意构建上下文）。
11. **静态文件路径穿越**：`static.ts` 的 `sendFile` 文件名校验、`apps/web` 的 public 目录、模块静态路由。
12. **依赖与供应链**：见 §5.2（**本机 `npm audit` 不可用**，原因与替代方案都写了）。
13. **后台越权与状态机**：34 个 admin 端点是否都走 `adminHandler`（会话 + 写操作 CSRF）；有没有 GET 产生副作用；会话撤销/固定；审计是否覆盖所有人工变更。
14. **隐私与留存**：反馈里的邮箱/截图/IP 的留存与擦除（`/api/admin/feedback/:id/erase` 是否真删）、日志里的 IP、备份里的 PII、公开出口是否泄露内部字段（`NO_INTERNALS` 约定的实际执行）。
15. **成本与资源滥用面**：OG 图渲染（大文本/重复请求）、搜索容量闸、图片代理带宽预算（`IMGPROXY_UPSTREAM_*`）、MCP/Agent 出口的缓存与限流。

## 5. 方法与工具

### 5.1 静态审查（主战场）
- 按 §3 的入口逐个读：先看鉴权/校验/限额，再看数据流到哪（DB、文件、外部请求、渲染）。
- 找“**唯一入口**”被绕过的路径：`publication/` 是唯一公开读取层（`docs/architecture.md`）；绕过它自己查表的代码就是疑点。
- 用 grep 找危险原语，逐个确认是否被清洗/转义/参数化：
  ```bash
  rg -n "dangerouslySetInnerHTML|innerHTML|exec\(|execFile|spawn|eval\(|new Function" apps packages modules
  rg -n "readFile|writeFile|createWriteStream|sendFile|path\.join" apps/api packages/backend | rg -v "test"
  rg -n "fetch\(|http://|https://" packages/backend/src | rg -v "test"
  rg -n "\$\{.*\}" packages/backend/src | rg "sql\`" # 确认都用参数化模板
  ```
- SQL：本仓库统一用 postgres.js 的模板字面量（参数化）；重点找**拼接**（`sql.unsafe`、字符串拼 SQL）。

### 5.2 依赖与供应链
- ⚠️ **本机 `npm audit` 用不了**：npm registry 指向 `registry.npmmirror.com`，它不实现 advisories 接口
  （`[NOT_IMPLEMENTED] /-/npm/v1/security/*`）。用其一：
  ```bash
  npm audit --omit=dev --registry=https://registry.npmjs.org
  npx --yes osv-scanner@latest -r package-lock.json     # 或 osv-scanner 直接扫 lockfile
  ```
- 记录：受影响包、传递路径、是否有可用修复、生产是否真的加载（`--omit=dev` 与否分开看）。
- lockfile 是否被改动（本仓库要求 PR 不夹带 `package-lock.json` 变更）。

### 5.3 配置审查（仓库 + 服务器）
```bash
# 仓库侧
Get-Content deploy/Caddyfile                     # 安全响应头（当前没有）
Get-Content docker-compose.yml                   # ports / volumes / privileged / docker.sock
# 服务器侧（只读命令）
sudo ss -lntp                                    # 监听端口
sudo docker inspect aihot-worker-1 -f '{{json .HostConfig.Privileged}} {{json .Mounts}}'
sudo grep -E "DEV_AUTH_ROLE|TRUST_PROXY|ALLOW_PRIVATE_NETWORK_FETCH|INGEST_RATE_LIMIT|COLLECT_ENABLED" /home/weijianlin/aihot/.env
ls -l /home/weijianlin/aihot/.env                # 权限
gcloud compute firewall-rules list --project project-79671177-5fb1-4881-a7c
```

### 5.4 动态验证（**先本地，再生产且只读**）
- 本机起一套：按 `docs/deploy.md` 起 web/api/worker（`COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`），
  在**本地**做主动测试（XSS payload、路径穿越、SSRF 目标、越权请求）。
- 生产只做**非破坏性、低频**验证（每个 payload 最多几次、带 `User-Agent` 标注、不要并发）：
  ```bash
  curl -sS -D- -o /dev/null https://hot.jian.ing/ | head -20          # 响应头
  curl -sS "https://hot.jian.ing/api/img-proxy?u=&mode=&exp=&sig="    # 签名是否必填
  curl -sS -X POST https://hot.jian.ing/api/ingest/items -d '{}'      # 未带 token 应 401
  curl -sS https://hot.jian.ing/api/v1/items?limit=1 | head -c 400     # 公开面是否泄露内部字段
  ```
- **不要**做：压测、爆破、批量扫描、写操作、改生产数据、利用漏洞横向移动。

### 5.5 日志与取证
- 只读查看：`docker logs --since 24h`，找异常 4xx/5xx、被限流记录、异常 User-Agent；确认日志**不含**密钥与正文。

## 6. 交战规则（硬约束）

1. **不破坏生产**：不写、不删、不改配置、不重启服务；只读探测；速率≤人类手速。
2. **不碰真实用户数据**：反馈邮箱、截图、IP 不导出、不外传；需要样本时在本地造假数据。
3. **先本地复现**：所有“能利用”的结论必须在本地环境复现一次，否则只写“疑似”。
4. **漏洞细节不外传**：按 `SECURITY.md` 的口径私密上报；本仓库的 `SECURITY-REVIEW.md` 只写必要证据。
5. **不删证据**：结论要能指到 `文件:行号` 或请求/响应原文。
6. **改动走本仓库规矩**：先写失败测试 → 修复 → 容器全套通过 → 部署 → 复测（见 §8）。

## 7. 严重度与输出格式

每条发现按这个模板写（`SECURITY-REVIEW.md` 一节一条）：

```markdown
### [S2] 正文渲染可注入 script —— 存储型 XSS
- 位置：packages/backend/src/content/sanitize.ts:60-63 → apps/web/app/features/item/ArticleBody.tsx:152
- 影响：任何读者打开被投毒的文章即执行脚本（会话、CSRF、钓鱼）
- 复现：本地投一条正文含 `<a href="//evil.example">` 的条目 → 打开条目页 → 观察 href/协议
- 证据：请求/响应或截图；文件:行号
- 根因：allowProtocolRelative=true 与 allowedSchemes 的组合未覆盖协议相对 URL
- 修复建议：关掉协议相对（或显式校验解析后的 host/protocol）；补测试
- 状态：待修 / 已修（提交号）/ 复测通过
```

分级：**S1** 可直接拿下会话/密钥/改内容；**S2** 存储型 XSS、越权、SSRF 到内网、成本可被持续滥用；
**S3** 信息泄露、配置缺失（安全头）、限流不足；**S4** 加固建议。

## 8. 修复与验证（按本仓库规矩）

1. 先写**失败测试**（放 `tests/` 或模块 `tests/`），再修。
2. `npm run typecheck`。
3. **容器内全套**（本机唯一能全绿的路子）：
   ```powershell
   pwsh -File scripts/test-in-container.ps1                     # 全套
   pwsh -File scripts/test-in-container.ps1 tests/xss.test.ts   # 单文件
   ```
   注意：容器测试用**全新库名**（`DB_NAME=aihot_verify_ci`），本机 `aihot_ci` 有 4.0.0 删除的 13 张残留表会让架构测试失败。
4. 改了框架代码要**重建镜像并部署**（`DEPLOY-NOTES.md` 有完整步骤，含“把 4 个 545 MB 转储移出构建上下文”这个坑）；只改 `industry/`、`scripts/` 则手动同步挂载文件并核对 md5。
5. 部署后**复测**同一 PoC，并把结论写回 `SECURITY-REVIEW.md`。
6. 修复要守住既有规则：不绕开回执与预算、不把模型调用搬到页面、公开出口仍只走 `publication/`。

## 9. 交付物

- `SECURITY-REVIEW.md`（仓库根，fork 本地）：范围、方法、**发现清单（含证据与状态）**、未决问题、复测记录。
- 修复提交（每个问题一个提交，带测试），必要时在 `DEPLOY-NOTES.md` 记一行。
- 若发现属于**上游框架**的通用问题：按 `AGENTS.md` 的 PR 规则先在 `KKKKhazix/AIHOT` 开 Issue 讲清场景（新开关/行为变更要先讨论），不要直接提 PR。
- 建议顺带补一份 `docs/security.md`（本仓库当前没有威胁模型文档）：信任边界、数据流、密钥与留存口径。

## 10. 已知坑（别踩）

- 本机 `npm audit` 不可用（npmmirror 无 advisories 接口）→ 用 §5.2 的替代命令。
- 工作目录里的 `aihot-db-*.sql.gz`（4 个，共 545 MB）与 `aihot-upload.zip`：**可能含真实反馈邮箱**，别提交、别外传；查 git 历史时用 `git log -p -- . ` 而不是把文件读进上下文。
- PowerShell 里中文 commit message 会炸 → 写文件后 `git commit -F`。
- 预推钩子在本机必挂 → `$env:ECC_SKIP_PREPUSH='1'`。
- 源文件 CRLF：脚本改文件要按原换行写回。
- 生产上 `industry/`、`scripts/`、`database/` 是挂载目录（手动同步），`modules/` 在镜像里（要重建）。
- 别在 `feat/archive-analysis-switch`（上游 PR 分支）上做安全修复；站内改动都提交到 `upgrade-4.0`。
