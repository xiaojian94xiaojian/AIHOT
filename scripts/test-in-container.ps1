# Run the project's test suite inside the project image: Linux, Node 24 and pg_dump — the environment
# upstream CI uses. Same run as scripts/test-in-container.sh, for this Windows host, where the only
# bash is WSL and Docker Desktop's integration for it is off (the .sh cannot reach the daemon).
#
# Dependencies are installed with `npm ci` from the working tree's lockfile, because the image carries
# only what was installed at build time and a rebase can add packages that newly added tests import.
#
#   scripts/test-in-container.ps1                                 # whole suite
#   scripts/test-in-container.ps1 tests/materials.test.ts         # one file
#
# The image name defaults to aihot-app:latest (docker tag <deployed image> aihot-app:latest);
# the database defaults to the test container on the default bridge.
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$TestArgs)

$ErrorActionPreference = "Stop"
$dbHost = if ($env:DB_HOST) { $env:DB_HOST } else { "172.17.0.2" }
$dbName = if ($env:DB_NAME) { $env:DB_NAME } else { "aihot_ci" }
$image = if ($env:IMAGE) { $env:IMAGE } else { "aihot-app:latest" }
$concurrency = if ($env:TEST_CONCURRENCY) { $env:TEST_CONCURRENCY } else { "6" }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tests = if ($TestArgs) { $TestArgs -join " " } else { "tests/*.test.ts modules/*/tests/*.test.ts" }

docker run --rm --entrypoint pg_isready $image -h $dbHost -U aihot *> $null
if ($LASTEXITCODE -ne 0) { throw "postgres at ${dbHost}:5432 is not reachable from the container" }

$inner = @'
set -e
# Stage the working tree outside the image, without the host node_modules.
tar -C /src --exclude=./node_modules --exclude=./.git --exclude=./.data -cf - . | tar -xf - -C /work
cd /work
echo "=== installing dependencies from the lockfile ==="
npm ci --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -n 30 /tmp/npm.log; exit 1; }
echo "=== $(uname -s) / node $(node --version) / $(pg_dump --version | cut -d" " -f1-3) ==="
node scripts/migrate.ts 2>&1 | tail -n 1
exec node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency="$TEST_CONCURRENCY" --test-timeout=120000 $TEST_ARGS
'@

docker run --rm --user root --entrypoint sh `
  -v "${repo}:/src:ro" -w /work `
  -e "DATABASE_URL=postgres://aihot:aihot@${dbHost}:5432/${dbName}" `
  -e LOG_LEVEL=error -e "TEST_ARGS=$tests" -e "TEST_CONCURRENCY=$concurrency" `
  -e NPM_CONFIG_FUND=false -e NPM_CONFIG_AUDIT=false `
  $image -c $inner
exit $LASTEXITCODE
