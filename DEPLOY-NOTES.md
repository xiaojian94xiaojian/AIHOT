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
| X 源 | **346**（editorial 183 个 @60 分钟、氛围 163 个 @120 分钟）→ 需求 **265 次/小时** |
| `socialdata` 预算 | 30 / 300 / **7000**（今天下午从 10/100/1000 调高）|
| 今天 socialdata 调用 | **610 次**（大部分时间还压在旧预算上）|
| 本轮新建源 | **176 个**（31 编辑 + 145 氛围），其中 **148 个已抓到内容**（84%）|
| 近 24 小时 | 信号 1301 条 / 参与方 209；精选 35 条（T1 13、T1_5 15、T2 7）|
| `rss-tomtunguz` | 近 24 小时 1 条、入选 **0**（降级前：30 天 68 条入选）|
| 站点 | `/`、`/hot`、`/all`、`/daily` 全 200；worker 0 报错 |

## 1. 成本与配额（最要紧，跑一天再看）

```sql
-- 每天实际花了多少次 X 抓取
select created_at::date as day, count(*) from receipts where service='socialdata' group by 1 order by 1 desc limit 3;
```

- **期望**：约 **4 000–6 400 次/天**（需求 265/小时跑满）。接近 7 000 说明日上限成了瓶颈；
  远低于 2 000 则说明有别的瓶颈（看下一条）。
- **看还有没有被挡的源**：
  ```sql
  select left(last_error,46) as err, count(*) from sources where last_error is not null group by 1 order by 2 desc limit 5;
  ```
- **撑不住就回落**（日调用降到约 2 200 次）：
  ```sql
  UPDATE sources SET interval_minutes=120 WHERE kind='x_search' AND enabled AND participation_mode='editorial';
  UPDATE budgets SET per_minute=10, per_hour=150, per_day=3000 WHERE service='socialdata';
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

- **期望**：主力源的最新条目停在 1–2 小时内。若普遍超过 4 小时，说明配额仍不够，
  要么调预算、要么只把 T1/T1_5 的间隔收回 30 分钟（约 +60 次/小时）。

## 5. 站点与出刊

- `/`、`/hot`、`/all`、`/daily` 全 200；worker 近 5 分钟 level 50/60 计数为 0。
- 日报/周报照常出刊：tier 改动会影响事件主位与「（一手）」标注，看一两期是否合理
  （官方渠道当主位、T2 媒体不作主位）。

## 6. 还没做、但可能想做的

- 83 个待判里仍有 2 个探不到 feed（CTech、Impress Watch），3 个缺 handle 的已放弃 1 个（AppSail 注销）。
- 那 46 个个人源已经补完（45 个入库），没有遗留。
- `roster-x-gap`（60 个 X 缺口）如果之后拿到文件，按同一套脚本跑一遍即可。
