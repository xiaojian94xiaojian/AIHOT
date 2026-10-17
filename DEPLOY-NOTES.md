# 本地部署记录

AIHOT（github.com/KKKKhazix/AIHOT）部署在 `E:\cs\aihot`，用 Docker Compose 跑。

## 怎么访问

| 入口 | 地址 |
|---|---|
| 网站 | http://localhost:3000 |
| 后台 | http://localhost:3000/admin |
| 管理员密码 | 见 `.env` 的 `ADMIN_PASSWORD` |

## 常用命令

```bash
docker compose ps                      # 容器状态
docker compose logs -f --tail 100 worker   # 看抓取和模型处理
docker compose down                    # 停止（数据保留在卷里）
docker compose up -d                   # 再启动
docker compose down -v                 # 停止并删除数据
```

更新代码后：`docker compose up -d --build`

## 模型配置

用 **OpenCode Go 订阅**（$10/月）作为模型后端，走 Go 专属端点：

```bash
LLM_BASE_URL=https://opencode.ai/zen/go/v1
LLM_MODEL=deepseek-flash
LLM_EXTRA_JSON={"reasoning_effort":"none"}
LLM_SESSION_ID=aihot-local
```

注意 Go 用的是 `/zen/go/v1`，**不是** Zen 按量付费的 `/zen/v1`；两者是不同的端点和不同的 key。

## 为了跑通，改了三处（其余是配置）

### 1. `LLM_SESSION_ID` → `x-opencode-session` 请求头

Go 端点要求带 `x-opencode-session`，否则返回 `400 MissingSessionID`。原来只有 `content-type` 和
`authorization`。改了 `providers/llm.ts` 和 `providers/embeddings.ts`：设了 `LLM_SESSION_ID` 才发这个头，
不设就没有影响，所以对其他厂商仍是原样。

### 2. `reasoning_effort=none`（配置，非代码）

`deepseek-flash` 默认会思考，而 `score_article` 的 `max_tokens` 只有 1024、`structure_article` 只有 800。
思考会把预算吃光，`content` 返回空，报 `No JSON object in model output`。实测失败的调用里
`reasoning_tokens` 正好等于上限（1024/1024）。

Go 端点拒绝 DeepSeek 原生的 `thinking` 参数（`unknown field "thinking"`），但接受标准 OpenAI 的
`reasoning_effort`。设为 `none` 后 `reasoning_tokens` 恒为 0。

### 3. 修复 `sweepUnprocessed` 的去重死锁（上游 bug）

`queueProcessing` 用 `singletonKey: articleId`。补扫（`sweepUnprocessed`）重新入队时，pg-boss 会跟那个
已经死掉的旧 job 去重、直接返回 `null`，于是新 job 根本没建出来 —— 文章在退避里等一个永远不会再跑的
job。改了 `jobs/content.ts`：每次补扫用一个带时间戳的 key（`sweep:<ts>:<articleId>`），
`queueProcessing` 新增可选 `dedupeKey`，不传就是原来的行为。

这个 bug 值得提 issue 给上游。

## 运行边界（需要知道）

`docs/go/` 写明 OpenCode Go **是给编码 agent 用的**：文档要求客户端发送典型 coding agent 流量、
用 `x-opencode-session` 标识会话，并说明「Traffic is monitored for abuse」。AIHOT 是新闻站的批量
处理管道（首次导入就约 930 次调用），并不是文档描述的用法。技术上现在能跑，但如果要长期稳定运行，
建议换成 DeepSeek / 千问 / 智谱 这些明确按量计费、允许服务端调用的 API。换的时候只要改
`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，并把 `LLM_EXTRA_JSON` 和 `LLM_SESSION_ID` 去掉。

### 4. `reasoning_effort=max` 需要给思考留出 token（已修一部分，还有一处未修）

换到 `deepseek-v4.1-flash` + `reasoning_effort=max` 后，思考会占用 `max_tokens`。实测：
长文（10K token 提示）思考用了 **14,205** 个 token、耗时 113 秒，只为了输出 `{"attentionScore":72}`
这 4 个 token。原来各步骤的预算是按「不思考」的模型定的，于是思考会把预算吃光、`content` 返回空、
报 `No JSON object in model output`。

已在 `providers/llm.ts` 加了统一兜底：只要模型带 `reasoning_effort`（且不是 `none`），
输出预算至少 4096；否则维持原来的 512。另外把各步骤的数字预算按实测调大：
`structure` 800→4096、`prefilter` 512→4096、`story_digest` 1200→4096、
`report_lead` 800→4096、`report_period` 2500→8192。

**⚠️ 仍未修（下次继续）：** `score_article` 用的预算还是 4096，不是 `analyze.ts` 里给
`deepseek-v4.1-flash` 配的 32768。失败的调用 `completion_tokens` 正好卡在 4096。
原因是 `SCORE_CALL[model]` 的 key 没匹配上实际读到的评分模型名，于是走了 `?? ` 兜底
（现为 4096）。修法：把 `SCORE_CALL` 的 key 改成实际模型名（在后台「模型与评测」页能看到），
或者直接把兜底值提到 32768。实测长文评分需要约 6,000–15,000 个思考 token。

## 本地已下线，线上在香港（2026-10-01 起）

**本文档前面记的是本地跑通的过程。生产环境已迁到 GCP 香港，见 `DEPLOY-GCP.md` 与文末的「生产环境运行记录」。**

本地栈已 `docker compose down`（卷 `aihot_db` / `aihot_data` 保留）。**本地与服务器不能同时跑** —— 会重复抓取和重复付费调用。

线上：**https://hot.jian.ing**（静态 IP `34.96.136.13`，Cloudflare DNS-only）

## 当前状态：本地已安全暂停（2026-09-30 当时的状态）

`.env` 里两个安全阀都已关掉，恢复时改回 `true` 再 `docker compose up -d`：

```bash
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
```

- 已确认暂停生效：暂停后 3 分钟内 **0** 次新付费调用，worker 日志安静，定时任务都是空转
  （`enqueued: 0`），没有 `pending` 收据残留，不会有「花了钱不知道结果」的调用。
- 网站仍可在 http://localhost:3000 浏览（止于暂停前的 145 篇）。
- 23 篇待处理、3 篇 blocked、1 篇 failed，恢复后会由补扫继续。

## 速度与成本（`reasoning_effort=max` 的代价）

实测每次调用平均耗时：

| 步骤 | 平均 | 每次资料次数 |
|---|---|---|
| score_article | 24–28 秒 | **2 次**（独立打两次分） |
| understand_article | 26–33 秒 | 1 |
| story_digest | 11 秒 | 按事件 |
| structure_article | 9–11 秒 | 1 |
| prefilter_article | 3 秒 | 1 |

每篇资料光评分就要 ~50 秒，加上其他步骤约 1 分钟；并行度 6（`ANALYZE_CONCURRENCY`）。
一次全量重跑 144 篇大约 25–30 分钟，但如果碰上很长的正文（`MAX_BODY_CHARS = 60_000`，
正文最多约 28K token 提示），单次评分可以到 90–113 秒，整体就会被拖长。

如果嫌慢，把 `LLM_EXTRA_JSON` 改成 `{"reasoning_effort":"low"}` 或 `medium` 即可，
不用改代码；`reasoning_effort=none` 是实测最快（思考 token 恒为 0）。

## 信源导入（322 个）

从 `E:\cs\hot\backend-import-aihot-sources-2026-09-30.json` 导入。做法与结果：

- **合并脚本** `scripts/merge-source-pack.ts`：按「同源」判重 —— RSS 比 `feedUrl`、X 比 `query`、
  公众号比 `ghid`、其余比 `url`。同源的用新包字段覆盖（名称/配置/分级/参与方式），
  **但保留原有 id** —— 因为 `articles.source_id` 是 `NO ACTION` 外键，换 id 会让已采集的文章失联。
- **`scripts/seed.ts` 改成真覆盖**：原本是 `ON CONFLICT (id) DO NOTHING`（只增不改），
  现在是 `DO UPDATE SET ...`，重复项会被新包配置覆盖。
- 结果：**308 新增 + 18 覆盖 = 326 条**（322 来自导入包 + 4 条演示信源不在包内，保留）。
  修掉了 14 个「同源不同 id」的重复（如 `rss-google-deepmind` ↔ `rss-deepmind`、
  `rss-techcrunch-ai` ↔ `rss-techcrunch`）。
- 辅助脚本：`scripts/validate-import.ts`（按 collector 白名单校验 config，避免 seed 抛错）、
  `scripts/compare-packs.ts`（对比两个包）、`scripts/check-reachability.ts`（实测 URL 可达性）。

### 信源可用状态

| 类别 | 数量 | 状态 |
|---|---|---|
| RSS | 72（启用 60） | ✅ **实测 57 个 URL 全部 HTTP 200**，无失效 |
| web_list 网页 | 78（启用 1） | 其余 77 个未启用（需自写选择器） |
| **x_search** | **141（全部启用）** | ⚠️ **需要 `SOCIALDATA_API_KEY`，当前没配 → 每次抓取都会失败** |
| mp_account 公众号 | 23 | 未启用（需 `DAJIALA_KEY` + ghid） |
| json_list | 12 | 未启用（需字段映射） |

**建议先把 141 个 X 信源关掉**，否则会持续报错刷日志（`SOCIALDATA_API_KEY is not configured`）。

## 模型分工：照原项目设置（2026-09-30 改）

原项目的设计是**思考档位烧在模型预设里**，不是全局开关：`llm.ts` 的 `MODELS` 表里每个预设自带
参数，然后按能力选模型（`editorial/models.ts` 的 `CAPABILITIES`）。
**只有评分那一步开思考，其余全部关掉**，评分只开 `high` 不开 `max`。

本部署照这套分工，但所有模型都走 Go 网关，所以各家的 BASE_URL 全部指向 Go 端点、用同一个 Go key。
`scripts/show-step-models.ts` 可以随时打印当前每一步实际用的模型和参数（纯读取，不调模型）：

| 步骤 | 预设 | 实际模型 | 思考 |
|---|---|---|---|
| prefilter | qwen3.8-flash | qwen3.8-flash | 关（`enable_thinking:false`） |
| **score** | **glm-5.3-flash-selection** | glm-5.3-flash | **high** + `temperature=1` |
| understand | glm-5.3-flash | glm-5.3-flash | low |
| summarize / group / digest / report | deepseek-flash | deepseek-flash | 关 |
| groupReview | mimo-v2.6-flash | mimo-v2.6-flash | 关 |
| translate / monitor | default | deepseek-v4.1-flash-fast | 关 |

### Go 网关的参数差异（必须知道）

Go 网关**拒绝各厂商原生的 `thinking` 参数**（`unknown field "thinking"`，GLM 和 DeepSeek 都拒），
只接受标准 OpenAI 的 `reasoning_effort`。所以预设里的 `thinking` 全部翻译成 `reasoning_effort`：

| 原项目写法 | 本部署写法 |
|---|---|
| `thinking:{type:enabled}` + `reasoning_effort:low` | `reasoning_effort:"low"` |
| `thinking:{type:enabled,clear_thinking:false}` + `reasoning_effort:high` | `reasoning_effort:"high"` |
| `thinking:{type:disabled}` | `reasoning_effort:"none"` |

`qwen` 的 `enable_thinking:false` Go 网关接受，保持原样。

**另一个坑**：`deepseek-flash` 带 `thinking:{type:disabled}` 时 Go 网关返回 200，但内容是**跑偏的
中文散文**（不是 JSON），会静默污染结果；换成 `reasoning_effort:"none"` 才正常。

### `qwen3.7-flash` 不可用

Go 端点没有 `qwen3.7-flash`，prefilter 和 structure 用 `qwen3.8-flash` 顶替（同样 `enable_thinking:false`，
原项目 `docs` 里也是这两个并列的备选）。

### 顺带修掉了评分预算的 bug

`SCORE_CALL` 的 key 是**预设键名**，不是模型名。之前 `modelFor("score")` 返回 `"default"`，
查表落空 → 走 `?? ` 兜底 4096 → 思考吃光预算、JSON 被截断。
现在 score 走 `glm-5.3-flash-selection` 预设，`SCORE_CALL` 命中，拿到 `maxTokens=65536`。

### 每条调用都会有 `x-opencode-session`

Go 网关要求这个头，否则 `400 MissingSessionID`。已加在 `providers/llm.ts` 和
`providers/embeddings.ts`：设了 `LLM_SESSION_ID` 才发，不设对其他厂商零影响。

### 信源可用状态（2026-09-30 核查）

326 条入库，**实际能跑的只有 64 条**（全部是 RSS）。逐类说明：

| 类别 | 启用 / 总数 | 能不能跑 | 解决办法 |
|---|---|---|---|
| **RSS** | **64 / 72** | ✅ **实测全部 HTTP 200** | 已可用 |
| x_search | **0 / 141** | ❌ **SocialData 余额为 0**（`HTTP 402 Insufficient balance`） | 充值后 `node scripts/toggle-kind.ts x_search true` |
| web_list | 1 / 78 | ❌ 其余 77 条 `config` 是空的，需自写选择器 | 见下 |
| json_list | 0 / 12 | ❌ `config` 空，需字段映射 | 见下 |
| mp_account | 0 / 23 | ❌ 需 `DAJIALA_KEY` + 每条的 `ghid` | 见下 |

`.env` 里 `SOCIALDATA_API_KEY` **已配置且格式正确**（`12199|...`，实测能通过认证），
但账户余额为 0，所以 141 个 X 信源仍然全部不可用 —— **key 有了不等于能用**。
（注意：这一行原本行首多了一个空格，已修掉，否则可能被解析成空值。）

### 已修好的 4 条 RSS

导入包里 12 条 RSS 没有 feedUrl。实测后填好了 4 条：

| 信源 | feed |
|---|---|
| Answer.AI | `https://www.answer.ai/index.xml` |
| Claude：YouTube | `https://www.youtube.com/feeds/videos.xml?channel_id=UCrDwWp7EBBv4NwvScIpBDOA` |
| Google Cloud：Databases | `https://cloudblog.withgoogle.com/products/databases/rss/` |
| MIT News | `https://news.mit.edu/rss/topic/artificial-intelligence2` |

### 仍无法解析的 8 条 RSS（都保持 disabled，不会报错）

这 8 家要么没有公开 RSS，要么站点改版/反爬：

| 信源 | 实测结果 |
|---|---|
| Claude Platform 版本说明 | 三个 atom 地址全 404 |
| Factory | 无公开 feed |
| LangChain：Blog | 200 但返回 HTML（非 feed） |
| Linear：Now | 200 但非 feed |
| MarkTechPost | **403**（Cloudflare 拦） |
| Modal | 无公开 feed |
| OpenRouter：Announcements | 200 但非 feed |
| VentureBeat：AI | **429**（限流） |

解决办法：这类没有 RSS 的站点，要么改用 `web_list` + 选择器（见下），要么等官方出 feed。

## 信源处理结果（2026-09-30 完成）

**326 条里 256 条可用**（最初只有 64 条）。`scripts/apply-source-configs.ts` 可直接改库、
`scripts/seed.ts` 从 `industry/sources.json` 覆盖，两者等价。

| 类别 | 可用 / 总数 | 说明 |
|---|---|---|
| x_search | **143 / 143** | SocialData 充值后全部恢复 |
| web_list | **46 / 73** | 45 条自动探测 + 手动修正 |
| rss | **64 / 72** | 其中 4 条是我实测找到的 feed |
| json_list | **3 / 15** | GitHub 新仓库（含从 web_list 改正过来的 3 条） |
| mp_account | 0 / 23 | 缺 `DAJIALA_KEY` + ghid |

### 工具脚本（都是只读或幂等，可重复跑）

| 脚本 | 用途 |
|---|---|
| `validate-import.ts` | 按 collector 白名单校验导入包的 config |
| `compare-packs.ts` | 对比两个信源包，找同源重复 |
| `check-reachability.ts` | 实测 URL 可达性 |
| `merge-source-pack.ts` | 合并信源包（同源保留原 id，避免文章失联） |
| `resolve-feeds.ts` | 给没有 feedUrl 的 RSS 试探候选地址 |
| `detect-selectors.ts` | 抓页面、用 cheerio 自动探测列表项选择器 |
| `validate-web-selectors.ts` | **用真 collector 验证选择器**，按标题/同域/去重打分 |
| `probe-selectors.ts` | 人工比对几个选择器的实际抽取结果 |
| `inspect-web-list.ts` | 看某条信源到底抽出了什么 |
| `show-step-models.ts` | 打印每一步实际用的模型和思考档位 |
| `toggle-kind.ts` | 批量开关某一类信源 |
| `apply-source-configs.ts` | 直接把 sources.json 写进数据库（免重新构建镜像） |

### 仍不可用的 27 条 web_list：分三类

**A. 需要 Jina Reader（页面是 JS 渲染，静态 HTML 里没有文章列表）**

`web-research`(Google Research) `web-qwen` `web-kimi` `web-mimo` `web-hunyuan` `web-openmoss`
`web-minimax` `web-tessl` `web-goodfire` `web-transluc` `web-zyphra` `web-lmsys` `web-catonetworks`
`web-dataguidance` `web-developer-2`(蚂蚁百灵)

解决办法：填 `JINA_API_KEY`，然后把该源的 `url` 改成 `https://r.jina.ai/<原url>`。
collector 会自动切换到 markdown 解析模式（`web-list.ts:117`），**不需要改代码**。

**B. 需要内嵌 JSON 提取（页面数据在 JS 变量/`__NEXT_DATA__` 里）**

`web-seed`、`web-arxiv-2`（字节 Seed）。用 `mode: html_window_var` + `windowVar`，
或 `mode: html_json_key` + `jsonKey`。要逐个分析页面的内嵌结构。

**C. 被反爬挡住 / 是 X 主页 / 无可解析列表**

| 信源 | 实测 |
|---|---|
| `web-artificialintelligence-news` | 403 |
| `web-metaaiblog` | 400 |
| `web-xainews` | 403 |
| `web-agibot` | 500 |
| `web-github-2`（Hacker News） | 需要 `span.titleline` 特殊处理 |
| `rss-hn-buzzing`、`web-app`、`web-runway-news`、`web-api-docs`、`web-promptarmor` | 静态 HTML 无可用列表 |

这些都保持 **disabled**，不会产生报错。

## Jina Reader：先别买，匿名就能用（2026-09-30 实测）

**`r.jina.ai` 不带任何 API key 也能用**，官方限流表写的是无 key **20 RPM**。我实测直接请求
`https://r.jina.ai/https://research.google/blog/` 返回 200、26KB markdown。

所以 AIHOT 原来那句 `if (!key) throw new Error("JINA_API_KEY is not configured")` 是不必要的限制，
我改掉了（`providers/jina.ts`）：有 key 才发 `Authorization` 头，没 key 就走匿名档。

### 已经用匿名 Jina 救回 9 条源

页面是 JS 渲染、静态 HTML 里没有文章列表的，把 `url` 改成 `https://r.jina.ai/<原url>` 即可，
collector 会自动切到 markdown 解析（`web-list.ts:117`）。加上 `allowUrlPrefixes` 过滤掉导航链接：

| 信源 | 效果 |
|---|---|
| Google Research | **12 篇**（原来静态 HTML 只有 1 篇） |
| xAI News | **85 条**（原来 403） |
| Meta AI Blog | 8 条（原来 400） |
| MiniMax / LMSYS / Goodfire / Transluce / Zyphra / 小米 MiMo | 均可用 |

配置样例：

```json
{
  "url": "https://r.jina.ai/https://research.google/blog/",
  "baseUrl": "https://research.google/blog/",
  "allowUrlPrefixes": ["https://research.google/blog/"],
  "cacheToleranceSeconds": 3600
}
```

### ⚠️ 匿名档 20 RPM 不够用：会出现 403（2026-10-01 已解决）

线上实测：**匿名档下 jina 累计 11 次 403**，系统自己报了警
（`🟠 Jina 拒绝服务，可能欠费或账号失效`，持续 1 小时 20 分钟）。

原因是 AIHOT 会在抓不到正文时用 Jina 兜底渲染，短时间集中兜底就会撞 20 RPM 限流。
影响：部分文章取不到正文（曾累积 `待抓正文 374` 篇）。

**解决**：注册**免费** Jina key（不需要信用卡），限流 20 → **500 RPM**。
已配置到服务器 `.env`，实测：**近 30 分钟 0 次 403、6 次成功调用**，问题消失。

响应头可确认档位：

```
x-ratelimit-limit:     500, 500;w=60     ← 免费/付费 key 都是 500
x-ratelimit-remaining: 499
x-usage-tokens:        29                ← 按输出 token 计费
```

### 顺带放宽了 jina 的预算熔断

`budgets` 表里 jina 原为 `5/分钟、50/小时、300/天` —— **比 Jina 自己的 20 RPM 还紧**，
是 403 的成因之一。已改为 `30/分钟、400/小时、2000/天`（保留熔断，不取消）。

> ⚠️ **预算不是环境变量**：改 `budgets` 表（后台「设置 → 预算」页改的也是这张表，
> 见 `admin/settings.ts:66`）。别再往 `.env` 里加 `BUDGET_*` 变量。

**入口**：
- Reader 主页（含在线 demo 和参数说明）：https://jina.ai/reader/
- 登录 / 拿 key / 看账单：https://jina.ai/api-dashboard?login=true
- 限流表：https://jina.ai/api-dashboard/rate-limit

注意 `jina.ai/pricing/` 是 404，官网没有独立定价页，**实际单价要在 dashboard 里看**。
代码里按约 ¥0.36/百万 token 估算成本（`jina.ts:50`），仅作参考。

## 首次运行实测

- 18 个示范信源，抓取正常
- 145 篇分析完成，135 篇精选，45 个事件，9 份日报，53 篇事件综述
- `scripts/smoke.ts` 28 项检查全部通过

---

# 生产环境运行记录（2026-10-01 ~ 10-02）

线上 https://hot.jian.ing。以下都是**实测发现并修掉的问题**，每条给出根因、验证方式与回归测试。

## 一、修掉的四个 bug

### 1. `published_at` 永远不会被回填（网页源 100% 无日期）

**症状**：1858 条网页来源的内容**全部**没有发布时间。页面上只显示"发现时间"，排序和"最新"判断全错，**旧文（2024 年的帖子）被当成今天的内容**。

**根因**（`content/materials.ts:149`）：

```sql
ON CONFLICT (identity_key) DO NOTHING RETURNING id
```

已存在的文章被**完全跳过**；而后续那条本来会更新行的语句里**也没有 `published_at`**。所以列表页后来才学会的日期永远进不到已有行。

**修法**：在"只有文章自己的源才能改"这道既有规则之后，加一段**只填空值、绝不覆盖**的补全：

```sql
UPDATE articles SET
  timeline_at = CASE WHEN published_at IS NULL AND <新日期> IS NOT NULL
                     THEN least(timeline_at, <新日期>) ELSE timeline_at END,
  published_at = coalesce(published_at, <新日期>),
  author = coalesce(author, <新作者>), language = coalesce(language, <新语言>)
WHERE id = ... AND (published_at IS NULL OR author IS NULL OR language IS NULL)
```

**三个设计要点，每个都对应一个我写错后被抓出来的问题：**

1. **只填空白** —— 已有日期永不被后来的报告改动（源站改日期、列表页显示错日期都不能污染数据）
2. **只有文章自己的源能补** —— 与既有规则一致（其他源的标题/摘要本来也不采纳）
3. **`timeline_at` 只在首次填补时回退** —— 我第一版写成每次都 `least()`，结果一个带旧日期的后续报告把排序键拖到 2020 年。**这个错误是测试抓出来的**（见 `tests/materials.test.ts` 的 "a later report never overwrites a date that is already stored"）

**补历史数据**：光改代码不够，已有 1858 条不会自己变。`scripts/backfill-web-dates.ts` + `backfill-detail-dates.ts` 回填了 **394 条**（8 个列表页源 203 条 + 11 个详情页源 191 条）。

**回归测试**：`tests/materials.test.ts` 新增 3 个用例（学到日期会填入、后续报告不覆盖、他源不能定日期）。

**端到端验证**：生产库上清空某篇的 `published_at` → 重抓该源 → 日期自动补回且值一致。

### 2. 热点榜配图破图（502 `Upstream image unavailable`）

**症状**：热点榜第一名的卡片配图是破图，`/api/img-proxy` 返回 502。

**根因**：图片代理只信 `Content-Type`，而 **Google Cloud Storage 把真实 WebP 用 `application/octet-stream` 发出来**：

```
日志原文: "err":"Error: upstream is not an image","host":"storage.googleapis.com"
```

**图本身是好的** —— 直取原图 `HTTP 200`、魔数 `52 49 46 46 ... 57 45 42 50`（`RIFF....WEBP`）。是代理误判。**影响面比一张图大**：任何托管在不返回标准图片头的服务上的配图都会破。

**修法**（`media/images.ts`）：加 `sniffImageType()` 按魔数识别 PNG / JPEG / GIF / WebP / BMP / AVIF / HEIC。

**安全设计**：**SVG 刻意不在嗅探名单里** —— SVG 是 XML、可携带 `<script>`，靠嗅探放行等于开了脚本注入通道。所以 SVG 只在服务端明确声明 `image/svg+xml` 时才接受。

**回归测试**：`tests/media-sniff.test.ts` 5 个用例，重点是**反向**（HTML 登录页 / GCS XML 错误页 / 伪造的 `ftypmp42` 仍被拒；SVG 不能靠嗅探进）。

**验证**：那张图 `502` → `200 | 2072B | image/webp`；热点榜 **40/40 图片全部 200**。

### 3. 翻译从来没跑过（`translations` 表恒为空）

**症状**：文章页没有「正文 · AI 翻译」和「中文/原文」切换。

**根因链**（**不是翻译坏了，是根本没被触发**）：

```
345 个源 site_fulltext 全为 false     ← 导入增量包时的失误（包生成脚本没带出该字段）
   ↓
bodyModeOf() 一律返回 "summary"       ← publication/rules.ts:47
   ↓
publications.body_mode 全是 summary（0 条 full）
   ↓
翻译任务筛选要求 body_mode='full'      ← editorial/translate.ts:290
   ↓
匹配 0 条 → 翻译调用 = 0 → translations 表空
```

**正文数据其实一直在抓**（那篇有 5134 字），只是**不对外展示**。

**修法**：`scripts/enable-site-fulltext.ts` 开启 **287 个源**的 `site_fulltext`，再 `scripts/republish-selected.ts` 重发 **637 篇**让 `body_mode` 从 `summary` 翻到 `full`。

> ⚠️ **`site_fulltext` 与 `syndicate_fulltext` 是两件事**：前者=站内展示全文，后者=把全文放进我们自己的 RSS feed（那是另一种转载）。**只开前者**。

**验证**：`translations` 从 0 涨到 **625+ 篇完成**（2448 次调用，1 次失败），积压从 616 降到个位数。页面实测：同一篇的中文版 31.9% 汉字、原文版 0% 汉字，是两个独立版本。

### 4. 演示源被静默重新启用（隐性 bug）

**症状**：4 条明确停用的演示源（Google Research / AWS ML / MIT TR / Import AI）**在我不知情的情况下被重新打开了**。

**根因**：我在某次改 `sources.json` 的脚本里读入→改部分源→写回时，**把它们 `enabled: false` 这个键整个丢掉了**。而 `seed.ts` 的逻辑是：

```ts
${s.enabled ?? true}     // ← 键缺失 = 默认启用！
```

**缺失 = 启用**，所以静默复活。

**修法**：`scripts/enforce-source-states.ts` —— 把"必须禁用"的源集中成一个**带原因的清单**，可随时审计：

```bash
node scripts/enforce-source-states.ts --check   # 只读检查
node scripts/enforce-source-states.ts           # 修正
```

受管清单：4 条演示源 + `rss-marktechpost`（实测 403）+ `web-blogs-2`（重复源）。**每次改完 `sources.json` 都该跑一次 `--check`。**

## 二、OpenCode Go 网关：换 key 与工作区区域

### 症状与诊断

老 key 报 **429 `GoUsageLimitError`（周额度用尽）**，新 key 报 **400 `This Go model requires Global regions. Select Global in your workspace's Privacy settings`**。

**关键点**：新 key **不是无效**，而是工作区默认区域没设 Global。同一个 key 下 `glm-5.3-flash` / `mimo-v2.6-flash` 都 200，只有 DeepSeek 系被挡 —— 所以**不要一看到 400 就以为 key 废了**，要看具体报错。

### 替换范围

5 个变量共用同一把 Go key：

```
LLM_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / ZHIPU_API_KEY / XIAOMI_MIMO_API_KEY
```

老 key 按用户要求**保留**为 `OPENCODE_OLD_KEY`。

### ⚠️ 改 `.env` 后必须重建容器，不能只 restart

**`docker compose restart` 只重启进程，不会重新读取 `.env`。** 必须：

```bash
docker compose -f docker-compose.server.yml up -d --force-recreate api worker
```

**这个坑我踩了两次**，第二次还因为"容器内变量哈希与 `.env` 不一致"而误判是凭证配对错误。**验证方法**（不打印密钥）：

```bash
# .env 中值的哈希
grep -E '^LLM_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-16
# 容器内实际读到的哈希 —— 两者必须一致
docker compose ... exec -T worker node -e "const c=require('crypto');console.log(c.createHash('sha256').update(process.env.LLM_API_KEY||'').digest('hex').slice(0,16))"
```

## 三、信源：三轮导入

### 3.1 增量包（19 新源 + 6 配置更新）

`scripts/merge-increment.ts`。其中 **MarkTechPost 实测 403**（Cloudflare 拦截），已在清单里强制保持禁用 —— **feed 能不能用要实测，不能照抄包里写的**。

实测这批 feed：OpenRouter 145 条 / Modal 136 条 / HN buzzing 300 条可用；MarkTechPost 403 不可用。

### 3.2 网页源日期选择器

`scripts/detect-web-dates.ts`（列表页）+ `detect-detail-dates.ts`（详情页）。

**教训：探测脚本会有假阳性。** 我的探测匹配到了 item 容器**外面**的日期，真 collector 只看容器内，所以取到 0。**必须用 `scripts/validate-web-dates.ts` 跑真 collector 验证**，11 个候选筛掉 3 个。

可用范围：**8 个列表页源 + 11 个详情页源**；**22 个站点根本不显示日期**（METR×3、Epoch、Karpathy、Dario Amodei、Every 等），无日期可救。

### 3.3 氛围源（hot_signal）85 个

来自交接文档。**关键约束已在代码中核实**：

```ts
// events/group.ts:631 —— 非 editorial 源无条件走 groupSignal，不可能创建事件
if (opts.signalOnly || a.participation_mode !== "editorial") return groupSignal(a, source, observedAt);
```

```ts
// publication/stories.ts:57 注释 —— hot_signal 只加热度，不列出
// "hot_signal material only adds heat and is not listed, as on the live pages."
```

**数据验证**：氛围源创建事件数 **0**、公开可见条目 **0**、`eligible=false`。所以**启用氛围源不会污染内容流**，最多让热度算法偏一点，可逆。

**结果**：`signalCount` 从恒为 0 开始增长（观察到 0 → 6 → 8 → 9），参与者数 23 → 32（= 信源 + 信号）。这正是交接文档的验证口径。氛围源文章需先经模型分析再归组，所以信号数是**逐步**涨上来的，不是立刻生效。

**落地流程**：`validate-pack.ts`（白名单+冲突校验）→ `merge-hot-signals.ts`（强制 `enabled=false`）→ seed → `enable-hot-signals.ts`。

### 3.4 原生接法替换

**用户的规则**：有原生 feed/API 就用原生，否则保持 `web_list` + 选择器。

**替换**：`web-arxiv`（HuggingFace Daily Papers）`web_list` → **`json_list` + HF 官方 API**。原来抓 HTML 会捞到登录提示页且无日期（交接文档点名的垃圾来源）。实测从"登录页垃圾"变成 **48 篇、47 篇有日期**。

**⚠️ 查重比替换更重要**：我原打算"新增"的几个原生源，**其实都已经存在** ——

| 我探测到的 feed | 实际 |
|---|---|
| `openai.com/news/rss.xml` | 已有 `rss-openai-news` |
| `blogs.nvidia.com/feed/` | 已有 `rss-nvidia-blog` |
| Claude YouTube | 已有 `rss-youtube` |
| HF 美团 / inclusionAI API | 已有 `src-huggingface` / `-2` |

**没查重就会造一堆重复源。**

**确认没有原生接法的**（常见 feed 路径全 404）：Anthropic / Cerebras / ElevenLabs / xAI / Stanford HAI / PromptArmor / AGIBOT / Preferred Networks / Microsoft AI。**印证交接文档"原生 RSS/API 0 个"的结论** —— 这些只能页面抓取。

**低价值例外**：`web-qwen` 有原生 RSS 但**已停更一年**，换过去没意义，保持现状。

## 四、R2 异地备份

见「R2」相关章节。补充两点本轮踩到的：

### `DB_BACKUP_STORE_PATH_STYLE`（我加的开关）

`operations/backup.ts` 原来只支持**虚拟主机风格**（桶名在子域名里，腾讯 COS 那种），而 **R2 只支持路径风格**（`https://<账号ID>.r2.cloudflarestorage.com/<桶名>/<键>`）。加了 `DB_BACKUP_STORE_PATH_STYLE=true` 让 URL 变成 `${endpoint}/${bucket}/${key}`。

验证脚本 `scripts/verify-backup-url.ts` 的关键一条：**两种形态的签名必须不同** —— 证明桶名确实被纳入 SigV4 签名（`signV4` 用 `url.host` + `url.pathname`），不会出现"签名算的是 A、请求发的是 B"这种隐蔽错误。

### R2 生命周期规则（用 wrangler 配的）

同一份备份会写进**多个保留前缀**（`daily/` + 周日加 `weekly/` + 每月 1 日再加 `monthly/`），**代码不会删远端旧文件**（只轮转本地），所以远端会无限累积。规则：

| 前缀 | 保留 |
|---|---|
| `daily/` | 3 天 |
| `weekly/` | 28 天 |
| `monthly/` | 365 天 |

用 `npx wrangler r2 bucket lifecycle add aihot-backup <name> <prefix> --expire-days N -y` 配置。**wrangler 的 OAuth 能管桶（所以能配生命周期规则），但不能创建 R2 API 凭证**（`/accounts/{id}/tokens` 返回 403）—— 凭证只能在控制台建。

## 五、本轮新增的脚本

| 脚本 | 作用 | 安全性 |
|---|---|---|
| `scripts/validate-pack.ts` | 导入前校验（config 白名单 + id/同源冲突 + 硬约束） | 只读 |
| `scripts/merge-increment.ts` | 合并增量包 | 写 `sources.json` |
| `scripts/merge-hot-signals.ts` | 合并氛围源（强制 `enabled=false`） | 写 `sources.json` |
| `scripts/enable-hot-signals.ts` | 开启全部氛围源 | 写 `sources.json` |
| `scripts/enable-site-fulltext.ts` | 开启 `site_fulltext` | 写 `sources.json` |
| `scripts/apply-native-switches.ts` | web_list → 原生 feed/API | 写 `sources.json` |
| `scripts/enforce-source-states.ts` | 受管源状态审计与修正 | `--check` 只读 |
| `scripts/republish-selected.ts` | 重发精选让 `body_mode` 跟上源设置 | 幂等，`--dry-run` |
| `scripts/backfill-web-dates.ts` | 回填 `published_at`（web_list + json_list） | **默认 DRY-RUN** |
| `scripts/backfill-detail-dates.ts` | 从文章页回填日期 | **默认 DRY-RUN** |
| `scripts/detect-web-dates.ts` / `detect-detail-dates.ts` | 探测日期选择器 | 只读 |
| `scripts/validate-web-dates.ts` | 用**真 collector** 验证选择器 | 只读 |
| `scripts/verify-backup-url.ts` / `verify-r2-objects.ts` | 验证备份 URL 与签名 / 列出桶内对象 | 只读 |
| `scripts/verify-date-refill.ts` | 受控实验：清空日期→重抓→看是否补回 | **改一行又还原** |
| `scripts/run-backup.ts` | 手动触发一次备份 | 上传 |
| `scripts/retest-endpoints.sh` / `probe-native-feeds.sh` | 从服务器复测端点 | 只读 |

## 六、可复用的排查手法

