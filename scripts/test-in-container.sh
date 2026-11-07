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

# The database suite: `tests/*.test.ts` also matches the `.standalone.test.ts` files, which have their
# own entrypoint (tests/standalone.ts) and must not run under the database global setup.
if [ "$#" -gt 0 ]; then TEST_ARGS="$*"; else TEST_ARGS="$(ls tests/*.test.ts modules/*/tests/*.test.ts | grep -v '\.standalone\.test\.ts$' | tr '\n' ' ')"; fi

docker run --rm \
  --user root \
  -v "${REPO}:/src:ro" \
  -v "${REPO}/.git:/gitdir:ro" \
  -w /work \
  -e DATABASE_URL="$DB_URL" \
  -e NODE_ENV=test \
  -e GIT_DIR=/gitdir \
  -e GIT_WORK_TREE=/work \
  -e GIT_CONFIG_COUNT=1 \
  -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0='*' \
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
    # The image sets NODE_ENV=production, which would skip the test-only dependencies (the MCP client).
    npm ci --include=dev --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -n 30 /tmp/npm.log; exit 1; }
    echo "=== $(uname -s) / node $(node --version) / $(pg_dump --version | cut -d" " -f1-3) / $(ls node_modules | wc -l) packages ==="
    # The architecture test enumerates tracked template files with `git ls-files`: the image ships no
    # git and the staged tree is not a checkout, so the host's .git is mounted at /gitdir and git is
    # pointed at the staged tree (GIT_DIR/GIT_WORK_TREE above).
    command -v git >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq --no-install-recommends git) >/dev/null 2>&1 || echo "(no git: the architecture env-template test will fail)"
    git ls-files -- '*.env.example' >/dev/null 2>&1 || echo "(git cannot list the staged tree: the architecture env-template test will fail)"
    node scripts/migrate.ts 2>&1 | tail -n 1
    exec node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency="${TEST_CONCURRENCY:-6}" --test-timeout=120000 $TEST_ARGS
  '
