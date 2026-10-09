#!/usr/bin/env bash
# Run the project's test suite inside the project image: Linux, Node 24 and pg_dump — the environment
# upstream CI uses. The host here is Windows and its shell cannot run several of these tests (no
# pg_dump client, different process/signal behaviour), so a change gets verified the way a reviewer's
# runner will verify it.
#
# Dependencies are installed with `npm ci` from the working tree's lockfile, because the image carries
# only what was installed at build time and a rebase can add packages (the MCP client, marked) that
# newly added tests import.
#
#   scripts/test-in-container.sh                          # whole suite
#   scripts/test-in-container.sh tests/materials.test.ts  # one file
set -euo pipefail

DB_HOST="${DB_HOST:-172.17.0.2}"
DB_NAME="${DB_NAME:-aihot_ci}"
DB_URL="postgres://aihot:aihot@${DB_HOST}:5432/${DB_NAME}"
IMAGE="${IMAGE:-aihot-app:latest}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if ! docker run --rm "$IMAGE" pg_isready -h "$DB_HOST" -U aihot >/dev/null 2>&1; then
  echo "postgres at ${DB_HOST}:5432 is not reachable from the container" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then TEST_ARGS="$*"; else TEST_ARGS='tests/*.test.ts modules/*/tests/*.test.ts'; fi

docker run --rm \
  --user root \
  -v "${REPO}:/src:ro" \
  -w /work \
  -e DATABASE_URL="$DB_URL" \
  -e LOG_LEVEL=error \
  -e TEST_ARGS="$TEST_ARGS" \
  -e NPM_CONFIG_FUND=false \
  -e NPM_CONFIG_AUDIT=false \
  "$IMAGE" sh -c '
    set -e
    # Stage the working tree outside the image, without the host node_modules.
    tar -C /src --exclude=./node_modules --exclude=./.git --exclude=./.data -cf - . | tar -xf - -C /work
    cd /work
    echo "=== installing dependencies from the lockfile ==="
    npm ci --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -n 30 /tmp/npm.log; exit 1; }
    echo "=== $(uname -s) / node $(node --version) / $(pg_dump --version | cut -d" " -f1-3) / $(ls node_modules | wc -l) packages ==="
    node scripts/migrate.ts 2>&1 | tail -n 1
    exec node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency="${TEST_CONCURRENCY:-6}" --test-timeout=120000 $TEST_ARGS
  '