1. **哈希比对代替打印明文** —— 定位"容器读到的值和 `.env` 不一致"时，比哈希而不是打印密钥，既定位问题又不泄露。
2. **用真 collector 验证配置** —— 自己写的探测脚本会有假阳性（我吃了这个亏）。`validate-web-dates.ts` 就是为这个写的。
3. **受控实验** —— 要证明"日期会被自动补回"，就在生产库上清空一个字段、重抓、看是否补回、再核对值。
4. **落地前查重** —— 我原打算新增的原生源其实都已存在。`find-sources.ts` 就是查这个的。
5. **先测凭证再推送** —— 新 key / 新 feed 先在本地或服务器实测，别配完才发现不行。
6. **`\r` 会污染 shell 参数** —— Windows 写出的脚本传到 Linux，`tail -n 2` 会变成 `tail -n '2\r'` 报错。用 `sed -i 's/\r$//'` 清一遍，或干脆用单条命令+SQL 文件代替包装脚本。
7. **`set -euo pipefail` + 管道里的 locale 报错 = 脚本提前中止** —— 我用 `docker compose restart worker | tail -n 2` 时，`tail` 因 `\r` 报错导致**整个脚本在重启前就退出**，我却以为是凭证问题查了半天。

---

# 跟进上游更新（2026-10-02）

## 背景

上游从 `f6c2952` 走到 `3343fe2`，**21 个提交**（9/30 ~ 10/2）。本地有大量未提交的部署定制，跟进方式：

```bash
git fetch origin
git add -A && git commit          # 先把定制提交，保住安全网
git rebase origin/main            # 只 2 个文件冲突
```

## 上游带来了什么

| 提交 | 内容 |
|---|---|
| `8d5a39b` | 恢复能力、公开一致性、Agent 接入（最大一批） |
| `035f7b7` | 整合社区采集/会话/恢复/跨行业修复 |
| `ddf1c19` | embedding 批次与付费回执一起提交 |
| `b5e2a09` | X 搜索回执用 coverage commits 补齐 |
| `c3ba0ca` | 回执未知被释放后重新排队文章 |
| `3343fe2` | 读者能按时间顺序跟事件进展 |
| `3e36e48` | 保留文章图片比例与 Markdown 结构 |
| `17ade63` | 写库前校验 ingest 条目 |
| `cf8f8d0` | 图片依赖固定到打过补丁的 fflate |
| **新增迁移** | `0039` 尝试身份 / `0040` 综述世代校验 / `0041` 会话绑定 |

## ⚠️ 两个部署坑（都踩到了，都必须记住）

### 坑 1：迁移文件不在镜像里，要单独上传

`docker-compose.server.yml` **挂载了 `./database`**，所以容器用的是**宿主机上**的迁移文件 —— 而我一直只上传 `industry/sources.json` 和个别脚本，**`database/migrations/` 从没同步过**。

后果：上游那 3 个新迁移跑出来是

```
database is up to date          ← 看起来一切正常
```

**但新列根本不存在**。如果只看这句话就继续，新代码会在运行时炸。

**正确做法**：跟进上游时一起上传迁移文件，并且**跑完必须核对新列/新表真的存在**：

```bash
# 上传
for f in 0039_oss_recovery.sql 0040_oss_domain_recovery.sql 0041_admin_session_binding.sql; do
  gcloud compute scp database/migrations/$f weijianlin@aihot:/home/weijianlin/aihot/database/migrations/$f --zone=asia-east2-c
done
# 应用
docker compose -f docker-compose.server.yml run --rm setup sh -c 'node scripts/migrate.ts'
# 核对（关键——别信 "up to date"）
docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot -t -c "
select count(*) from information_schema.columns
 where table_name='articles' and column_name='processing_attempt_tag';"
```

**推论**：凡是新加到 `database/` 或 `scripts/` 的文件，**都不在镜像里，都要单独上传**。只有 `industry/` 因为一直在同步所以没暴露这个问题。

### 坑 2：`docker compose build` 会覆盖 `:latest`，旧镜像标签就没了

想留回滚点的时候才发现：本机 `aihot-app:latest` 已经被新构建覆盖，三个标签（`latest` / SHA / 我起名的 `pre-upstream-merge`）**全指向新镜像** —— 名字起得误导，幸好核对时发现了。

**正确做法**：**在构建之前**给旧镜像打标签，或者**在服务器上**保存（服务器还留着正在运行的旧镜像）：

```bash
# 服务器上：pulling 之前先把当前运行的镜像另存
docker tag $REPO:latest $REPO:rollback-<旧镜像短ID>
docker compose ... pull
```

本项目的回滚路径现在是：服务器上的 `:rollback-83fe1d13`（本地保底），加上仓库里的镜像摘要 `sha256:83fe1d13...`。

## 冲突解决：以上游为主干，只叠加独有修复

21 个提交里**只有 2 个文件冲突**（其余 11 个自动合并）。

### `jobs/content.ts`

- **上游**：新增 `processing_attempt_tag` 列，把"这次评估的付费身份"持久化到行上；新增 `resumeSourceArticles`
- **本地**：新增 `opts.dedupeKey` 修 `sweepUnprocessed` 死锁

**判断依据**：核实 `processing_queued_at` / `QUEUED_STALE` 是**本地基线本来就有的**，所以上游**没有**修那个死锁 —— 两者正交，都要保留。

> 死锁场景：sweep 因 `processing_queued_at` 过期而选中文章，但 article-id 的 singletonKey 还握在那个死掉的 job 手里，pg-boss 会去重掉发送，文章就永远等下去。

→ **取上游版本，把 `dedupeKey` 重新加回**（签名加可选参数 + 三处 singletonKey + sweep 用每次唯一的 key）。

### `media/images.ts` —— 上游修了同一个 bug

上游在 `8d5a39b` 里**独立发现并修复了** "Google Storage 用 `application/octet-stream` 发 WebP"，正是本地前一天修的那个。但实现不同：

| | 上游 | 本地 |
|---|---|---|
| 判定 | octet-stream 时交给 sharp 解码 | **魔数嗅探** |
| `type` 值 | **保留 `application/octet-stream`** | 用嗅探出的真实格式 |
| 后果 | 下游 `type === "image/png"` / `image/svg+xml"` 判断**全部失配** → 落到 JPEG 分支 → **带透明通道的 WebP 丢 alpha、矢量化降级** | 格式准确 |

**合并了两者优点**：保上游对"通用二进制类型"的宽容（不限于本地列的 7 种格式）+ 本地嗅探拿准确类型 + 上游的 `meta.mediaType` 作为最后一道防线。

## 顺带修掉的上游测试问题

`tests/media-performance.test.ts`：队列是**首次使用时创建**的（`ensureQueue`），而 `boss.deleteAllJobs` 不会创建队列 → 干净库上必然报 `Queue media.prepare does not exist`。加了 `ensureQueue` 一行修掉。

## 修掉的上游测试缺陷（Windows 路径处理）

`tests/architecture.test.ts` 上游原版在 Windows 上**3/5 通过**，会误报 53 条违规。**两个 bug 叠加，后一个掩盖了前一个** —— 这一点值得记，因为我第一次只修了一个，测试仍然红：

### bug ①：`sources()` 返回反斜杠路径

```ts
out.push({ file: path.relative(ROOT, full) });   // Windows 上是 "packages\backend\src\..."
```

规则拿它和 `"publication/"`、`"providers/receipts.ts"` 这类**正斜杠**串比较 → 永匹配不上。

### bug ②：`path.relative` 不把 `/` 当分隔符（Windows）

修了 ① 之后仍然红。原因是这一段：

```ts
const own = path.relative("packages/backend/src", file);
```

`file` 变成正斜杠后，Windows 的 `path.relative` **不把 `/` 当路径分隔符**，于是把整个 `"packages/backend/src/publication/publish.ts"` 当成一个文件名比较，返回 `..\..\..\..\packages/backend/src/publication/publish.ts`。

> ⚠️ **我在这里被自己的测试方法误导过一次**：用 PowerShell 单引号跑 `node -e` 验证时，`'${val}'` 拼接坏了，输出看起来像"正确"，害我一度以为归属判断的本意就是错的、打算不去修。**验证脚本本身也会说谎**，所以第二次改用文件形式的探针脚本重测才看清。

### 最终修法（只归一化分隔符，不改语义）

```ts
// ① sources()：统一输出 posix 路径
file: path.relative(ROOT, full).split(path.sep).join("/")

// ② 归属判断：喂 OS 路径给 path.relative，再转回 posix 比较
const own = path.relative("packages/backend/src", file.split("/").join(path.sep)).split(path.sep).join("/");
```

**为什么确定本意没写错**：文件里其它测试（第 44、57 行）都用**相对 `packages/backend/src`** 的路径（`backendPath()` 的返回值、`/^publication\//` 这样的正则），`OWNERS` 的 `"publication/"` / `"providers/receipts.ts"` 同属这个形式 —— 所以归属检查本身是对的，缺的只是分隔符归一化。

### 验证这个测试「有牙齿」

修完不能只看它变绿 —— 得确认它真能抓违规：

```
插入探针（在 media/ 里写 publications）→ ✖ 1 fail:
  'packages/backend/src/media/__arch_probe.ts writes publications (owner publication/)'
移除探针                              → ✔ 5 pass
```

能精准抓到、移除后恢复全绿，说明它是**有效的守卫**，不是永远绿的空壳。

### 这个修复值不值得做

**值得，理由是"53 条假阳性会淹没真问题"**：修复前真有人违反表归属，输出混在 53 条噪音里没人看得出；修复后 5 个用例全绿，**任何一条新违规都会立刻显形**。

改动只有 7 增 2 删，且不动任何产品代码。

## 测试套件的失败归因（14 个，逐个查证）

| 失败 | 原因 | 状态 |
|---|---|---|
| 5 × SIGTERM（120s 超时） | 沙箱不传播信号给子进程（用原始代码验证，失败完全相同） | 环境限制，无法在本机修 |
| 10 × `backup-files` | 本机没有 `pg_dump`（它只在镜像里） | 环境限制（服务器上有 `pg_dump`，功能正常） |
| 3 × `translate` | 测试环境的模型 stub 配置 | 环境限制 |
| ~~2 × `architecture`~~ | ~~上游测试自身缺陷~~ | **已修**（见上节，5/5 通过） |

**修复后：574 测试 / 556 通过 / 12 失败**（原 554 通过 / 14 失败），剩下 12 个全是本机环境限制。

> 干净库与脏库跑出的失败集合**完全一致**，排除了测试交叉污染的可能。

## 部署结果（2026-10-02）

**部署前**：手工跑一次备份（218.9 MB，已传 R2，桶内累计 997.9 MB / 10 GB）。

**三条独立证据证明新版在跑**（不要只看"我执行了命令"）：

| 证据 | 值 |
|---|---|
| api/worker/web 容器镜像 | `45c1edb87da9`（新） |
| 已应用迁移 | 38 个，含 0039/0040/0041 |
| 新列 `processing_attempt_tag` / `context_article_ids` | 都存在 |

**部署后验证**：8 个页面/接口全 200、图片代理 200、worker 近 3 分钟 52 次调用 0 失败、待处理 0、日志无 error/warn、10 个步骤的模型分工未变、网关补丁 0 报错。

**当前版本**：`0a67805` = 上游 `3343fe2` + 本地定制。



---

# 信源交接包：2026-10-03（106 条氛围源 + 站点体检）

## 一、导入结果

包内 106 条，**只有 20 条是新的**（85 条是 10-02 那批的 id，1 条 `x-account-alexandr_wang` 与已有的 `x-account-alexandr-wang` 同源）。走 `merge-hot-signals.ts` 合并 → `seed` → `enable-hot-signals.ts`。

```
信源总数  450（editorial 345 / hot_signal 105）
启用      391（editorial 286 / hot_signal 105）
```

**12 条新 RSS feed 全部实测可达**（服务器出口，200 且都带日期）。其中 5 条是文档说的"被 Cloudflare 拦后找到的替代通道"（3 个 FeedBurner + 2 个 freenewsapi），确实必要。

> ⚠️ **纠正文档一处**：它说 TNW 原生被 CF 拦，但服务器实测 `https://thenextweb.com/feed/` **返回 200 且有 10 条** —— 原生可用。（Wccftech 原生 403、ComputerBase 原生 404，替代通道仍是必要的。）

> ⚠️ **上面这句是错的，2026-10-08 实测纠正**：`scripts/seed.ts` 至今仍是 `ON CONFLICT (id) DO NOTHING`
> （仓库与服务器上的都是），也就是说**改 `sources.json` 再 seed 不会更新已有源**，只补新源。
> 改已有源要么走后台、要么用一条会 UPDATE 的脚本 —— 见下面「权重重置」那节的
> `scripts/apply-tier-mapping-2026-10-08.ts`。当天先照这句错话做过一次，发现库里 tier 没变才查出来。

## 二、站点体检 §6 P1（池被归档页灌水）—— 已基本解决

**体检时（10-03）**：近 24h 无日期 **64%**（1244/1940），88% 集中在 5 个源。

**现在的实测**：

| 指标 | 体检时 | 现在 |
|---|---|---|
| 近 24h 无日期占比 | **64%** | **3.1%**（376/11945） |

**为什么好了**：那 5 个源大多**一直在持续抓取**（每 60 分钟一轮），所以 10-02 部署的日期能力已经把日期逐步补上了。查库确认：

| 源 | 库里状态 |
|---|---|
| `rss-tomtunguz` | **1882 条，0 无日期**（含 2010 年的旧文，日期正确）|
| `web-llamaindex` | 468 条，417 有日期 |
| `web-arxiv` | 有日期规则；残留 201 条是旧 HTML 抓取时代、已滚出 API 窗口的 |
| `web-lmsys` | 124 条全无日期 → **已停用** |

## 三、本轮实际改动

### 1. `rss-tomtunguz` 补日期规则

```json
"publishedAtSelector": ".hero-date, .post-item-date"
```

归档页 1882 条原来全无日期。列表页其实带日期（纯文本"October 2, 2026"格式），只是 class 不在常规候选里。实测 **1882/1882 取到**，范围 2010-02-25 ~ 2026-10-01。

### 2. `web-llamaindex` 修正选择器 + 补日期

原来 `itemSelector` 是**裸 `"a"`** —— 把页面上 1005 个链接全当文章。实际文章容器是 `div.Post`：

```json
"itemSelector": "div.Post",
"linkSelector": "a[href*='/blog/']",
"publishedAtSelector": "p.PostDate"
```

实测 **433 条、417 有日期**（原来 1005 条全无日期）。

### 3. `web-lmsys` 停用

三种途径都试过，都不通：

- 原生 feed：7 个候选端点**全 404**，`sitemap.xml` 只有 15 字节
- 直连站点：被 CDN 拦（返回 16 字节）
- 走 Jina：列表页 markdown 无日期；`itemSelector` 取不到条目；`parseMode:"html"` 也取不到

按文档 §6 的选项①处理。它是 5 个源里最小的（124 条）。

## 四、仍待处理

剩余无日期 293 条来自 **3 个确实没有日期规则的源**：

| 源 | 条数 | 端点 |
|---|---|---|
| `web-microsoft` | 125 | `news.microsoft.com/source/topics/ai/` |
| `web-anthropic-2` | 84 | `www.anthropic.com/institute` |
| `web-xainews` | 84 | `r.jina.ai/https://x.ai/news` |

需要逐个探测这三家的 DOM（各站结构不同）。**注意它们每轮还在新增无日期条目**，不修就会持续累积。

## 五、脚本

| 脚本 | 作用 |
|---|---|
| `scripts/validate-pack.ts` | 导入前校验（白名单 + id/同源冲突 + 硬约束）|
| `scripts/merge-hot-signals.ts` | 合并氛围源（强制 `enabled=false`）|
| `scripts/enable-hot-signals.ts` | 开启全部氛围源 |
| `scripts/apply-p1-date-fixes.ts` | 套用已实测的日期规则 |
| `scripts/verify-new-feeds.sh` | 从服务器复核新 feed 可达性 |

**修掉一个脚本缺陷**：`backfill-web-dates.ts` 遇到单个源读列表失败（跨域重定向）会**整轮崩掉**，已改为报错跳过、继续处理其余源。


---

# 停用全部「无日期规则」的网页源（2026-10-03）

## 决定与范围

**范围界定**：`rss` 与 `json_list` 的日期来自 feed/API 本身，不受影响。只有 **`web_list`** 读的是列表页，没有日期规则时每一条都会以 `published_at = NULL` 入库 —— 于是按发现时间排序与展示，归档页的旧文看起来像新的。

判定条件：`web_list` + 启用中 + 既无 `publishedAtSelector`/`publishedAtRegex`，也无 `detail.publishedAtSelector`/`detail.publishedAtRegex`。

**停用 35 个源**（脚本 `scripts/disable-undated-sources.ts`，`--apply` 才写入）：

```
web_list  启用 52 → 17
全站启用  391 → 356
```

## 核实

```
近 30 分新增 295 条 → 其中无日期 0
近 2 小时仍在产无日期条目的源: 0 个
全站无日期 1860 条（存量，已停止增长）
```

## 已停用的源（35 个，可按需恢复）

`web-arcprize` `web-karpathy` `web-anthropic-news` `web-anthropic-research` `web-anthropic-2` `web-cognition` `web-cohere` `web-cohere-2` `web-labs` `web-baseten` `web-darioamodei` `web-epoch` `web-every` `web-canarymedia` `web-claude-blog` `web-fireworks` `web-goodfire` `web-research` `web-metr` `web-metr-2` `web-metr-3` `web-metaaiblog` `web-microsoft` `web-minimax` `web-developer` `web-preferred` `web-primeintellect` `web-transluce` `web-worldlabs` `web-zyphra` `web-xainews` `web-mimo` `web-liquid` `web-hai` `web-lmsys`

**恢复方式**（二选一）：

1. **能补日期规则的**：配好 `publishedAtSelector`（或 `detail` 规则）+ 实测确认能取到日期，再 `enabled=true`。届时也要把历史行回填：`node scripts/backfill-web-dates.ts --hours <上限>`。
2. **不补规则但要恢复**：`enabled=true` 即可，代价是它产出的条目继续无日期、按发现时间排序。

> 注意第 2 种会让"排序失真"回来 —— 这类源每轮都在抓归档页，旧文会持续以"新"的样子进入池子。

## 为什么选择停用而不是逐个补规则

这 35 个站点的结构各不相同，每个都要单独探测 DOM（本轮已实测：`rss-tomtunguz` 和 `web-llamaindex` 两个各花了几轮探测才找到正确选择器，而 `web-lmsys` 三种途径全不通）。停用是**立刻见效且可逆**的做法；补规则可以后续按价值排序逐个做。


---

# 历史归档不再评分（2026-10-03）

## 背景

新信源首次导入会把整个归档带进来（实测 `rss-tomtunguz` 一次 1820 条）。这些历史条目不会创建事件、不加热度（`isHistorical`），但**每条仍会走评分、结构化、写作** —— 花的调用买不到读者能看到的东西。

## 改动（4 文件 24 行）

闸门放在 `editorial/analyze.ts` 的 `runAnalysis`：**预筛之后、评分之前**。

```ts
if (prefilter.label === "BLOCK") return { prefilter, scores: null, writing: null, structure: null };
// 新增：归档历史到此为止，预筛结论仍然入库
if (opts.sweep && !opts.attemptTag && isHistorical(a)) return { prefilter, scores: null, writing: null, structure: null };
```

- `content.ts` 的自动任务处理器传 `sweep: true`
- `input.ts` 的 `loadAnalyzeInput` 多取一个 `backfill` 字段
- `isHistorical` 改为同时接受 DB 行的 snake_case 和加载输入的 camelCase

**只限制自动流程**：显式重评估（后台"重跑"）是点名要这篇文章，仍完整判定。

## 为什么不放在队列层

最初在 `queueProcessing` 里拦（不入分析队列），结果**破坏了两个既有测试**，其中包括 `promotion preserves history…` 直接 120 秒超时。文档（`sources.md:214`）写明的契约是历史内容**仍被分析、只是排队靠后**；队列层的拦截把"排最后"变成了"不处理"，改动面过大。

**改成预筛后的时间限制后，套件 577/577 全绿**，且改动只有 24 行。

## 验证

**新增测试 3 个**（`tests/history-limit.test.ts`），其中行为测试在移除实现时失败：

```
移除实现 → ✖ the automatic run stops after the prefilter on archived history
           ✔ an explicit re-evaluation of history is still judged
           ✔ news found today is judged in full, sweep or not
```

**探针实测四场景**（容器内）：

| 场景 | 实际调用 |
|---|---|
| 历史 + 自动(sweep) | `["prefilter"]` |
| 历史 + 显式重跑 | `["prefilter","structure","score","score","writing"]` |
| 历史 + 直接调用 | 同上（完整）|
| 当日新闻 + 自动 | 同上（完整）|

**生产库实证**（真实的一年前归档文章）：

```
样本 h6906tdudh58gkwmmgil9ajef
  published_at=2025-07-15  discovered_at=2026-10-02  (距发现 10678 小时)
  自动流程调用 → scores=null  writing=null  structure=null  prefilter.label=PASS
```

## 部署踩到的坑：Artifact Registry 凭据过期

`docker compose pull` 报 `authentication failed`，但 `sudo docker pull` 成功 —— 因为**两者读不同的配置**：compose 以 `weijianlin` 运行，读 `~/.docker/config.json`；`sudo` 读 `/root/.docker/config.json`。

根因：`oauth2accesstoken` 是**短期 token**，存在配置里的会过期。

```bash
# 两个配置都要刷新（用当前用户的 gcloud 凭据）
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://asia-east2-docker.pkg.dev
gcloud auth print-access-token | sudo docker login -u oauth2accesstoken --password-stdin https://asia-east2-docker.pkg.dev
```

**另**：`.env` 里 `AIHOT_IMAGE` **自带 `:latest`**，拼回滚标签前要先剥掉（`${AIHOT_IMAGE%%:*}`），否则得到 `…:latest:rollback-xxx` 报无效引用。

**回滚标签**（pull 之前保存）：`:rollback-7786c9c9d29d`（= 本次部署前的版本）


---

# 信源抓取方式：三种类型，增量程度完全不同（2026-10-03）

## 一句话结论

**`x_search` 是真正增量的；`rss` 靠 HTTP 校验省流；`web_list` 没有任何增量机制，每轮重读整页。**
"全量抓取"这个说法只对 `web_list` 成立。

## 三者的机制对比

| 类型 | 增量机制 | 每轮读取量 | 实测平均 found | 实测最大 found |
|---|---|---|---|---|
| **`x_search`** | `since_id` 水位线 + 24 账户分片共享一次搜索 | 只读新推文 | **0** | 20 |
| **`rss`** | E-Tag / Last-Modified（304 则不解析）；feed 多大读多大 | 整份 feed | 53 | 1245 |
| **`json_list`** | 由上游 JSON 自身窗口决定 | 上游返回多少 | 29 | 50 |
| **`web_list`** | **无**（整页解析后按 identity_key 去重）| **整页** | **175** | **1882** |

数据来自生产库 `fetch_runs`（近 24 小时）。

## X 源：增量 + 分片（做得最好）

### ① `since_id` 水位线

```ts
// packages/backend/src/sources/x.ts:127
const query = lastId ? `${base} since_id:${lastId}` : base;
```

水位线存在 `sources.cursor.lastTweetId`。生产实测 **199/199 个 X 源都有水位线**。

### ② 分片：24 个账号合并成一次搜索

```ts
const SHARD_MAX_ACCOUNTS = 24;
const SHARD_QUERY_MAX = 470;   // SocialData 上限 512 字符，水位线占约 30
export function shardQuery(handles: string[]): string {
  return `(${handles.map((h) => `from:${h}`).join(" OR ")}) -filter:replies`;
}
```

SocialData 按请求计费，所以这一步直接把成本除以 24。

生产实测：**可共享 199 / 实际可分片 199 / 独占搜索 0** —— 全部走了分片。

```
同一时刻的抓取批次：
  started_at 13:12:01.191868  同批源数 24
  started_at 13:12:01.189844  同批源数 24
  started_at 13:01:37.416610  同批源数 22
```

### ③ 水位线追赶（长时间停机不丢推文）

搜索超过一轮的页数上限时，水位线先移到**最新**推文，把未读完的位置存进 `cursor.xBacklog`；后续轮次从那里继续读到追上旧水位线，**中间不会跳过**。

```ts
const MAX_PAGES = 10;          // 每轮新推文的页数
const MAX_BACKLOG_PAGES = 10;  // 每轮补读旧区间的页数
const MAX_BACKLOG = 5;         // 最多保留 5 个区间，超出则放弃最旧的并上报
```

### ④ 首次抓取本身就有界

`_aihot.initialBackfillLimit: 8`，且 `readXSearch` 在没有水位线时**只读一页**：

```ts
if (!lastId || !res.nextCursor || res.tweets.length === 0) break;
```

所以 X 源启用时**不会**一次灌进整个历史时间线 —— 这点比 `web_list` 强得多。

## 实测：found 分布（近 24h）

```
x_search:
  0 条 → 7685 次     ← 96% 的抓取没有新推文，正是增量在工作的特征
  1 条 →  263 次
  2 条 →   40 次
  3 条 →   16 次
  5 条 →    2 次
  7 条 →    1 次
 20 条 →    8 次
```

对照 `web_list` 最大 1882 条、`rss` 最大 1245 条 —— 两个数量级的差别。

## ⚠️ 读 `fetch_runs` 的口径陷阱

**`fetch_runs` 是每个源记一行**，而 24 个 X 源共享一次付费搜索。所以：

```
fetch_runs 行数（近 24h）: 11734    ← 不是调用数
付费回执数（receipts）    : 27315
X 搜索真实请求（source_fetch）: 539
```

`8022 行 ÷ 24 ≈ 334 次搜索`，与 `source_fetch = 539`（含重试与零散账户）量级吻合。

**不要把 `fetch_runs` 行数当成 API 调用数或成本。**

用 `scripts/check-fetch-cost.sql` 一次看两侧。

## 真实的成本结构（近 24h）——抓取不是大头

| service | 回执数 |
|---|---|
| **deepseek**（评分/预筛/结构化/写作…）| **19980** |
| embedding | 4037 |
| zhipu | 914 |
| **socialdata**（X 抓取）| **841** |
| jina | 584 |
| mimo | 250 |

```
score_article      6337
prefilter_article  5283
embedding          4037
structure_article  3242
summarize_article  1915
story_digest       1484
group_article      1380
understand_article  901
translate_body      709
source_fetch        539   ← X 抓取
```

**结论：抓取侧（841）与模型分析侧（19980）差一个数量级以上。** 要控成本，该动的是分析环节 —— 这也是"历史归档不再评分"那个改动的依据。

## 附带的判断依据

停用那 35 个无日期 `web_list` 源，同时也是省掉 **35 × 每轮整页重读** 的无谓开销 —— 它们既拿不到日期，又是唯一"全量重读"的类型。


---

# 为什么我们的热点榜/精选与原站差异这么大（2026-10-03 排查）

## 结论速览

差异**不来自**筛选门槛或提示词 —— 这两样我们与上游**完全一致**（`git diff 3344fe2 -- industry/selection.ts industry/prompts/` 为空）。

差异来自四个可量化的杠杆：

| # | 原因 | 量化证据 |
|---|---|---|
| **1** | **一个灌水源污染了 44% 的精选** | `rss-dev` → `https://dev.to/feed`（dev.to 全站公共 feed），占精选 16/36 条 |
| **2** | **tier 分档 × 分档门槛，产生 15 倍入选率差** | T1 入选率 10.9% vs T2 **0.7%**，而三者平均分都是 38.8~39.5 |
| **3** | **事件归组碎片化** | 窗口内 1872 个事件，**93.4% 只有 1 个参与者**；热榜要求 ≥2，所以它们全部隐形 |
| **4** | **`signal_group_id` 未配置** | 450 个源全为空；2617 个信号键**全是 `source:`**，没有 `group:` |

## 1. `rss-dev` 是个错误源（影响最大）

```
名字:  Google AI：DEV 作者专属（RSS）
实际:  https://dev.to/feed          ← dev.to 全站公共 feed
tier:  T1_5（门槛 65）
```

它抓到的内容：

```
The Most Expensive Feature Is the One Nobody Needs
Your passkey can be an encryption address. The domain is the key.
Stop Paying for Firebase: How to Self-Host Supabase on DigitalOcean for Free
```

**跟 AI 无关。** 来源是 `backend-import-aihot-sources-2026-09-30.json` 这个包（上游示范源里没有它），上游 `industry/sources.json` 不含 `rss-dev`。

它是**精选里最大的贡献者（16/36）**，因为通用技术文章在宽召回评分里也能拿到 65+。

## 2. tier 分档造成的入选率断层

门槛是分档的（`industry/selection.ts:12`）：

```ts
thresholds: { T1: 60, T1_5: 65, T2: 76 }
```

而我们的 tier 分布与上游示范**完全不同**：

| | 源数 | T1 | T1_5 | T2 |
|---|---|---|---|---|
| 上游示范 | 18 | 10（**56%**）| 0 | 8 |
| **我们** | **450** | **48（11%）** | 134 | **268（60%）** |

实测入选率：

| tier | 条数 | 入选 | 入选率 | 平均分 |
|---|---|---|---|---|
| T2 | 705 | 5 | **0.7%** | 39.5 |
| T1_5 | 549 | 26 | 4.7% | 38.8 |
| T1 | 46 | 5 | **10.9%** | 38.8 |

**三者平均分几乎相同，入选率却差 15 倍** —— 说明差异不是内容质量，纯粹是门槛档位。

被 76 分门槛卡掉的例子（原站热榜第 10 名的事件就在其中）：

```
T2  75.0  Google Research 发布 Cogentic 多智能体自动证明发现系统
T2  74.0  OpenAI 解雇 3 名安全团队研究员…        ← 同一天原站热榜 #10
T2  73.0  Anthropic IPO 招股书警告美国政府态度…
T2  73.0  OpenAI 智能体入侵澳大利亚新南威尔士州政府网站…
```

`selection.ts` 的注释本身就写明：**门槛要用使用者标注的样本重新校准**（`scripts/eval-selection.ts` + `docs/selection.md`），不要凭感觉改。**我们的门槛是从上游直接继承的，没有针对我们的信源结构校准过。**

## 3. 事件归组碎片化（热榜的直接原因）

热榜规则（`events/hot.ts:55-58`）：

```
heat-v1-48h-halflife24h    48 小时窗口，24 小时半衰期
MIN_PARTICIPANTS = 2       至少 2 个独立参与者
```

实测：

```
窗口内事件 1872 个
  单参与者 1749 个（93.4%）  ← 达不到 2，热榜上完全隐形
  可上榜    123 个
  最大参与者 20
```

**同一个话题被拆成一堆 1 参与者的碎片**，最典型的是 Meta Muse：

```
8 参与者  Meta 开源 Muse Gadgets 硬件生态        ← 唯一够格的
3 参与者  Meta Muse上线22天美国下载量破500万
1 参与者  Meta 将 AI 智能体 Muse 扩展至中小企业
1 参与者  Alexandr Wang 评论 Muse 优于 Dot
1 参与者  Meta Muse 对部分行业卖家构成威胁
1 参与者  Meta 智能体 Muse 将登陆智能眼镜
1 参与者  Alexandr Wang 发布 Muse Gadget 葡萄酒追踪功能
...（共 17+ 条碎片）
```

原站把这一簇聚成 #1 并写成一条综合摘要；我们这里有相当一部分素材，但**归组没把它们合起来**，于是 Meta Muse 在我们的热榜只排 #9。

## 4. `signal_group_id` 全空

```ts
// events/group.ts:67
export function participantKey(source: { id: string; signal_group_id: string | null }): string {
  return source.signal_group_id ? `group:${source.signal_group_id}` : `source:${source.id}`;
}
```

这个机制用来把**同一来源的多个镜像账号算作一个参与者**（防止刷热度）。我们 450 个源**全部未设**，所以 2617 个参与键全是 `source:`，`group:` 为 0。

对我们的影响是**双面的**：
- 同一组织的多个账号（如 `@OpenAI` 与 `@OpenAIDevs`）各算一个参与者 → 可能虚高
- 但也可能因此让某些事件更容易上榜

**这一项我没有确证对我们不利**，但它是原站很可能配置了、而我们没配的差异点，值得核对。

## 5. 覆盖广度本身也是差异

- 我们 450 个源、T1 仅 48 个（11%）
- 上游示范 18 个源、T1 有 10 个（56%）

原站是**精选少数高质量源**，我们是**广撒网**。广度带来更多长尾条目，但 T2 的 76 分门槛又把这些长尾挡在精选外 —— 结果就是**精选被少数几个 T1_5 源（尤其 `rss-dev`）主导**，而不是均匀分布。

## 6. 热榜排序还受"新鲜度衰减"影响

24 小时半衰期意味着**参与者少但很新的事件能超过参与者多但较旧的事件**：

| 事件 | 参与者 | 距最新报道 |
|---|---|---|
| OpenAI GPT-6.1 Sol | 13 | **8.0 小时** |
| Meta 开源 Muse Gadgets | 8 | 9.3 小时 |
| Tavus Griffin | 13 | **33.3 小时** ← 参与者多但旧 |
| OpenAI 与三名安全研究员终止合作 | 13 | 24.7 小时 |

所以两边抓取时点/回填进度的差异，也会直接改变排序。**这一项不是缺陷，是规则的正常表现。**

## 建议的处理顺序

| 优先级 | 动作 | 预期效果 |
|---|---|---|
| **P0** | **删掉 `rss-dev`**（或换成真正的 Google AI 源）| 精选立刻少 44% 的无关内容 |
| **P1** | 按 `docs/selection.md` 用标注样本**校准门槛** | 让 T2 好内容能入选，而不是被 76 分一刀切 |
| **P2** | 排查归组为何把 Muse 话题拆成 17 条 | 热榜候选池从 123 扩到更大 |
| **P3** | 核对 `signal_group_id` 该怎么配 | 影响"独立参与者"的计数口径 |

诊断脚本：`scripts/diagnose-surfaces.sql`（以上六个查询都在里面，改完信源或门槛后重跑）。


---

# P2 排查结论：归组不是元凶（推翻先前判断）

## 先纠正我自己

我在上一节的诊断里写"**事件归组碎片化**（93.4% 只有 1 个参与者）"，暗示归组把同一事件拆开了。**查下去发现这个归因是错的。**

## 实测：归组本身工作正常

**每个 story 挂多少报告**：

```
1 条    → 2998 个（82.7%）
2-3 条  →  506 个（14.0%）
4-10 条 →  107 个（ 3.0%）
11+ 条  →   14 个（ 0.4%）
近 48h 活跃事件平均报告数 1.52，最大 63
```

**看似"碎片"的其实是真的不同事件**。以 Anthropic 为例：

```
Anthropic 同日发布商业与消费者服务条款及 Usage Policy   3 报告
Anthropic 发布隐私与健康数据政策                        2 报告
Anthropic 发布美国 K-12 服务条款与数据处理协议          2 报告
Anthropic 上线 Claude Academy 教程中心与用例库          2 报告
Anthropic 公布领导团队构成                              1 报告
```

这些是**各自独立的事件**（不同的政策文件、不同的人事变动），不该合并。

**归组阈值也不保守**（`events/group.ts:40-46`）：

```ts
RECALL_TOP_FACTS = 10        每个报告召回 10 个候选事实
CONFIRM_BELOW_COSINE = 0.85  低于 0.85 由复核模型确认，不是直接拒绝
SIGNAL_MIN_COSINE = 0.72     氛围帖只要 0.72
SIGNAL_AUTO_COSINE = 0.92    0.92 以上免调用直接挂
```

## 真正的原因：来源覆盖不够重叠

**这是决定性的数字**：

```
story 的来源数分布：
  0-1 个来源 → 92.6%   ← 结构性上不了热榜（MIN_PARTICIPANTS = 2）
  2 个来源   →  4.9%
  3-5       →  1.9%
  6+        →  0.6%
```

热榜要求 **≥2 个独立参与者**（`events/hot.ts:58`）。而**我们 92.6% 的事件只有一个来源报道过** —— 不是归组没合起来，是**根本没有第二个来源报道它**。

### 氛围源几乎是空的（关键缺口）

```
hot_signal 文章     5745
  已挂 signal        353   ← 只有 6%
  已挂事实             0   ← 不建事实（符合设计：氛围源永不创建事件）
```

**105 个氛围账号发了 5745 条，只有 353 条挂到了事件上（6%），覆盖 104 个事件。**

