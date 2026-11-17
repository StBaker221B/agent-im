param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$data = Join-Path $root "app\data"
if (-not (Test-Path $data)) { throw "data directory not found: $data" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zip = Join-Path $OutDir "agent-im-data-$stamp.zip"

# Keep tokens/state/tasks/audit/agents/media. Benchmark workspaces are
# reproducible from fixtures and can be large, so they are intentionally out.
$items = @(
  "state.json",
  "tasks.json",
  "gateway-state.json",
  "audit.jsonl",
  "agents",
  "media"
) | ForEach-Object { Join-Path $data $_ } | Where-Object { Test-Path $_ }

if ($items.Count -eq 0) { throw "nothing to back up in $data" }

Compress-Archive -Path $items -DestinationPath $zip -Force
$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host "Backup written: $zip ($size MB)"
Write-Host "WARNING: this archive contains Matrix tokens/passwords. Keep it private."
