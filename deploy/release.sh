#!/bin/sh
# 本站的标准发布：拉镜像 → 同步挂载目录 → 迁移与种子 → 重建 → 冒烟。
#
# 服务器上 industry/、database/seeds/、scripts/ 三处是 bind mount，会盖住镜像里的同名目录；
# 只换镜像不同步这三处，上游新增的提示词、种子、脚本就不会生效（11-04 就是缺了
# industry/prompts/translate-body-retry.md，worker 一直崩）。这个脚本把同步做成发布的一部分。
#
# 用法（服务器上，需要 sudo）：
#   sudo sh deploy/release.sh                 # 用 .env 里的 AIHOT_IMAGE
#   sudo sh deploy/release.sh <image:tag>     # 指定镜像
#   SYNC_ONLY=1 sudo sh deploy/release.sh     # 只同步挂载目录，不发版（合并后想先看一眼时用）
#   PRUNE=1 sudo sh deploy/release.sh         # 顺带把宿主机独有的旧文件挪走，让挂载目录与镜像一致
#
# 镜像仓库：AIHOT_IMAGE 指向的仓库（腾讯云 TCR，如 krccr.ccs.tencentyun.com/aihot/app:latest）；
# 登录账号放 .env 的 TCR_USERNAME / TCR_PASSWORD，没配就用本机已保存的 docker 凭证。
#
# 同步的规则：以镜像为准，覆盖同名文件、补上缺失；宿主机独有的文件默认只报告，
# PRUNE=1 时移到 .mount-extras-<时间>/ 并在报告中列出（不删除）。
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE=docker-compose.server.yml
SYNC_DIRS="industry database/seeds scripts"
DOMAIN="${SITE_DOMAIN:-hot.jian.ing}"

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  IMAGE=$(grep -E '^[[:space:]]*AIHOT_IMAGE=' .env | tail -1 | cut -d= -f2-)
fi
[ -n "$IMAGE" ] || { echo "找不到镜像：传给脚本，或在 .env 里设 AIHOT_IMAGE"; exit 1; }

# 镜像仓库的登录信息放在 .env（TCR_USERNAME / TCR_PASSWORD），仓库地址取自 AIHOT_IMAGE 的第一段。
# 没配就沿用本机已经 docker login 过的凭证（/root/.docker/config.json）。
env_value() { grep -E "^[[:space:]]*$1=" .env | tail -1 | cut -d= -f2-; }
TCR_USERNAME="${TCR_USERNAME:-$(env_value TCR_USERNAME)}"
TCR_PASSWORD="${TCR_PASSWORD:-$(env_value TCR_PASSWORD)}"
REGISTRY="${IMAGE%%/*}"

echo "== 1. 拉镜像 =="
if [ -n "$TCR_USERNAME" ] && [ -n "$TCR_PASSWORD" ]; then
  if ! printf '%s' "$TCR_PASSWORD" | sudo docker login "$REGISTRY" -u "$TCR_USERNAME" --password-stdin >/dev/null 2>&1; then
    echo "   (仓库登录失败，用本机已保存的凭证继续)"
  fi
fi
sudo docker pull "$IMAGE" >/dev/null
echo "   镜像: $IMAGE"

echo "== 2. 同步挂载目录（镜像 → 宿主机：覆盖同名、补上缺失） =="
for d in $SYNC_DIRS; do [ -d "$d" ] || mkdir -p "$d"; done
TMP="$(mktemp -d)"
chmod 0777 "$TMP"
trap 'rm -rf "$TMP"' EXIT
sudo docker run --rm -v "$TMP:/out" --entrypoint sh "$IMAGE" -c "cd /app && tar -cf /out/bundle.tar $SYNC_DIRS"
sudo docker run --rm --entrypoint sh "$IMAGE" -c "cd /app && find $SYNC_DIRS \\( -type f -o -type l \\)" > "$TMP/list.txt"
sudo tar -C "$ROOT" -xpf "$TMP/bundle.tar"
OWNER="$(stat -c %U "$ROOT")"; GROUP="$(stat -c %G "$ROOT")"
sudo chown -R "$OWNER:$GROUP" $SYNC_DIRS
printf '   现在 industry %s 个文件，database/seeds %s 个，scripts %s 个\n' \
  "$(find industry -type f | wc -l)" "$(find database/seeds -type f | wc -l)" "$(find scripts -type f | wc -l)"

# 宿主机独有的文件：镜像里没有（旧版留下的 site 文件、一次性脚本、.bak）。默认只报告，PRUNE=1 时移到旁边。
EXTRAS="$TMP/extras.txt"
find $SYNC_DIRS \( -type f -o -type l \) | sort | while IFS= read -r f; do
  grep -qxF "$f" "$TMP/list.txt" || echo "$f"
done > "$EXTRAS"
N=$(wc -l < "$EXTRAS")
if [ "${PRUNE:-0}" = "1" ]; then
  if [ "$N" -gt 0 ]; then
    STAMP="$(date +%Y%m%d-%H%M)"
    DEST="$ROOT/.mount-extras-$STAMP"
    while IFS= read -r f; do
      mkdir -p "$DEST/$(dirname "$f")"
      mv "$f" "$DEST/$f"
    done < "$EXTRAS"
    echo "   宿主机独有 $N 个文件，已移到 .mount-extras-$STAMP/（镜像里没有这些文件）"
  fi
  # 文件移走后留下的空目录也清掉，否则挂载目录仍和镜像不一致。
  find $SYNC_DIRS -mindepth 1 -type d -empty -delete
else
  if [ "$N" -gt 0 ]; then
    echo "   宿主机独有 $N 个文件（镜像里没有，未删除；清理用 PRUNE=1）："
    head -5 "$EXTRAS" | sed 's/^/     /'
    [ "$N" -gt 5 ] && echo "     ..."
  fi
fi

if [ "${SYNC_ONLY:-0}" = "1" ]; then
  echo "== 只同步，不发布 =="
  exit 0
fi

echo "== 3. 回滚点 =="
CUR=$(sudo docker inspect aihot-api-1 --format '{{.Image}}' | cut -d@ -f2)
sudo docker tag "$CUR" "${IMAGE%:*}:rollback-$(date +%Y%m%d-%H%M)" 2>/dev/null || true
echo "   当前: $CUR"

echo "== 4. 迁移与种子 =="
if ! sudo docker compose -f "$COMPOSE" run --rm setup > "$TMP/setup.log" 2>&1; then
  tail -20 "$TMP/setup.log"; exit 1
fi
tail -3 "$TMP/setup.log"

echo "== 5. 重建 api / worker / web =="
if ! sudo docker compose -f "$COMPOSE" up -d --no-deps --force-recreate api worker web > "$TMP/up.log" 2>&1; then
  tail -20 "$TMP/up.log"; exit 1
fi
sleep 10
sudo docker ps --format '{{.Names}}\t{{.Status}}' | grep aihot | sed 's/^/   /'

echo "== 6. 冒烟 =="
for p in / /api/health; do
  printf '   %-14s HTTP %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN$p")"
done
sudo docker logs --since 2m aihot-worker-1 2>&1 | grep -iE 'error|fail' | tail -3 || true