氛围源本应是**最容易产生重叠的**（同一批 AI 人物、同一批话题），但 94% 的帖子找不到可挂的事件 —— 因为它们关注的很多东西，我们的**编辑源根本没报道**，于是没有"事件"可挂。

### 还有一半已分析文章没走完归组

```
已分析 9800 → 走过归组 5217 / 未归组 4583（46.8%）
队列里待处理的 group 任务: 0（没有积压）
失败任务 239（占 10580 完成量的 2.3%）
```

未归组的入库时间**集中在今天 11:00–13:00**（12 点那小时 1696 条）—— 是一次集中的积压，队列已排空。

## 修正后的结论

| 我原先的判断 | 实际 |
|---|---|
| 归组把同一事件拆散了 | ❌ 归组正常，拆开的是**真的不同事件** |
| 归组阈值太保守 | ❌ 0.85 以下有模型兜底，不保守 |
| **真正的问题** | ✅ **来源重叠不足：92.6% 事件只有 1 个来源** |

**所以 P2 不能靠改归组参数解决。** 它是信源结构问题：450 个源覆盖太广、太分散，任一具体事件往往只有一个源报道。原站能用较少源做出高热度榜，是因为它的源**集中在同一批高重叠的话题上**。

### 可能的改善方向（都需要你决定，不是我可以替你选的）

1. **补氛围源**：现有 105 个只有 6% 挂载率，说明素材与编辑事件不匹配；补充与现有编辑源话题重叠度更高的账号
2. **降低 `MIN_PARTICIPANTS`**：会让"只有一家报道"的内容也上热榜 —— 但这会改变热榜的含义（"讨论最多"变成"最近有什么"）
3. **接受现状**：热榜就是"被多个来源共同报道的事件"，123 个候选池是真实覆盖度决定的

**我没有改任何参数** —— 第 2 项是产品定义问题。


---

# 撤下误配源的已发布内容（2026-10-03）

## 背景：停用源不会撤回内容

`sources.enabled` **只被采集器读取**（`collect.ts:364` `WHERE s.enabled`），而公开出口只读 `publications.visibility`（`rules.ts` 的 `hasItemPage`）。**两者没有任何关联。**

所以停用一个源之后，它**已经发布的内容照旧展示**。`rss-dev` 就是这样：源已停用，但 23 条精选仍在首页。

## 机制：编辑覆盖优先

`publish.ts:186`：

```ts
const visibility = source.participation_mode === "isolated" ? "withdrawn" : (override?.visibility ?? "public");
```

`override`（`editorial_overrides`）**优先级高于自动判定**，所以：

- 写入 `visibility='withdrawn'` → `detail.ts` 判定为 **404**
- 首页、API、RSS、MCP、搜索索引**一次全部生效**（走同一个 publication projection）
- 因为是覆盖，**以后重新发布也不会复活**
- 与后台"撤回"是同一个机制，写同一张表，同样进审计日志

## 脚本

```bash
node scripts/withdraw-source.ts --source <源id> --dry-run   # 先看清单
node scripts/withdraw-source.ts --source <源id>             # 执行
```

实际用了两次（第二次是因为运行期间又有 2 条新发布完成），共撤下 **25 条**，首页归零。

**注意**：撤下只影响**前台可见性**，文章本身仍在库里（`rss-dev` 有 985 条 `public`）。若目标是"当作从没抓过"，那是另一件更大的事。

## 踩坑：`gcloud compute ssh` 不返回 ≠ 命令没跑完

第一次执行时我盯着"命令没返回"等了 10 分钟以上，以为卡住了，还 kill 掉重跑了一次。**其实第一次早就写完了。**

`gcloud compute ssh` 的输出是**缓冲**的，远端命令结束了管道也可能挂着。

**正确的排查方式**：不要等 ssh，**直接查数据库状态**。

```sql
-- 看写入是否在进行
select visibility, count(*) from publications where source_id = '<源id>' group by 1;
select count(*), max(updated_at) from editorial_overrides;
```

这次一查就发现 23 条早已变成 `withdrawn`。

## 关于"每条撤回为什么慢"

不是数据库慢。实测：

```
pg_stat_activity 活动查询: 0
锁等待:                   0
最长事务:                 0.0 秒
```

**没有阻塞。** 慢的原因是每次重发布都会额外入队两个后台任务：

```ts
await enqueue(QUEUES.notifySelected, { articleId }, …)   // 精选通知
await enqueue(QUEUES.prepareMedia,  { articleId }, …)    // 媒体准备
```

25 条 = 50 个新任务，要和正在进行的抓取、评分、归组分抢 worker。**是队列拥挤，不是 SQL 慢。**

**判据**：先查 `pg_stat_activity` 和 `pg_blocking_pids()`。若都为空，就不要怀疑锁，去看队列长度。


---

# 热点榜问题：根因定位（2026-10-03）

## 结论

热榜候选池小的根因**不是归组算法，也不是评分**，而是两件事：

1. **氛围源里混进了泛领域媒体** —— 财联社、证券时报、东方财富、华尔街见闻、IT168 等，
   它们的 feed 里 AI 只占一小部分，其余是财经/游戏/社会新闻
2. **召回门槛 0.72 把绝大多数真实匹配也挡掉了** —— 实测中位数余弦只有约 0.50

## 判定结果分布（`grouping_decisions`）

```
editorial:
  new-story         3779     ← 大多数编辑文章自成新事件
  same-fact          865
  new-fact-in-story  514
  roundup              7

hot_signal:
  signal-unmatched  3178     ← 99% 在召回阶段就空了
  signal             396
  signal-native       41
```

**关键**：3178 条 `signal-unmatched` 里**只有 37 条拿到了候选**（1.2%）。

对应代码（`group.ts:507-512`）：

```ts
if (!embeddingsAvailable()) return { verdict: "signal-unmatched" };
const recalled = await recallFacts(a.id, signalText(a), SIGNAL_MIN_COSINE, SIGNAL_TOP_FACTS);
if (recalled.length === 0) return write(null, "signal-unmatched", []);   // ← 99% 走到这里
```

**不是模型拒绝，是 `recallFacts` 一条都没召回。** 根本走不到 `judgeSignal`（那一步要付费）。

## 实测相似度：门槛 0.72 太高

召回池 **5169 行**（14 天内的编辑源已发布事实），抽样 20 条未挂载氛围帖，**没有一条是"池中无事实"** —— 池子不缺。

```
最高余弦相似度（×100）:
  88.5  安森美半导体将以大幅折价收购Synaptics，两只股票均在飙升   ← 唯一过 0.72 的
  65.4  卧槽有点好玩啊，它给每个实例默认 4 核 4G 内存…（开源项目）
  63.2  post-consumer market, anon
  60.6  Sam Altman says:
  56.0  个人投资者在ETF投资中的占比仍在持续扩大
  53.8  Singapore's government creates a dating app
  51.2  GOG限时免费领取西部铁路Roguelike游戏《赏金列车》
  48.5  财联社10月3日电，克利夫兰联储行长哈马克称…
  41.2  图集｜香港举办国庆烟花汇演 超3万枚烟花维港绽放
  39.9  Top BBC Director Says He's Been Reviewing a Fully AI…

达到各门槛的数量（20 条中）:
  ≥0.50: 12    ≥0.55: 6    ≥0.60: 4    ≥0.65: 2    ≥0.70: 1    ≥0.72: 1
```

**中位数约 0.50，远低于 0.72。** 而**唯一过门槛的是一条半导体财经新闻** —— 它确实挂到了一个 AI 事件上，这正是污染路径。

## 污染源：泛领域财经媒体（不是 X 转推）

我最初的假设是"X 搜索返回了转推，而 `retweeted_status` 没被填"。**查证后这个假设是错的** —— API 的 `retweeted_status` 字段正常，`x.ts:183` 的过滤有效。

真正的原因是**源本身就是泛领域媒体**：

```
财联社        131 条
IT168         52 条
证券时报      35 条
凤凰科技      35 条
东方财富      34 条
华尔街见闻    31 条
界面新闻      29 条
DoNews 20 / cnBeta 14 / 36氪 9 / 财新 8 / V2EX 7
（氛围源共 5850 条，疑似财经 361 条 = 6.2%，疑似游戏 85 条 = 1.5%）
```

这些源被标为 `hot_signal`（只作讨论证据、永不创建事件），但它们的 feed 里**大部分内容与 AI 无关**，于是：

- 绝大多数帖子召回为空 → 白跑一次嵌入计算
- 极少数（如半导体财经新闻）**误挂到 AI 事件上** → 污染热度

## 待决策（都需要人来定，不是参数问题）

| # | 选项 | 说明 |
|---|---|---|
| 1 | **清掉泛领域媒体源** | 财联社/证券时报/东方财富/华尔街见闻/IT168 等，它们的 feed 不是 AI 专版 |
| 2 | **降 `SIGNAL_MIN_COSINE`** | 0.72 → 0.55~0.60 会多召回一些，但**必须有标注确认"哪些相似度算真匹配"**，否则会把财经新闻挂到 AI 事件上（现在已经有 1 例） |
| 3 | 不动 | 热榜口径就是"被多方共同报道"，候选少是覆盖度决定的 |

**注意 2 的风险已被实证**：0.72 时那条半导体新闻就已经挂上了；再降门槛会挂得更多。

## 排查手法（可复用）

```sql
-- 判定结果分布：看清卡在哪一步
select s.participation_mode, d.verdict, count(*)
  from grouping_decisions d
  join articles a on a.id = d.article_id
  join sources s on s.id = a.source_id
 group by 1,2 order by 1, 3 desc;

-- 区分"召回为空"与"模型拒绝"
select d.verdict, count(*),
       count(*) filter (where jsonb_array_length(coalesce(d.candidates,'[]'::jsonb)) > 0) as 有候选
  from grouping_decisions d join articles a on a.id = d.article_id
  join sources s on s.id = a.source_id
 where s.participation_mode = 'hot_signal' group by 1;
```

**表名是 `grouping_decisions`**（不是 `article_decisions`），候选存在 `candidates` jsonb 列里。

**召回池的口径**（`recall.ts:41-49`）：只含 `participation_mode='editorial'`、`visibility='public'`、
`discovered_at` 在 **14 天（`RECALL_DAYS`）** 内、且 `role IN ('primary','report')` 的事实。
排查"召回为空"时先确认池子里有没有对应事件，再怀疑相似度。


---

# 热点榜根因（最终版）：事件密度不足（2026-10-03）

## 先撤回一个错误建议

我先前建议"清掉泛领域媒体源"。**这个建议基于错误假设，撤回。**

交接文档 `hot-signal-reverse-report-2026-10-02.md` 明确写着这是**从原站反推的原站氛围源**（85 个 = X 型 38 + 媒体/社区型 47），而且文档自己就记录了这些源产出非 AI 内容：

```
东财  样例: 9月30日东方财富财经晚报（附新闻联播）
财联社 样例: 财联社10月2日电，欧盟发言人表示，欧盟完全拒绝任何柴油出口禁令…
IT168 样例: 鸣潮耐力上限解锁稳定提升路线解析 - IT168下载站
      ⚠ 结果多来自 IT168下载站，质量一般（文档原话）
```

**原站确实在用这些源，且知道它们会产出这类内容。** 它们的角色是"背景噪音池"——偶尔匹配上 AI 事件作为周边证据。

## 配置层面全部一致（逐项核对过）

| 项目 | 原站 | 我们 |
|---|---|---|
| 氛围源名单 | 财联社/东财/华尔街见闻… | **同一批**（反推所得）|
| `SIGNAL_MIN_COSINE` | 0.72 | 0.72（未改）|
| `SIGNAL_AUTO_COSINE` | 0.92 | 0.92（未改）|
| `RECALL_DAYS` | 14 | 14（未改）|
| 嵌入模型 | `text-embedding-v4` @1024 | `text-embedding-v4` @1024 |
| `recall.ts` / `group.ts` | — | **一行没改** |

**所以不是配置错。**

## 真正的根因：一条报道的事件无法被讨论帖匹配

机制（`recall.ts:132-138`）：讨论帖与召回池里**每一条报道的文案**逐一比对，**每个 fact 取最高分**：

```ts
const consider = (r: PoolRow, score: number) => {
  const prev = best.get(r.fact_id);
  if (!prev || score > prev.score) best.set(r.fact_id, { ...r, score });
};
```

**一个事件有 N 条报道 = N 次达到 0.72 的机会。**

### 实测：挂载率随报道数单调上升（37 倍差）

| 事件的报道数 | 事件数 | 有讨论证据 | 挂载率 |
|---|---|---|---|
| **1 条** | **3268** | 62 | **1.9%** |
| 2-3 条 | 511 | 48 | 9.4% |
| 4-10 条 | 109 | 35 | 32.1% |
| **11+ 条** | 14 | 10 | **71.4%** |

有讨论证据的事件平均 **3.65 条报道**，没有的只有 **1.27 条**。

### 而我们的报道数普遍是 1

```
召回池里每个 fact 的报道条数:
  1 条 → 3969 个 fact（89.7%）
  2 条 →  311 个（7.0%）

已生成标题的事件里:
  0-1 条报道 → 3279 个（83.8%）
  2-3 条     →  511 个（13.1%）
```

## 不是归组的问题（已验证）

怀疑"该合并没合并"，查标题相近却分属不同事件的对：

```
xAI 完成 60 亿美元 C 轮融资    vs  xAI 完成 60 亿美元 B 轮融资      0.82
Claude Code v2.1.286 发布      vs  Claude Code 发布 v2.1.288 更新   0.74
Anthropic发布Transformer可解释性练习集 vs ...早期视频              0.74
Suno发布v4音乐生成模型          vs  Suno发布v4.5音乐生成模型         0.68
```

**这些是真正不同的事件**（不同轮次融资、不同版本），**不该合并**。（唯一的 1.00 是 `DEV 社区用户发布 [Boost] 帖子` 这个占位标题重复。）

**关键对照**：我们 20420 条发现记录只对应 20021 个不同 URL —— **每个 URL 平均只被 1.02 个源发现**。

**即：我们的编辑源之间几乎没有重叠，同一篇稿件不会被两个源同时抓到。**

## 结论

**"事件密度"= 同一个事件被多少条报道覆盖。**

- 我们 **83.8% 的事件只有 1 条报道** → 讨论帖只有 1 次机会过 0.72 → 挂载率 1.9%
- 原站的 hot_signal 机制要求"多方讨论同一件事"，**只有事件本身被多方报道时它才成立**

**这不是 bug，是信源结构问题**：我们的 editorial 源（无论 345 个还是多少个）**彼此不重叠**，各报各的。

## 三个方向（都需要判断，非参数问题）

| # | 方向 | 说明 |
|---|---|---|
| **1** | **增加同质源** | 不是加更多源，而是加**会报道同一批 AI 新闻的**源（如 5 家都报道 OpenAI 发布会的媒体）。这些源之间才会产生 2-10 条报道的事件 |
| **2** | 降 `SIGNAL_MIN_COSINE` | ⚠️ 已实证风险：0.72 时那条半导体财经新闻就挂上了；再降会更多 |
| **3** | 调整热榜口径 | 例如允许单报道事件按"最近报道时间"参与排序 —— **但这改变了"讨论最多"的定义** |

## 另一条可查的线索（未做）

上游开源仓库的示范源 **18 个全是 editorial、0 个氛围源** —— 氛围源名单是原站作者在生产环境加的，**没进开源仓库**。所以无法从代码确认原站真实的事件密度。

## 排查手法

```sql
-- 挂载率与报道数的关系（本次结论的核心查询）
with per_story as (
  select st.id,
         (select count(*) from facts f join fact_articles fa on fa.fact_id=f.id where f.story_id=st.id) as 报道数,
         exists (select 1 from story_signals ss where ss.story_id=st.id and ss.kind='signal') as 有讨论证据
    from stories st where st.merged_into is null
)
select case when 报道数<=1 then '0-1' when 报道数<=3 then '2-3' when 报道数<=10 then '4-10' else '11+' end as 报道数,
       count(*), count(*) filter (where 有讨论证据),
       round(100.0*count(*) filter (where 有讨论证据)/count(*),1) as 挂载率
  from per_story group by 1 order by 1;

-- 源之间是否有重叠（每 URL 被抓几次）
select round(1.0*count(*)/nullif(count(distinct a.url),0),2) as 每URL平均被发现次数
  from article_discoveries d join articles a on a.id=d.article_id;
```

**注意**：`stories.title` 在标题生成前是占位符 `事件更新中`（实测 3931 个里只有 18 个），
做标题相似度比较时必须排除，否则它们彼此相似度都是 1.00。


---

# 上游 4.0.0 升级前的数据备份（2026-10-04）

## 为什么必须先备份

上游 17 个新提交里，`1ca5d6d`（4.0.0）**把模型榜、Codex 重置监控、主题大事记移出框架**，
配套迁移**直接删表**：

```sql
-- 0053_drop_leaderboard_monitor.sql
DROP TABLE IF EXISTS lb_rankings, lb_scores, lb_prices, lb_aliases, lb_calibrations, lb_runs, lb_snapshots, lb_models;
DROP TABLE IF EXISTS monitor_event_posts, monitor_events, monitor_posts, monitor_state;
DROP TABLE IF EXISTS fx_rates;
DELETE FROM settings WHERE key IN ('leaderboard.fetch', 'models.monitor');

-- 0045_drop_topics.sql
DROP TABLE IF EXISTS topics;

-- 0051_drop_unused_state.sql
DROP TABLE IF EXISTS regroup_pending;
DROP TABLE IF EXISTS stored_files;
```

**我们此前是启用这三个功能的**（`/leaderboard` 与 `/codex-reset` 都是 200），所以升级会**永久删除数据**。

## 备份脚本

```bash
bash scripts/backup-dropped-tables.sh [输出目录]
```

- 只备份升级会删的表（从迁移文件里读出清单），含建表语句
- 只对**实际存在**的表加 `--table`（`pg_dump` 遇到不存在的表会报错）
- 同时打印各表行数，并统计归档内的 `CREATE TABLE` 数量做自检

## 本次备份结果

```
文件: /home/weijianlin/backups/dropped-tables-20261004T112629Z.sql.gz
大小: 4.7M
```

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
| | | | `regroup_pending` / `stored_files` | 0 |

**共 15 张表。**（`lb_calibrations` 在我们库里不存在，脚本自动跳过。）

## 备份内容验证（不只看"命令跑成功了"）

```
COPY 数据块数:        15
CREATE TABLE 数:      15
lb_scores 数据行数:   11124   ← 与库中行数一致
monitor_posts 数据行: 158
lb_scores 首行样例:   u52bp39iew451eysfh47cqny  mh5rlfsn7cixhvn16v4y5nts  …
```

**确认是完整数据，不只是建表语句。**

## 恢复方式

```bash
gunzip -c /home/weijianlin/backups/dropped-tables-20261004T112629Z.sql.gz \
  | docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot
```

## 升级时还要注意（上游 #105 的兼容说明）

| 项 | 影响 |
|---|---|
| `industry/site.ts`、`industry/models.ts`、`industry/features.ts` | **搬到 `site/`**（`features.ts` 整个移除）|
| 具名 `-think` 模型 | 要补 `reasoningTokens: 4000` —— 我们的 `deepseek-v4.1-flash-scorer` 需核对 |
| `DEPLOYMENT.directImageHosts` → `directFetchHosts` | 重命名 |
| 模型榜 / Codex 监控 / 主题大事记 | 要保留须移植到 `site/modules/`；**用户已决定不要** |

## 迁移编号的疑点已排除

上游有 5 个迁移文件挤在 2 个编号里（三个 `0056_*`、两个 `0057_*`）。查迁移器后确认**不影响执行**：

```ts
// scripts/migrate.ts —— 用文件名作主键，不是编号
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, ...)
const applied = new Set(...`SELECT name FROM schema_migrations`...);
for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) { if (applied.has(file)) continue; ... }
```

同号但文件名不同 → 各自记账、各自执行。只是编号不美观。

---

# 部署结果（2026-10-08）：合并上游 #153 那次

## 部署了什么

`upgrade-4.0` 合并上游 7 个提交后的镜像（含 #153「没有材料就等材料」、原生视频保留、SelectBench 指标、
向量缓存淘汰修复）。公开接口版本仍是 4.0.0，**本轮没有新迁移**（已应用迁移数部署前后都是 77）。

| 项 | 值 |
|---|---|
| 镜像 digest | `sha256:1353a8f31b78f055b9ffdd19bb1b3d1f0c1d75ac77d7b6393a04b090f0e2c22c` |
| 部署时间 | 2026-10-08 20:35（+0800） |
| 回滚点 | 服务器上的 `app:rollback-7be14a2bd52e`（**pulling 之前**打的标签，见「坑 2」） |
| 挂载目录同步 | `scripts/eval-selection.ts`（更新）+ `scripts/eval-selection-core.ts`（**服务器上原本没有**） |

`database/` 与 `industry/` 本轮无改动，所以没有迁移要单独上传。脚本上传后按 `DEPLOY-NOTES` 的老规矩
`sed -i 's/\r$//'` 去掉了 CRLF，再用「本地按 LF 归一化后的 md5」比对通过（`7eec8aaa…` / `d10d1c03…`）。

## ⚠️ 新踩到的坑：`COPY . .` 会把仓库根目录的转储打进镜像

`Dockerfile` 用的是 `COPY . .`，而 `.dockerignore` 只排除 `node_modules` / `.env` / `.git` 等。
仓库根目录当时躺着 4 个 `aihot-db-*.sql.gz`（**合计 544.6 MB**）和一个 `aihot-upload.zip`：
不处理的话它们会进镜像层并被推到 Artifact Registry。

这次的处置：构建前把 4 个转储临时移出仓库目录，构建+推送完再移回（`.zip` 只有 1.6 MB，进了镜像）。
**下次构建前二选一**：把转储挪出 `E:\cs\aihot`（交接文档本来就建议拷回本机一份），或给 `.dockerignore`
加 `*.sql.gz`、`*.zip`。

## 三条独立证据证明新版在跑

| 证据 | 值 |
|---|---|
| api / worker / web 容器的镜像 | 三个都是 `sha256:1353a8f31b78`，与服务器 `RepoDigests` 一致 |
| 容器内的代码 | `grep "missingEvidence(a) && !original"` = 1；`deepseek-v4.1-flash-scorer` 的 `maxTokens: 32_768` 在；`/app/scripts/eval-selection-core.ts` 在 |
| 站点 smoke | 在 **web 容器**里跑 `node /app/scripts/smoke.ts --base http://localhost:3000`：**30/30 通过** |

> smoke 要在 `aihot-web-1` 里跑，别在 worker 里跑 —— worker 不监听 3000，全项都会是
> `TypeError: fetch failed`（这次白跑了一轮）。

## 部署后复核

| 检查 | 结果 |
|---|---|
| 20 个公开地址（`/`、`/all`、`/more`、`/privacy`、`/feed.xml`、`/feed/all.xml`、`/llms.txt`、`/robots.txt`、`/sitemap.xml`、`/manifest.webmanifest`、`/openapi-v1.json`、`/api/health`、`/api/v1/items`、`/api/v1/hot-topics`、`/api/v1/selected/snapshot`、`/og/site.png`、`/icon.png`、`/favicon.ico`、`/leaderboard`、`/admin/login`） | 全部 **200** |
| worker 启动以来日志里的 error/50 | **0** |
| 待处理（`processing_state in ('new','pending')`） | **0** |
| 部署后是否还在给无正文条目评分 | **0 次**（复核 SQL 见下） |

行为变化（#153）此刻已生效但还没遇到样本：无正文条目本来就少（实测约每天 85 条），复核用这条 SQL：

```sql
select a.id, r.purpose from receipts r
  join articles a on r.subject = 'article:'||a.id||'@'||a.revision
 where r.created_at > timestamptz '2026-10-08 12:35:00+00'
   and coalesce(btrim(a.body_text),'') = '' and coalesce(btrim(a.excerpt),'') = ''
   and coalesce(btrim(a.x_post->>'text'),'') = '' and coalesce(btrim(a.x_post->'quoted'->>'text'),'') = '';
-- 只应看到 prefilter（有时加一条关于原帖的路径）；出现 score/structure/understand/summarize 就是没生效
```

---

# 权重重置与编辑源包整合（2026-10-08）

## 做了什么

「权重」= `sources.tier`，它同时决定三件事：入选门槛（T1 60 / T1_5 65 / T2 76 / EXCLUDE_MP 不评分）、
能不能推送（`PUSH_TIERS = ["T1","T1_5"]`）、以及**一手标记**（`tier='T1'` → 事件主位、日报「（一手）」与
排序、代表作优先、公开面 firstParty 频道）。判据按「谁在说话」，不按产量：

| 分级 | 判据 |
|---|---|
| `T1` | 当事方的**机构发布渠道**：官网 / 官方博客 / Newsroom / 官方 RSS / 官方 X 机构号 / 产品官方号 / 官方 Release 页 |
| `T1_5` | 当事方的**人**（CEO / 创始人 / 首席科学家 / 研究员 / 工程）与准一手创作者 |
| `T2` | **转述方**：媒体、聚合、社区、独立作者与记者 |
| `EXCLUDE_MP` | 全量分类火车型，不评分、只进「全部动态」 |

落地：**改档 48 个源 + 新建 31 个源（AIHOT 编辑源包 79 条里库里没有的那部分）+ `first_party` 全表归一**。

| 项 | 值 |
|---|---|
| 启用中的 editorial 源 | 250 → **281**（含新建 31） |
| 分级分布 | T1 34→**66**、T1_5 81→**101**、T2 135→**110**、EXCLUDE_MP 0→**4**（含补做的 6 个个人源） |
| 源总数 | 450 → **481** |
| `sources.first_party` 归一 | 109 行（列值与 tier 不一致的清零） |
| `publications.first_party` 归一 | 1210 行 |
| 入队重发 | 48 个源，全部 completed |

几处主要改动：`Tomer Tunguz 博客` T1→T2（30 天 1885 条、入选 68 条、占全站入选第一，却是 VC 分析的转述方）；
`Meta/NVIDIA Newsroom`、`Cloudflare Blog`、`@NVIDIAAI`、`@ElevenLabs`、`@cohere` 等 14 个 T2→T1；
`@ChatGPT`、`@claudeai`、`@GoogleDeepMind` 等 13 个 T1_5→T1；`@JeffDean`、`@karpathy`、`@Simon Willison` 等
14 个 T2→T1_5；arXiv cs.LG/cs.AI/cs.CL 与 HF Daily Papers 四个火车型 → EXCLUDE_MP（30 天 3778 条、入选 0，
每天省约 250 次付费评分）。

## 怎么做的（可复跑）

```bash
# 1. 仓库侧：industry/sources.json 记录同一份改动（新部署 seed 时就是了）
# 2. 线上应用（scripts/ 是挂载目录，不用重建镜像）
gcloud compute scp scripts/apply-tier-mapping-2026-10-08.ts scripts/tier-mapping-2026-10-08.json \
  weijianlin@aihot:/home/weijianlin/aihot/scripts/ --zone=asia-east2-c
gcloud compute ssh weijianlin@aihot --zone=asia-east2-c \
  --command="cd aihot && sudo docker exec aihot-worker-1 node scripts/apply-tier-mapping-2026-10-08.ts --dry-run"
# 去掉 --dry-run 即真正写库（先 dry-run 看计划）
```

脚本会：更新改档源（tier + first_party）→ 全表归一 `first_party = (tier='T1')` → 新建 31 个 X 源
（`config.query = from:<handle> -filter:replies`、`interval_minutes=30`、`enabled=true`）→ 对每个改档源入队
`QUEUES.republishSource`（后台改源走的就是这条路径），让 `publications` 跟着重算。全程不调模型。

## ⚠️ 两个必须记住的点

1. **`scripts/seed.ts` 只插不改**（`ON CONFLICT (id) DO NOTHING`，仓库与服务器一致）。所以
   「改 `sources.json` 再 seed」对**已存在**的源无效 —— 本文档旧版说「上游现在是 DO UPDATE」是错的，
   已在上文纠正。要改已有源必须走后台或会 UPDATE 的脚本。
2. **改 tier 只改 `sources` 不会刷新公开投影**。`publications.first_party` 是发布时按 tier 写下的；本次
   48 个源的重发任务跑完（全部 completed）后，全库仍有 1210 条与之不一致（1081 条来自**更早**改过级、
   从未重发的源，129 条是 T1 源里发布时还不是 T1 的旧条目）。最后用一条单列 UPDATE 归一：
   ```sql
   UPDATE publications p SET first_party = (s.tier = 'T1')
     FROM sources s WHERE s.id = p.source_id AND p.first_party <> (s.tier = 'T1');
   ```
   这一列是纯派生值，不涉及模型与内容，可随时按同一句重算。

## 验证

| 检查 | 结果 |
|---|---|
| 分级分布 | T1 66 / T1_5 101 / T2 110 / EXCLUDE_MP 4（启用中的 editorial） |
| `sources.first_party` 与 tier 不一致 | 0 |
| `publications.first_party` 与 tier 不一致 | 0 |
| 重发任务 | 48/48 completed |
| 抽查 | `rss-tomtunguz` 一手 0/1885、`x-account-openai` 13/13、`@elonmusk` 111/111、`rss-arxiv-3` = EXCLUDE_MP |
| 新源开始采集 | `@amasad` 5 条、`@huggingface` 1 条、`@MistralAI` 1 条（应用后几分钟内） |
| worker 报错 | 0 |

## 回滚

改档表在 `scripts/tier-mapping-2026-10-08.json`（只有新值），旧值在
`E:\cs\hot\2026-10-08\tier-mapping-2026-10-08.csv` 的 `current_tier` 列。按旧值重跑一次同样的 UPDATE +
重发即可；`industry/sources.json` 的旧副本在 `E:\cs\hot\2026-10-08\sources.json.bak`。新建的 31 个源可以
`enabled=false` 或直接删除（它们还没有历史判断价值）。

## 补做的一条（同日）

T1 名单里原本还有 6 个**个人源**，按「T1 只给官方渠道」的判据已全部降到 `T1_5`：`@elonmusk`（115 条）、
`@mntruell`、`rss-dwarkesh`、`rss-gary-marcus`、`rss-lilianweng`、`rss-interconnects`。改后启用中的
editorial 分布是 **T1 66 / T1_5 101 / T2 110 / EXCLUDE_MP 4**；这 6 个源的重发任务全部 completed，
`publications.first_party` 与 tier 不一致仍为 0（这次重发把该刷的都刷到了，没有再手工 UPDATE）。

**仍不一致、待定的两条**：同一个人两个渠道档位不同 —— `@lilianweng`（X，T2）与 `rss-lilianweng`
（博客，T1_5）、`@natolambert`（X，T2）与 `rss-interconnects`（博客，T1_5）。要对齐就把这两个 X 账号
也提到 T1_5（门槛 76→65 并获得推送资格）；没有确认前保持 T2。
## 氛围源（hot_signal）这边的情况（同日核查）

**这轮的氛围源包不在盘上**。`source-split-all-2026-10-08.md` 的落地包表里列了三个包，实际只有编辑源包
（79 条）在 `E:\cs\hot\2026-10-08`；`backend-import-aihot-hot-signal-2026-10-08`（185 条 = X 126 + 媒体 59）
和 `backend-import-aihot-roster-x-gap-2026-10-08`（60 条 X）都没有文件，全盘与桌面/下载目录都找过。
要整合就把文件放进来，按同一套判据处理。

**顺手补了 2 条本该转精选源的**：包里 `participation_mode=editorial`，但库里仍是 `hot_signal` ——
`@NVIDIARTXSpark`（→ T1）与 `@reach_vb`（→ T1_5）。原因是我上一步只改了 tier 没改模式。
改后氛围源 105 → **103**，编辑源 283。这两个源已入队重发，`publications` 会按 editorial 重算。

**现有氛围源在正常跑**（103 个启用：rss 53 / x_search 46 / json_list 6）：

| 指标 | 值 |
|---|---|
| 信号量 | 近 24h **1231** 条、近 7 天 **7721** 条 |
| 参与方 | 近 7 天 **340** 个 |
| 热点榜计算 | `hot_rankings` 最新 **2026-10-08 13:30 UTC**；`story_heat_hourly` 到 13:00 |
| 页面 | `/hot` 200，接口 10 条（第 1 名：源 16 / 信号 30 / 参与者 46） |

**6 个氛围源实际采集不到东西，建议修或停用**：

| 源 | 症状 |
|---|---|
| `src-c378da5a1e` DEV Community、`src-5c57c60c50` SiliconANGLE、`src-c2ae08e9af` 车东西 | `no items mapped (check title/url paths)` —— `json_list` 的字段映射不对 |
| `src-cbf787802c` Golem.de | `fetch failed` |
| `src-153dacfb29`、`src-22a6ec4b2c` | `Blocked cross-origin redirect for a protected request`，最后成功 10-02 |
| `src-3a691df5b3`、`src-f6d2ad6f1b` | 偶发超时 / HTTP 406，但今天成功过，先观察 |

## 氛围源：停用采不到的 + 补进文档点名的（同上日）

**停用 6 个从来采不到内容的**（`enabled=false`，随时可开回来）：

| 源 | 症状 |
|---|---|
| DEV Community、SiliconANGLE、车东西 | `json_list` 字段映射不对：`no items mapped (check title/url paths)` |
| Golem.de | `fetch failed` |
| InfoWorld、Thurrott | 跨域重定向被拦，最后成功停在 10-02 |

**新增 5 个 `source-split-all-2026-10-08.md` 第四节点名、但台账里没有的**（全部 `hot_signal` + `T2`，
只喂热度、不进精选；已于 13:40 UTC 全部抓取成功）：

| id | 名称 | feed | 首次抓到 |
|---|---|---|---|
| `src-qbitai` | 量子位 | `https://www.qbitai.com/feed` | 10 条 |
| `src-sspai` | 少数派 | `https://sspai.com/feed` | 10 条（探测时只回 1 条，采集器拿到 10 条） |
| `src-ifanr` | 爱范儿 | `https://www.ifanr.com/feed` | 20 条 |
| `src-ruanyifeng` | 阮一峰的网络日志 | `https://www.ruanyifeng.com/blog/atom.xml` | 3 条（atom） |
| `src-meituan-tech` | 美团技术团队 | `https://tech.meituan.com/feed` | 10 条 |

氛围源现在 **102 启用 + 6 停用 = 108**。文档第二节点名的那些（Techmeme、cnBeta、钛媒体、36氪、虎嗅、
新浪科技、V2EX、掘金、DEV Community、宝玉）**早就都在库里**，这次没重复添加。

> ⚠️ **文档只写了氛围源的「数量」，没写名单**：`source-split-all-2026-10-08.md` 里 118 个 X 氛围源与
> 139 个媒体氛围源只有分类计数（举了 10 个例子），完整名单在缺失的
> `backend-import-aihot-hot-signal-2026-10-08`（185 条）与 `backend-import-aihot-roster-x-gap-2026-10-08`
> （60 条）两个包里。要补全这两个包里的源，得先拿到文件。

`美团技术团队` 是第一方官方博客但非 AI 垂直，按「只喂热度」放在氛围源；要当精选源是改 `participation_mode`
与 tier 两行的事。

## 氛围源全量包（ambient-sources-full-2026-10-08，同日）

`ambient-sources-full-2026-10-08.csv/.md` 是氛围源的完整清单：**X 126 + 媒体/社区 59 + 待判待补 83**。
逐条与库里比对后：

| 项 | 数量 | 处理 |
|---|---|---|
| X 氛围源 | 126 | 77 个库里没有 → 新建 **71** 个；43 个已在跑；**6 个是已纠正的旧 handle，跳过**（见下）|
| 媒体/社区 | 59 | **全部已在库**（53 rss + 6 json_list）；3 个地址与包不同（当前都能跑，未改）|
| 待判/待补 | 83 | 包内明确「⛔ 未进包」（缺地址/handle），**保持不动** |

**跳过的 6 个旧 handle**：`@ChatGPTapp`、`@cognition_labs`、`@elevenlabsio`、`@xai`、`@OpenRouterAI`、
`@ManusAI_HQ` —— 简介里写着「New account: @cognition」「Now at @SpaceXAI」，`source-split-all` 的 §5.1 已把
它们纠正成新 handle，而新 handle 在**精选源**里（本次已整合）。按旧 handle 建源只会抓到空或别人的内容。

