param(
  [string]$TaskName = "AgentIM",
  [string]$Distro = "agentim",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task: $TaskName"
  exit 0
}

$start = Join-Path $PSScriptRoot "start-agent-im.ps1"
if (-not (Test-Path $start)) { throw "start script not found: $start" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$start`" -Distro $Distro"

$logon = New-ScheduledTaskTrigger -AtLogOn
# Also check every 5 minutes; start-agent-im.ps1 is idempotent and only starts
# missing Tuwunel/app, so this acts as a simple watchdog after a crash.
$watch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($logon, $watch) `
  -Settings $settings `
  -Description "Agent IM: start Tuwunel/app at logon and check every 5 minutes" `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "It runs at logon and every 5 minutes; start-agent-im.ps1 is idempotent."
Write-Host "Remove with: powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove"
