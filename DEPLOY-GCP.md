# 部署到 GCP（香港 asia-east2）

目标实例：`aihot` / `e2-medium` / `asia-east2-c` / `34.96.136.13`
镜像仓库：`asia-east2-docker.pkg.dev/project-79671177-5fb1-4881-a7c/aihot/app:latest`

## 架构：镜像在本地构建并推送，服务器只拉取

服务器上**不构建**。原因：构建要 npm ci + Vite 打包，会冲高内存；而且本地已经有构建好的镜像。

```
本地 Windows                        Artifact Registry             服务器 34.96.136.13
   docker build ──push──> aihot/app:latest ──pull──> docker compose up -d
```

## 一、在本地推送镜像

```powershell
cd E:\cs\aihot

# 1) 认证（第一次需要，会开浏览器）
gcloud auth login
gcloud config set project project-79671177-5fb1-4881-a7c
gcloud auth configure-docker asia-east2-docker.pkg.dev --quiet

# 2) 建仓库（只需一次）
gcloud artifacts repositories create aihot `
  --repository-format=docker --location=asia-east2 `
  --project=project-79671177-5fb1-4881-a7c

# 3) 打标签并推送（669 MB，视上传带宽可能要几分钟）
docker tag aihot-app:latest `
  asia-east2-docker.pkg.dev/project-79671177-5fb1-4881-a7c/aihot/app:latest
docker push asia-east2-docker.pkg.dev/project-79671177-5fb1-4881-a7c/aihot/app:latest
```

## 二、给服务账号授权（否则服务器拉不到镜像）

服务器用实例服务账号从 Artifact Registry 拉镜像，需要读取权限：

```bash
gcloud projects add-iam-policy-binding project-79671177-5fb1-4881-a7c \
  --member="serviceAccount:550053867265-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

> 另外，**实例的 Access scopes 不能过于受限**。创建时如果选了"限制访问"，token 范围里没有
> Artifact Registry，Docker 登录会失败。最省事是把 scopes 设成"允许对所有 Cloud API 的完全访问"。
> `deploy-server.sh` 第 3 步会直接报出这类问题。

## 三、把文件传到服务器

只需要这些（合计约 7 MB）：

```bash
cd E:\cs\aihot
gcloud compute ssh root@34.96.136.13 --zone=asia-east2-c --command="mkdir -p ~/aihot"
gcloud compute scp --recurse `
  apps packages industry database scripts deploy `
  docker-compose.server.yml .env.server `
  root@34.96.136.13:~/aihot/ --zone=asia-east2-c
```

> **`.env` 里含密钥，用 `.env.server` 这个名字单独传**。上传后在服务器上改名：
> `mv ~/aihot/.env.server ~/aihot/.env`

## 四、迁移数据库（把本地跑出来的数据带过去）

**为什么要迁**：不用从零回填，直接继承 326 条信源、5593 篇文章、5592 篇精选、1576 个事件。
更重要的是**收据（receipts）一起迁** —— 收据的 key 是 prompt 内容哈希，服务器处理同一批文章时
会命中已有收据**直接复用、不重复调用模型**，省下的钱远超这 140 MB。

### 本地导出

```powershell
cd E:\cs\aihot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
# Windows 没有 gzip，用容器里的
cmd /c "docker compose exec -T db sh -c ""pg_dump -U aihot -d aihot --clean --if-exists | gzip -9"" > aihot-db-$stamp.sql.gz"
```

得到约 **139 MB** 的文件（383 MB 压缩到 36%）。

### 上传

```powershell
gcloud compute scp aihot-db-<stamp>.sql.gz root@34.96.136.13:~/aihot/ --zone=asia-east2-c
```

### 服务器上恢复

```bash
cd ~/aihot
bash scripts/restore-db.sh aihot-db-<stamp>.sql.gz
```

`restore-db.sh` 的顺序是刻意安排的：**停应用 → 起数据库 → 跑迁移建 schema → 恢复数据 → 才启动服务**。
这样 worker 不会在恢复过程中一边写一边被覆盖。恢复完会打印各表条数供你核对。

> ⚠️ 先跑迁移再恢复是必须的：`pg_dump --clean` 只会 DROP/CREATE 表，它**不建 schema**，
> 所以 `public` schema 得先由迁移创建出来。

## 五、在服务器上启动

```bash
gcloud compute ssh root@34.96.136.13 --zone=asia-east2-c
cd ~/aihot
mv .env.server .env
bash scripts/deploy-server.sh
```

脚本会：校验 `.env` 必填项 → 装 Docker（如果没有）→ 用实例服务账号登录 Artifact Registry
→ 拉镜像 → `docker compose up -d` → 等迁移和种子跑完 → 健康检查。

> 已经用 `restore-db.sh` 恢复过数据的话，`deploy-server.sh` 里的 seed 是 `ON CONFLICT DO UPDATE`
> 幂等的，会把 `industry/sources.json` 的信源配置再对齐一次，不会清空你的数据。

## 六、验证

```bash
curl -s http://34.96.136.13/api/health
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot \
  -c 'select (select count(*) from sources) 信源, (select count(*) from publications) 精选;'
```

打开 <http://34.96.136.13/> ，后台 `/admin`，密码在 `.env` 的 `ADMIN_PASSWORD`。

## 服务器专用 compose 的两处不同

`docker-compose.server.yml` 相对仓库自带的 `docker-compose.yml`：

| 改动 | 原因 |
|---|---|
| `build: .` → `image:` | 服务器只拉镜像，不构建 |
| 挂载 `./industry` 和 `./database` | 官方 Dockerfile 是 `COPY . .` 把这两个目录烤进镜像，不挂载的话改信源就得重建镜像 |
| 端口 `${PORT:-80}:3000` | 复用 GCP 默认 VPC 已放行的 `http-server`（80），不需要额外防火墙规则 |

## 常见操作

```bash
# 更新代码：本地重新 build + push，然后服务器上
docker compose -f docker-compose.server.yml pull
docker compose -f docker-compose.server.yml up -d