**顺手修好 5 个一直采不到的媒体源**（包给了正确接法，实测可用后重新启用）：

| 源 | 原来为什么失败 | 改法 | 结果 |
|---|---|---|---|
| DEV Community | 缺字段映射 | `dev.to/api/articles` + `title/url/description/published_at` 映射 | 3 条 |
| SiliconANGLE、车东西 | 缺字段映射 | WordPress 映射（`title.rendered` / `{link}` / `excerpt.rendered` / `date`）| 各 3 条 |
| InfoWorld、Thurrott | `infoworld.com` → `www.` 跨域跳转被拦 | 直接写 `www.` 地址 | 各 6 条 |
| Golem.de | `fetch failed`（地址正确也抓不到）| — | **仍停用** |

氛围源现在 **179 个**（X 115 + rss 58 + json 6），除 Golem.de 外全部启用。

**新 X 源的采集受 SocialData 预算节流**：首轮 115 个 X 氛围源里 43 个成功、52 个报
`Budget for socialdata exhausted (minute)` —— 这是 `budgets` 表的每分钟熔断在起作用，会随预算回填自动继续，
不是故障。X 源从 ~190 增到 ~261 个，若嫌慢可在后台「设置 → 预算」调高 socialdata 的配额。

**包内自带的边界提醒已按它执行**：Gary Marcus 与 Simon Willison 的**博客**在精选源（现在是 T1_5），
他们的 **X 号**留在氛围源（`@garymarcus`、`@simonw` 本次新建）；Hacker News 归精选（现有两个 HN 源保持停用）。

## 6 个矛盾源的判定 + 83 个待判的处理（同日）

**能不能两者都是？不能。** `participation_mode` 是单值；但热度里本来就有两类参与方
（`story_signals.kind = editorial | signal`）：精选源作为「精选组」在加热度（就是卡片上的 `sourceCount`），
氛围源只加 `signalCount`。所以「上公开面 + 加热度」= 精选源一个身份就够，氛围源是「只加热度」。

### 6 个矛盾源（包里判氛围、库里是精选）按判据 + 实测定案

| 源 | 30 天实测 | 判定 | 理由 |
|---|---|---|---|
| `@runwayml` | 22 条 / 入选 0 / 均分 32.5 | **精选 T1**（原 T1_5）| 公司官方产品号，发布即当事方消息 |
| `@googleaidevs` | 2 条 / 入选 0 / 均分 24.5 | **精选 T1**（原 T1_5）| Google 官方开发者渠道 |
| `@pmarca` | 2 条 / 入选 0 / 均分 56.0 | **精选 T1_5**（不变）| 机构执行层个人（a16z 联创）|
| `@_akhaliq` | 21 条 / 入选 0 / 均分 27.6 | **氛围源** | 条目全是论文转述 |
| `@omarsar0` | 65 条 / 入选 0 / 均分 42.2 | **氛围源** | DAIR.AI 聚合号；65 条 0 入选、均分低于 50 的理解线 |
| `@lilianweng` | 0 条 | **氛围源** | 她的**博客**才是精选源（T1_5）；X 号是讨论号 |

这条同时解决了上一轮遗留的「同一个人两个档」：**博客归精选、X 号归氛围**，与包内对 Simon Willison、
Gary Marcus 的边界说明一致。转氛围的 3 个已入队重发，它们的条目会退出公开池（`eligible=false`）、仍加热度。

### 83 个待判/待补：4 个已在库、24 个补齐并落地、其余需 handle

- **已在库 4 个**：爱范儿、量子位（本轮新建的氛围源）、Oran Ge（`x-account-oran_ge` T1_5 精选）、
  Dex Horthy（`x-account-dexhorthy` T2 精选）。
- **补齐 24 个媒体**（全部 `hot_signal` + T2，只加热度）：The Guardian Technology、Nikkei Asia、CNET、
  Computerworld、CNBC Technology、BleepingComputer、Silicon Republic、Tech.eu、Numerama、ServeTheHome、
  FT Technology、Fortune Tech、The Bridge、Semafor、极客公园、蓝点网、小众软件、机器之心、智东西、
  麻省理工科技评论中国、创业邦、同花顺、手机中国、科技日报。中文那批用
  `news.google.com/rss/search?q=site:<域名>` 兜底（原生 RSS 已停或没有）。
- **跳过 2 个重复**：`36氪·AI`（与已有 36氪 同一条 RSSHub 路由）、`掘金 AI 分类`（已有掘金）。
- **探不到的 2 个**：CTech、Impress Watch（原生与 Google News 都没有可用 feed）。
- **剩下 46 个 + 3 个待补 handle**：绝大多数是**个人**（Graham Neubig、Sarah Guo、Elad Gil、Armin Ronacher、
  @levelsio、Matthew Berman、Robert Scoble…）。判定明确 —— **氛围源**（个人评论/转述）；缺的是**可核实的 handle**，
  猜错会抓到别人的内容，所以没有自动建源。

氛围源现在 **206 个**（X 118 + rss 82 + json 6），全部启用。

## 48 个待核实 handle 的核实结果（同日）

83 个待判里剩下的 48 个（个人号为主）用 4 个并行 agent 逐个核实：**要求给出可追溯证据（本人主页 / GitHub
自报的 twitter_username / x.com 档案），不许猜**。结果：**45 个高/中把握入库**，3 个跳过。

| 结果 | 数量 | 说明 |
|---|---|---|
| 已建为氛围源 | **45** | 全部 `hot_signal` + T2 + 60 分钟间隔 |
| 已在库 | 2 | `@omarsar0`（Elvis Saravia）、`@hq4ai`（汗青 HQ）—— 查重拦住 |
| 无把握 | 1 | AppSail：唯一可查的 `@AppSaildotDEV` 已注销（404），`@AppSail` 是无关公司号 |

证据强度分两档：**GitHub 用户 API 的 `twitter_username` 自报字段**（最硬，如 `mitsuhiko`、`gneubig`、
`saranormous`、`thdxr`、`osanseviero`）与**x.com 档案 + 独立第二来源**（如 `AndrewCurran_`、`btibor91`、
`elder_plinius`）。两个易错点已按证据修正：`@levelsio`（不是 @levels）、`wong2` 的 handle 尾部是**两个下划线**
（`wong2__`）、`fofr` 要记 `fofrAI`（`@fofr` 是他自己声明的私人小号）、`麦当mdldm` 是 `czzzzzzJ_`
（`@mdldm` 是无关账号）。核实清单与逐条证据留在 `E:\cs\hot\2026-10-08\_handles-verified.json`。

**顺带修掉一个我自己的 bug**：应用脚本里那条 INSERT 的 `interval_minutes` 我写死了 30，数据里的 60 没生效，
45 个源建成了 30 分钟档；已改脚本并对库执行 `UPDATE`（现在 89 个 X 氛围源是 60 分钟档）。

## ⚠️ X 抓取已经严重供不应求（这次一并查出来的）

| 项 | 值 |
|---|---|
| 启用中的 X 源 | **346 个**（editorial 183 / hot_signal 163）|
| 按各自间隔需要的轮询量 | **601 次/小时** |
| `socialdata` 预算 | 每分钟 **10**、每小时 **100**、每天 **1000** |
| 近 1 小时实际调用 | **100 次**（正好撞在小时上限）|
| 今天累计 | **527 次**（日预算 1000）|
| 被预算挡下的源 | **144 个**，报 `Budget for socialdata exhausted (minute|hour)` |

也就是说：**X 源实际被抓的频率远低于配置的间隔**（346 个源分 100 次/小时 ≈ 平均 3.5 小时一次），
其中 183 个 editorial 源是本站的正文来源 —— 这是「新鲜度」问题，不只是氛围源的问题。
这个瓶颈在本次加源之前就存在（当时 199 个 X 源、需求约 398 次/小时），加源把它放大了。三条路可选：
① 调高 `budgets` 表的 socialdata 配额（按请求计费，费用随调用量线性上涨）；② 拉长间隔
（把 editorial 调到 120 分钟、氛围源调到 360 分钟，需求才降到约 119 次/小时，仍高于 100）；
③ 精简 X 源。**这是花钱的决定，等你定。**

## X 抓取配额：按「只保证精选源」调整（同日）

上面那节的供需缺口已处理。**改的是 `budgets` 表 + 各源间隔，不是环境变量**（后台「设置 → 预算」页改的也是这张表）：

| 项 | 改前 | 改后 |
|---|---|---|
| `socialdata` 预算（分/时/天） | 10 / 100 / 1000 | **30 / 300 / 7000** |
| editorial X 源（183 个） | 30 分钟档（实际约 3.5 小时才轮到）| **60 分钟档** → 需求 183 次/小时 |
| 氛围 X 源（163 个） | 30 或 60 分钟档 | **120 分钟档** → 需求 82 次/小时 |
| 合计需求 | 601 次/小时 | **265 次/小时**（预算 300，留 12% 余量）|

**效果（改后 10 分钟实测）**：X 抓取折算约 378 次/小时；**近 1 小时 307/346 个 X 源成功**（改前是 100 次/小时封顶）、
**精选源 162/183 恢复**；被预算挡下的源从 144 降到 75（剩下的是刚重置 `next_fetch_at` 在排队的）。

⚠️ **成本提醒**：代价是调用量上一个数量级 —— 改前实际约 530 次/天（被 100/小时封顶压出来的），
现在按需求跑满约 **4 400–6 400 次/天**。SocialData 按请求计费，如果账户额度撑不住，把 editorial 也调到
120 分钟档即可把日调用砍到约 2 200 次（需求 91+82=173 次/小时），预算也可同步回落。

---

# 部署后观察清单（2026-10-08 收工；次日核对）

## 基线（今天收工时的值，用来对比）

| 指标 | 值 |
|---|---|
| 源总数 | **626**（editorial 375 / hot_signal 251）|
| 启用中的 editorial 分级 | T1 69 / T1_5 100 / T2 107 / EXCLUDE_MP 4 |
| X 源 | **346**（editorial 183 / 氛围 163）—— 按分片读取，约 15 个分片/轮（见第 1 节）|
| `socialdata` 预算 | 30 / 300 / **7000**（今天下午从 10/100/1000 调高）|
| 今天 socialdata 调用 | **610 次**（大部分时间还压在旧预算上）|
| 本轮新建源 | **176 个**（31 编辑 + 145 氛围），其中 **148 个已抓到内容**（84%）|
| 近 24 小时 | 信号 1301 条 / 参与方 209；精选 35 条（T1 13、T1_5 15、T2 7）|
| `rss-tomtunguz` | 近 24 小时 1 条、入选 **0**（降级前：30 天 68 条入选）|
| 站点 | `/`、`/hot`、`/all`、`/daily` 全 200；worker 0 报错 |

## 1. 成本与配额（最要紧，跑一天再看）

```sql
-- 每天实际花了多少次 X 抓取
select created_at::date as "day", count(*) from receipts where service='socialdata' group by 1 order by 1 desc limit 3;
```

- **期望**：约 **1 000–1 500 次/天**（见下面的「分片」说明 —— X 抓取的请求数远小于源数）。
  接近 7 000 才说明日上限成了瓶颈；低于 500 说明有别的瓶颈（看下一条）。
- **注意 X 是分片读取的**：一个 SocialData 请求可以覆盖最多 **24 个账号**
  （`x.ts` 的 `SHARD_MAX_ACCOUNTS`，查询形如 `from:(a OR b OR …)`），所以
  **346 个 X 源并不等于 346 次请求/轮**，而是约 15 个分片。每轮分片的节奏由参与方式决定
  （`collect.ts` 的 `X_SHARD_MINUTES`：editorial 30 分钟、hot_signal 60 分钟），
  而且 `adaptIntervals`（每天跑一次）会**按这个节奏把每源的 `interval_minutes` 写回去** ——
  所以手动改 X 源的间隔会被覆盖，那不是 bug，别跟它较劲。
- **看还有没有被挡的源**：
  ```sql
  select left(last_error,46) as err, count(*) from sources where last_error is not null group by 1 order by 2 desc limit 5;
  ```
- **真要压成本**，有效的是这两条（改 X 源间隔无效）：
  ```sql
  -- ① 降预算（超了就先排队，不会超支）
  UPDATE budgets SET per_minute=10, per_hour=100, per_day=1200 WHERE service='socialdata';
  -- ② 停掉长期没产出的 X 源（这是真正减少请求的办法）
  UPDATE sources SET enabled=false WHERE kind='x_search' AND enabled
    AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.source_id=sources.id AND a.discovered_at > now() - interval '30 days');
  ```

## 2. 新源是否真的在工作

```sql
select count(*) filter (where (select count(*) from articles a where a.source_id = s.id) > 0) || ' / ' || count(*) as "有内容的源"
from sources s where s.created_at > now() - interval '2 days';
```

- **期望**：24–48 小时后 ≥ 90%（今天 8 小时时是 148/176）。
- 仍是 0 条且 `last_error` 又不是预算问题的，逐个查 —— 尤其那 29 个用
  `news.google.com/rss/search?q=site:<域名>` 兜底的媒体源，Google News 可能限流。

## 3. 权重改动是否按预期起作用

```sql
-- 精选构成（T1 占比应比改动前高）
select s.tier, count(*) filter (where p.selected) as selected
from publications p join sources s on s.id = p.source_id
where p.timeline_at > now() - interval '1 day' group by 1 order by 1;

-- 4 个 EXCLUDE_MP 火车型：不该再有评分回执（它们仍应出现在 /all）
select s.id, count(r.id) as score_calls
from sources s left join receipts r on r.subject like 'article:' || s.id || '@%'
     and r.purpose='score_article' and r.created_at > now() - interval '1 day'
where s.id in ('rss-arxiv','rss-arxiv-2','rss-arxiv-3','web-arxiv') group by 1;

-- 3 个转氛围的源：公开池里的条目应为 0
select s.id, count(*) filter (where p.eligible) as in_pool, count(*) as total
from publications p join sources s on s.id = p.source_id
where s.id in ('x-account--akhaliq','x-account-omarsar0','x-account-lilianweng') group by 1;

-- 升到 T1 的源：新发布条目应带一手标记
select s.id, count(*) filter (where p.first_party) as first_party, count(*) as total
from publications p join sources s on s.id = p.source_id
where s.id in ('x-account-runwayml','x-account-googleaidevs','rss-meta-newsroom-ai','x-account-openrouter')
group by 1;
```

## 4. 新鲜度（editorial X 从 30 分钟档改成了 60 分钟）

```sql
select s.name, max(p.timeline_at) as latest
from publications p join sources s on s.id = p.source_id
where s.kind='x_search' and s.participation_mode='editorial' and s.tier in ('T1','T1_5') and s.enabled
group by 1 order by 2 asc limit 10;
```

- **期望**：主力源的最新条目停在 1–2 小时内。若普遍超过 4 小时，说明配额仍不够 —— 先查第 1 节。
  **注意别把长期不发的账号当成「不新鲜」**：下面这条加了「近 7 天有产出」的过滤，否则排在最前面的
  全是 @ylecun、@GroqInc 这类本来就很少发推的账号（10-09 实跑时就踩了这个）。
  ```sql
  select s.name, max(p.timeline_at) as latest
  from publications p join sources s on s.id = p.source_id
  where s.kind='x_search' and s.participation_mode='editorial' and s.tier in ('T1','T1_5') and s.enabled
    and exists (select 1 from articles a where a.source_id = s.id
                and a.discovered_at > now() - interval '7 days' and not a.backfill)
  group by 1 order by 2 asc limit 10;
  ```

## 5. 站点与出刊

- `/`、`/hot`、`/all`、`/daily` 全 200；worker 近 5 分钟 level 50/60 计数为 0。
- 日报/周报照常出刊：tier 改动会影响事件主位与「（一手）」标注，看一两期是否合理
  （官方渠道当主位、T2 媒体不作主位）。

## 6. 还没做、但可能想做的

- 83 个待判里仍有 2 个探不到 feed（CTech、Impress Watch），3 个缺 handle 的已放弃 1 个（AppSail 注销）。
- 那 46 个个人源已经补完（45 个入库），没有遗留。
- `roster-x-gap`（60 个 X 缺口）如果之后拿到文件，按同一套脚本跑一遍即可。

## 10-09 实跑基线表：两处更正 + 实测结果

清单写完当天（10-09 11:34 UTC）跑了一遍，结果如下，其中**两条要更正**（我原先的分析错在把「源数 × 间隔」
当成了请求数）：

| 检查 | 实测 | 判断 |
|---|---|---|
| 源 / 分级 | 626 个；T1 69 / T1_5 100 / T2 107 / EXCLUDE_MP 4 | ✅ 与基线一致 |
| 预算挡下的源 | **0 个**（改前 144）| ✅ 配额调整生效 |
| 新建源是否工作 | 176 个里 **166 个已抓到内容**（94%，早上是 84%）| ✅ 在收敛 |
| 火车型评分回执（24h）| **0 次** | ✅ 省钱目标达成 |
| 转氛围的 3 个源在池条目 | **0/27、0/8、0/75** | ✅ 已退出公开池 |
| 升 T1 的源一手标记 | meta-newsroom 15/15、googleaidevs 8/8、openrouter 40/40、runwayml 23/23 | ✅ 全部到位 |
| 精选构成（24h）| 19 条：T1 11 / T1_5 6 / T2 2 → **T1 占 58%**（改动前基线 37%）| ✅ 权重在起作用 |
| `rss-tomtunguz` | 24 小时 0 条、0 入选 | ✅（它本身产出就慢）|
| 站点 / worker | 四个页面 200、level 50/60 = 0 | ✅ |

**更正 1：X 抓取是分片读取的，不能拿「源数 × 间隔」估请求量。**
`x.ts` 的 `SHARD_MAX_ACCOUNTS = 24`：一个请求形如 `from:(a OR b OR …)` 覆盖最多 24 个账号，
346 个 X 源 ≈ **15 个分片/轮**（editorial 30 分钟、hot_signal 60 分钟，见 `X_SHARD_MINUTES`）。
实测今天（10-09，11.5 小时）522 次调用 ≈ **45 次/小时 ≈ 1 100 次/天**，
所以第 1 节的期望值已从「4 000–6 400」改成「1 000–1 500」。
反过来说：**旧预算（100 次/小时、1 000/天）确实卡住了**（10-08 那天正好用满 610 次后开始挡源），
调到 30/300/7000 是必要的，但成本涨幅是大约 **2 倍**（1 100–1 500/天 vs 之前 1 000/天上限），
不是我先前说的 6–12 倍。

**更正 2：手动改 X 源的间隔没用。** `adaptIntervals`（每天跑一次）会把可分享搜索的账号按参与方式
写回固定节奏（editorial 30、hot_signal 60）—— 我 10-08 设的 60/120 就是这么被覆盖回去的，
这是引擎的设计，不是 bug。真要压成本只有两条路：**降预算**（超了排队、不会超支）或**停掉没产出的源**
（第 1 节已更新成这两条，并附 SQL）。

---

# 恢复历史归档闸门（2026-10-09）

## 丢了什么

`5d49267`（10-03「历史归档不再评分，只做预筛」）加的闸门在 **4.0.0 升级时丢了**：升级那一步
（`1ca5d6d`「引擎改为从 AIHOT 线上代码直接导出」）是整体导出上游代码重建的，那个提交留在旧的 `main` 上，
`git merge-base --is-ancestor 5d49267 HEAD` 返回 1 —— 它不在 `upgrade-4.0` 的祖先里，配套的
`tests/history-limit.test.ts` 也一起没了。上游没有这个概念，合并时不会替我们保留。

**后果（实测）**：升级后历史归档条目又被完整判定。近 3 天 305 条归档条目 → **532 次评分调用**
（另有 305 预筛、284 结构化、226 摘要写作、54 理解写作），单 10-08 一天就有 424 次评分回执。
另外这些条目里有 19 条被选中进了精选 —— 正是闸门当初要拦掉的那类（新源首次导入带进来的旧归档）。

## 恢复的做法（`c154153`）

按原样恢复，适配当前（上游 #153 之后）的流程，一共 5 个文件：

| 文件 | 改动 |
|---|---|
| `editorial/analyze.ts` | `StepOpts` 加 `sweep`；`runAnalysis` 在「预筛 BLOCK」「无正文」两道早退之后加闸门 |
| `editorial/input.ts` | 分析输入带回 `backfill` |
| `content/materials.ts` | `isHistorical` 同时接受 DB 行（snake_case）与加载输入（camelCase）；未标记 `backfill` 视为非归档 |
| `jobs/content.ts` | 自动队列传 `sweep: true`；后台点名的重评估（带 `attemptTag`）不受限 |
| `tests/history-limit.test.ts` | 从 `5d49267` 恢复，3 条全过 |

判据没变（`isHistorical`）：`backfill` 且「发布时间未知或发现时已过期 **48 小时**以上」。
**发布后 48 小时内被发现的不算归档**，照常完整判定 —— 新源今早发的帖子仍是新闻。

## 生产验证（受控实验）

部署后队列里没有待处理的归档条目，所以挑一条重新入队验证
（`jey4g15zwfb7swx5j3t3hvpbk`，发布 10-05、发现 10-09、正文 1624 字，只改 `processing_state`）：

| | 恢复前（10:50 那次分析） | 恢复后（12:00 那次分析） |
|---|---|---|
| 判断 | `pass`，标题 26 字、摘要 192 字 | **`unknown`，无分、无标题、无摘要** |
| 公开池 | 在池、曾被选中 | **`eligible=false`、`selected=false`** |
| 回执 | 预筛 + 2 次评分 + 结构化 + 写作 | **无新回执**（预筛答案命中缓存，这次重跑零调用）|

部署镜像 `de25abb0475d`（回滚点 `rollback-1353a8f31b78`），三个容器已换新，站点 `/`、`/hot`、`/daily` 全 200、
worker 零报错。

## 加进观察清单

```sql
-- 历史归档条目不该再有评分回执（有就是闸门又丢了）
select r.purpose, count(*) from receipts r join articles a on r.subject = 'article:'||a.id||'@'||a.revision
where a.backfill and r.created_at > now() - interval '1 day' group by r.purpose order by 2 desc;
-- 期望：只有 prefilter_article；出现 score_article / structure_article 就要查 analyze.ts 的闸门还在不在
```

## 在容器里跑全套测试：本机终于有了 CI 环境的验证通道（10-09）

找回 `scripts/test-in-container.sh`（旧线 `269a3be`）后，为了让它在**本机**真能跑起来，踩了 5 个环境缺口，
都已修在脚本里（不改上游代码）：

| 缺口 | 现象 | 处理 |
|---|---|---|
| 本机唯一的 bash 是 WSL，且它连不到 Docker 守护进程 | 脚本报 `postgres ... is not reachable`（其实是 docker 命令本身失败）| 补 `scripts/test-in-container.ps1`：同一个 docker run 的 PowerShell 版 |
| 镜像设了 `NODE_ENV=production` | `npm ci` 跳过 devDependencies，测试专用包（`@modelcontextprotocol/client`）缺失 → 8 条 MCP 断言全挂 | `npm ci --include=dev` |
| 同一个 `NODE_ENV=production` 还会让 dev-admin 通道关闭 | `admin/auth.ts:267` 要求 `environmentName !== "production"`，测试打 `/api/admin/...` 得到 **401**（期望 400）| 运行测试时传 `NODE_ENV=test` |
| `tests/*.test.ts` 这个 glob 会连 `*.standalone.test.ts` 一起匹配 | standalone 套件在数据库 global setup 下运行 → 假失败 | 默认目标排除 `*.standalone.test.ts` |
| `architecture.test.ts` 用 `git ls-files` 枚举模板文件 | 镜像没有 git；而且暂存树 `/work` 不是 git 仓库（`.git` 有 561 MB，不适合每次复制）| 尽力 `apt-get install git` + 只读挂载宿主的 `.git` 到 `/gitdir`，用 `GIT_DIR`/`GIT_WORK_TREE`（含 `safe.directory=*`）指向暂存树 |

**结果**：`pwsh -File scripts/test-in-container.ps1` → **626/626 通过**（Linux / Node v24.21.0 / pg_dump 17.11），
这正是上游 CI 的环境。以后「Windows 上跑不了全套」不再是借口：DB 套件走这条，standalone 套件用
`npm run test:standalone`，静态检查用 `npm run typecheck`。

单文件也支持：`pwsh -File scripts/test-in-container.ps1 tests/history-limit.test.ts`。

---

# 安全审查（2026-10-09，依据 SECURITY-PLAN.md）

**结果**：5 条发现（3 条已修、2 条待决策），10 条疑点被核实**不成立**（留档在 `SECURITY-REVIEW.md` §4，含我预判的
「存储型 XSS」—— 浏览器实测 `data:text/html` 在 `<img>` 上下文不执行，降为 S3），方案本身被纠错两处
（SSRF 闸的真实路径是 `lib/url.ts` / `lib/http-fetch.ts`；OG 分享图不做外部取图）。

**已修并提交**（`upgrade-4.0`）：

| 提交 | 内容 |
|---|---|
| `702cea2` | 清洗器惰性属性绕过：`data-src`/`data-original`/`data-poster` 的值从不经过 scheme 白名单就落进 `src`/`poster`（二次清洗也修不回）；改为清洗后按标签校验地址属性（`img` 只额外允许 `data:image/…`）|
| `f9f45a6` | SSRF 名列表绕过：结尾的点让 `blockedHostname` 失配（`http://localhost./`）；比较前归一化 |
| `f7c1f64` | `deploy/Caddyfile` 加 HSTS / `X-Frame-Options` / `nosniff` / `Referrer-Policy` / `Permissions-Policy`（不设 CSP，图片代理自己的 CSP 不受影响）|
| `c0da905` | 修 `scripts/test-in-container.ps1` 的 CRLF 缺陷（`sh -c` 读到 `set -e\r` 直接失败）|
| `71791a8` | 收录 `SECURITY-REVIEW.md` |

独立复测：`typecheck` 通过；容器全套（`aihot_sec_verify_ci`，全新库）**626/626 通过**。

**生产核对（`SECURITY-REVIEW.md` §4.9 那项，本次补齐）**：

- 宿主机监听只有 `22`、`80`、`443`（另有 Ops Agent 的 `20201/20202` 与 LLMNR `5355` 监听在全接口）；
- 从服务器 hairpin 探测自己的公网 IP：**只有 22/80/443 通**，`3000/3001/5432/9090/20202` 全被 GCE 防火墙拦住；
  docker 只发布了 Caddy 的 80/443（db 的 5432、web/api 的 3000 没有发布到宿主）；
- 容器：无 `privileged`、无 `docker.sock` 挂载（五个容器逐个确认）；
- `.env`：无 `DEV_AUTH_ROLE`、无 `ALLOW_PRIVATE_NETWORK_FETCH`，`TRUST_PROXY=false` ✓；
  **但权限是 `-rw-rw-r--`（同机任何用户可读，内含全部 API 密钥）→ 已改 `chmod 600`**，`docker compose config` 正常、站点 200；
- GCE 防火墙规则列表缺 `compute.firewalls.list` 权限，改以上面的 hairpin 实测替代（结论等价）。

**仍未做**：`deploy/Caddyfile` 的响应头未部署（生产上 `deploy/` 是挂载目录，同步后 `caddy reload`）；
代码修复需要重建镜像并重新部署才在生产生效。CSP、提示词加固、知识库公开面三项待决策。

## 安全修复已部署（2026-10-09 晚）

- 镜像 `93e05c10da45` 已构建推送并部署，三个容器换新（回滚点 `app:rollback-de25abb0475d`）。
- **容器里核对**：清洗器的地址校验在（`dropUnallowedAddresses`）、`blockedHostname` 已归一化结尾点；
  用容器里的真实函数实测四组名字：`localhost` / `localhost.` / `metadata.google.internal.` / `anything.internal.`
  **全部被拒**（修复前带点的三个会被名列表绕过）。
- **安全响应头已生效**：`deploy/Caddyfile` 同步到服务器并 `caddy reload`，从服务器侧取响应头，
  HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy 五个都在；
  图片代理仍保留自己的 CSP（发无效签名得 400，行为正确）。
- 站点 `/`、`/hot`、`/daily`、`/api/v1/items` 全 200，worker 零报错，近 10 分钟 144 条回执（采集与判定照常）。
- 服务器 `.env` 权限从 `0644` 收到 `0600`（原为同机任意用户可读，内含全部 API 密钥）。

**知识库收口**（`feat/kb-module` 的 `1edce5f`）：按站主决定摘掉三条公开的 agent/MCP 出口，
连带删除只服务于它们的 `backend/answer.ts` 与死 import，测试与 `docs/deploy.md` 同步更新；
容器内 KB 测试 40/40 通过。该分支仍未随镜像上线（生产镜像来自 `upgrade-4.0`）。

**仍未做**：CSP（需先数真实 HTML 里的内联脚本再定 hash/nonce）、`summarize-*`/`translate-*` 提示词加固
与摘要一致性校验。

## 两个框架级安全缺陷已按 SECURITY.md 走私密报告（2026-10-09）

`CONTRIBUTING.md` 与议题模板都写明「安全漏洞走私密入口」，所以没有开公开 issue，走
[私密漏洞报告](https://github.com/KKKKhazix/AIHOT/security/advisories/new)（该仓库已开启此功能，当前无已公开的 advisory）：

| 报告 | 内容 |
|---|---|
| `GHSA-727h-m5jh-46mj` | 清洗器惰性属性绕过（`content/sanitize.ts`）：`transformTags` 写入的地址从不经过 scheme 白名单；含本机复现、浏览器验证（**不是**存储型 XSS）、以及我们生产库的只读核查结果 |
| `GHSA-596c-jrmp-xhm6` | SSRF 名列表结尾点绕过（`lib/url.ts`）：`http://localhost./` 等；含复现与「地址层仍有效」的影响收窄说明 |

两份都在 `triage`，且都写明「修复已在本地实现（含测试），需要就提 PR」。

**生产侧核查（回答「到底在我们服务器上验证过没有」）**：

- **漏洞未被触发**：已发布正文里 `src`/`poster` 带 `data:` 的 42 篇（43116 篇中）**全是合法的内联图片**
  （28 篇 raster + 14 篇 svg，属清洗器有意放行的范围）；`data:text`/`data:application` **0 篇**；
  原始载荷里出现 `data-src`/`data-original`/`data-poster` 的 **0 篇**（那条绕过路径从未被走到）；
  源配置或报错里出现内网名的 **0 条**。
- **修复已验证**：容器内用真实函数实测四组带结尾点的名字全被拒；五个安全响应头实测在线；部署后新增 0 例。

顺带：我探测私密报告端点时误建了一份内容为 `probe` 的空报告（`GHSA-2ffm-xwrw-622h`），该端点不支持改写或撤回，
已在报告 1 里向维护者说明，请他们直接关闭。

**还没发的**（按之前的评估，等你决定）：上游五份提示词缺「不可信数据」条款（3）、`agent.abilities` 的公开性文档（4）、
默认 Caddyfile 无安全头（5）、`grounded()` 对中文论断的漏洞（6）。

## 私密报告提交结果（2026-10-10 00:45）

[2026-10-10 00:45:01] gh：C:\Users\weijianlin\AppData\Roaming\npm\gh.cmd（存在：True）
[2026-10-10 00:45:01] 开始：本地 00:45:01 / UTC 16:45
[2026-10-10 00:45:02] 提交失败（限流未解除则等下次开机再跑）：advisory-3-prompts.md → gh: You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) If you reach out to GitHub Support for help, please include the request ID B8B8:1D57F0:1BE323:1FD2A8:6AC91A0E and timestamp 2026-10-09 16:45:02 UTC. (HTTP 403)


## 同步上游（2026-10-10）：落后 21 → 0

合并 `b23b2de`（`origin/main` 的 10 个新提交）：

| 提交 | 内容 |
|---|---|
| `a68d525` | **新增一步模型调用「改用词」**：标题/摘要/推荐理由写完后按 `industry/wording.ts` 词表查，用了词表里的词就让模型只改这些词一次（新增 `industry/prompts/mend-wording.md`、`editorial/wording.ts`）|
| `f087b9f` | 撤回的报告不再作为后续归组证据 |
| `f9a6da4` | 首份日报之前的周/月不再出刊 |
| `dd02610` | 精选评测在复制等待后重新选 |
| `ab715bf` / `aab7e62` / `50075b4` / `18ddc7b` / `7971d92` | 网页导航与手机底栏若干（含 `site/site.ts` 的 `NAV.hidden`）|

**冲突两处**，都是「两边各加了独立内容」，都保留：

- `content/extract.ts`：我们的 `isSignInRedirect`（登录页重定向识别）+ 上游的 `settleStreamedContent`（React 流式边界还原）；
- `docs/deploy.md`：上游新条目在前，我们 10 月 7 日的视图过渡条目按时间插在中间。

**合并后清点（我们自己的东西一个没丢）**：归档闸门（`analyze.ts` 的 `sweep/isHistorical` 早退）+ `jobs/content.ts` 的 `sweep` 标记、
清洗器与 SSRF 两个安全修复、Caddyfile 安全头、找回的三个工具、闸门与清洗器测试、KB-PLAN / SECURITY-REVIEW。
上游新增的 `mend-wording.md` 与 `industry/wording.ts` 也随合并进来了。

验证：`typecheck` 通过；容器内按上游 CI 环境跑完整套件 **673/673 通过**（合并前 626，多出的是上游新测试）。

### 两件要记住的事

1. **归档闸门是永久 fork 本地分叉**：上游在议题 #172 里明确「暂不收这个开关，也不把历史归档改成默认停在预筛」，
   理由是归档仍可经过价值判断、成为可阅读的归档或精选，且多加一套规则要长期验证。
   所以**每次同步上游后都要核对** `analyze.ts` 的闸门与 `tests/history-limit.test.ts` 都在 —— 4.0.0 升级时丢过一次。
2. **「改用词」默认不会多花钱**：`industry/wording.ts` 的词表是空的 → 不查、不调用；要启用得先填词表，
   需要单独选模型时另外设 `WORDING_MODEL`。

## 知识库模块：已实现，暂时搁置（10-10）

`modules/kb` 第一期做完并验证过（容器内 667/667、后台页可开、卡片能落盘），**但只活在
`feat/kb-module` 分支上，没有并进 `upgrade-4.0`，也没有部署**。当前生产跑的是 `upgrade-4.0`。
搁置的原因：站主 10-10 试用本地整套后认为形态还太粗，先放着（不是技术问题，也不是安全收口那条
——公开 agent/MCP 出口已经在 `1edce5f` 摘掉了）。

要重新拿起来，注意这几件事：

| | |
|---|---|
| 代码在哪 | 分支 `feat/kb-module`，五个提交：`6a495f5`（模块本体）`6b61ae7`（顶层目录）`57cd298` `d589bff`（安全审查文档）`1edce5f`（摘掉公开出口）|
| 要看代码 | `git show feat/kb-module:modules/kb/backend/export.ts`（在工作区切过去也行，注意别在别的活干到一半时切）|
| 它的形态 | 卡片落在数据目录 `kb/` 下（生产是卷 `aihot_data` 的 `/data/kb`）；**读取出口只有后台** `/admin/kb` 与 `/api/modules/kb/*`（adminHandler 鉴权），没有公开出口 |
| 安全阀 | `KB_EXPORT_ENABLED`（默认 false），另有 `KB_INTERVAL_MINUTES` / `KB_ITEM_RETENTION_DAYS` / `KB_REPORTS_LOOKBACK`，都在那个分支的 `.env.example` 里 |
| 冲突面 | 它改过 `site/modules/{index,server,web}.ts`、`site/package.json`、`Dockerfile`、`.env.example`、`docs/{architecture,deploy}.md`；上游同步后合并时先看这几处 |
| 不要 | 别在 `upgrade-4.0` 上 `git checkout modules/kb` 之类的半吊子合并 —— 模块的四处接线要一起过来，否则 `site/modules` 会指向一个不存在的包 |

## 「改用词」要不要开：实测结论（10-10，结论是不开）

上游 `a68d525` 新增的这一步：词表在 `industry/wording.ts`（`READER_WORDING: [正则, 改法][]`，**上游模板为空**），
空着就完全不查、不多花钱；填了词以后，写作产出中文标题/摘要/推荐理由时**命中才**多一次调用（`mend_wording`），
只改列出的那几处，护栏是「改完命中更少**且数字不变**」才采用。

**我们站实测（近 30 天、22 991 条有中文稿的条目，`analyses` 表，`origin` 全是 model 即我们自己写的）**：

