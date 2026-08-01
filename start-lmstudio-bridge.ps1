$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectRoot "backend"
$EnvPath = Join-Path $BackendDir ".env"

if (!(Test-Path $BackendDir)) {
  throw "Backend folder not found: $BackendDir"
}

function Set-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Content,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $line = "$Key=$Value"
  $pattern = "(?m)^$([regex]::Escape($Key))=.*$"
  if ($Content -match $pattern) {
    return [regex]::Replace($Content, $pattern, $line)
  }
  if (!$Content) { return $line }
  return "$($Content.TrimEnd())`r`n$line"
}

$envContent = if (Test-Path -LiteralPath $EnvPath) { Get-Content -LiteralPath $EnvPath -Raw } else { "" }
$envContent = Set-DotEnvValue -Content $envContent -Key "PORT" -Value "3000"
$envContent = Set-DotEnvValue -Content $envContent -Key "SIGNAL_SHARE_LM_STUDIO_BASE_URL" -Value "http://127.0.0.1:1234"
$envContent = Set-DotEnvValue -Content $envContent -Key "LM_STUDIO_BASE_URL" -Value "http://127.0.0.1:1234"
$envContent = Set-DotEnvValue -Content $envContent -Key "SIGNAL_SHARE_AI_TEMPERATURE" -Value "0.7"

Set-Content -LiteralPath $EnvPath -Value $envContent.Trim() -Encoding UTF8
Write-Host "Updated LM Studio values in $EnvPath without replacing existing bridge credentials."

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