# ⚠️ 改了 .env 之后必须这样做 —— restart 不会重读 .env！
# docker compose restart 只重启进程，环境变量还是容器创建时那一份。
# 这个坑踩过两次：容器内变量与 .env 不一致，会被误判成「凭证配错了」。
docker compose -f docker-compose.server.yml up -d --force-recreate api worker

# 验证容器真的读到了 .env 的新值（用哈希，不打印密钥）
grep -E '^LLM_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-16
docker compose -f docker-compose.server.yml exec -T worker \
  node -e "const c=require('crypto');console.log(c.createHash('sha256').update(process.env.LLM_API_KEY||'').digest('hex').slice(0,16))"

# 改了 industry/sources.json（比如加信源）后让它生效
docker compose -f docker-compose.server.yml run --rm setup sh -c 'node scripts/migrate.ts && node scripts/seed.ts'

# 看日志
docker compose -f docker-compose.server.yml logs -f --tail 100 worker

# 暂停（注意：只关 COLLECT_ENABLED 会连带关掉正文抽取的 handler，见 DEPLOY-NOTES）
# 改 .env 里 MODEL_CALLS_ENABLED=false 然后 up -d

# 数据库备份（手动；定时备份见下）
docker compose -f docker-compose.server.yml exec -T db pg_dump -U aihot aihot | gzip > aihot-$(date +%F).sql.gz

# 手动跑一次对象存储备份（含上传），验证凭证是否仍有效
docker compose -f docker-compose.server.yml exec -T worker node scripts/run-backup.ts

# 列出 R2 桶里实际存在的对象（独立验证，不靠代码自称成功）
docker compose -f docker-compose.server.yml exec -T worker node scripts/verify-r2-objects.ts
```

**`scripts/` 与 `industry/`、`database/` 都是挂载进容器的**，所以在服务器上改了脚本不用重建镜像就能跑。

### ⚠️ 跟进上游更新时，新增的文件要单独上传

因为它们是**挂载**的，容器读的是宿主机上的文件 —— 镜像里那份是构建时的快照，**不是最新的**。所以拿到上游新文件后，必须一起传上去：

```bash
# 新增的迁移（漏传的后果：migrate 报 "database is up to date"，但新列根本不存在）
gcloud compute scp database/migrations/0041_xxx.sql \
  weijianlin@aihot:/home/weijianlin/aihot/database/migrations/0041_xxx.sql --zone=asia-east2-c

# 然后应用迁移，并【核对新列真的存在】—— 不要只信 "database is up to date"
docker compose -f docker-compose.server.yml run --rm setup sh -c 'node scripts/migrate.ts'
docker compose -f docker-compose.server.yml exec -T db psql -U aihot -d aihot -t -c \
  "select count(*) from schema_migrations;"     # 应等于 database/migrations/ 的文件数
```

### 回滚：回滚标签要在构建【之前】打

`docker compose build` 会把 `aihot-app:latest` 指向新构建，**旧镜像的标签就此丢失**（起个 `pre-xxx` 的新名字也没用，它指向的还是新镜像）。最可靠的是**在服务器上、pull 之前**保存：

```bash
# 服务器上，pull 之前（旧镜像本来就在那儿）
docker tag $AIHOT_IMAGE $AIHOT_IMAGE:rollback-<短ID>
docker compose -f docker-compose.server.yml pull
```

回滚 = 改 `.env` 的 `AIHOT_IMAGE` 指向那个标签 + `up -d --force-recreate`。

## 备份

三层，都在跑：

| 层级 | 位置 | 时间 | 保留 |
|---|---|---|---|
| 本地（服务器磁盘） | `/home/weijianlin/backups/` | 每天 04:20（服务器 UTC） | 7 份，自校验 gzip + ≥50 张表 |
| 异地（Cloudflare R2） | 桶 `aihot-backup` | 每天 04:10 | 由桶的生命周期规则控制 |
| 手动 | `scripts/run-backup.ts` | 随时 | — |

**R2 生命周期规则**（用 `npx wrangler r2 bucket lifecycle add` 配的，不是控制台）：`daily/` 3 天、`weekly/` 28 天、`monthly/` 365 天。

> 同一份备份会写进多个前缀（周日多一份 `weekly/`、每月 1 日再多一份 `monthly/`），而**代码不删远端旧文件**，所以没有生命周期规则会无限增长。

## 注意事项

- **`industry/sources.json` 是 git 跟踪文件**，里面没有明文密钥（已核查），但有你的信源清单。
  如果不想公开，把它加进 `.gitignore` 并从 git 移除。
- **镜像里烤进了 `industry/sources.json`**（`Dockerfile` 的 `COPY . .`）。推到私有 Artifact Registry
  没问题，但**不要把这个镜像推到公共仓库**。
- **静态 IP**：确认 `34.96.136.13` 是预留地址（`gcloud compute addresses list --filter=region:asia-east2`），
  否则实例重启后 IP 变化会让 `SITE_URL` 失效（全站链接、RSS、分享图、MCP 都依赖它）。
- **数据盘 30 GB**：GCP 磁盘只能扩不能缩，不够时在线扩容即可。
- **$300 试用金 90 天**到期或耗尽后，试用账户关闭、资源停止（30 天宽限期内升级付费账户可恢复）。