| 候选词 | 命中 | 实际是什么 |
|---|---|---|
| `闭环` | **87** | 技术词（「感知-推理-评估闭环」「闭环仿真」）——不该改 |
| `赋能` | 26 | 多为引用来源口径 |
| `颠覆` | 21 | 多为正常描述 |
| `重磅` | 3 | 多来自 X 原帖语气（「重磅警报🚨…」）|
| `史上最强` / `碾压` / `震撼` / `封神` / `遥遥领先` | 各 1–2 | 正常描述（「击败史上最强选手」「反应速度碾压人类」）|
| **夸张类合计** | **31 条（0.13%）** | 绝大多数是正常描述或来源自己的口吻 |
| AI 套话（值得注意/众所周知/在当今/标志着…）| **8 条（0.03%）** | 且多为转述他人说法 |

**判断：不开，保持空表。** 三条理由：① 命中率极低，省不下也改不动什么；② 命中最多的 `闭环`/`赋能`/`颠覆` 是技术词或正常表述，
而「史上最强选手」「碾压人类」是**忠实转述来源**必需的措辞，按词表改掉反而失真；③ 护栏只数「命中更少 + 数字不变」，
判断不了用词是否正当，**一个列错的词会稳定改坏正常文案**（上游注释也写「拿不准的不列」）。

**什么时候值得重开**：换写作模型之后（最可能带出 AI 腔的时点），或想统一某类风格（例如标题禁掉标题党词）——
那时只列一眼可判的 2–3 个，调用量按上面比例算 ≤10 次/月。重测用的 SQL 见 `E:\cs\hot\wording-decision.md`。

所以这次合并对我们**行为零变化**：词表空着，既不查也不多调用。

## 部署合并后的代码（10-10）：镜像 8c320b323bf4，中途踩了挂载目录的坑

**部署结果**：镜像 `8c320b323bf4` 上线（回滚点 `app:rollback-93e05c10da45`），三个容器都是新镜像，
站点 `/`、`/hot`、`/daily`、`/api/v1/items` 全 200，五个安全响应头仍在，worker 零报错，近 10 分钟 45 条回执（18 条分析相关）。

**踩的坑（`industry/` 与 `database/` 都是挂载目录，新文件没同步）**：

1. 重建后 **api 与 worker 反复重启（exit 1）**，日志是
   `ERR_MODULE_NOT_FOUND: file:///app/node_modules/@aihot/industry/wording.ts` ——
   上游新加了 `industry/wording.ts`，而服务器上挂载的 `industry/` 还是旧的（缺这个文件）。
   同步 4 个文件（新增的 `wording.ts`、`prompts/mend-wording.md`，改动的 `selection.ts`（只动注释）、
   `prompts/group-batch.md`）后重启即恢复。
2. **迁移没有执行**：`redeploy.sh` 只做「拉镜像 + 重建 api/worker/web」，**不跑迁移**；
   而 `docker compose run --rm setup` 会先尝试构建镜像（服务器上构建失败）。
   更隐蔽的是：`database/` 同样是挂载目录，新迁移文件 `0083_publications_selected_source_idx.sql`
   根本没在服务器上，所以 `node scripts/migrate.ts` 会报「database is up to date」而**静默跳过**。
   同步该文件后执行 `sudo docker exec aihot-worker-1 node scripts/migrate.ts` →
   `applied 0083_publications_selected_source_idx.sql (72ms, index)`，索引 `publications_selected_source_idx` 已建。

**流程修正（以后合并上游后必须做）**：

```powershell
# 1) 找出这次合并动了哪些挂载目录里的文件（industry/、database/、scripts/）
git diff --name-status <合并前> <合并后> -- industry/ database/ scripts/
# 2) 逐个 scp 到服务器对应目录，并 sed -i 's/\r$//' 去掉 CRLF
# 3) 重启 api/worker；再跑一次迁移（这一步 redeploy.sh 不做）
gcloud compute ssh weijianlin@aihot --zone=asia-east2-c --command="sudo docker exec aihot-worker-1 node scripts/migrate.ts"
# 4) 核验：容器不是 Restarting、日志无 ERR_MODULE_NOT_FOUND、账本里出现新迁移、站点 200
```

判据速查：**容器 Restarting + 日志 `ERR_MODULE_NOT_FOUND` = 挂载目录缺新文件**；
**迁移日志说「up to date」但你刚合并了新迁移 = 服务器上压根没有那个迁移文件**。

## 管理员凭据轮换与密钥副本清理（10-10）

起因：核查「线上后台密码是不是项目默认值」。结论是**不是** —— 项目没有固定默认密码（`.env.example` 里是空的，
生产启动会拒绝占位符与短密钥），线上那份是用 `scripts/init-env.ts` 随机生成的
（密码 16 位 base64url、会话密钥 64 位十六进制、图片签名 64 位、数据库密码 36 位，四项形态全部吻合）。
但顺手查出：**8 个 `.env` 备份（轮换密钥时留下的）权限是 664**，同机任何用户可读，里面有全部密钥。

按站主要求做了三件（均已验证）：

| 动作 | 结果 |
|---|---|
| 轮换管理员密码 | 新值 16 位 base64url（与 init-env 同法）；`ADMIN_PASSWORD` 已更新；api/worker 重建生效 |
| 清空后台会话 | 删掉 9 条旧会话（30 天有效期，原本到 11-01 都有效）|
| 删除 8 个 `.env` 备份 | `rm .env.bak-*`，只剩 `.env` 与一份轮换前快照 |

**端到端验证**：新密码登录 → `303 → /admin` 且拿到会话 cookie、库中新建会话；**旧密码与任意错密码 → `303 → /admin/login?error=wrong`、不建会话**；
用会话访问 `/api/admin/me` → 200。最终会话数 0（验证用的也已清掉）。

**新密码保存在两处 600 文件里，不在仓库、不在对话里**：

- 服务器 `/home/weijianlin/admin-password-2026-10-10.txt`
- 本机 `E:\cs\hot\admin-password-2026-10-10.txt`

建议：存进密码管理器后把这两个文件删掉。另有 `.env.before-pwrot-<时间戳>`（轮换前的快照，600）也建议确认无用后删除。

**其它查证**：密码值没有出现在 bash 历史或 git 里；`.env` 是 CRLF（应用读时会把行尾 CR 去掉，登录实测正常，但用别的工具读 `.env` 要注意）。
后台登录有 15 分钟窗口的尝试次数限制（`admin-auth.ts:36`），但**失败尝试不写 `audit_log`** —— 想补的话按仓库规矩先写失败测试再改。

## 提示词补「不可信数据」条款（10-10，未提交未部署）

对应 `SECURITY-REVIEW.md` [S3] 的第 4 条。改动只在 `industry/prompts/`（本机文件，`industry/` 是挂载目录，上线要 scp）：

| 文件 | 改了什么 |
|---|---|
| `summarize-article.md`、`summarize-long-post.md`、`summarize-short-post.md` | 各补 `{{> safety}}` + 一条「数字与专名只能来自原文」 |
| `translate-body.md`、`translate-post.md` | 各补 `{{> safety}}` + 数字/单位/日期照原文、片段里的指令不照做 |
| `understand.md` | 补 `{{> safety}}`（写规则测试时才发现的：它原来自带的安全边界只在 `content-understanding.md` 里，没有共享条款）|

- **规则测试**：`tests/architecture.test.ts` 新增「every prompt that carries collected material includes the safety clause」——
  按这几个提示词族扫 `industry/prompts/`，新族要显式加进清单，漏加即失败（第一版规则就是这么抓出 `understand.md` 的）。
- **版本哈希轮换**（收据与后台模型页看得到，旧结果不会被当同版本复用）：
  `summarize…@b9917be0c9 → @e29a635c9d`、`translate…@738a6a83a9 → @76235d1e61`。
- **证据边界**：`tests/analyze.test.ts` + `tests/translate.test.ts` 15/15 通过（提示词渲染路径没坏），
  但**样本回放没做** —— 需要真实模型调用，本机按规矩关着 `MODEL_CALLS_ENABLED`。别把"测试通过"读成"摘要质量已经验证"。
- **没做的那半条**：报告建议的「`summaryZh` 原文一致性校验」量过之后决定不上：在本地生产数据副本上，
  能想到的规则都会误伤 11–14% 的正常摘要（数字见 `SECURITY-REVIEW.md` [S3] 的表）。

## CSP 前置勘查：hash 不可能，另有一处 Caddy 覆盖坑（10-10，只读勘查）

`SECURITY-REVIEW.md` [S3] 第 1 条要求的"先数真实 HTML 里的内联脚本"做完了。结论按重要性排：

1. **固定 hash 在原理上不可能**。React Router 8 的 `<Scripts/>` 会注入 **loader 数据流**脚本
   （`window.__reactRouterContext.streamController.enqueue("…")`）：本机构建产物抓 `/`、`/all` 各 6 段内联脚本，
   生产站 `/` 有 10 个 script 标签**全部内联**、最大一段 **41KB**；同一路径连抓 3 次得 **3 种不同的脚本集合**。
   哈希写死在 CSP 里 = 要么挡掉全部内联脚本（页面不再 hydrate），要么放行全部。**只剩 nonce**。
2. **nonce 与页面缓存互斥**（要站主取舍，未落地）。页面声明 `max-age`（首页 60 秒、条目页 600 秒；浏览器上限 300 秒）。
   浏览器复用缓存 HTML 时拿到的是**新** nonce，内联脚本会被挡；所以 nonce 方案必须同时让 HTML 不可复用。
3. **Caddy 覆盖坑（实测，容易踩）**：`header >Content-Security-Policy …`（`>` 会 `defer`）在**上游写头之后**执行，
   实测把**图片代理自己那条 `default-src 'none'; style-src 'unsafe-inline'; sandbox` 顶掉**。
   正确做法是 Caddy 只发 nonce（`request_header X-CSP-Nonce "{http.request.uuid}"`，实测每请求不同且上游能收到），
   页面 CSP 由应用写在 `apps/web/server.ts` 的 `pageResponse`（那里本来就是页面响应头的唯一写者，图片路由自己的头不受影响，实测透传正常）。
4. **指令范围**：站内资源全同源（图片走 `/api/img-proxy`、字体是系统字体），唯一第三方地址是正文里**未代理**的
   `<video src>`（`imgproxy.ts` 只代理 `poster`）→ `media-src` 必须放行第三方 https。

复现用的脚本与容器实验不入库（`.data/`）。**在哪落地还没定**：等站主在 nonce 与保留缓存之间选一个。

# 接上飞书精选推送（2026-10-10 晚）

生产 `hot.jian.ing` 的「精选推送到飞书群」已接通并实测送达。只用了**内容群 webhook**这一条线
（内部告警群、飞书登录后台两条没动）。

## 配置

| 位置 | 内容 |
|---|---|
| 服务器 `.env`（600） | 新增 `FEISHU_PUSH_WEBHOOK_URL`（81 字符）、`FEISHU_CONTENT_PUSH_ENABLED=true` |
| 备份 | `.env.before-feishu-20261010-144937`（600，含同一凭据，要清理时记得它） |
| 数据库 | `notify_targets.feishu-content-main`：`enabled=t`、`enabled_at=2026-10-10 14:49:55Z` |
| 审计 | `audit_log`：`admin:1` / `notify.enable` / `notify-target:feishu-content-main` / 理由「接入飞书精选推送群」 |

目标是通过**后台正规接口**打开的（`POST /api/admin/notify-targets/:key`，带会话 + CSRF），
不是直接改库——所以有审计，`enabled_at` 也由代码写。打开时接口回的 `pushEnabledHere` 就是全局阀
（当时还是 `false`，重建容器后才变 `true`）。

**两个开关缺一不可**：全局 `FEISHU_CONTENT_PUSH_ENABLED` 与每群 `enabled`。只开一个时投递会被记成
`skipped`（全局关）或根本不会产生（群关）。

## 这条链路怎么走

新的精选落到 `selected` 后，worker 的 `notifySelected` 队列（`jobs/notify.ts`）先备好分享图，
再走 `notify/selected.ts` → `notify/deliver.ts`：按 target 去重（`selected:fact:<id>` 或
`selected:article:<id>`）、写 `deliveries` 一行、`postWebhook` 发
`{msg_type:"interactive", card}`，飞书回 `code:0` 才算 `sent`。

- **不补历史**：`contentAt`（文章 `discovered_at`）早于 `enabled_at` 的直接跳过。
- **自定义关键词**：机器人的安全设置选了「自定义关键词=精选」，所以卡片标题必须含这两个字
  （测试卡标题是「精选 · 连通性测试」）。**以后改卡片标题时别把「精选」去掉**，否则飞书会回 code≠0。
- **不做签名校验**：`postWebhook` 不签，别在机器人安全设置里改成「签名校验」。

## 验证记录

| 项目 | 结果 |
|---|---|
| worker → `open.feishu.cn` 出口 | 通，580 ms（发了个假凭据，回 `code:10003`，证明是飞书在应答） |
| 测试卡 | HTTP 200 `{"code":0,"msg":"success"}`，群内可见 |
| 重建后容器内开关 | `FEISHU_CONTENT_PUSH_ENABLED=true`、webhook 长度 81（api 与 worker 都是） |
| 站点 | `/` 与 `/api/health` 均 200 |
| worker 近 5 分钟错误 | 无；`notify.selected` 队列 109 条全部 `completed`，无卡住 |

**还没验到的**：截至配置完成时 `deliveries` 仍为 0 行（近 20 分钟有 39 条新发布、0 条新精选），
所以「真实精选推出去」这一步是等下一次精选自然发生来验的，不是当时验的。

## 踩到的坑（重要）

1. **别在服务器上跑 `docker compose up`（无 `-f`）**：仓库根那份 `docker-compose.yml` 的 `x-app` 带
   `build: .`，会触发**本地构建**（跑到 `npm run build -w @aihot/web` 失败，容器没被替换、开关没生效，
   白等几分钟）。生产要用部署脚本那份：
   ```bash
   cd ~/aihot && sudo docker compose -f docker-compose.server.yml up -d --no-deps api worker
   ```
2. **`env_file` 只在创建容器时读**：`docker restart` 不够，必须 `up -d` 重建容器（`Recreated` 才算数）。
   只改代码不重新打包时用 `--no-deps`；改了镜像内容才走 `scripts/deploy-server.sh`（它会 `pull`）。
3. **临时凭据用完即删**：webhook 地址通过 `/tmp/feishu-cred.txt` 上传（600），用完 `shred -u`。
   本机那份 `E:\cs\hot\feishu.txt` ACL 已收紧到仅本人读写。

## 两份私密报告提交完成（10-10 23:16 / 23:19）—— 待发清单清空

配额窗口（触发后 24 小时）一开就发出去了，中间只试了两次：23:02 一次仍被挡，23:16:30 窗口到点后成功。

| 报告 | GHSA | 状态 |
|---|---|---|
| 五份写作/翻译提示词缺「不可信数据」条款 | `GHSA-gj3j-rgpx-m32p` | triage |
| 默认 `deploy/Caddyfile` 无任何安全响应头 | `GHSA-j954-mqhh-3pjp` | triage |

加上 10-09 的两份，现在账号下的私密报告共 5 份（4 份真实 + 1 份误建的 `probe`），**全部在 triage，没有已公开的**。

提交方式：`gh api --method POST repos/KKKKhazix/AIHOT/security-advisories/reports`（`pwsh -File E:\cs\hot\submit-advisories.ps1`），
两次之间隔 180 秒。记录在 `E:\cs\hot\advisories-result.txt`。

**教训（下次别再撞）**：GitHub 的「内容创建」次级限流是**账号级、约 24 小时**的窗口 —— 从创建第 3 份报告那一刻算起，
期间 API 与网页都被挡（我们 10-10 07:57 试 API、08:19 试网页，两次都被挡）。**撞到就记时间、等满 24 小时再发一次**，
中途反复重试只会续期。

**报告 4 的一个细节**：草稿里写的「默认 Caddyfile 没有头」针对的是上游仓库，我们自己的 fork 在 `f7c1f64` 之后已经有了
（上游那份仍然没有，报告成立）。报告里第 51 行关于 CSP 的措辞后来被我们自己的勘查更新了：真实 HTML 每次抓取的内联脚本
集合都不同（React Router 的数据流脚本），**hash 不可行、只剩 nonce**，且 nonce 与页面缓存互斥 —— 上游若回信问 CSP，
直接给这份结论。

## 合并上游 4 个提交并部署（2026-10-11）

镜像 `d7c664c05db4`（标签 `merge-7ffe2ba`）已上线，回滚点 `rollback-8c320b323bf4`（= 部署前的 `latest`）。

| 内容 | 说明 |
|---|---|
| 上游 4 个提交 | 长文章桌面目录独立滚动（`931a4eb`，今天）、改用词被拒保留初稿（`9cf2a3c`）、日报提醒停发（`efc7bdf`）、关联事件桥接经 fact（`b6c0796`）|
| 我们的 2 个提交 | 登录失败写日志（`dcdcd45`）、六份提示词补 safety 条款（`bc27846`）|
| 挂载目录 | `database/migrations/0085_grouping_decisions_fact_idx.sql` + 六份 `industry/prompts/*.md`（scp + `sed -i 's/\r$//'`）|

**核验结果**（逐项实测，不是看日志猜的）：

- 迁移账本出现 `0085_grouping_decisions_fact_idx.sql`（`2026-10-11 12:47:13Z`），setup 容器 `exited 0`；
- 三个容器都跑新镜像 `sha256:d7c664c05db4`，`Up` 稳定、无 `Restarting`、日志无 `ERR_MODULE`；
- 站点 `/`、`/hot`、`/api/health` 均 200；首页资源哈希换过（`root-DSVWYFDW.js`、`manifest-2f916397.js`）→ 新前端在线；
- 提示词版本因挂载文件更新而轮换：`summarize…@9019d90f04`、`translate…@7c023ebddd`；
- **登录失败日志实测**：往真实路由发一次错误密码 → `303 error=wrong`，api 日志出现
  `"event":"admin_login_refused","method":"password","reason":"wrong","attempt":1,"client":"127.0.0.1"`；
- **飞书实测**：走 `postWebhook` 同一条路径发卡 → `{"code":0,"msg":"success"}`。

## ⚠️ 这次踩到的坑：服务器上 `docker compose pull` 认证失败

第一次部署脚本跑到第 2 步就报：

```
Image ...aihot/app:latest Error error from registry: authentication failed
```

原因：`deploy-server.sh` 的第 3 步会**先从 GCE 元数据服务取服务账号 token 再 `docker login`**，
而只跑 `docker compose pull` 是拿不到这个登录态的（服务器的 `~/.docker/config.json` 里没有长期凭据）。
后果很微妙：**pull 失败但 `up -d` 照样"成功"** —— 容器被重建了、跑的还是本地那份旧 `latest`（`8c320b323bf4`），
输出里只看到 `Started`，看起来像部署成功。

```bash
# 服务器上手动拉镜像前，先补这一步（deploy-server.sh 第 3 步的等价命令）
REGION_HOST="$(grep -E '^AIHOT_IMAGE=' .env | cut -d= -f2- | cut -d/ -f1)"
ACCESS_TOKEN="$(curl -sS -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | sed -E 's/.*"access_token"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
echo "$ACCESS_TOKEN" | sudo docker login -u oauth2accesstoken --password-stdin "https://${REGION_HOST}"
sudo docker compose -f docker-compose.server.yml pull
```

**判据（以后必看）**：部署完核 `docker inspect <容器> --format '{{.Image}}'`，必须等于你刚推的镜像 ID；
只看 `docker compose up -d` 的 `Started` 不算数（`pull` 失败时它照样重建，只是用旧镜像）。

## 其它两条

1. **迁移不会自己跑**：`deploy-server.sh` 不跑迁移，靠 `setup` 容器（`docker compose up -d` 会带起它）。
   这次 setup 正常应用了 0085。若单独重建 api/worker（`--no-deps`）就没跑 setup —— 那种情况下要手动
   `docker exec aihot-worker-1 node scripts/migrate.ts`。
2. **`.dockerignore` 没排除根目录那 4 个 `.sql.gz`（546 MB）**：它们会被 `COPY . .` 拷进构建层并被最终镜像继承
   （镜像本来就 1.8 GB，所以没造成异常，只是白传）。这次构建是临时在本地 `.dockerignore` 加了 `*.sql.gz` 等几条、
   **构建后已还原**（仓库文件没改）。要不要永久加这几条，等站主定（那是共享框架文件，且属于所有站都成立的小改进）。

## 本地测试环境：独立一套，不碰任何现有容器（2026-10-11）

为了放心做集成测试（Artex 往站里推内容、改坏了自己重来），本地起了一套**完全隔离**的实例，
用的是当前工作树的代码（`docker compose -p aihot-test build api` 构建的 `aihot-app:latest`）。

| 资源 | 名字 | 说明 |
|---|---|---|
| compose 项目 | `aihot-test` | 容器都是 `aihot-test-*`；与 `aihot` 项目互不影响 |
| 数据卷 | `aihot-test_db`、`aihot-test_data` | **与原有的 `aihot_db`/`aihot_data` 完全分开** |
| 数据库 | 全新空库 | `setup` 跑了 **79 条迁移**（含上游新加的 0085）+ seed 灌入 **626 个示例信源** |
| 入口 | http://localhost:3000 | 没有起 Caddy/HTTPS（本地不需要，也免掉 80/443） |
| 后台 | http://localhost:3000/admin | 密码就是 `.env` 里的 `ADMIN_PASSWORD` |

**实测状态**：`/` 与 `/api/health` 均 200，`/admin` 正确 302 到登录页；三个服务零报错；worker 正常启动。

### 常用命令

```powershell
cd E:\cs\aihot
docker compose -p aihot-test ps                      # 状态
docker compose -p aihot-test logs -f --tail 100 worker   # 看 worker
docker compose -p aihot-test stop                    # 停（保留数据）
docker compose -p aihot-test start                   # 再起
docker compose -p aihot-test down                    # 删容器（数据卷保留）
docker compose -p aihot-test down -v                 # 连数据一起清掉，下次重新迁移+seed
docker compose -p aihot-test up -d --build api worker web   # 改了代码后重建
```

### 安全阀默认全关（免得本地测试误触发真调用）

`.env` 里 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_CONTENT_PUSH_ENABLED`、
`FEISHU_INTERNAL_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 全是 `false`，容器里实测一致。
所以默认状态下 worker 不抓取、不调模型、不推送——`deliveries` 里只会出现 `skipped`。

要让它真跑（会花钱），把对应的阀改 `true` 后 `docker compose -p aihot-test up -d api worker`
（**改 .env 必须重建容器，restart 不读新值**）。注意本地 `.env` 的模型 key 是**真实凭据**，
而 `budgets` 表有每分/时/天上限兜着。

### 让外部往站里推内容（Artex 那条线）

`POST /api/ingest/items` 需要 `INGEST_TOKEN`，**本地 `.env` 里没有这一项** → 该接口当前是关闭的。
要用就在 `.env` 加一行 `INGEST_TOKEN=`（至少 16 位，别用常见占位符），重建 api 后生效；
限流由 `INGEST_RATE_LIMIT` 控制（compose 默认 10/分）。

## 事故：磁盘写满导致数据库恢复循环、站点 503（2026-10-12）——已恢复

### 症状与处置

10-12 站点全部 503（`/`、`/api/health`、`/hot`、`/daily` 都是）。**根因是根分区 100% 满**，
PostgreSQL 因此在恢复循环里反复重启（`the database system is in recovery mode` → `all server processes
terminated; reinitializing`），api 拿不到库就一律 503。

处置（都只读或只删可再生的东西，**没有动数据卷**）：

| 动作 | 释放 |
|---|---|
| `docker image prune -a`（未使用的旧镜像，保留在用的 3 个） | 22.9 GB |
| 删掉失败的本地备份 dump（保留最新两个可恢复） | 12 GB |
| `docker builder prune` | 0.87 GB |
| `journalctl --vacuum-size=200M` | 0.69 GB |

磁盘 100% → 35%（31 GB 可用）。**数据库自行恢复**（约 5 秒），没有数据丢失：
`publications` 49142 条，站点与全部接口复测 200。

### 根因链（一条链，不是单点）

1. **10-03 的 4.0.0 同步把 `DB_BACKUP_STORE_PATH_STYLE` 覆盖掉了**（`1ca5d6d` 把引擎改成从线上
   代码直接导出，我们本地那个补丁只活在 DEPLOY-NOTES 的文字里，代码与 `.env.example` 里都没了）。
   服务器 `.env` 里的 `DB_BACKUP_STORE_PATH_STYLE=true` 还在，**但没人读**。
2. 于是备份端点回落到虚拟主机风格：`https://<桶名>.94053f….r2.cloudflarestorage.com/…`。
   **R2 只认路径风格**，每天的备份都回 `403 AccessDenied`。
3. 备份失败，但 `pg_dump` 已经跑完、dump 留在 `/data/backups`。**每天两份，9 天堆到 12 GB**。
4. 10-12 磁盘写满 → 数据库恢复循环 → 503。

`backup.ts` 的本地保留（`KEEP_LOCAL = 3`）在**上传之后**才执行，上传一抛错就走不到，
所以失败期间的 dump 会一直堆着。**查证后这不是缺陷、也不是我们改的**：
上游 `origin/main` 的 `backup.ts` 顺序完全相同（上传在循环内、保留在其后），
而且这个顺序是对的 —— **远端没拿到之前不删本地**，上传一直失败时本地那份是唯一副本，
删掉才是真出事。这个场景的兜底本来就是告警：`backup.failed`（>50 小时、`today` 级，
10 分钟内就发）与 `backup.stale`（>30 小时、`later` 级，进 09:00 日报）。

也就是说：10-05 22:10Z 起（距 10-03 那次成功满 50 小时）框架每 10 分钟就在算这条告警、
并在日志里写 `alert (not sent: FEISHU_INTERNAL_ENABLED is off)` —— **信号一直在，是我们没有收件人**。
这两半（守卫丢失 + 没有收件人）今天都补上了。

### 修复与验证

- 提交 `970b8da`：端点从字符串改成 `(key) => url` 的函数，桶名进主机名还是进路径只在一处决定；
  恢复 `DB_BACKUP_STORE_PATH_STYLE`（默认 false，其它存储行为不变）；桶名不是合法 DNS 标签时
  只能走路径风格。`.env.example` 补回该项并修正「访问域名要带桶名」的旧说法。
- 回归：`tests/backup-store-url.test.ts`（先失败后通过），`tests/backup.test.ts` 把
  「默认虚拟主机风格」显式断言。容器全套 **681 通过 / 0 失败**。
- 镜像 `a759d61b00b7` 已部署（回滚点 `rollback-d7c664c05db4`… 见 registry 里的 `backup-fix` 标签），
  部署后手动跑了一次真实备份：**`uploaded = true`**，远端 HEAD `daily/aihot-202610121324.dump`
  966776946 字节、与本地一致。这是 **10-03 以来第一次成功上传**。
- 成功一次之后本地保留随即生效：`/data/backups` 只剩最新 3 对 dump/tar。

### 判据（下次必看）

- **`backup.last` 的 `at` 字段**：超过一天没更新就是备份在失败（不要只看磁盘）。
- **`job_runs` 里 `ops.backup` 的 status**、以及 `pgboss.job` 里同名任务。
- **`/data/backups` 的文件数**：正常应 ≤ 3 对；只涨不降说明上传成功不了。
- 备份是 `10 4 * * *`，**时区 Asia/Shanghai，即北京 04:10**（不是凌晨 UTC，也不是中午；
  我先前写成 12:10 是误把它当 UTC，实测 `pgboss.schedule.timezone` 为 Asia/Shanghai）。
  其余定时任务同样在 Asia/Shanghai：系统日报 `0 9 * * *`（北京 09:00）、告警 `*/10 * * * *`、留存 03:30、出刊每半小时。

### 仍未解决的两件事（都要站主决定）

1. **告警没有收件人**：`alerts.ts:122` 本来就有「备份超过一天没成功」的告警
   （`backup.stale`），但 `FEISHU_INTERNAL_ENABLED=false` —— 内部飞书群从来没配过
   （我们只接了内容群推送）。**这是这次 9 天无人察觉的真正原因。** 需要 `FEISHU_APP_ID` /
   `FEISHU_APP_SECRET` / `FEISHU_INTERNAL_CHAT_ID`。
2. **磁盘没有闸**：满了才有征兆。可复用告警框架加一条「剩余空间低于 15%」。

### 顺带查到（与本次无关）

- `/var/log` 2.4 GB（journal 已清到 200 MB；`google-cloud-ops-agent` 占 780 MB）。
- 数据库里 `receipts` 表 951 MB（**每行存原始模型请求/响应**），是库内最大对象；`articles` 298 MB。

## 接上飞书内部告警（2026-10-12）

内容群推送之外的第二条线：**自建应用**（不是自定义机器人 webhook），告警与读者反馈都进**同一个群**
（站主选「只想要一个群」）。

| 位置 | 内容 |
|---|---|
| 服务器 `.env`（600） | 新增 `FEISHU_APP_ID`(21)、`FEISHU_APP_SECRET`(32)、`FEISHU_INTERNAL_CHAT_ID`(35)，`FEISHU_INTERNAL_ENABLED=true` |
| 备份 | `.env.before-feishu-internal-20261012-140031` |
| 群 | **AI信息**（`oc_835f97f1eea70847a0a08b20e46506f5`，只有 1 个成员、非外部群）；只填 `FEISHU_INTERNAL_CHAT_ID`，没填 `FEISHU_ALERT_CHAT_ID`，所以告警与反馈同群 |
| 应用 | `cli_aa836258bbf8dbd6`；凭据也在本机 `E:\cs\hot\feishu.txt`（与内容群 webhook 同文件） |

### 验证（都走真实代码路径）

| 项目 | 结果 |
|---|---|
| `sendAlert()`（worker 容器内） | 返回 **sent** |
| `checkAlerts()`（就是每 10 分钟那个任务） | 本轮发出 `deliveries.failed` 与 `monitor.review:recovered` |
| 图片上传 `im/v1/images` | `code=0`，拿到 image_key → **反馈截图能发** |
| `screenshotsForwarded()` | true（转发成功即删本地文件，备份的文件包因此不再含截图） |
| worker 容器出口 IP | `34.96.136.13`（= 预留静态地址 `aihot`，不会变） |
| 站点 | `/`、`/api/health` 均 200 |

### ⚠️ 内容群推送被我上次的「关键词」建议坑了 —— 已修复（10-12 22:34）

3 条投递失败，原因**不是**磁盘故障：

```
{"code":19024,"msg":"Key Words Not Found"}
```

我先前让站主把自定义机器人的安全设置选「自定义关键词 = 精选」，但**卡片里根本没有「精选」这个词**：

| 投递 | 内容 | 含「精选」 | 含「MyHOT」 |
|---|---|---|---|
| #1 codex_reset | Codex 额度重置：Tibo 已宣布 | ❌ | ✅ |
| #2 codex_reset | Codex 额度重置已完成（Tibo 确认） | ❌ | ❌ |
| #3 selected | GPT-6.1 Sol …上下文长度提升至 500k | ❌ | ✅ |

卡片由不同模块各自拼装，**没有任何字符串会出现在所有卡片里**，所以「换一个关键词」解决不了。

**修法（站主在飞书里改，不需要改代码）**：把该机器人的安全设置从「自定义关键词」改成
**「IP 白名单」**，填 `34.96.136.13`（已从 worker 容器内实测确认出口 IP 就是这个）。

**站主 10-12 已改成 IP 白名单，实测通过并重发完成：**

| 步骤 | 结果 |
|---|---|
| 连通性测试（`postWebhook`，同一 payload 形态） | `status = sent`，`code 0` |
| `resendDelivery(1/2/3)` | 三条全部 `sent`（`attempts` 2），应答 `StatusCode:0` |

依赖：白名单里是预留静态地址 `34.96.136.13`（从 worker 容器内实测出口 IP 与之一致）。
**若以后重建实例丢了预留地址，推送会再次静默失败** —— 改 IP 后记得同步白名单。
`postWebhook` 不做签名，所以**不要选「签名校验」**。

### 「通道关着也算已发」查证结论：**不是缺陷，不报上游**（10-12）

我起初把这条当成框架缺陷（`checkAlerts` 在 `sendAlert` 返回 `disabled` 时照样写状态，
`alerts.ts:330-331`，于是通道关闭期间的告警不会重发）。逐项查证后**推翻**：

| 检查 | 证据 |
|---|---|
| 是不是上游的代码 | `git show origin/main:…/alerts.ts` 的 330-331 行与本地**逐字一致** |
| 是不是有意为之 | 上游测试（比我们新 4 个提交）**260-264 行**：主动关掉通道、接管 `console.log`、断言消息内容出现在日志里 —— **关通道时日志就是交付面** |
| 有没有把去重策略钉住 | 上游测试 **45-55 行**：全程不开通道，却断言 `r.sent` 的「首次告警 / 1 小时内不重复 / 61 分钟后提醒 / 恢复只报一次」 |
| 有没有相反的断言 | **没有**任何测试要求「disabled 时不写状态」 |

所以这是**设计支点**：关通道时消息进日志、状态照记，于是去重/重复提醒/恢复这套策略可测，
也不会在开通时补发一堆积压告警。**我抹掉 `alerts.state` 里的 `deliveries.failed` 让它重发，
其实是绕过了有意设计的行为**（结果无害，但当时我以为在修 bug）。

教训：**在一次不寻常的状态迁移里看到的症状，不等于缺陷。** 报上游前先查三样 ——
代码出处（`git show origin/main`）、意图（注释与设计）、是否被测试钉住。
今天早些时候的 `activities`、主机门控两条，也是同一个错误模式。

### 站主现在会收到什么

- **每 10 分钟**（`cron.ops.alerts`）：只有 `now`/`today` 级——站点挂了、内容群推送失败、
  服务商故障/额度、备份超一天没成功、日报缺期、Codex 重置待确认。同类在 1 小时（now）/ 24 小时（today）内不重复。
- **每天北京 09:00**（`cron.ops.digest`）：一条系统日报，汇总 `later` 级事项（当前 8 条：
  61 个信源 7 天没新内容、7 个待核实质量、10 个热度信号反复失败、4 个付费请求结果未确认等）。

**注意时区**：所有定时任务都在 `Asia/Shanghai`（实测 `pgboss.schedule.timezone`），
不是 UTC —— 备份是**北京 04:10**，出刊每半小时、留存 03:30。

## 删掉 6 个坏信源（2026-10-13）

10-13 的系统日报报了 8 条，逐条查完后删掉这 6 个（其余是阈值噪声，见下）：

| 信源 | 删除理由（实测） |
|---|---|
| `rss-developers` OpenAI Developers | `developers.openai.com/rss.xml` 对**默认 UA 和浏览器 UA 都 403**，已连续失败 48 次（12 天）。而 `openai.com/news/rss.xml` **已由 `rss-openai-news` 覆盖**，所以删掉不丢内容 |
| `src-cbf787802c` Golem.de | **从未采集成功过一次**（45 连败）：`Connect Timeout Error (77.247.84.129:443, timeout 10000ms)`；用 20 秒超时的普通请求能抓到，说明是连接超时太短 |
| `src-cc96d787d7` Techmeme | 每次抓取都超时（20 秒探测也超时） |
| `src-d45942267e` 新浪科技 | feed **自 2018-09-23 未变过**（`last-modified` 就是那天），源已死 |
| `src-362baa923a` Big Technology | 近 7 天 0 入库，源站最新 10-06 站上没有；每次抓取 `found=100, new=0`（采集器认为都已知），根因未查明 |
| `src-nikkei-asia` Nikkei Asia | 5 天采了 **160 篇全部 `skipped`**，一篇都进不了站点：`backfill_reason = unknown-publication-time`，发布行 `eligible=false / indexable=false / selected=false` |

**做法（两处都要，缺一不可）**：

1. 从 `industry/sources.json` 移除这 6 条（626 → 620）。`scripts/seed.ts` 是
   `ON CONFLICT (id) DO NOTHING`（「已有的永不覆盖」），所以移出包就不会再被种回来。
2. 生产库 `update sources set enabled = false, next_fetch_at = null`（启用中 531 → 525）。
   **行必须保留**：`articles.source_id` 引用它，删行会连带毁掉文章。
   `sources/health.ts:63` 的 `sourceHealth` 过滤 `s.enabled`，所以停用后日报里那几条也一起消失。

