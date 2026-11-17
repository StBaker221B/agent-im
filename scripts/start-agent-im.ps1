param(
  [string]$Distro = "agentim",
  [int]$Port = 8790,
  [switch]$NoTuwunel
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$app = Join-Path $root "app"
$data = Join-Path $app "data"
New-Item -ItemType Directory -Force -Path $data | Out-Null

function Test-Http($url) {
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    return $res.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not $NoTuwunel -and -not (Test-Http "http://127.0.0.1:8008/_matrix/client/versions")) {
  Write-Host "Starting Tuwunel in WSL distro '$Distro'..."
  $cmd = "nohup /opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml > /var/log/tuwunel.log 2>&1 &"
  & wsl.exe -d $Distro -u root -- bash -lc $cmd | Out-Null
  Start-Sleep -Seconds 2
}

if (-not (Test-Http "http://127.0.0.1:$Port/api/health")) {
  Write-Host "Starting Agent IM app on 127.0.0.1:$Port..."
  $out = Join-Path $data "server.log"
  $err = Join-Path $data "server.err.log"
  Start-Process -FilePath "node" -ArgumentList "server.mjs" -WorkingDirectory $app -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err
  Start-Sleep -Seconds 2
}

if (Test-Http "http://127.0.0.1:$Port/api/health") {
  Write-Host "Agent IM: http://127.0.0.1:$Port"
  Write-Host "Homeserver: http://127.0.0.1:8008"
} else {
  Write-Error "Agent IM did not become healthy. Check $data\server.log and $data\server.err.log."
}
