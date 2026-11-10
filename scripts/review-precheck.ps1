# 复审前置校验：确认「这轮真的有改动」再交给 reviewer
#
#   pwsh -File scripts/review-precheck.ps1 -Since 22e4cac
#   pwsh -File scripts/review-precheck.ps1 -Since 22e4cac -Base upgrade-4.0
#
# 通过条件：当前 HEAD 与上轮审核的 commit 不同，且两者之间有非空 diff。
# 失败退出码 1，直接退回 Worker，不消耗 reviewer —— 这就是为了防止
# 「声称改了、代码里没有」。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Since,
  [string]$Base = "upgrade-4.0"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo

$head = (git rev-parse HEAD).Trim()
$since = (git rev-parse --verify "$Since^{commit}" 2>$null)
if (-not $since) { Write-Host "REVIEW-PRECHECK: FAIL — 找不到上轮审核的 commit: $Since" -ForegroundColor Red; exit 1 }
$since = $since.Trim()

if ($head -eq $since) {
  Write-Host "REVIEW-PRECHECK: FAIL — HEAD 仍是上轮审核的 $Since，没有新提交。" -ForegroundColor Red
  exit 1
}

$changed = git diff --name-only "$since..$head"
if (-not $changed) {
  Write-Host "REVIEW-PRECHECK: FAIL — $since..$head 的 diff 为空（可能只改了工作区、没提交）。" -ForegroundColor Red
  exit 1
}

Write-Host "REVIEW-PRECHECK: PASS" -ForegroundColor Green
Write-Host "reviewed: $since"
Write-Host "head:     $head"
Write-Host "files:"
$changed | ForEach-Object { Write-Host "  $_" }

# 顺手提示工作区是否干净：reviewer 只读，脏工作区说明有未提交的改动，送审前应处理。
$dirty = git status --porcelain
if ($dirty) {
  Write-Host "note: 工作区还有未提交改动，审核将以 $head 为准。" -ForegroundColor Yellow
}

if ($Base) {
  $stat = git diff --stat "$Base...$head" 2>$null
  if ($LASTEXITCODE -eq 0 -and $stat) { Write-Host ""; Write-Host "相对 ${Base} 的累计 diff："; $stat | Select-Object -Last 1 | ForEach-Object { Write-Host "  $_" } }
}