**没有做撤回**：`scripts/withdraw-source.ts` 是给「这个源的内容不该公开」用的
（写 `visibility='withdrawn'`）。这 6 个是「源坏了」而不是「内容不对」，撤回会把合法文章从站点拿掉
——`rss-developers` 有 10 条精选、`src-362baa923a` 103 条、`src-cc96d787d7` 60 条、`src-d45942267e` 15 条，
全部原样保留。

**要撤销**：把条目加回 `sources.json` 并 `update sources set enabled = true, next_fetch_at = now()`。

### 查这些时的两个教训

- **别把 feed 的 `<updated>` 当成文章日期。** 第一轮审计用「所有日期取最大」，把 Atom feed 顶层的
  `<updated>`（每次都刷新成当前时间）当成了最新文章，于是误报 Sam Altman 博客漏收 185 天、
  Claude YouTube 漏收 14 天。**只取 `<item>`/`<entry>` 内部的日期**后，这两个都变成「源站最新一条
  与我们存的完全一致」。纠正后 19 个 RSS 源里真漏收从 5 个降到 2 个。
- **「7 天 0 新增」绝大多数是噪声。** 判据是拿源站最新一条与库里的比对。查过的结果：19 个 RSS 源里
  **17 个是源站本来就没更新**；X 账号那 135 个更彻底——直接调 SocialData API 验证，LeCun 的最新
  **原创**帖是 08-16（10-13 的全是回复别人的争论，被查询里 `-filter:replies` 按设计排除）、
  吴恩达 09-29、DeepSeek 10-02。**不是采集失效。**

## 额度用尽让归组永久停摆：修好并报上游（2026-10-13）

### 症状与真实死因

飞书 🔴 告警「有精选新闻卡在去重确认，暂未发布（已持续 10 天）」，18 条。告警的 `action` 文案把
人指向「未知回执需核对计费」，但**这 18 条根本没有回执**（`grouping_receipt_id IS NULL`），错误是
`Budget for deepseek exhausted (hour)`。

链条：10-02～10-09 采集高峰（每天 6000+ 篇）打满 deepseek 额度 → `groupArticle` 抛
`BudgetExceededError` → `events/group.ts:255` 把它写成 `grouping_status='failed'`（终态）→
`jobs/events.ts:29` 的 `sweepUngrouped` 只扫 `pending` → 再没人重试 → 卡 11 天。

### 缺陷（已确认是上游代码）

四个相关文件与 `origin/main` **逐字一致**，作者是 Khazix：

- `events/group.ts:251-257`：catch 里只有 `shutdownSignal.signal.aborted` 算可恢复，其它一律终态。
- `providers/receipts.ts:16-23`：`BudgetExceededError` **自带 `retryAfterSeconds`** —— 它被定义为
  「过一会儿可以再来」的错误。
- `sources/health.ts:27,36-40`：明确把额度等待**排除在失败计数之外**。

**同一个错误，在健康统计里不算失败，在归组里却是永久放弃。**

### 修复与验证

- 提交 `cd9b397`：catch 里 `const repairable = shutdownSignal.signal.aborted || error instanceof BudgetExceededError`，
  留 `pending` 交给扫描器。
- 回归测试（`tests/grouping-reliability.test.ts` 新增一项）：把所有预算置 0 触发额度错误，断言留在
  `pending` 且扫描器会重新入队。**去掉修复时失败**（`actual: 'failed'` / `expected: 'pending'`），
  加上后全套 **682 通过 / 0 失败**。
- 镜像 `bf8ba6060e97` 已部署，容器内确认第 23、257 行就是修复。

### 那 18 条已救回，**733 篇积压仍在**（不要搞混）

18 条是用后台那条正路救的：`admin/content.ts` 的 `rerun(id, "group", …)` → `requestRegroup`
（即「重跑 → 归组」），18 条全部 `complete` + `selected=true` + `public` → `waitingSelectedNews` 归零 → 告警清除。
它们的入库时间是 10-02 22:49，属**补回历史位置**，不是当新闻发。

⚠️ **修复不追溯**：它只让将来的额度中断留在 `pending`。已写成 `failed` 的 **733 篇**（`sweepUngrouped`
仍只扫 `pending`）不受影响 —— 我先前说「部署后扫描器会自动重试那 800 篇」是错的。

**建议先不动这 733 篇**，理由有两条：

1. 它们的 `selection_candidate` **全是 false**，不进精选，只影响事件页与时间线的历史补全；
2. 归组队列是**串行**的（`localConcurrency: 1`），一次灌 733 个任务会把**当天新文章的归组推迟约一小时**
   —— 用读者的新鲜度换历史补全，不划算。

要补的话按需要**选择性重跑**（例如只挑最近 3 天的），用同一个 `rerun(id, "group", …)`。

### 已报上游

- **#195** 信源健康的「静默」判据按各源自身节奏判断（减少低频源每日误报）
- **#196** 额度用尽会把手写归组变成永久终态失败（本条，附确定性复现与最小修法）

两条都只写场景与方案，不含本站的阈值、信源 ID 与 industry 包内容。

### 仍未处理

4 条结果未知的付费请求（3 条 `score_article` 自 10-07、1 条 `embedding` 自 10-02）。它们与上面这 18 条
**无关**（只有 1 篇文章关联到其中 1 条，且它不在那 18 条里）。放行需要人工判断「供应商是否已计费」，
涉及付费记录，留给站主在后台核对。

## 联系上游维护者的有效渠道（2026-10-13 实测）

私密漏洞报告（GHSA）**投递成功 ≠ 被看到**。实测对比：

| 渠道 | 结果 |
|---|---|
| GitHub 私密漏洞报告（5 份，10-09 / 10-10 提交） | **4 天零动静**：全部停在 `triage`，`updated_at` 一直等于创建时间。上游 `SECURITY.md` 也写明「暂不承诺固定响应时间」 |
| **他站上的反馈表单**（`aihot.news` → 存进他的库 + 转发飞书内部群） | 发出去后**几分钟内**他上了 Security → Advisories |
| 公开 Issue（#195 20:38、#196 21:51） | 无评论，但同期他确实在处理仓库 |

时间线（北京时间）：

```
20:38  提 Issue #195
21:51  提 Issue #196
21:58  维护者关闭了那份误提交的 probe 报告（相差 7 分钟）
```

**为什么 GHSA 那条不灵**：GitHub 只在维护者把仓库 watch 成 All Activity / Security alerts
**且**开了邮件通知时才发邮件（官方文档原文见「配置私密漏洞报告的通知」一节）；两份官方文档
也都没有任何提醒或升级机制——报告可以在 `Triage` 里无限期躺着。他没有公开邮箱
（GitHub 资料空白、提交用 noreply），站内也没有私信功能。

**做法**：以后要给上游报安全问题，**GHSA 照提（留痕、必要），但要另走一条能推送到人的渠道**——
首选他站上的反馈表单（框架自带，反馈会进他的后台、配了内部群就进飞书）。
措辞上守住 `SECURITY.md` 的规矩：**零技术细节，只请他去 Security → Advisories 看**。

**注意**：这是单次观察到的相关性，不能证明因果；但「只走 GHSA = 4 天无人看」这一半是确定的。

## 合并上游 5 个提交（2026-10-13，含维护者的安全修复）

上游这次带进 **`ea96060`「补齐地址、图片与材料的安全边界」**——就是我们那 4 份报告的修复：
Caddyfile 五个安全头、5 份提示词加 `{{> safety}}`、`url.ts` 的结尾点归一化、`image-url.ts` 拒非图片
`data:` 地址，并各配了回归测试。另外两份（清洗器惰性属性、SSRF 结尾点）他**接受成了草稿公告**
（`state=draft` + `submission.accepted=true`），两份加固类（提示词、安全头）**静默修掉、没接受**。

### 冲突与取舍（按站主「他的修法可以就放弃我们的」）

只有 3 个冲突：`deploy/Caddyfile`、`industry/prompts/translate-body.md`、`translate-post.md`。

⚠️ **自动合并有个坑**：另外 3 个提示词里 `{{> safety}}` 被**合成了两份**（两边都加了同一行）。
已把这 6 个文件**一律取上游版本**，现在各恰好 1 次。

**放弃的**：Caddyfile 我们那版头（改用他的 `?` 前缀版本，意为「已设置就不覆盖」；值是
`SAMEORIGIN` / `max-age=31536000`，与我们的 `DENY` / `63072000` 等效）、5 份提示词里我们那行
「数字/单位/日期/价格照原文」的保真要求。

**保留的**（上游没覆盖）：
- `industry/prompts/understand.md` 的 `{{> safety}}`——他的提交没动这个文件，而
  `tests/architecture.test.ts` 要求 6 份都有；少一份测试就红。
- `content/sanitize.ts` 的 scheme 白名单（+63 行，在 `transformTags` **之后**统一校验）。
  **他的 `image-url.ts` 只拒非图片的 `data:`，范围比我们窄**，而那份草稿公告还开着——等公告落地
  或发布后再比较，确认覆盖得上才谈放弃。
- 归档门、备份 `PATH_STYLE`、登录失败日志、额度可恢复（`events/group.ts`）。

### 状态

- 合并提交 `0eba7db`，**落后上游 0 个提交**；worktree 已清，临时分支已删。
- 正常树全套 **684 通过 / 0 失败**（+2 是上游带的 url/image-url 测试）。
  （在 worktree 里跑会有 1 项假失败：`.git` 是指向外层的文件，容器内 `git ls-files` 解析不到仓库。）
- 镜像 `34b6b14b0c24`（回滚标签 `merge-0eba7db`；上一个好版本是 `bf8ba6060e97`）已部署：
  上游的四处改动与我们的四条分叉在容器内逐项确认都在。
- 站点 `/`、`/api/health`、`/hot`、`/daily`、`/codex-reset` 全 200；近 10 分钟抓取 83 成功 / 0 失败。

## SocialData 余额被本地测试栈吃掉的排查（2026-10-13）

面板显示 10-11 花了 $1.93（约 9,650 条推文），而生产那天只记了 $0.10 —— 差 20 倍。

**查证过程**：先排除框架侧问题 —— 全仓只有一处构造服务商地址，所有调用都走 `paidRequest`；
把 10-11 生产存下的应答逐个数，只有 **475 条推文**（≈$0.095，与我们记的 $0.097 吻合），
且应答里**没有 users 数组**（顶层只有 tweets + next_cursor），也没有翻页（872 次全是首页）。

**真因**：本地测试栈（compose 项目 `aihot-test`）10-11 那次运行，

    610 次请求 / 9,025 条推文 / $1.81   ← 记在它自己的库里

它**用的是生产的 SocialData key**，所以钱花在同一个账号上，而**生产的预算与账本看不见**
（两套库）。对账闭合：面板 7 天 $3.73 ≈ 生产 $1.65 + 本地 $1.81 = $3.46。

**我先前的两个错误结论已纠正**：不是「成本估算漏计 users 对象」（面板切到 Items retrieved 后
Users/Spaces/Lists 全是 0），估算误差只有约 10%；也不是计费异常。**框架没有问题，不用报上游。**

### 规矩

1. **非生产栈绝不用生产的付费密钥。** 要用就单独申请一份 key；否则用 stub（测试套件本来就是 stub，
   只有「跑起来的那个栈」用了真 key）。
2. 本地/测试栈的 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 保持 `false`（已改回）。
3. 跨环境的共享密钥**没有共同的熔断和账本**，面板余额是唯一能暴露它的地方。

### 处置

- 本地测试栈整体删除（`docker compose -p aihot-test down`）：api / worker / web / setup / db 五个容器
  加网络，另删掉 9 天前的孤儿容器 `aihot-test-db`；卷 `aihot-test_db`、`aihot-test_data` 暂留。
- 保留 `aihot-testdb`（跑 `scripts/test-in-container.ps1` 用的 Postgres，与花钱无关）。
- **SocialData key 仍需轮换**（本地 `.env` 里还是生产那把；换新的只填生产）。

## 五个网页源「静默漏收」的排查与修复（2026-10-14）

HANDOFF §1① 的五个源，逐个抓它自己的列表页 + 跑采集器的真实解析（`fromHtml`）逐条核对。结论是：
**四个源确实漏，一个源不是漏；三个「页面最新」是审计脚本的假警报。** 已全部处置并验证。

### 先修判据：三个「页面最新」是假的

`E:\cs\hot\audit-web.sh` 的 `newestDate()` 把整页里所有日期字符串取最大值，于是：

| 源 | 审计说的「页面最新」 | 实际是什么 | 真实最新 |
|---|---|---|---|
| `web-blog` CMU | 2026-10-14 | **W3 Total Cache 的页脚注释**：`Served from: blog.ml.cmu.edu @ 2026-10-14 08:29:36` | **2026-08-10**（博客自己的 `/feed/` 也只有这一条：`Mon, 10 Aug 2026`） |
| `web-cursor` | 2026-10-13 | 页面底部「更新日志」区的一张卡片 `/changelog/origin-app-marketplace` | **2026-09-23**（blog directory 的第一条，我们本来就有） |
| `web-blogs` NVIDIA | 2026-10-13 | 真内容，但**早已在库里**（见下） | — |
| `web-sarvam` | 2026-10-13 | 真漏（hero 位，见下） | **2026-10-13** |

**判据要改两处**：① 扫日期前先去掉 HTML 注释（`<!--[\s\S]*?-->`）；② 比对不能只看「这个源名下的最新」——
身份（`identity_key`）是**全站按 URL 去重**的，同一条内容可能挂在别的源名下（NVIDIA 就是）。

### 真因：最新的那条在「特稿位」，结构跟列表不一样

四个源同一个形态：列表区之外还有一个 hero/特稿位，标记完全不同，选择器只认列表区，所以**每个新帖
在它当特稿的那段时间里永远看不到**（等下一篇出来、它落回列表，才会被收进来）。

| 源 | 特稿位 | 列表区 | 旧选择器 |
|---|---|---|---|
| `web-blog` | `aside.default-post-style` + `h2` | `aside.list-post-content` + `h3` | `h3` → 特稿永远不匹配 |
| `web-bfl` | 裸 `<a>`（无 `.group`） | `a.group` 卡片 | `a.group` |
| `web-cursor` | `a.card--feature`（客户案例） | `a.blog-directory__row` | `a.blog-directory__row` |
| `web-sarvam` | `a.block > h2` | `a.group` 卡片 + `h3` | `a.group` |

`web-sarvam` 的特稿位连日期元素都没有（页面只在 hero 显示标题），日期藏在文章页 JSON-LD
（`BlogPosting.datePublished`）里 → 走 `detail`（不写 `publishedAtSelector`，用兜底的 JSON-LD 读取）。

### 第二道坎：48 小时发现门槛会把「补漏」挡掉

`collect.ts` 的后续抓取只收「发布时间 ≥ `cursor.initializedAt` − 48h（`STALE_ON_DISCOVERY_MS`）」的新身份，
或已存在的身份。所以**修好选择器也未必进得来**：CMU 漏的那条是 08-10、bfl 是 09-23、cursor 是 08-25~09-15，
都在门槛之下 → `new_count` 仍然是 0。

按框架自己的机制办：**删掉 `cursor.initializedAt`**（等于把这个源重新当作首次导入），下一次抓取走
有界首导路径 —— `_aihot.initialBackfillLimit`（条数）+ `initialBackfillMonths`（12 个月），
并且这些条目按 `backfill` 归档（不进事件、不进推送、`stale-on-discovery`）。cursor 的页面一共 16 条、
漏的 4 条在末尾，所以把它的 `initialBackfillLimit` 从 8 调到 **16**。
`web-sarvam` 不用重新武装：它漏的是 10-13，本来就在门槛之上。

### 第三件事：标题是整张卡的文字

bfl / cursor / sarvam 都没有 `titleSelector`，标题取的是整张卡片的文本，站上显示成
`ProductsModelsFLUX Video Upscale: 2K and 4KAug`、`Sep 23, 2026·研究提升长时间智能体运行的 token 效率Jediah…`。
补上 `titleSelector` 后，已知条目的标题被改写 → 触发正常的**材料修订**（重新分析 + 重新归组）：
bfl 7 条、cursor 12 条、sarvam 20 条，共 39 条重跑分析（都是便宜的打分/写作调用，不是付费抓取）。

### 处置与验证（生产库实测）

| 源 | 新配置要点 | 抓取前 | 抓取后 | 新条目 |
|---|---|---|---|---|
| `web-blog` | `aside.type-post` + `h2,h3` + `.date` | found 9 / new 0 | **found 10 / new 1** | Forking-Sequences Part II（08-10，backfill） |
| `web-bfl` | `a[href^="/blog/"]` + `h2` 标题 | found 12 / new 0 | **found 10 / new 1** | Introducing FLUX 3 Action（09-24 02:11） |
| `web-cursor` | `a.blog-directory__row, a.card--feature:has(time)` + `p` 标题 | found 12 / new 0 | **found 16 / new 4** | Grab / Basis / Nokia / IMDEX 客户案例 |
| `web-sarvam` | `a.group, a:has(h2)` + `h2,h3` + `div.type-supporting span` | found 21 / new 0 | **found 21 / new 1** | Introducing Bulbul V4 Flash（10-13，走 detail 取 JSON-LD 日期） |
| `web-blogs` | **停用** | found 10 / new 0 | — | — |

六个新条目全部 `analyzed`，Bulbul 那条 10-13 是当天的真新闻（`backfill=f`，已进精选候选），
其余五条按 backfill 归档。五个源 `health=ok`、`fail_count=0`、下次抓取时间正常。

### `web-blogs` 不是漏收，是重复源

页面 15 条（特稿 4 + 热门 4 + 最新 10，去重后）的归属：

- **13 条在 `rss-nvidia-blog` 名下**（NVIDIA 自家 feed，每小时跑，最新 10-14 14:04）；
- 1 条在 `rss-nvidia-newsroom` 名下；
- 只剩 1 条（`gpus-openai-gpt-6-astra-ultrafast`）是 `web-blogs` 自己收的。

`upsertMaterial` 对「同 URL、不同源」只记一次发现、不修订（`existing.source_id !== m.sourceId` 直接返回），
所以这个网页源**永远 new=0**。站主决定停用（与已停用的 `web-blogs-2` 一致）：
库里 `enabled=false` + `next_fetch_at=null`，包内 `industry/sources.json` 同步；它名下 8 篇内容一篇没动
（8 条读者可见、1 条精选）。**以后审计要按 URL 看全库，不能只看源自己的 max(published_at)。**

### 留下的东西

- 旧选择器误收的 4 条非文章：`bfl.ai/enterprise`、`/pricing`、`/research`（导航链接）和
  `indus.sarvam.ai/`（「Get Started」按钮）。它们 `eligible=false`（公开读取层 `pool_search` 只取 eligible），
  读者看不到；站主决定先不删。新选择器不会再收这类链接。
- `web-cursor` 名下有一条 `https://x.ai/news/grok-4-7`：那是 Cursor 博客页自己挂的 Grok 公告卡片，
  属于该源的列表内容，保留。
- `https://www.sarvam.ai/rss.xml` 存在且完整（28 条、带日期）。这次仍按「修选择器」办，
  没把 `web-sarvam` 换成 RSS 源；要换是另一件事。

### 现场操作方法（这台机器上怎么连生产）

本地 Docker 守护进程没在跑，`gcloud compute ssh` 又因写 `%APPDATA%\gcloud\credentials.db` 被拒而失败；
这次直接用 OpenSSH 连实例：

```powershell
ssh -i $env:USERPROFILE\.ssh\google_compute_engine weijianlin@34.96.136.13
```

（实例 `aihot`、zone `asia-east2-c`、project `project-79671177-5fb1-4881-a7c`；IP 从
`%APPDATA%\gcloud\logs\*.log` 里那行 `plink … weijianlin@34.96.136.13` 找到的。）
脚本一律写成 `.sh` 本地文件 → `scp` 到 `/tmp` → `sed -i 's/\r$//'` → `sh` 执行，
中间产物放 `E:\cs\aihot\.cache\hot\`（已 gitignore）。

## #195 的 PR：静默判据改成按信源自己的节奏（2026-10-14）

上游在 #195 里要的：用已有、去重后的发现历史判断是否超出该源自身节奏；不新增配置、不引入付费调用；
历史不足、从未发现内容的源仍需可见；采集失败与实际漏收的证据保留；`interval_minutes` 不能当发布节奏；
先给证据（窗口、倍数、排序），回归覆盖正常低频/高频/漏收/历史不足，拿真实订阅做前后对照，并给有界查询与性能依据。

**已提 PR #202**（<https://github.com/KKKKhazix/AIHOT/pull/202>），分支 `fix/source-silence-rhythm`
从 `origin/main` 的 `e57da5a` 开出，单个提交 `65731da`，已推 `fork`。改动只有四处：

| 文件 | 改了什么 |
|---|---|
| `packages/backend/src/sources/health.ts` | 判据本体：产出日、节奏、超出倍数、历史不足 |
| `packages/backend/src/operations/alerts.ts` | 日报条目拆成「超出自身更新节奏」和「7 天没有新内容（历史不足）」 |
| `packages/backend/src/operations/reports.ts` | 周报同样拆开，头部计数跟着改 |
| `tests/source-health.test.ts` + `docs/sources.md` | 四类回归 + 判据说明 |

**判据**：产出日 = 最近 90 天收到的内容（它自己的条目 + 它带来的别人的条目）按各自日期
（有发布时间用它，没有用发现那天）去重到「天」；节奏 = 相邻产出日间隔的**中位数**；
至少 **4** 个产出日才算有节奏，静默超过中位间隔的 **4 倍**才算超出；历史不足或从未收到内容的**仍然列出**；
7 天 0 发现仍是触发条件；`interval_minutes` 不参与。

**生产库实测（524 个在用源、建站 14 天）**：现行判据列出 **55** 个 → 新判据 **14 个超出 + 2 个历史不足（仍列出）
+ 39 个回到自身节奏内**。倍数 2/3/4/5/6 分别列出 31/22/14/10/6 个（构成：4 倍下 10 个 X、1 个 HuggingFace JSON、
1 个 RSS、2 个网页）。窗口 60/90/120 在本部署结果完全一致（全部数据都在 60 天内），90 天是为老站定的默认。

**逐个核对**（抓源站、不用付费接口）：能核对的 3 个都是源站自己没更新——`rss-answer`（源站 08-18 / 我们 08-19）、
`web-tensorzero`（05-12 / 05-11）、`src-huggingface`（HuggingFace API `createdAt` 最新 07-31 / 我们 07-31）；
剩下 10 个是 X 账号，核对要用采集同款付费接口所以没核。**结论：这个判据是排序与减噪，不是故障判定**——
真正的采集故障仍由「连续失败 / 反复失败」两条兜住，措辞里也写明要对照原站。

**开销**：节奏 CTE 在 6.3 万篇文章 / 6.5 万条发现上 **176 ms**（同样口径下 `OR published_at` 是 515 ms，
而且逐源天数完全一致——发布不会早于发现，所以只按 `discovered_at` 设界，正好用上 `articles_discovered_idx`）。
没有新增索引与迁移：`article_discoveries` 上本来就没有 `discovered_at` 索引，现有 7 天查询一直在扫它。

**验证**：`npm run typecheck` ✓；容器全套 **581 通过 / 0 失败**（在干净库上跑：`DB_NAME=aihot_clean_ci`，
用 `aihot_ci` 会因里面留着本仓库模块的表而让 `tests/architecture.test.ts` 报「多出 lb_*/monitor_* 表」，
那是旧库的残留、不是代码问题）；GitHub CI `docker` 通过、`check` 当时还在跑。

**推送注意**：`fork` 的 pre-push 钩子（ECC）会跑本地 `npm test`，而本地没设 `DATABASE_URL` 时它必然失败
（测试库要求 `*_test`/`*_ci` 结尾）。这次先用容器套件自验，再用 `$env:ECC_SKIP_PREPUSH="1"` 推。

## #195 的 PR：CI 结果（补记）

PR #202 的两个 CI 任务都通过（`check` 4m06s、`docker` 47s），PR 状态 `CLEAN`（MERGEABLE）。
本仓库自己的验证是在干净库上跑容器全套：581 通过 / 0 失败。

## 从两份源清单里补源（2026-10-14）

输入是 `E:\cs\hot\2026-10-14\` 里的 6 个文件：**大黑AI速报**的全量源普查（2016 期、4878 个来源、29 个域名）
+ 那份准备好的接入包，以及本站**最近四天抓源汇总**（66 个新名字）。按「先去重 → 补地址 → 判精选/氛围 → 精选再定权重 → 入库」走了一遍。

### 一、去重结果：清单里绝大多数本站已经有了

- 四天汇总的 66 个名字里 **48 个本站已有**（其中不少是按名字/域名能直接对上的：同花顺、The Guardian、创业邦、
  蓝点网、ServeTheHome、手机中国、爱范儿、Semafor、Fortune Tech、小众软件、BleepingComputer、Silicon Republic、
  Nikkei Asia（已停用）、Numerama、极客公园、CNET、Tech.eu、Computerworld、CNBC Technology、智东西、量子位…
  X 账号那侧 40 个里 34 个已有，连 `@levelsio`、`@CuiMao` 都在）。那份台账自己也写了原因：
  **10-04 起原站 `/hot` 载荷不再给头像**，扫描判不出「是不是 X 账号」，于是把已有源误标成「需补地址」。
- 大黑AI 的 29 个域名里，`blog.google` 我们有（`rss-blog` = Google Blog：AI）、`simonwillison.net` 有、
  `mp.weixin.qq.com`/`github.com`/AWS/Google Cloud/Databricks/HF/掘金/宝玉都有；`stackoverflow.blog`、
  `blog.cloudflare.com`（`web-blog-2`）、`blog.bytebytego.com`、`lastweekin.ai` 也都在清单里。
  **真缺口只有 reddit、linux.do、blog.google 之外的两三个**——与那份报告的结论一致。
- 结论：**这次要补的不是几十个，而是 29 个**（22 个精选 + 7 个氛围）。

### 二、地址逐个实测（用采集器同一条网络路径，2026-10-14 22:0x–22:5x UTC）

| 源 | 用的地址 | 实测 |
|---|---|---|
| Epoch AI | `https://epoch.ai/atom.xml` | 200、50 条 |
| PyTorch Blog | `https://pytorch.org/blog/feed/` | 200、10 条（旧地址 /feed.xml 也 200） |
| Redwood Research | `https://blog.redwoodresearch.org/feed` | 200、20 条 |
| Understanding AI | `https://www.understandingai.org/feed` | 200、20 条 |
| Exponential View | `https://www.exponentialview.co/feed` | 200、20 条 |
| ChinaTalk | `https://www.chinatalk.media/feed` | 200、20 条 |
| Recode China AI | `https://www.recodechinaai.com/feed` | 200、20 条（Substack 的 reco…substack.com 会 302 到这里） |
| Amazon Science | `https://www.amazon.science/index.rss` | 200、25 条 |
| ElevenLabs Blog | `https://elevenlabs.io/blog/rss.xml` | 200、50 条 |
| Turing Post | `https://turingpost.substack.com/feed` | 200、20 条（官网 /feed 是 404） |
| Cursor Changelog | `https://cursor.com/changelog/rss.xml` | 200、50 条 |
| **Impress Watch** | `https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf` | 200、20 条 —— **HANDOFF §6 里「探不到 feed」的那个，找到了** |
| Reddit r/LocalLLaMA | `https://www.reddit.com/r/LocalLLaMA/.rss` | 200、25 条（连发会 429） |
| Reddit r/ClaudeAI | `https://www.reddit.com/r/ClaudeAI/.rss` | 200、25 条 |
| Matthew Berman / Matt Wolfe | YouTube `channel_id=UCawZsQWqfGSbCI5yjkdVkTA` / `UChpleBmo18P08aKCIgti38g` | 200、15 条（频道 id 从频道页的 `videos.xml` 链接里取） |
| 8 个 X 账号 | `from:<handle> -filter:replies` | 都用 fxtwitter 实证过 handle 存在与粉丝数（Tongyi Lab 2.6 万、Cline 8.1 万、LM Studio 6.6 万、Zara Zhang 9.1 万、KwaiKAT 3.7 千、黑 6.5 千、Cerebras 7.9 万、Amanda Askell 11.4 万、gggerganov 7.3 万、Figure 22.6 万、Lisa Su 32.9 万、Waymo 14.3 万） |

**没补的与原因**：`linux.do`（直连 403；`rsshub.rssforever.com` 的路由缺失、`rsshub.ktachibana.party` 404、
官方 `rsshub.app` 已公告限制公共访问）、`deeplearning.ai` The Batch（官网已无 feed，且 `@DeepLearningAI` 在库）、
Gemini API 更新日志（没有 feed，要写 `web_list` 选择器，留作后续）、OpenClaw 博客（`@openclaw` 在库）、
`@gp_pulipaka`（11.4 万推的长尾互动号，报告自己也只是「备查」）、`Generalist`（身份不清，先不加）。

### 三、判型与权重

判据沿用本站的分级口径（`docs/sources.md` + `industry/selection.ts` 的门槛 T1 60 / T1_5 65 / T2 76）：

- **精选（editorial）22 个**：官方一手/机构博客给 T1 或 T1_5（PyTorch T1、ElevenLabs T1、Cursor Changelog T1、
  Epoch AI T1_5、Amazon Science T1_5、Redwood Research T1_5），分析型媒体与个人给 T2（Understanding AI、
  Exponential View、ChinaTalk、Recode China AI、Turing Post、Zara Zhang）；X 账号里官方产品/机构/官方人物
  给 T1_5（Tongyi Lab、Cline、LM Studio、Cerebras、Figure、Waymo、KwaiKAT、Lisa Su、Amanda Askell、ggerganov）。
- **氛围（hot_signal）7 个**：社区与聚合（Reddit r/LocalLLaMA、r/ClaudeAI、X：黑）、宽口径科技媒体
  （Impress Watch）、AI 视频博主（Matthew Berman、Matt Wolfe），以及**准备好但按原样未启用**的
  `rss-daheiai-news`（那份接入包自己写着 `enabled: false`——它是别家速报，会引用上游演示站 aihot.news，留着等站主决定）。
- `site_fulltext`：精选源开、氛围源关（与库里 248/251 个 hot_signal 一致）。

### 四、入库与验证

包（`industry/sources.json`，620 → **649**）与库两处一起改：把包 scp 到主机（`industry/` 是挂进容器的），
跑框架自己的 `node scripts/seed.ts` → **29 added, 620 already there**。现在全站 **启用 552 / 合计 655**。

第一次抓取（手动一轮 + 调度器自己跑）：**21 个源 ok、各按 `initialBackfillLimit` 收进 8 条**；两个特殊情况：

- `rss-reddit-localllama` **HTTP 429**：reddit 按 IP 频控（r/ClaudeAI 同一时刻是 200）。两条 reddit 源都设了
  120 分钟，让它自己重试；持续 429 再说。
- **5 个 X 账号首读超时**（Ali_TongyiLab、Cline、LM Studio、Cerebras、Figure_robot）：新账号没有水位，
  第一次是**单独读**（`shardHandle` 要求已有 `lastTweetId` 才进分片），窗口大就容易超时，并留下未确认回执。
  按设计 `ops.recover` 会在 30 分钟后自动放行一次，约 00:55 的重试会再发一次；**别在放行前手动重跑**
  （回执未确认时会被拒绝，我试过一次，只会多记一次失败）。
- `x-account-hx1u0`（黑）收进来的 8 条最新是 2026-04-14：这个号本身已经几个月没发帖，不是采集问题。

**加源时的两个一次性现象**（都会自己恢复，记下来免得误判）：

- 13 个 X 账号一起入库，调度器在同一分钟里读它们，撞上了 SocialData 的**每分钟 30 次**预算：
  22:40–22:56 有 15 个既有账号记到 `Budget for socialdata exhausted (minute)`。这类错误**不算源失败**
  （`health.ts` 里按 `spentBudget` 过滤，那 15 个账号 `health=ok`、`fail_count=0`），下一次（23:11）就正常了。
  一次加很多付费源时会看到这一分钟的尖峰，不是故障。
- 那 5 个首读超时的 X 账号留下了未确认回执，`ops.recover` 在 30 分钟后（约 23:10）自动放行一次，
  下一次调度（约 00:55）重试；重试成功拿到水位后它们就并入分片。

### 2026-10-15 再换一次 key（第二把额度也到顶了）

**症状**：`deepseek HTTP 429 {"type":"GoUsageLimitError"}`。10-15 15:49 起零星出现，**16:00 之后每一次模型调用都失败**
（16:00–19:00 每小时 0 成功、327/466/479 次失败），归组的 `group_article` 攒了 1221 次失败、2172 篇文章卡在
`processing_state='new'`。站点自己的告警**发现了**（`alerts.state` → `content.process`「新内容卡住了，进不了网站」，
10-15 10:50 UTC 发出）。

**处置**：`.env` 里那把早先因周额度用尽而被顶下来的 key（`OPENCODE_OLD_KEY`）**周额度已经重置**，
实测 `deepseek-flash` / `glm-5.3-flash` 都 200（在用的那把两个模型都 429）。于是对调：

```
LLM_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / ZHIPU_API_KEY / XIAOMI_MIMO_API_KEY  ← 700a89304d94（恢复使用）
OPENCODE_OLD_KEY                                                                         ← d0cfcbf3fd23（本次用尽的）
```

（哈希是 sha256 前 12 位，用来核对不打印明文。）

**步骤**（`.env` 里 6 行用 awk 就地改写，脚本 `keyswap.sh`，先 `cp -p .env .env.bak-20261015-before-keyswap`）：

1. 改写后先比对 `.env` 与容器读到值的哈希；
2. **`docker compose -f docker-compose.server.yml up -d --force-recreate api worker web`** ——
   `restart` 不会重读 `.env`（老坑）；这次连 `web` 一起重建，因为它的环境里也带 `LLM_API_KEY`；
3. 复核：6 个变量哈希两边一致、站点四页 200、模型调用恢复（19:11 起 0 失败，19:14 峰值 18 次/分钟）。

**要记住的两件事**：

- 这个 $10/月的 Go 套餐撑不住本站的量：**10-15 一天 deepseek 调用 11,478 次、2,704 万 token（输入 2,400 万 / 输出 304 万）**，
  外加 embedding 4,364 次。按 DeepSeek 官方按量计费粗算约 **$5–8/天**（含缓存命中）；Go 套餐是给编码 agent 的，
  文档写明「Traffic is monitored for abuse」，长期跑批量管道既有额度问题也有被判定滥用的风险。
  真要稳，还是换成按量计费的 API（只改 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，并去掉 `LLM_EXTRA_JSON`、`LLM_SESSION_ID`）。
- 每次换 key 都会留下旧 key（`OPENCODE_OLD_KEY`），所以「另一把 key 的周额度重置了」是可以复用的退路；
  但两把都被用尽时会同时失效，**别把两把 key 都当成无限量**。

### 2026-10-15 停掉三个 arXiv 源

站主决定：arXiv 那三个源（`rss-arxiv` = cs.AI、`rss-arxiv-2` = cs.CL、`rss-arxiv-3` = cs.LG）**全部停用**。
理由是它们占了当天 64% 的模型调用（9,555 次 / 17.8M token），而分级 `EXCLUDE_MP` 决定它们**从不进精选**，
只进「全部动态」：今天 1,872 篇里 `selected=0`、`selection_candidate=0`。

- 停法：库里 `enabled=false` + `next_fetch_at=null`（包 `industry/sources.json` 同步，620→649 那份里三个源也置 false），
  三个源都是 **15 分钟轮询**，停掉后每天少约 288 次抓取。
- **「移出评分」这件事本来就是关的**（这套机制值得记住）：分级 `EXCLUDE_MP` → `publish.ts` 的
  `isSelectable(eligible, judgedSelected, tier)` 返回 false → `publications.selection_candidate = false`。
  而 `selection_candidate` 同时管两件事：
  1. 精选评分（`score_article`）：近 24 小时 1,136 次评分调用**全部来自其他源**，arXiv 是 0 次；
  2. 归组清扫（`operations/grouping.ts` 只挑 `selection_candidate AND eligible AND public` 且未归组的）。
  今天 1,872 篇、历史 6,669 篇的 `selection_candidate` **全是 false**，队列里也没有它们的任何任务。
- 它们**仍以 `eligible=true` 出现在「全部动态」**（今天 1,864 条）——这是另一套开关（`visibility`/`eligible`），
  站主确认：**出现在动态的不用管**，保持可见。

