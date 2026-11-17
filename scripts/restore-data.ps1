param(
  [Parameter(Mandatory = $true)][string]$Zip,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$data = Join-Path $root "app\data"
$zipPath = Resolve-Path $Zip
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (-not (Test-Path $zipPath)) { throw "backup not found: $zipPath" }

if (-not $Apply) {
  $out = Join-Path $root "app\data-restored-$stamp"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $out -Force
  Write-Host "Extracted for inspection: $out"
  Write-Host "Nothing was overwritten. Re-run with -Apply after stopping the app to restore."
  exit 0
}

$listening = Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  throw "port 8790 is still listening. Stop the app (Ctrl+C / stop the background node process) before -Apply."
}

$confirm = Read-Host "This will replace $data. Type RESTORE to continue"
if ($confirm -ne "RESTORE") { throw "cancelled" }

# Safety snapshot before replacing.
& (Join-Path $PSScriptRoot "backup-data.ps1")
Get-ChildItem -Path $data -Force | Where-Object {
  $_.Name -in @("state.json", "tasks.json", "gateway-state.json", "audit.jsonl", "agents", "media")
} | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Expand-Archive -Path $zipPath -DestinationPath $data -Force
Write-Host "Restored $zipPath into $data"
Write-Host "Start the app again: cd app; npm start"
