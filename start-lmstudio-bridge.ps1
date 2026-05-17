$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectRoot "backend"
$EnvPath = Join-Path $BackendDir ".env"

if (!(Test-Path $BackendDir)) {
  throw "Backend folder not found: $BackendDir"
}

$envContent = @"
PORT=3000
SIGNAL_SHARE_LM_STUDIO_BASE_URL=http://127.0.0.1:1234
LM_STUDIO_BASE_URL=http://127.0.0.1:1234
SIGNAL_SHARE_AI_TEMPERATURE=0.7
"@

Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8
Write-Host "Wrote LM Studio bridge config to $EnvPath"

Write-Host "Checking LM Studio local server at http://127.0.0.1:1234/v1/models ..."
try {
  $models = Invoke-RestMethod "http://127.0.0.1:1234/v1/models" -TimeoutSec 5
  $modelIds = @($models.data | ForEach-Object { $_.id }) | Where-Object { $_ }
  if ($modelIds.Count -gt 0) {
    Write-Host "LM Studio models detected: $($modelIds -join ', ')"
  } else {
    Write-Host "LM Studio responded, but no model IDs were returned. Load a model in LM Studio if chat fails."
  }
} catch {
  Write-Host "LM Studio did not respond yet. Start LM Studio Developer > Local Server on port 1234, then keep this bridge running."
}

Set-Location $ProjectRoot

if (!(Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "Installing npm dependencies ..."
  npm install
}

Write-Host "Starting Signal Share bridge on http://127.0.0.1:3000"
node backend/server.js