## 2026-10-15 的增量包与 linux.do：去重、实测、入库

输入是 `E:\cs\hot\2026-10-15\` 的五份文件（AIHOT 信源增量包 11 个 + linux.do 方案）。走的是同一套流程：
先去重 → 再逐个实测（用采集器同一条网络路径）→ 判型/定分级 → 入库并实抓验证。

### 一、增量包 11 个：真加 5 个，5 个跳过

**加的（都实测通过）**：

| 源 | 地址 | 分级/参与 | 实测 |
|---|---|---|---|
| 张小珺商业访谈录（播客） | `feed.xyzfm.space/dk4yh3pkpjp3` | T2 / editorial | 200、157 期、最新 10-15（首轮收 8 条，标题如「154. 对Dyna创始人Lindon的3小时访谈…」） |
| 中华网科技 | `news.google.com/rss/search?q=site:tech.china.com…` | T2 / hot_signal | 200、100 条（站上 GN 兜底写法与手机中国/虎嗅一致） |
| X：Legit (@legit_api) | `from:legit_api` | T2 / hot_signal | fxtwitter：14,954 粉、自述 "covering AI news… @voxelbench"；实读 20 条/收 8 条 |
| X：Yihui Xie (@xieyihui) | `from:xieyihui` | T2 / hot_signal | 22,080 粉、名字吻合；实读 20 条/收 2 条 |
| X：Rachel Metz (@rachelmetz) | `from:rachelmetz` | T2 / hot_signal | 34,169 粉、自述 Bloomberg AI 记者；实读 20 条/收 8 条 |

（`yetone` 也加了，见下表的 X 账号；这里漏列，实际入库 4 个 X。）

**跳过的（去重与实测的结论）**：

- **界面新闻**：站内**已有** `src-992b39c481`（同名、同地址、已启用）——增量包给的 id `rss-src-992b39c4`
  正是从它派生的，重复。（顺带说明：这个源是站上待处理积压最多的几个之一，194 篇。）
- **OpenAI Developers：Blog**：站内已有 `rss-developers`（同名同地址），**因 403 被停用**；
  本次从服务器复测仍是 **403 `Forbidden`（hkg1 边缘拦截）**，不能加。
- **Tom Huang**：站内已有 `x-account-tuturetom`（`from:tuturetom`，已启用）。
- **Ideogram Blog**：整站 Cloudflare 挑战（`/blog` 403、首页 403，sitemap 200），无 feed；
  且 X 账号 `x-account-ideogram_ai` 已在站内。
- **博客园·AI**：官方 feed 服务端 **500**（复测仍 500），增量包里也没给 config，留待其恢复。

**与包的差异（有意为之）**：X 账号按站内命名规范写成 `X：显示名 (@handle)`；播客的 `site_fulltext` 打开
（站内两个播客 Dwarkesh / Latent Space 都是 true）；张小珺用 `rss-zhangxiaojun` 这个干净的 id
（包里那个 `web-src-94640ce5` 与 kind=rss 不符）。

### 二、linux.do：**本站抓取端确实被 CF 挡**，用框架自带的 Jina 通路解决

那份文档的结论「linux.do 有官方 Discourse RSS、直连即可抓，403 是 Python 库的 TLS 指纹问题」——
**对一半**：同一台服务器上 `curl` 带采集器 UA 也是 **200**，但**我们的采集器（Node/undici）拿到的是
403 `Just a moment...`**（三个端点全试：`c/news/34.rss`、`latest.rss`、`top.rss?period=daily`）。
即：不是 UA 的问题，是 **TLS 指纹**；而框架不给信源配 UA/指纹的开关（这是有意的）。

解法走框架**文档里写明**的 Jina 通路（`docs/sources.md`：到不了的站点把 `url` 写成 `r.jina.ai/…`）：

```json
{
  "kind": "web_list",
  "config": {
    "url": "https://r.jina.ai/https://linux.do/c/news/34.rss",
    "parseMode": "html",
    "itemSelector": "body > div",
    "linkSelector": "h3 a",
    "titleSelector": "h3",
    "publishedAtSelector": "time",
    "allowUrlPrefixes": ["https://linux.do/t/topic/"]
  }
}
```

Jina 把 RSS 渲染成 HTML 后结构正好可读（`<div><h3><a href=topic>标题</a></h3>…<time>Thu, 15 Oct 2026 11:33:59 +0000</time>`），
首抓 **25 条全收、标题与日期都对**（「IDC：Q3全球智能手机出货量同比暴跌22%」19:33 等）。
代价是每次抓取一次 Jina 读取（60 分钟一轮 → 24 次/天），`cashToleranceSeconds` 未设、无详情页读取。
**注**：RSS 的 Markdown 渲染也能读到标题和链接，但 `fromMarkdown` 不取日期 → 会全部落成「无发布时间的回填」，
所以选了 html 渲染 + 选择器这条路。

### 三、入库结果

包 649 → **656**，`scripts/seed.ts` → **7 added, 649 already there**；全站 **启用 556 / 合计 662**。
七个源首抓全部成功（播客 157 收 8、linux.do 25 收 25、中华网 100 收 8、4 个 X 账号各读 20 收 8/8/2/8），
`health=ok`、`fail_count=0`。首轮导入的条目都带 `backfill`（首轮导入的既定行为），下一轮起进正常流程。

### PR #202 第二轮：维护者打回的三条与修法（2026-10-15）

维护者 KKKKhazix 在 10-14 18:04Z 给了 **CHANGES_REQUESTED**，正文三条 + 一句要求（补两个方向的回归、重做前后对照）。
本轮逐条改完（分支 `fix/source-silence-rhythm`，已并入 `origin/main` 的 `540c477`）：

1. **首次导入必须折成一天**。`activity_days` 原来按 `coalesce(published_at, discovered_at)` 分天，
   一次首次导入（`backfill_reason='first-import'`）会被算成多个产出日：维护者给的可复现样例是
   同一天导入 4 篇、发布在 8/9/10/11 天前 → 原实现 `evidence_days=4`、中位间隔 1 天、静默 8 天 → 误判 overdue；
   反向也会**掩盖**信源（跨月导入把中位间隔撑大，安静的源显得「节奏内」）。
   改法：`CASE WHEN backfill_reason = 'first-import' THEN discovered_at ELSE coalesce(published_at, discovered_at) END`。
2. **窗口语义写清楚**。原来用发现时间限定 90 天、却用发布时间生成产出日——近期导入的更早历史仍进中位数。
   改法：行按「`discovered_at` 或 `published_at` 任一落在窗口内」读取（不假定两者先后），
   产出日再 `BETWEEN 窗口起点 AND 今天` 夹一次（窗口外与未来日期都丢弃）。
3. **`evidence_days === 0` 不等于「从未收到过内容」**。新增 `ever_output`（这个源历史上有没有产出过文章），
   据此分三种说法：`从未收到过内容` / `近 90 天窗口内没有可比较的产出` / `窗口内可比较的历史只有 N 天`；
   日报、周报的汇总句也分别给出「窗口内没有可比较的产出」与「从未收到过内容」两个数量。

**回归**（`tests/source-health.test.ts`）：新增 3 个用例（首次导入算一天；跨月首次导入不能掩盖静默；
窗口外产出日不计入且措辞与「从未收到」区分），并更新 1 处按新措辞断言的旧用例。
在**迁移过的干净库**上：改后 **11 通过 / 0 失败**，改前实现下这 3 个新用例 + 那条措辞用例失败（4 失败 / 7 通过）。

**真实数据前后对照**（生产库，550 个在用信源，只读跑两份实现）：

| | 超出自身节奏 | 判断不了 |
|---|---|---|
| 改前 | 15（editorial 14 + hot_signal 1） | 2 |
| 改后 | **2**（editorial 2 + hot_signal 0） | **49** |

变成「判断不了」的不是坏消息：本站的 DB 是 **09-29/09-30 那次整包首次导入**建起来的（那天 255 个源、2,223 行带 `first-import`），
**73 个启用中的源的窗口内产出日全部来自那次导入** → 折成一天后它们确实「没有可比较的历史」，
按维护者的口径属于「历史不足、仍然列出」，不该硬算出一个假节奏去报超标。查询耗时 822ms → 987ms（一次性的窗口聚合）。


## 并入上游 540c477（翻译修复，2026-10-15）

站主指示「没冲突就并进来」。`git merge origin/main` **无冲突**（只带 3 个文件：`editorial/translate.ts`、
`tests/translate.test.ts`、新迁移 `0086_translation_attempt_request_tag.sql`），合并提交 `c02ad68`。

**合并后按老规矩重验我们的分叉**（都在）：

| 分叉 | 位置 | 状态 |
|---|---|---|
| 归档门 | `editorial/analyze.ts` + `tests/history-limit.test.ts` | ✓（测试 3/3 通过） |
| `DB_BACKUP_STORE_PATH_STYLE` | `operations/backup.ts` + `.env.example` | ✓ |
| `LLM_SESSION_ID` → `x-opencode-session` | `providers/llm.ts` | ✓ |
| 补扫去重键 | `jobs/content.ts`（`sweep:<ts>:<articleId>`） | ✓ |
| 模型网关预设 | `site/models.ts` | ✓ |

**顺手更正一处旧记录**：DEPLOY-NOTES 前面写「`LLM_SESSION_ID` 改了 `llm.ts` 和 `embeddings.ts` 两处」，
现在树里只有 `llm.ts` 一处（`embeddings.ts` 只发 content-type + authorization）。生产上 embedding 调用一直是好的
（今天 4,364 次），说明 Go 网关的 `/embeddings` 路由不要求这个头，所以不需要补。

**验证**（本地，每文件一个干净库）：`npm run typecheck` 通过；`tests/translate.test.ts`（上游新测试）7/7、
`tests/history-limit.test.ts` 3/3、`tests/source-health.test.ts` 5/5；
`tests/backup-store-url.test.ts` 只因本机没有 `pg_dump` 而失败（`spawn pg_dump ENOENT`），属环境限制。

**未部署**：这次合并带迁移（0086 = `ALTER TABLE translation_attempts ADD COLUMN request_tag text`）。
`docker-compose.server.yml` 里有 `setup` 服务（`node scripts/migrate.ts && node scripts/seed.ts`），api/web/worker 都
`depends_on: setup: condition: service_completed_successfully` —— 所以**正常 `docker compose pull && up -d` 就会自动补迁移**，
不用手动跑。生产库现在 79 条、到 `0085`；合并后是 80 个文件，部署时只会补这 1 条。按 HANDOFF 的口径不急。

## 积压告警的「已持续」时长（2026-10-15）

**现象**（站主收到的两条真实通知）：`🔴 新内容卡住了，进不了网站（已持续 45 小时 52 分钟）`、
`✅ 已恢复：… 持续 47 小时 12 分钟（10月13日 21:48 起）` —— 但那次积压是当天 16:00–19:00 三小时里堆起来的
（模型额度用尽），真实时长只有 3 小时多。

**真因**（上游原始代码 `877d6d5` 带来的）：`operations/alerts.ts` 的 `content.process` 把 `Finding.since`
设成**最老一篇还卡在 `new` 的文章的 `discovered_at`**。一篇几天前的遗留文章会跨过每一次积压，
于是后续每一次积压都用它的年龄起算；`checkAlerts` 把这个值存进 `alerts.state`，恢复通知照抄，所以报成 47 小时。
`Finding.since` 的约定本是「问题开始的时间，否则第一次看到的时间」——这个值两者都不是。

**处置**：

1. **提到上游**：**PR #204**（分支 `fix/backlog-alert-duration`，从 `origin/main` 的 `540c477` 开，提交 `deccb26`）。
   改法：不再给这个 finding 传 `since`（交给 `checkAlerts` 的「第一次看到」语义起算），
   最老一篇的时间作为事实写进 `detail`（`最老的一篇 10月13日 21:48 收进；…`）。
   回归：`tests/alerts.test.ts` 的素材加一篇 **40 小时前**的遗留文章（在 2 天窗口内、旧代码会选中它），
   断言首次告警后 `alerts.state` 的 `since` 等于首次告警时刻 —— 改后 7/7 通过，把那一行 `since` 放回去则这条断言失败。
2. **同时并进我们的树**：`4bcbdbd`（`git merge fix/backlog-alert-duration`），这样**下次部署即生效**，不必等上游合并。

**注意**：这是代码修复，**要部署才生效**（线上仍是 `34b6b14b0c24` 旧镜像）。下次部署把 `d9ee498`（上游合并）、
`540c477`（翻译修复 + 迁移 0086）和本修复一起带上即可。

## 站主选的四项：① 换后端 + 成本可见、② 额度熔断、③ 部署、④ 恢复演练

### ② 额度熔断（已提上游 PR #205，并已并进我们的树 `84534a9`）

**病根有两处**（都在上游原始代码里，不是我们改坏的）：

1. `assertAccepted` 把 429 一律当**限流**（`retryable = true`）→ 套餐额度用尽时，每篇文章继续走重试阶梯，
   3 小时里白撞 **1,374 次**；
2. `providerFindings` 的拒绝模式是 `HTTP 40[123]\M|insufficient|balance|…`，而 Go 的正文是
   `HTTP 429: {"type":"GoUsageLimitError"…}` —— **两个条件都不匹配**，所以站主根本没收到"账号额度用尽"的告警，
   是从下游的「新内容卡住了」（3 小时后）间接知道的。

**改法**：账务类拒绝（402/403/429 且正文提到额度/余额/欠费）抛 `BudgetExceededError(service, "provider", 900)`——
框架里每一条 `BudgetExceededError` 的处置正好是我们要的：文章与归组**留 `pending`**（不烧重试次数）、
`spentBudget` 的 LIKE 把这些失败**排除在信源健康之外**、且记 `failed` 而不是 `unknown`（不会产生要人工放行的回执）；
同时在 `settings` 记 `provider.quota.<service>` 作为**熔断**，`checkBudget` 先看它——冷却期内调用**发不出去**，
于是"一次额度用尽"的代价从"每篇文章一次"降到"每个冷却期一次"；`providerFindings` 读这个键**立刻告警**
（「X 额度用尽，已暂停调用」，today/owner），冷却过期自动收尾。
回归：`tests/receipts.test.ts` 12/12、`tests/alerts.test.ts` 8/8、typecheck 通过。

### ④ 恢复演练（2026-10-15，第一次真正做）

拿最新那份 dump（`/data/backups/aihot-202610142010.dump`，1164.1 MB）恢复到临时库：

| 项 | 结果 |
|---|---|
| `pg_restore --no-owner --no-privileges -j4` | **退出码 0、stderr 0 行**；用时 **244 秒**（约 4 分钟，1.16 GB）|
| 恢复出的内容 | 文章 **64,584**、公开条目 **64,574**、分析 **26,633**、回执 **197,005**、信源 **655**、已应用迁移 **79** |
| 时间线自洽 | 库里最新一篇是 **10-14 20:07 UTC**，而 dump 生成于 20:10、记录的上一次备份是 10-13 20:10 ✓ |
| 抽三条公开条目 | 「Gemini 4 Argon 上线 Cloudflare AI Gateway」「Databricks Document Intelligence…」等都是真实条目、时间正确 |
| 与生产对照 | 生产此刻 文章 71,239 / 信源 662 —— 差的正是这 24 小时的增量与 10-15 新加的 7 个源 ✓ |
| 收尾 | 临时库已删除（核对为 0），磁盘回到 23G/49G（多出的约 1G 是恢复期间产生的 WAL，checkpoint 后回收）|

**结论：备份是"能用"的，不只是"存在"。** 建议固化：每月挑一份最新 dump 走一遍同样的流程（脚本在
`E:\cs\aihot\.cache\hot\restore-drill.sh`，约 5 分钟），并记下用时——恢复耗时是事故处置计划里要有数的一项。
## 部署上线（2026-10-15 22:05 北京，站主批准）

**镜像**：`a1587d2c3116`（标签 `merge-060c5a6` + `latest`），构建于本地、推送后服务器 `pull`；
上一个好版本 `34b6b14b0c24` 已推成 **`rollback-before-060c5a6`** 存进仓库，服务器上也还留着（悬空层），
两条回滚路都在。

**这次带上的东西**：`d9ee498`（早先那次上游合并）→ `540c477`（翻译修复 + **迁移 0086**）→
积压告警「已持续」时长修复（PR #204）→ **额度熔断**（PR #205）。

**挂载目录同步**（代码在镜像里，`database/`、`industry/`、`scripts/` 是挂载的，必须单独放）：
`database/migrations/0086_translation_attempt_request_tag.sql`（**关键**：不放上去 setup 会报 "up to date" 静默跳过）、
`industry/sources.json`、`scripts/eval-selection.ts`、`scripts/eval-selection-core.ts`，全部 `sed -i 's/\r$//'` 去过 CR。

**部署前的保险**：先在 worker 里跑了一次完整备份 —— `daily/aihot-202610151357.dump`（1280 MB，已上传 R2）✓。

**过程与核验**：

| 项 | 结果 |
|---|---|
| `setup` 服务 | 3 秒成功退出：`applied 0086_translation_attempt_request_tag.sql (17ms, transaction)`、`1 migration(s) applied`、`sources: 0 added, 656 already there` |
| 迁移账本 | **80 条**已应用，最后一条 `0086_translation_attempt_request_tag.sql`；`translation_attempts.request_tag` 已存在 ✓ |
| 容器 | api/worker/web 全部 Up、**重启 0 次**，镜像 `a1587d2c3116` ✓ |
| 站点 | `/`、`/api/health`、`/hot`、`/daily`、`/codex-reset` 全 **200**；`/api/health` 返回 `{"ok":true,"db":"ok"}` ✓（刚起来的几秒内 `/` 是 503、`/api/health` 是 502，容器还在起 ✓） |
| 代码核对 | 额度熔断 2 处 ✓、告警时长修复 1 处 ✓、上游翻译修复 5 处 ✓、归档门 ✓、备份 PATH_STYLE ✓、Go 会话头 ✓ |
| 运行 | 近 5 分钟抓取 38 成功 / 0 失败；近 10 分钟模型调用 **220 次、失败 0**；`provider.quota.*` 无键（正常）；日志无 error |

**两点要记住**：

1. **这次没带 #202**（静默判据按信源节奏）—— 它还在上游复审，只存在于 `fix/source-silence-rhythm` 分支，
   所以线上的「静默源」判据仍是旧口径，这是预期的，不是漏部署。
2. 现场还看到 **归组待办 14,387 条**（`articles.grouping_status='pending'`）与 **12 篇 `failed`**（额度事故的遗留）——
   前者就是菜单里第 8 项（归组吞吐）要处理的量级，后者可以后续手动重排一次。


## Go 套餐额度可见：新增 go-quota 模块（2026-10-15，已上线）

站主提示「Go 套餐密钥应该可以查额度，可以按百分比算」。实测确实有只读接口（不花额度）：

```
GET https://opencode.ai/zen/go/v1/usage   (Authorization: Bearer <key>)
{"usage":{"rolling":{"status":"ok","percent":10,"resetsAt":"2026-10-15T15:26:12Z"},
          "weekly": {"status":"ok","percent":11,"resetsAt":"2026-10-19T00:00:00Z"},
          "monthly":{"status":"ok","percent":60,"resetsAt":"2026-10-27T01:58:51Z"}}}
```

**顺带证实一件事：额度按 key 算** —— 10-15 那把用尽时，换上的另一把周额度只用了 11%
（两把 key = 两份独立额度，这也是「留着旧 key」的价值）。状态里记密钥 sha256 前 6 位（当前 `700a89`），
数字跳变时能分辨是用量还是换 key。

**做成模块**（Go 专属，按 AGENTS 不进框架）：`modules/go-quota/`
（`backend/quota.ts` 逻辑、`server.ts` 挂点、`tests/quota.test.ts`），在 `site/modules/server.ts` 装上。

| 行为 | 说明 |
|---|---|
| 采样 | 每 30 分钟一次（`cron.go.quota`，Asia/Shanghai），`runOnStart` 让新库启动即查一次；留两天样本 |
| 外推 | 只用「没有重置过的那一段」算用量速度（百分比下降即视为重置，之前的样本不参与），再算「还能撑几天」 |
| 告警 | 任一窗口 ≥70% 且按速度会在重置前用尽、或 ≥95% 时，报给站主（≥95% 用 `now`，否则 `today`，都带 `owner`）；重置或换 key 后由告警状态机自动收尾 |
| 非 Go 后端 | 换成官方 API 后整个模块什么都不做（`LLM_BASE_URL` 不是 Go 网关就直接返回） |

**回归**：`modules/go-quota/tests/quota.test.ts` 6/6 通过（解析真实答复形状、重置切段、速度外推、两个阈值、指纹不是密钥）；
`npm run typecheck` 通过。

**上线**（第二次部署，同一天）：镜像 `0b904ed57eb3`（`merge-f60de5e`），回滚点 `rollback-before-f60de5e`（= 上一个镜像）。
核验：模块文件在镜像里 ✓、`site/modules/server.ts` 装上 ✓、**启动 10 秒后 `settings.go.quota` 就有真实数据** ✓、
`pgboss.schedule` 里有 `cron.go.quota` ✓、`operations/alerts.ts:155` 会调用模块的 alerts ✓、
当前三个窗口 10%/11%/60%、**0 条告警** ✓（样本还少，速度要一小时后才外推得出来）、站点五页 200 ✓、模型调用 0 失败 ✓。


## 巡检与额度事故遗留清理（2026-10-15 深夜）

**巡检结论（站点健康）**：处理 `new=0` ✓；`events.group` 已完成 35,467 个 ✓ 近 60 分钟模型调用 0 失败 ✓；
新源都在出内容（中华网 92、linux.do 25、X 各 5–10、reddit 7/4）✓；额度 10%/11%/60% ✓。

**我自己看错了一次口径**：先看到 `grouping_status='pending'` 有 14,431 条就以为是积压，拆开看是
**8,313 条 `processing_state='skipped'`（非编辑内容，本来就不归组）+ 5,000 条 `blocked`（`analyze.ts:586`
按相关性主动拦截的噪声）+ 只有 1,107 条真在等**。教训：看 pending 要先按 `processing_state` 拆，
再把「公开 + 合格 + 精选候选」这个归组门槛套上，否则数字会吓自己一跳。

**清理（两类真正的遗留）**：

| 动作 | 数量 | 走的路 |
|---|---|---|
| 处理失败的文章重排 | **11 篇** | `admin/runs.ts` 的 `requeueFailedArticles`（框架自带、写审计，actor `admin:1`） |
| 因额度/配额失败而归组的文章放回待办 | **1,895 条** | `content/provenance.ts` 的 `groupingReset()` + `grouping_error ~* 'exhausted|GoUsageLimit|HTTP 429'` |
| 剩下的归组失败 | 7 条 | 是内容/输出问题，不是额度，留着不动 |

清理后核对：`grouping_status='failed'` 1,902 → **7**；归组在推进（90 秒内 `new` 8→4，近 10 分钟新归组 65→70），
模型调用 0 失败 ✓。脚本 `.cache/hot/cleanup-stranded.mjs`。

## 近 6 小时"额度花在哪一步"（菜单第 5 项）

| 步骤 | 调用 | 合计 token | 占比 | 平均输入/输出 |
|---|---|---|---|---|
| `score_article` | 264 | 1.41M | **30.8%** | 3,199 / **2,181** |
| `group_article` | 239 | 1.04M | **22.6%** | 3,876 / 515 |
| `structure_article` | 140 | 0.44M | 9.6% | 3,016 / 137 |
| `prefilter_article` | 271 | 0.44M | 9.5% | 1,589 / 24 |
| `story_digest` | 234 | 0.30M | 6.5% | — |
| `summarize_article` | 95 | 0.29M | 6.3% | — |
| `understand_article` | 43 | 0.25M | 5.4% | — |
| `group_signal` | 254 | 0.15M | 3.3% | — |

**两步占了 54%**，其中 `score_article` 每次吐 **2,181 个输出 token**（评分这一步在写长文）——
这是最大的单点。可选处置：给评分换更便宜的模型（`site/models.ts` 一步配置），或让它输出更短；
换之前要抽 50 篇对比评分质量，不能只看省。


## Codex 重置监控的 11 条「需复核」处理（2026-10-15 深夜）

**现象**：站主收到 `🟠 仍未恢复：有 Codex 重置消息需要你确认（已持续 3 天）`。
原因：`monitor.review` 的条件是 `recognition->>'needsReview' = true AND reviewed <> true`
（`modules/monitor/backend/read.ts:101`），11 条 `thsottiaux` 的帖子被模型标了「没把握」、一直没人复核；
这条 finding 是 `today` 级 → **每天重复提醒**，起点 10-12 22:20 是告警状态里记的首次发送时间
（它没传 `since`，所以「已持续 3 天」是**准确**的 —— 正是今晚修的那类 bug 的反面）。监控本身健康：
待识别 0 条、已识别 307 条。

**处理（站主指示「按你的建议弄」）**：11 条全部走模块后台动作
`resolveMonitorPost(id, { action: "reviewed", reason }, "admin:1")`（带审计），理由分两种：
9 条玩笑/寒暄/产品计划/推送说明/空帖按「不是重置公告、无需改动」，2 条 `Day N/ Reset` 按「是进度标记、
不是重置已发生」。结果：**需复核 11 → 0**，告警引擎随即发出 `monitor.review:recovered`（群里的 ✅ 已恢复），
**告警状态清空**。脚本 `.cache/hot/resolve-monitor-review.mjs`。

**踩到的坑（记下来）**：一开始我给 9 条用了 `action: "skip"`，报
`Conflict: 这条帖子已经识别过了，请刷新` —— 读代码才明白两个动作的分工：
`skip` 是给**还没识别、堵住队列**的帖子（`processed_at IS NULL`）「挪开」，改 `processed_at` 并清空识别；
`reviewed` 才是给**已识别但结论被挂起**的帖子「我看过了」。用错动作时它只报错、不改数据（好在如此）。

**明天的可选项**：这 11 条里 9 条是玩笑/寒暄（`Mashed @poteto on the house.`、`Also! Good evening!!`、
`@hiarun02 Facts` 这类），识别提示词（版本 `tibo-reset-2026-09-26.5`，`modules/monitor/backend/recognize.ts`）
可以加一句「明显是玩笑、寒暄、与重置无关的产品/推送说明，直接 `relevant=false` 或 `needsReview=false`」，
能把复核量砍掉一大半。改提示词要配一批真实帖子做前后对照，别只看着像。


## 10-16 日报（8 条）的处理记录

### 立即修好的（源地址，已在库与包两处改）

| 源 | 原来 | 改成 | 证据 |
|---|---|---|---|
| `src-6d951949ba` TNW | `feeds.feedburner.com/thenextweb`（**404**，连败 9 次） | `thenextweb.com/feed/` | 实测 200、10 条、最新今天 12:04 |
| `src-3a691df5b3` 开源中国 | `rsshub.rssforever.com`（**超时** 44 次） | `hub.slarker.me` | 实测 200、20 条、最新今天 12:11 |
| `src-c05f2328a0` 掘金 | 同上（超时 61 次） | `hub.slarker.me` | 同上 |
| `src-fac4f55973` 36氪 | 同上（超时 65 次） | `hub.slarker.me` | 同上 |
| `web-eugeneyan` | 列表页（JS 渲染，抓得到但 0 条目） | `r.jina.ai/...` + `parseMode: html` | 框架自带的 Jina 通路（docs/sources.md） |

RSSHub 实例实测：`rsshub.app` **403**、`rsshub.rss.tips` **502**、`pseudoyu`/`shab.fun`/`henry.wang` 连不上、
`liumingye.cn` 超时；**能用的**是 `hub.slarker.me` 与 `rsshub.ktachibana.party`（200、20 条）。
（本站另有 1 个源本来就用 ktachibana，这样两处分开、不会一起挂。）

### 查清不是问题的

- **第 3 条「71 个编辑源 7 天 0 新发现」**：抽 8 个亲手抓，**feed 全是好的**，只是最新一篇本身就旧：
  BAIR 07-29、Ahead of AI 09-29、Answer.AI 08-19、Dwarkesh 10-01、Ethan Mollick 10-01、Lilian Weng 07-04、
  Thinking Machines 07-31、Chips and Cheese 10-05 —— 属于日报自己说的「低频更新」，不是采集失效。
- **第 1 条 deepseek 日额度 20,000/20,000**：是本站在 10-15 深夜清积压时（含我们重排的 1,895 条归组）撞到
  自己的日上限（`budgets` 表：100/分钟、2,000/小时、20,000/天）。**已自行恢复**：近 24 小时 8,115 次、
  近 26 小时**没有一次**被预算挡下的记录；Go 端周额度 25%、月额度 67%，模块外推「周还能撑 4.8 天、重置还有 60 小时」。
  设计如此：撞上就等窗口滚动，文章留在待处理、不计失败。
- **第 8 条 events.group 排队**：确实在排但**一直在消化**——最近几小时每小时完成 400–460 个，
  队列 1,381 个 ≈ 3.5 小时清完；「排队超过 2 小时」是延迟告警，不是卡死。
- **第 2 条 `rss-ithome`**：12.6% 失败都是连接层（`fetch failed`/超时），成功仍占 87%，属目标站不稳；
  **`rss-youtube`**：配置是对的（`@anthropic-ai` 解出的 channel_id 与库里一致 `UCrDwWp7EBBv4NwvScIpBDOA`），
  是这个频道的 RSS **只到 2023-06-15**，抓不到新东西——建议停用或换成别的采集方式。
- **第 6 条 `src-f6d2ad6f1b`（t3n）HTTP 406**：找到原因——采集 RSS 时发的
  `accept: application/rss+xml, application/atom+xml, application/xml`（`rss.ts:148`）被它的 WAF 拒；
  我用 `accept: */*` 抓同一条 feed 是 **200、20 条、今天 13:55 更新**。值得提上游（406 时退一步用 `*/*`），
  本地先不动（氛围源，成功的那 71% 仍在收）。
- **第 4 条 7 个源的文章质量**（缺发布时间/反复修订）：都是个位数（最多 3 篇），影响有限，列入下次体检。

### 查出的大问题：X 分片抓取有系统性缺陷（第 7 条 + 第 2 条的 X 部分）

**证据链**：

1. 那批「7 天 0 新发现」的 X 账号**名下真的没有内容了**：`x-account-claudeai` 最后一篇 **10-09 03:53**，
   `alexalbert__`/`berkeley_ai`/`geoffreyhinton` 都是 **10-08**；对照组 `lxfater` 146 篇（今天 19:15）、
   `yetone` 12 篇（今天 17:13）正常。
2. 近 24 小时 X 抓取 **11,700 次里 10,883 次 found=0**（93%）。
3. 直接问 SocialData `from:claudeai`（绕过分片）**返回 20 条** —— 内容存在，是分片没取到。
4. 同分片成员的 `cursor.lastTweetId` **水位线完全相同**（5 个账号都是 11:54Z）—— 说明
   `collect.ts:327` 把**整片的最新推文**写进了每个成员的游标（`read.lastId`），而不是各成员自己的最新推文。
5. 搜索边界来自 `coveredTo()`（`collect.ts:274`）：`max(自己的水位, 上次检查时间 − 10 分钟)`，
   分片取**最小值**当 `since_id`。两个效应叠加：安静账号的水位被"抬"到分片最新（它自己没读到的旧帖再也读不到），
   而"上次检查 − 10 分钟"又让每次的窗口只有几十分钟；再加上水位被抬高后**没有 backlog**（详情里 `backlog: 0`），
   中间漏掉的推文没有任何补读路径。

**下一步（明天第一件事）**：在临时库上复现——对一个分片跑一次 `collectXShard`，
对照"逐账号直接搜"的结果，确认漏读比例；修法方向是**各成员只推进到自己的最新推文**，
并让 `coveredTo` 反映"这个账号真正被读到哪儿"（而不是分片整体）。这是框架代码，修好提上游。


## 「新内容卡住了」持续 19 小时 50 分钟（2026-10-16 晚）—— 与日报第 8 条同源

**现象**：`🔴 仍未恢复：新内容卡住了，进不了网站（已持续 19 小时 50 分钟）`，影响写「770 篇新文章等了 2 小时以上」。

**查明**：

1. 待处理的 1,351 篇**全部是氛围源（`hot_signal`）**，其中 **1,348 篇在半小时内刚排过队、0 篇从未排队** —— 没有丢失，
   是在**排队等归组**。
2. 机制（读代码确认）：氛围源的文章不走分析队列 —— `jobs/content.ts:80` 的 `queueProcessing` 对 signal 文章直接
   `enqueue(QUEUES.group, { signalOnly: true })`；由归组任务里的 `settleNonEditorial()`（`jobs/content.ts:92`）
   把它们落成 `processing_state='skipped'` 并决定要不要归组。所以**「新内容卡住了」= 归组队列排队长**，
   与日报第 8 条（`events.group` 排队 1,606）是同一件事。
3. 归组队列**按设计串行**：`jobs/events.ts:11` 写得很明确 ——
   「Serial on purpose: two reports of the same new fact must not both create it.」`localConcurrency: 1`。
   实测消化速度 **约 450/小时**（10 分钟完成 83 个；两分钟采样 1,376 → 1,361）。
4. 因此：**入料持续、消化 450/小时**时，队列会长期停在千级 —— 告警会**长期红着**（不是"服务坏了"，
   而是吞吐与入料不匹配）。1,895 条我个人昨晚重排的归组也进了同一队列（诚实记一笔）。

**三条可选处置**（都需要站主或上游决定，今晚不动代码）：

| 方案 | 内容 | 代价 |
|---|---|---|
| A 提高归组吞吐 | 串行是有意为之（防同一事实被两条路径同时建），要做并发必须先让归组对"同一事实"加锁；属框架级改动，先开 Issue 讨论 | 大 |
| B 减少氛围源入料 | 氛围源（X 账号 360+、CN 媒体）间隔调长或减源；它们的产出只作热度证据 | 影响热点覆盖面 |
| C 改告警口径（推荐先做） | 这类告警的门槛（≥10 篇等 2 小时）是按小站标定的；本站每天 6k 篇，且队列**在持续消化**却仍报红。改成"队列在涨才报"或把门槛按入料速度缩放 —— 与昨晚修的"已持续时长"属同一类问题（告警文案/阈值是功能，要跟着站点规模走） | 小，且可提上游 |

**当前状态**：队列两分钟净消化 15 个（约 450/小时），待处理 1,352 篇全是氛围源、全部已排队，模型调用 0 失败。


### 追问：氛围源不进评分，为什么还要排队？（2026-10-16）

「不进评分」是对的 —— 氛围源的文章**不会跑 `score_article`**，永远成不了精选。但"不进评分"不等于"不用处理"，每篇文章还要过两道：

1. **落库发布**：`publishArticle()` 让它在「全部动态」里出现。实测：排队中的 1,301 篇氛围源文章里
   **只有 15 篇已公开、1,286 篇还没公开**；而近 6 小时里已 settled（`skipped`）的氛围源文章 **510/510 全部已公开**
   —— 证明**公开发生在归组任务里**，不是收集时。
2. **热度归属**：`groupSignal()`（`events/group.ts:298`）把这条讨论挂到对应的故事/事件上，
   注释写明「Discussion evidence only (hot_signal sources): attach to a story, never create one」——
   只作证据、绝不新建事件。

这两步都在**归组任务**里，而归组队列有意串行（防同一事实被两条路径同时建），所以它们排队。
代价有多大：近 6 小时归组任务完成 **2,330** 个，其中真正调模型的只有 **142（group_signal）+ 98（编辑归组）**
—— **约 94% 的归组任务一次模型调用都没有**，纯粹是"落库 + 挂热度 + 排队"。

**因此第 4 条处置（比我上一版的三条更对症，推荐优先）**：

| 方案 | 内容 | 效果 |
|---|---|---|
| **D 把"落库发布"从队列里拿出来** | 收集时就 `settleNonEditorial`（落库 + 发布，不需要模型、也不需要串行），只把**真正要挂热度**的（有候选故事可挂的）留给归组队列 | 文章立刻可见（1,286 篇不再"进不了网站"），队列缩小到真正需要串行的那部分 |
| C 改告警口径 | 门槛按站点规模缩放（队列在消化却长期报红） | 小，可提上游 |
| A 归组并发安全化 | 要给"同一事实"加锁 | 大，先开 Issue |
| B 减少氛围源入料 | 调长间隔/减源 | 影响热点覆盖面 |

D 与 A 都应先提上游 Issue（改的是框架的收集/归组分工），本地不擅自动。


## 「为什么今天才发生」—— 队列饥饿的完整因果链（2026-10-16 深夜）

站主追问「为什么今天才发生，要调查清楚」。查清了，链条如下，**起因是我昨晚的一次合法清理，
暴露了框架修复路径上的一个优先级 bug**。

**① 触发（我的动作）**：10-15 约 22:35，我把 1,895 条因额度事故停在 `grouping_status='failed'` 的文章
用框架自己的 `groupingReset()` 复位为 `pending`。归组队列**按设计串行**（`jobs/events.ts:11`，`localConcurrency: 1`），
等待时间立刻从**秒级**恶化：

| 完成小时（北京） | 平均等待 | 最久等待 | 完成数 |
|---|---|---|---|
| 10-15 21:00（动作前） | **9 秒** | 68 秒 | 215 |
| 10-15 22:00 | 56 秒 | 9 分钟 | 437 |
| 10-15 23:00 | 22 分钟 | 36 分钟 | 394 |
| 10-16 01:00 | 63 分钟 | 1.2 小时 | 456 |
| 10-16 05:00–07:00 | 1.4–1.9 小时 | 2.1 小时 | 80–99 |
| 10-16 09:00–21:00 | **6–10 小时** | 11 小时 | 100–460 |

**② 机制（框架的 bug，已提 Issue #213）**：`PRIORITY = { live: 0, liveSignal: -1, history: -2 }`（`content.ts:61`），
实测**数字大的先跑**。而修复式补排队 `sweepUngrouped()`（`jobs/events.ts:24-41`）**没带 priority**
（`enqueue(QUEUES.group, { articleId }, { singletonKey }, tx)`）→ 默认 live(0) → 1,895 条修复任务全部插在
**氛围源直播信号(-1)前面**。铁证：**10-15 23:00 到 10-16 08:00 完成的归组任务里，氛围 signal 数量为 0**，
而队列里躺着 1,170 个 signal。

**③ 放大器（额度）**：这批修复每条要调模型（编辑归组），当晚把 deepseek 日预算（20,000）撞满 →
调用被拒 → 归组任务抛 `BudgetExceededError` → **文章**按 #196/#198 的修法正确留在 `pending`，
但 **pg-boss 任务本身 failed 并重试**，`sweepUngrouped()` 又用 live 优先级把它们塞回去 →
队列里同时跑"真实工作"和"暂时不可能成功的重试"（现存 `events.group` 失败任务 **3,827** 个）。

**④ 症状**：氛围源文章**在归组任务跑完前不会发布**（`settleNonEditorial()` 里才 `publishArticle()`）→
高峰时 1,301 篇待处理里 **1,286 篇在站上根本不存在**；「新内容卡住了」告警因此长期红。

**⑤ 为什么以前没有**：站点上线两周多，**从未做过批量复位**（`sweepUngrouped` 单次上限 100 条 × 每 5 分钟，
平时完全够用），也从未撞满过日预算 —— 两个条件这次同时出现，才把这个优先级 bug 顶出来。

**现状（22:20 复核，修正早先的"当晚清空"判断）**：队列约 1,200 个待办，近 90 分钟**入队 493（其中 signal 476）
、完成约 540/小时** → 净消化约 200/小时，平均等待约 3.8 小时；**编辑源只剩 2 篇待处理**，压着的全是氛围源（1,212 篇）。
按此速度要数小时才清空，`content.process` 告警在清空前会一直红。

**上游**：Issue **#213**（含复现 SQL 与四条建议：① 补排队给正确的优先级 —— 本次直接原因、② 额度耗尽应延迟重排而非失败重试、
③ 讨论：氛围源"落库发布"是否可以从串行归组里拿出来、④ 告警门槛按站点规模缩放）。
本地暂不改代码，等上游对 ①（是否有意为之）的答复。


## 第 5 项（X 分片漏读）复查结论：**我之前的判断过重，予以纠正**（2026-10-16 深夜）

**先说结论**：那 22 个"7 天 0 新发现"的 X 账号，**大部分是真的没发推**，不是采集失效。
我之前说"20+ 账号静默失效、24 小时 93% 抓空"是把两件事混在一起了，**这里更正**。

### 实测（用框架自己的 `planXShards`/`shardQuery` + SocialData 直查，完全不碰生产数据）

| 账号 | 自身水位 lastTweetId | 它**真实的最新推文** | 判定 |
|---|---|---|---|
| geoffreyhinton | 10-16 12:52 | **10-02 20:42** | 真的没发 |
| alexalbert__ | 10-16 12:32 | **10-07 19:15** | 真的没发 |
| berkeley_ai | 10-16 12:32 | **10-06 01:29** | 真的没发 |
| claudeai | 10-16 12:45 | **10-09 03:49** | 真的没发 |
| lxfater（对照，正常） | 10-16 13:06 | 10-16 12:22 | ✓ 只差 44 分钟 |

分片查询本身也是好的：
- 坏分片（含 geoffreyhinton，24 账号）**不带 `since_id`** → **20 条**（来自 9 个句柄）✓；
- 同样的查询**带上生产用的 `since_id`** → 0 条 —— 因为那个窗口（约 10–20 分钟）里确实没有账号发帖 ✓；
- 对照 `from:geoffreyhinton` → 20 条（但**最新的一条是 10-02** ✓，证明账号本身安静）；
- 二分两半各 20 条 → 没有"坏句柄毒化整个 OR 查询"这回事 ✓。

所以：`found=0` 的 93% 主要由"分片里大多是不常发帖的账号 + 查询排除了回复（`-filter:replies`）"解释 ✓，
**不是漏读**。

### 但确实发现一个真 bug（后果比我原先说的小）

`collect.ts:327` 把**整片最新的推文 id** 写进了**每个成员**的 `cursor.lastTweetId`：

```ts
lastTweetId: read.lastId && BigInt(read.lastId) > BigInt(own) ? read.lastId : own
```

而这个字段的语义是"这个账号的帖子读到哪儿了"（`coveredTo()` 的注释就这么写的）。后果：

1. **实际覆盖不受影响**：分片的搜索窗口由 `coveredTo = max(自己的水位, 上次检查 − 10 分钟)` 取**最小值**决定，
   而"上次检查 − 10 分钟"总是更近，所以窗口仍然是连续的 ✓ —— 这也解释了为什么这些账号的历史内容没丢。
2. **会咬人的场景**：当分片组成变化（加/减账号会移动后面的分片）使某个账号改为**单独抓取**时，
   它的搜索是用 `since_id = 自己的水位`（已被推高 ✗）→ 于是**它水位之下的那些推文永远不会再被读**。
   对本来就安静的账号无害，但对"在分片里被推高期间发过帖"的账号，会漏掉水位之下、又落在 10 分钟余量之外的那几条。

   **10-17 维护者核对后的更正（#214 回复）**：被推高的水位大约就是那次检查的时间，账号在那之前的帖子
   在分片里**其实都已经读过**，所以不是"永久丢失"；真正会漏的是给晚进搜索的帖子留的 **10 分钟余量**
   （单独抓取时一样），已由 #220 一并修好；比较也改成了 BigInt（我们建议的字符串比较在位数不同时会出错）。
3. 影响面：一次分片重排就可能影响十几个账号，属"低频但真实"的缺陷；修法是**每个成员只推进到自己的最新推文**
   （从本片结果里按句柄取 ✅），而不是整片的最新。

### 下一步

- 已提 **Issue #214**（改 2 行 + 测试建议）：成员水位只按自己的最新推文推进。这与 #213（归组队列）是两回事。
- 日报里"22 个氛围源 7 天 0 新发现"的处置结论：**核对后属"账号本身安静"**，不需要动信源配置；
  唯一要做的是上面那个水位修法，避免分片重排时丢帖。


## 额度瘦身（第 10 项）：查到最大的一处浪费，但结论是"不能简单关掉"（2026-10-16 深夜）

**入手点**：近 6 小时的按步用量里 `score_article` 占 31%、`group_article` 占 23%。解剖评分这一步：

| 项 | 数值 |
|---|---|
| 每次评分输出 | 平均 1,968 token，其中**推理 1,959**（最高 7,350） |
| 真正的答案 | `{"attentionScore": 47}`（约 25 字符） |
| 每篇调用次数 | `SCORE_CALLS = 2` |
| 6 小时开销 | 166 次 / 303,336 推理 token ≈ 每天 120 万 |
| 根因 | `SCORE_MODEL=deepseek-v4.1-flash-scorer`（`reasoning_effort: "high"` + 4000 推理额度） |

**噪声底（免费测得，用已存回执）**：同一篇文章的两次独立评分，平均差 **5.8 分**（中位 5、最大 37），
**7.5% 的文章两次结论相反**（547 篇样本）。这是判断"改动是否伤质量"的标尺。

**同文章 A/B（关推理）→ 不通过**：把 `SCORE_MODEL` 换成同底层模型的 `deepseek-flash`
（`reasoning_effort: "none"`），再走框架自己的重评路径重评同一批文章：

| 文章 | 有推理 | 无推理 | 差 |
|---|---|---|---|
| A | **54** | **20** | −34 |
| B | 36 | 12.5 | −23.5 |
| C | **57** | **43** | −14 |
| D–F | 21 / 21.5 / 32.5 | 12 / 12 / 27.5 | −9 / −9.5 / −5 |
| G–I | 78 / 60.5 / 63.5 | 85 / 65.5 / 64 | +7 / +5 / +0.5 |

平均 **−8**、尾部 **−34**（远超 5.8 的噪声），并让两篇跨门槛落选 → **推理不是白花的，改动会实打实改变入选内容**。
**已回滚**（`SCORE_MODEL` 恢复原值、两个容器重建、并用原配置把那 10 篇重评回去，恢复后平均推理 1,858、
平均分 46.3，与原配置 42.3 同带）。三档对照：无推理 38.2 / 原配置 42.3 / 恢复后 46.3。

**正确的优化（已提上游 Issue #215）**：分数只有在**门槛附近**才决定入选（实测约 11% 的文章落在门槛 ±5 分内）
→ 改成两段：先便宜地评一次，**只有落在门槛 ±10 分内才用高推理重评**；预期省掉约 80% 的评分开销
（本站约每天 100 万 token），而结论几乎不变。这是框架级改动（评分逻辑在 `analyze.ts`），交给上游判断。

**顺手记下的相邻项**（同一次统计）：`structure_article`（602 次 × 平均输入 2,935）与 `story_digest`
（2,069 次 × 平均输入 993）也是百万 token/天级，但都已跑在最便宜的预设上，能省的只有"少调用/更短输入"。


## Jev（TypeSafe）能不能用来评分：实测结论（2026-10-16 深夜）

站主给了 TypeSafe 官方 key（放在 `E:\cs\hot\feishu.txt` 的 `jev_key`），并建议"用 Jev 代替一次评分，它便宜"。

### 接入事实（全部实测）

| 项 | 结果 |
|---|---|
| 端点 | `POST https://api.typesafe.ai/v1/systemone` ✓（`Authorization: Bearer <key>`）|
| 模型 id | `jev-1.13.0` / `jev-1.14.0`（别名 `jev-latest`→1.13.0、`jev-preview`→1.14.0）；**`jev-1.13` 不带 `.0` 会 400 Unknown model** |
| 价格 | **$0.042/M 输入、输出免费**；我们每篇约 936 输入 token ≈ **$0.00004/篇** |
| OpenCode 路线 | OpenCode 的 `/inference/v1/systemone` 也认 `jev-1.13-free`（免费但限时），**TypeSafe 的 key 在 OpenCode 上无效**（401），反之亦然 |
| 输出 | `score`（概率加权档位）+ `legend` + `probabilities` + **`confidence`**；另有 `noul`（0-1 概率） |
| 语言 | 文档明说英文最好、CJK「可用但要自测」——本次中文样本表现正常，但样本小 |
| 数据 | 不拿客户请求训练；密钥只走服务端 |

