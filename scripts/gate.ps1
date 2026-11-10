# 自动检查（Gate）：提交修改后、送审之前跑一遍
#
#   pwsh -File scripts/gate.ps1                  # 默认：类型检查 + 构建 + 架构测试 + 全量测试
#   pwsh -File scripts/gate.ps1 -SkipTests       # 只做静态检查（改文档/样式时用）
#   pwsh -File scripts/gate.ps1 -Base upgrade-4.0 -MaxLines 500
#
# 任何一步失败就退出码 1，不消耗 reviewer。
# 输出最后打印一个 PASS/FAIL 摘要，可直接贴进审核包。
[CmdletBinding()]
param(
  [string]$Base = "upgrade-4.0",
  [switch]$SkipTests,
  [int]$MaxLines = 500,
  [string]$TestArgs = ""
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo
$failures = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

function Step([string]$name, [scriptblock]$body) {
  Write-Host "=== $name ===" -ForegroundColor Cyan
  & $body
  if ($LASTEXITCODE -ne 0) { $failures.Add($name) }
}

# 1. 类型检查
Step "typecheck" { npm run typecheck }

# 2. Web 构建
Step "web build" { npm run build -w @aihot/web }

# 3. 架构测试（圆角、时区、预取等硬规则）
Step "architecture test" { pwsh -NoProfile -File scripts/test-in-container.ps1 "tests/architecture.test.ts" }

# 4. 全量测试（可跳过）
if (-not $SkipTests) {
  Step "full tests" { pwsh -NoProfile -File scripts/test-in-container.ps1 $TestArgs }
}

# 5. diff 规模：超过阈值只提醒，不判失败（拆分任务的责任在规划阶段）
$stat = git diff --numstat "$Base...HEAD" 2>$null
if ($LASTEXITCODE -eq 0 -and $stat) {
  $lines = ($stat | ForEach-Object { ($_ -split "`t")[0..1] | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ } } | Measure-Object -Sum).Sum
  $files = ($stat | Measure-Object).Count
  if ($lines -gt $MaxLines) {
    $notes.Add("diff ${lines} 行 / ${files} 个文件，超过建议的 ${MaxLines} 行：确认任务是否该再拆，或把规模写进任务卡。")
  } else {
    $notes.Add("diff ${lines} 行 / ${files} 个文件，在 ${MaxLines} 行以内。")
  }
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "GATE: PASS" -ForegroundColor Green
} else {
  Write-Host ("GATE: FAIL — " + ($failures -join "; ")) -ForegroundColor Red
}
foreach ($note in $notes) { Write-Host "note: $note" }
if ($failures.Count -gt 0) { exit 1 }
