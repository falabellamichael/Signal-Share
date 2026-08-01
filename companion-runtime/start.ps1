[CmdletBinding()]
param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  $escapedName = [Regex]::Escape($Name)
  $matches = @(Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$escapedName\s*=" })
  if ($matches.Count -eq 0) { return "" }
  $value = ($matches[-1] -replace "^\s*$escapedName\s*=\s*", "").Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    return $value.Substring(1, $value.Length - 2)
  }
  return ($value -replace "\s+#.*$", "").Trim()
}

function Test-CompanionHealth([string]$HealthUrl) {
  try {
    $health = Invoke-RestMethod -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
    return $health.ok -eq $true -and $health.service -eq "Signal Share Companion"
  } catch {
    return $false
  }
}

try {
  $installRoot = $PSScriptRoot
  $backendRoot = Join-Path $installRoot "backend"
  $logsRoot = Join-Path $installRoot "logs"
  $envPath = Join-Path $backendRoot ".env"
  $serverPath = Join-Path $backendRoot "server.js"
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw "Node.js is no longer available. Install the current Node.js LTS release from https://nodejs.org/." }
  if (-not (Test-Path -LiteralPath $serverPath) -or -not (Test-Path -LiteralPath $envPath)) {
    throw "The companion runtime is incomplete. Run setup-companion.bat again."
  }
  $portText = Get-EnvValue -Path $envPath -Name "PORT"
  $bridgePort = 0
  if (-not [int]::TryParse($portText, [ref]$bridgePort) -or $bridgePort -lt 1 -or $bridgePort -gt 65535) {
    throw "PORT in $envPath must be an integer from 1 through 65535."
  }
  $healthUrl = "http://127.0.0.1:$bridgePort/api/health"

  if (-not (Test-CompanionHealth -HealthUrl $healthUrl)) {
    New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
    $pidPath = Join-Path $installRoot "companion.pid"
    if (Test-Path -LiteralPath $pidPath) {
      $oldPid = 0
      if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$oldPid)) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue
        if ($candidate -and ([string]$candidate.CommandLine).IndexOf($installRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and ([string]$candidate.CommandLine).IndexOf("server.js", [StringComparison]::OrdinalIgnoreCase) -ge 0) {
          Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
          Start-Sleep -Milliseconds 300
        }
      }
    }
    $process = Start-Process -FilePath $nodeCommand.Source -ArgumentList "`"$serverPath`"" -WorkingDirectory $installRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logsRoot "companion.out.log") -RedirectStandardError (Join-Path $logsRoot "companion.error.log") -PassThru
    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ASCII
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      if ($process.HasExited) { break }
      if (Test-CompanionHealth -HealthUrl $healthUrl) { break }
      Start-Sleep -Milliseconds 400
    }
    if (-not (Test-CompanionHealth -HealthUrl $healthUrl)) {
      throw "The companion did not start. Review logs in $logsRoot or run setup-companion.bat again."
    }
  }

  if (-not $NoBrowser) {
    $siteUrl = Get-EnvValue -Path $envPath -Name "SIGNAL_SHARE_SITE_URL"
    if (-not $siteUrl) { $siteUrl = "https://falabellamichael.github.io/Signal-Share/" }
    $bridgeSecret = Get-EnvValue -Path $envPath -Name "SIGNAL_SHARE_BRIDGE_SECRET"
    $localToken = Get-EnvValue -Path $envPath -Name "SIGNAL_SHARE_LOCAL_LLM_TOKEN"
    $fragment = "#ss_bridge_url=$([Uri]::EscapeDataString("http://127.0.0.1:$bridgePort"))"
    if ($bridgeSecret) { $fragment += "&ss_bridge_secret=$([Uri]::EscapeDataString($bridgeSecret))" }
    if ($localToken) { $fragment += "&ss_local_llm_token=$([Uri]::EscapeDataString($localToken))" }
    Start-Process (($siteUrl -replace "#.*$", "") + $fragment)
  }

  Write-Host "Signal Share Companion is running at http://127.0.0.1:$bridgePort" -ForegroundColor Green
  Start-Sleep -Seconds 3
} catch {
  Write-Host "Signal Share Companion could not start: $($_.Exception.Message)" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