### 对照实验：同一批文章，Jev 评一遍 vs 现有高推理评分

24 篇随机编辑源文章（近 3 天、已有分数），Jev 用**精简版五档 rubric**（0-20/20-40/40-60/60-80/80-100）：

| 指标 | 数值 |
|---|---|
| 平均差（Jev − 现有） | **−2.9** |
| 平均绝对差 | 12.1（最大 29）|
| **结论不一致率** | **1/24 = 4.2%** ✓ |
| 对照：现有配置**自己对同一篇评两次**的不一致率 | **7.5%** |
| 平均 confidence | 0.60（0.07–0.97）|
| 平均输入 token | **936** → ≈ $0.00004/篇 |

**定性观察**：明显的噪声（标题只有 "Here"、气候/季风这类无关科学新闻）Jev 给 1–3 分、confidence 0.93–0.97
（说明它的置信度是校准过的 ✓）；中文条目（马斯克、特斯拉、微软等）分数合理 ✓；唯一的结论翻转是一篇 52→77
（门槛 76）的边缘案例。

**结论：可行，而且"结论层面"的一致性不低于现有配置自身**。但两条必须注意：
1. **量纲不同**（0–4 档 vs 我们 0–100），所以门槛必须重新校准（文档也明确要求"阈值要在你自己的数据上评估"）；
2. **只按 confidence 做闸门会退回太多**（中位 0.58，conf<0.8 占 20/24）→ 闸门要**同时**看"分数离门槛多远"，
   即"Jev 有把握 **或** 分数离门槛远 → 直接定稿；否则回落高推理评分"。

### 建议的三步

1. **扩大样本**（100–200 篇，含中文为主的子集），成本约 $0.01，把 4.2% 这个数坐实；
2. **设计问题集**：按文档建议把"五维加权"拆成 **五个原子问题**（每维一个 `score`）+ 一个噪声/安全的 `noul`，
   在代码里用**现有权重**组合 —— 这正好是框架本来的设计（内容类型 + 五维加权 + 噪声压制）；
3. **协议适配要提上游**：Jev 不是 chat/completions（`state` + `questions` 的 System One 接口），
   框架的评分路径（`chatJson` + `ScoreSchema`）接不了，需要一个适配层 —— 可以作为 **#215**
   （"只在门槛附近才花推理"）的证据与实现路径补充。

**临时密钥副本已全部清理**（服务器 `/tmp`、本地 `E:\cs\hot\keys.json`），只保留站主自己的 `feishu.txt`。


### 补充实测：Jev 用于**第一道预筛**（比评分更合适）

站主问"能不能在第一道预筛用 Jev 判断 AI 相关性、它是否具备多维度判断"。两问都已实测。

**多维度判断：具备**。一次请求可混放多种原语，**并行、相互隔离**评估（官方明说不产生 context rot），
每问自带 `instructions`/`criteria`，各自返回 `score`/`probabilities`/`confidence`/`choice`/`noul`；
**但组合必须写在代码里**（模型不做加权）—— 这正合我们"五维加权 + 门槛在 `industry/selection.ts`"的设计。
原语参数形状（踩过的坑）：`score` 的 `criteria` 是**有序列表**（档位），`choice`/`noul` 的 `criteria` 是
**对象**（选项→说明）；写成列表会 422。

**预筛实测（30 篇编辑源文章，与现有预筛标签对比）**：

| 指标 | 数值 |
|---|---|
| 三分类完全一致 | **28/30 = 93.3%** |
| BLOCK 判定 | **8/8 全对**（conf 0.69–1.00）|
| 操作判定一致（PASS vs 非 PASS）| 28/30 = 93.3% |
| 分歧 | 1 处 `PASS→BLOCK` conf **0.45**（低置信，闸门可拦）；1 处 `UNKNOWN→PASS` conf 0.91（真漏判）|
| 成本 | 平均 1,395 输入 token ≈ **$0.0000586/篇** |

中文表现好：荣耀平板、春风动力电摩、雷蛇联名外设、灵动岛 Sports 全部 BLOCK 且 conf 1.00；
腾讯 WorkBuddy/CodeBuddy、印孚瑟斯谈 AI 增长 → PASS。**说明 Jev 的置信度是校准过的**：
明显案例给 0.94–1.00，唯一的分歧案例给 0.45 —— 可以直接用来决定"要不要交回高推理模型"。

**预筛是最低风险的接入点**：它是第一道门、出错代价最小、输出本来就是三分类（`choice` 天然对应），
而且 `UNKNOWN`（材料不足、等补材料）可以用**低 confidence** 还原。用 `reason` 是散文这点
（Jev 不生成文本）可以用第二个 `choice` 问"依据类型"补上，本次实测可行。

**经济性汇总**：预筛约 1.6M token/天 + 评分约 2.4M token/天 ≈ **4M token/天（约日额度 20%）**
可以搬到 Jev，代价约 **$0.0001/篇**（1,000 篇/天 ≈ $0.06/天）。


## Jev 深度调研与接入方案（2026-10-16 深夜）

**产出**：`JEV-PLAN.md`（决策文档）+ `.cache/hot/typesafe-jev-research.md`（官方文档研究原文，25KB，
由子代理按 `.md` 后缀抓取 docs.typesafe.ai 全站后整理，含原语契约、confidence 公式、patterns、局限与文档自相矛盾处）。

### 最重要的发现：额度花在"判断"上，不是"写作"上（近 24 小时实测）

| 步骤 | 调用 | 合计 token | 占比 |
|---|---|---|---|
| **group_article** | 2,165 | 9,969,328 | **40.5%** |
| **score_article** | 1,129 | 5,952,146（其中推理 2,438,656）| **24.2%** |
| structure_article | 604 | 1,851,980 | 7.5% |
| prefilter_article | 942 | 1,380,905 | 5.6% |
| **判断层合计** | | **19,578,480** | **79.5%** |
| （生成层）story_digest / understand / 翻译 / 嵌入 | | 约 3.9M | 约 17% |

即：**归组一步就占四成**，而它恰好是 Jev 契合度最高的一步 —— 平均 **7.4 个候选**（最多 10）→ 一次请求扇出
7–8 个四选一问题 + 一个 `noul`（是否有读者未见的增量），而这套的**置信度闸门框架里早就有了**：

```ts
RELATIONS = ["SAME_OCCURRENCE","SAME_STORY","UNRELATED","ROUNDUP"]  // → choice
confidence: z.number().min(0).max(1)         // → Jev choice 原生返回同义字段
TIE_MIN_CONFIDENCE = 0.8                     // → 现成闸门（已标定 0.75 时精确率 0.944/召回 0.962）
firmlyTied(relation, confidence)             // → 低置信不算同一事件，交给 groupReview 复核
```

### 方案要点（`JEV-PLAN.md`）

1. **按职责切两半**：判断层（归组/评分/预筛/结构抽取的分类部分，79.5%）交给 Jev；生成层（理解/摘要/综述/
   周报/翻译/事实抽取，约 17%）保持对话模型 —— Jev **不生成文本**，硬性做不了。
2. **组合与权重留在代码**（官方也这么要求）：`industry/selection.ts` 与 `TIE_MIN_CONFIDENCE` 不动。
3. **分阶段**：P0 影子模块（现在就能做，不动框架）→ P1 上游加 System One 协议路径 → P2 切换归组 →
   P3 评分改成"Jev 第一遍 + 置信度/门槛闸门 → 高推理复评"（与 Issue #215 合并）→ P4 预筛与结构分类。
4. **代价**：判断层全部搬到 Jev ≈ **$0.5/天**（2,900 次判断）；已实测预筛 $0.0000586/篇、评分 $0.00004/篇。

### 新增的关键风险（文档研究得到，之前没考虑）

- **提示注入** ✗✗：官方明说 `state` **不当作敌意内容**，注入能改变答案；而我们的原文正是不可信材料
  → 不可信文本单独放字段 + 声明为数据 + **高风险的归组合并保留对话模型复核** + 影子期造注入样本测。
- **选项顺序偏好** ✗：`jev-1.13` 偏向靠前的选项 → 位置轮换跑两次验证是否系统性偏移。
- **版本漂移** ✗：`jev-latest` → 1.13.0、`jev-preview` → 1.14.0（文档自相矛盾地说 1.14 最新）→ **固定写 `jev-1.13.0`**。
- **`noul` 没有 confidence** → 用 `|2p−1|` 或按 0.5 判；`criteria` 形状每个原语都不同（choice=对象、
  score=有序数组、noul=true/false 对象），写错就 422（我已实测踩过）。
- **context rot**：无关内容拉低准确率 → 归组时不要塞整篇正文，用对象分字段、反引号路径引用。


## 今晚（10-16 深夜）收尾状态

**生产**：站点 `/` 与 `/api/health` 均 200；容器全部 Up（worker/api 因改 `.env` 各重建一次，web 25 小时、
caddy 5 天、db 健康）；**评分模型已回滚**为 `deepseek-v4.1-flash-scorer`（A/B 实验后恢复）。

**积压**：**待处理文章 0 篇**（编辑源 0 / 氛围源 0）—— 归组队列已完全清空；**未恢复告警：无**
（持续一整天的 `content.process` 告警随队列清空自动恢复）。

**安全**：Jev 的临时密钥副本已全部删除（本地 `E:\cs\hot\keys.json`、`.keys-masked.json`、
服务器 `/tmp/keys.json`）；仓库与缓存中无密钥残留（已 grep 验证）；只保留站主自己的 `feishu.txt`。

### 明天的待办（按优先级）

1. **站主决定四件事**（`JEV-PLAN.md` 第七节）：是否接受 TypeSafe 依赖；走官方 key 还是 OpenCode 免费版；
   是否先做 **P0 影子模块**（不动生产、只积累对照数据，顺便把"归组交给 Jev 准不准"测实）；
   归组的复核对冲怎么处理。
2. **上游四个 Issue 待回音**：#202（静默判据，已回评等复审）、#204（告警时长，CI 绿等 review）、
   #205（额度熔断，CI 绿等 review）、**#213**（归组优先级 + 氛围源发布，等答复）、
   **#214**（X 分片水位被整片推高）、**#215**（评分 99% 输出是推理，建议只在门槛附近花推理）。
3. **积累任务**（`HANDOFF.md` 的清单）：7 t3n 的 406、11 R2 生命周期盘点、14 清 pg-boss 失败任务行、
   8 余下 63 个静默源逐源对照、12 精选门槛校准（需要站主 20 分钟标注，现在多了一个更好的工具 —— Jev）。


## 10-17 日报处理（逐条核对，其中两条是**误报**）

### 第 1 条：2 个编辑源反复抓取失败 —— 无内容损失
- `rss-youtube`：频道 RSS 停在 **2023-06-15**，最后一次入库 09-24（更早的内容），抓取报 HTTP 500（YouTube 侧）→ **建议停用**（等站主确认）。
- `rss-ithome`：间歇 `fetch failed`（近 12 小时 8/31），但原站最新条目**已在库**（我们最新 19:23），
  `found=60`，**没有漏收**。

### 第 2 条：69 个编辑源"7 天 0 新发现" —— 抽样 17 个 RSS 逐个对照原站，**全是误报**
方法：直接抓每个源自己的 feed，取最新条目的日期，与库里最新一篇比。
- **15 个是真低频**：原站最新 = 我们最新（BAIR 07-29、Answer.AI 08-19、Lilian Weng 07-04、
  Chips and Cheese 10-06、Ethan Mollick 10-01、Ahead of AI 09-29、Thinking Machines 07-31…）✓
- **2 个看着"漏收"，其实都在库里**：Sierra（feed 最新 10-10 `poppy`，库里 10-10 ✓）、
  Google Cloud Databases（feed 最新 10-15，库里已收 ✓）。原因是**统计口径**：日报按"近 7 天入库篇数"计数，
  而这两源的最后一篇正好落在窗口边界外一天 ✓
- 结论：**没有一个真的漏收** ✓；这个日报指标本身会误导（建议换成"原站最新 vs 我们最新"的对照）

### 第 3 条：7 个源缺发布时间 —— **真问题**（未修）
- RSS 源：Databricks 的 feed 里**明明有** `Thu, 15 Oct 2026 00:06:48 GMT`，我们入库的 `published_at` 却是空 ✗
- 网页源：Liquid AI / Suno / Stanford HAI 是 `web_list`，日期要从页面抽 ✗
- 影响如日报所说：缺时间会被当历史文章处理。**待办**：查框架的日期提取（RSS 走 `pubDate`、网页走页面解析），
  属共享代码 → 需要时提上游

### 第 4 条：4 个热度源反复失败 —— 只有 36氪 的修复见效，其余**无内容损失**
| 源 | 近 12h 失败 | 原站最新在库吗 | 结论 |
|---|---|---|---|
| 36氪 | 1/44（**2.3%**，修前 13.5%）| ✓ | **昨天的代理修复见效** ✓ |
| 掘金 | 8/35（timeout）| ✓（10-17 18:55）| 无损失 ✓ |
| 开源中国 | 4/19（timeout）| ✓（10-17 12:27）| 无损失 ✓ |
| t3n | 8/30（HTTP 406）| ✓（10-17 19:15，近 7 天 187 篇）| **间歇性 406，无损失** ✓ |

**修正昨天的判断**：t3n 的 406 **不是请求头引起的** ✗ —— 今天用通配头、浏览器 UA 测都是 406，
所以是基于 **IP/地域** 的拦截。昨天"上游 Accept 头太严"的结论作废，**不提那个 Issue** ✓。

### 第 5 条：21 个 X 账号"7 天 0 新发现" —— 16 真安静、2 边界、3 待查，其中 **1 个已修复**
- **16 个确实安静** ✓（最新推文 8–241 天前）
- **2 个是边界**：`@FireworksAI_HQ`、`@sayashk` 最后发帖是 10-10，**当天就收进库了**（分别 19 篇 / 1 篇）✓
- **3 个 SocialData 搜不到任何推文** ✗ → 其中 **`@lijigang_com` 是句柄写错了**：
  真句柄 **`@lijigang`**（李继刚，5.6 万粉，10-08/10-12/10-15 都在发）。
  **已修**（库 + `industry/sources.json` 同时改），改完第一次抓取 `found=20 new=20`，
  **20 篇立刻入库** ✓ —— 这个源一直是死的，之前显示"健康"只是因为分片整体成功、它不出料。
  另两个（`@lmarena_ai`、`@windsurf_ai`）试了多种变体都搜不到 → 需要人工确认句柄

### 附带发现：**月度额度快到悬崖** ✗
`go.quota` 告警数值（就是我 10-15 做的模块，按 70% 线报的）：周 **32%**（10-19 08:00 重置）、
**月 71%（10-27 09:58 重置）**、滚动 2%。按当前消耗（约 20 天用掉 71% ≈ 3.5%/天），
**约 10-25 就会撞到 100%**，比重置早两天 ✗。
这正是 `JEV-PLAN.md` 的现实理由：判断层占日额度 **79.5%**，交给 Jev 就等于把这个悬崖推远。

### 今天要不要动手
1. **停用 `rss-youtube`**（等站主确认）
2. **修缺发布时间**（第 3 条，需要看框架的日期提取）
3. **查 `@lmarena_ai` / `@windsurf_ai` 的真实句柄**
4. 月度额度：按 `JEV-PLAN.md` 走（P0 影子模块 / P1 上游适配），或先手动降低评分开销


## 10-17 晚：合并上游 14 个提交、部署 merge-87639da、修好「日期补不回来」

### 上游状态先纠正了两处过期结论
- **#202（静默判据）与 #204（积压告警时长）不是「等复审」，10-16 凌晨就已合并**（02:10 / 02:02 北京时间）。
- **#213 与 #214 也不是「等答复」**：维护者 10-17 已实现 —— `4f9ff20`（补排队按历史内容 -2 / 讨论帖 -1 /
  其余 0 的优先级；额度耗尽时归组任务延后到额度窗口再跑，不再失败重试）、`e091a02`（X 分片里每个账号的
  水位只推进到自己读到的最新推文）。#205 仍开着，但同一改法早在我们的树里。

### 合并
`upgrade-4.0` 落后 `origin/main` 14 个提交，另有本地 19 个（源修复、go-quota、交接文档）。合并 4f9c544，
4 处冲突都是「本地功能 vs 上游新功能」：
- `content/extract.ts`：本地的登录页跳转识别（`isSignInRedirect`）与上游 #208 新增的 `Doc`/`El` 类型并存；
- `lib/url.ts`：上游 #219 的 `privateServiceAddress`/`refusedAddress` 保留，本地「结尾的点」注释挂回 `blockedHostname`；
- `tests/grouping-reliability.test.ts`：额度测试保留**上游更强的那一版**（跑真实 worker、覆盖讨论帖与优先级），
  删掉本地较弱的直调版（两者守的是同一行为，上游版合并前会删重复测试）；
- `tests/url.standalone.test.ts`：本地结尾点测试与上游 `PRIVATE_FEED_HOSTS` 两个测试并存。

typecheck ✓；容器内全套 **724 通过 / 0 失败**。

### 日期修复（真问题，见上面对日报第 3 条的核对）
`fillPublicationTime` 调 `decideTimeline` 时，未来时间检查一直拿**首次发现时间**当基准：
订阅把定时发布的文章提前写进 feed（Databricks 五篇的 `published_at_claim` 都比首次发现晚 5–23 小时），
入库时按未来时间拒掉并记 `unknown-publication-time`，之后每次列表再报同一个日期仍被判「未来」→ 永远补不上。
改法：`decideTimeline` 新增可选 `futureCheckAt`，只让补日期这条路径传 `new Date()`；插入路径不变
（“未来的时间不信任”仍按发现时刻判）。回归测试加在 `tests/invalid-dates.test.ts`（原 future 用例仍绿）。

生产验证：清掉 `rss-databricks-blog` 的 ETag 让它 200 一次 → 仍在列表里的那篇（Sizing Lakebase）
补上 `2026-10-15 00:06:48`、`backfill=f`；另一篇（Private Network Gateway）已不在当前 10 条列表里，
feed 不再提供，补不了。7 天缺时间 55 → 54，其中 47 篇来自已停用的 Nikkei（历史残留）。

### 部署
- 构建 `merge-87639da`（sha256:5a8dc6d1d496），推 registry 的 `merge-87639da` 与 `latest`。
- 部署前这台 e2-medium 在 IO 风暴里：可用内存 **39MB**、负载 **13.5**、worker 2.1GB、pg-boss 刷
  “timeout exceeded when trying to connect”。所以脚本先 `stop worker` 释放内存（可用回到 2.4GB），
  再 pull + `up -d`；服务器上先给旧镜像打 `rollback-before-87639da`。
- setup 3 秒退出 0（“database is up to date”，无新迁移）；五页全 200；部署后可用内存 **1.9GB**、负载 **0.7**。
- 代码标记核对：`futureCheckAt` 3 处、`privateFeedHosts` 1 处、`lastTweetId` 5 处。

### 信源
`rss-youtube` 停用（频道 RSS 停在 2023-06-15、抓取 HTTP 500）：库与 `industry/sources.json` 两处，
启用 556 → **555 / 662**。

### 仍然没做
- `@lmarena_ai` / `@windsurf_ai` 的真实句柄（`@lijigang` 已在 10-17 白天修好）。
- 网页源的日期选择器：Stanford HAI（正文里一行 “October 14, 2026”，无 time/meta/JSON-LD）、
  Liquid（列表用 `dateTime` 属性）、Suno（卡片是 `<span>Aug 10, 2026</span>`）。
- 额度路线（Jev P0 / 手动降开销）—— 月额度仍 71%，10-27 重置，约 10-25 撞线。

## 10-17 20:47：Jev 影子模块（P0）上线（merge-00481ff）

**模块**：`modules/jev-shadow/`，迁移 `0087_jev_shadow.sql`（一条 CREATE TABLE）。每 10 分钟取最多 8 篇
编辑源新分析（`JEV_SHADOW_PER_RUN`），用**生产同一份材料与提示词**问 Jev 预筛（三选一）与评分（五档），
把生产判定与 Jev 答案并排写进 `jev_shadow`；不改判定、不发布、不推送。单篇失败只记该行，1 小时后重试。
开关 `JEV_SHADOW_ENABLED` 默认关。

**线路**：默认 OpenCode 的 `jev-1.13-free`（借 `LLM_API_KEY`，零成本，限时）。实测同一批 4 个样本与
TypeSafe 官方 `jev-1.13.0` 几乎一致（score 差 ≤0.05/4、confidence ≤0.04、choice/noul 全同）；
Go key 打付费 `jev-1.13` 是 402（Go 套餐不含 Jev、无 Console 余额），所以官方线路要另配 key。

**部署**：镜像 `sha256:2b838661aa41`（`merge-00481ff`），回滚点 `rollback-before-00481ff`；
服务器 `.env` 加 `JEV_SHADOW_ENABLED=true`（备份 `.env.bak-*`）；setup 应用 0087（67ms）；
worker 重建后 **18 秒写入 8 行、0 错误**。

**首批对照**：预筛与生产 **8/8 一致**（block/BLOCK 3、pass/PASS 5）；评分平均绝对差 **4.6 分**
（5 个有分数的样本，全部低于门槛、两边一致）；单篇两次请求约 0.8–2.0 秒。

**测试**：模块 5/5（请求形状、落库、换算、失败重试窗口、线路切换），全套 **730 通过 / 0 失败**。

## 10-17 21:15：模型榜修好（`lb_calibrations` 缺失）、清 pg-boss 4,616 条失败行、影子首份对照

### 模型榜轮次每 6 小时失败（10-04 后榜单一直停在旧数据）
根因：`cron.leaderboard.round` 从 10-04 起一直报 `42P01 relation "lb_calibrations" does not exist`。
这条链是：**上游 4.0.0 有意把模型榜移出框架**，`0053` 按设计 DROP 掉全部 `lb_*` 表（不是缺陷）；
我们把功能作为模块接回来（`e346e56`），自己写了 `0058`–`0065` 的重建迁移，`0064` 就是建这张表。
账本显示 10-05 00:09 应用 `0048`（建表）→ `0053`（删表）→ 00:10 应用 `0064`（重建），本该把表建回来。
但证据显示：10-04 19:26 升级前的备份里它本来就不存在（那时还没应用 `0048`）；**10-15、10-16 的保留备份里
仍然没有它**，而账本一直记着 `0064` 已应用 —— 也就是表在 **10-05 00:10 之后**的某次手工操作/恢复里丢了，
现有记录查不到具体是哪条命令（10-12 有过一次数据库恢复，是候选）。教训是"迁移账本与实库漂移"：
`IF NOT EXISTS` 的重建迁移一旦账本记过，就再也不会自愈。
修法：新增幂等的模块迁移 `modules/leaderboard/migrations/0088_leaderboard_calibrations.sql`
（与 0064 同 DDL）；生产上把文件 `docker cp` 进 worker 后跑了一次 `scripts/migrate.ts`
（`applied 0088_leaderboard_calibrations.sql (38ms)`，下一次部署会带上它）。
**注**：该迁移文件里的注释把丢表归因于「10-11 的手工清理脚本」，那是当时的猜测，以本节证据为准。

验证：手动跑一次轮次（`runLeaderboardRound({force:true})`）—— **status=published**、5 个榜全部
`optimal`、`lb_runs` 从 10-04 12:05 推进到 10-17 13:18（总体榜 78 个模型）。**坑**：手动跑时不要用
`node --input-type=module`，这个启动参数会被轮次内部的 `worker_threads` 继承，计算子线程随即报
`ERR_INPUT_TYPE_NOT_ALLOWED`（第一次手动跑就踩了这个，17 条 calibration 写进去后崩在计算阶段）；
写成 `.mjs` 文件再 `node /tmp/round.mjs` 即可。

### pg-boss 失败行清理
删除前普查：共 **4,616** 条，3,768 条来自 10-15 的额度/重试风暴，其余是 10-10～10-17 的
`events.digest`（333）、`sources.fetch`（294，多为 job timed out）等；最近 24 小时只有
13 条 `sources.fetch` 超时 + 4 条榜单轮次（本次修掉）。`DELETE FROM pgboss.job WHERE state='failed'`
后 `failed=0`（导出命令因列名写成 `retrycount` 失败，未留下备份；都是终态记录，摘要如上）。

### Jev 影子首份对照（32 条，0 错误）
- 预筛：29/32 一致（90.6%）；3 条不一致**全是「我们 PASS、Jev BLOCK」**（两条特斯拉 FSD 事故、
  一条其它），Jev 的置信度 0.92。
- 评分：17 条有分数，我们均值 44.5 / Jev 46.9，平均绝对差 **6.1**，偏差 +2.4，`r=0.808`；
  跨门槛分歧 0（样本都低于门槛）。
- 延迟：单篇两次请求平均 941ms、p95 1342ms；预算零成本。
