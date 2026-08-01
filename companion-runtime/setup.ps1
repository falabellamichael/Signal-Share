[CmdletBinding()]
param(
  [string]$RuntimeBaseUrl = "https://falabellamichael.github.io/Signal-Share/companion-runtime",
  [string]$SiteUrl = "https://falabellamichael.github.io/Signal-Share/"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host "`n[Signal Share] $Message" -ForegroundColor Cyan
}

function New-RandomHex([int]$ByteCount = 32) {
  $bytes = New-Object byte[] $ByteCount
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
  } finally {
    $random.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

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

function Ensure-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $existing = Get-EnvValue -Path $Path -Name $Name
  if ($existing) { return $existing }
  if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt 0) {
    Add-Content -LiteralPath $Path -Value "" -Encoding ASCII
  }
  Add-Content -LiteralPath $Path -Value "$Name=$Value" -Encoding ASCII
  return $Value
}

function Stop-PreviousCompanion([string]$InstallRoot) {
  $pidPath = Join-Path $InstallRoot "companion.pid"
  if (-not (Test-Path -LiteralPath $pidPath)) { return }
  $oldPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$oldPid)) { return }
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue
  if (-not $candidate) { return }
  $commandLine = [string]$candidate.CommandLine
  if ($commandLine.IndexOf($InstallRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $commandLine.IndexOf("server.js", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    Write-Warning "The saved companion PID belongs to a different process. It was not stopped."
    return
  }
  Stop-Process -Id $oldPid -Force -ErrorAction Stop
  Start-Sleep -Milliseconds 350
}

try {
  Write-Host "`n========================================================" -ForegroundColor DarkCyan
  Write-Host " Signal Share Companion - secure per-user setup" -ForegroundColor White
  Write-Host "========================================================" -ForegroundColor DarkCyan
  Write-Host "This installs under your Windows profile. Administrator access is not required."

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $nodeCommand -or -not $npmCommand) {
    throw "Node.js 18 or newer was not found. Install the current Node.js LTS release from https://nodejs.org/ and run setup again."
  }
  $nodeVersion = (& $nodeCommand.Source -p "process.versions.node").Trim()
  $nodeMajor = 0
  if (-not [int]::TryParse(($nodeVersion -split "\.")[0], [ref]$nodeMajor) -or $nodeMajor -lt 18) {
    throw "Node.js $nodeVersion is too old. Install Node.js 18 or newer and run setup again."
  }

  $installRoot = Join-Path $env:LOCALAPPDATA "SignalShare\Companion"
  $backendRoot = Join-Path $installRoot "backend"
  $logsRoot = Join-Path $installRoot "logs"
  $stagingRoot = Join-Path $env:TEMP ("SignalShareCompanion-" + [Guid]::NewGuid().ToString("N"))
  $stagingBackend = Join-Path $stagingRoot "backend"
  New-Item -ItemType Directory -Path $stagingBackend -Force | Out-Null
  New-Item -ItemType Directory -Path $backendRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null

  Write-Step "Downloading the current companion runtime from the official static site"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $runtimeBase = $RuntimeBaseUrl.TrimEnd("/")
  $assets = @(
    @{ Remote = "package.json"; Local = "package.json" },
    @{ Remote = "backend/server.js"; Local = "backend\server.js" },
    @{ Remote = "backend/strict-ai-tools.js"; Local = "backend\strict-ai-tools.js" },
    @{ Remote = "backend/smtc-query.js"; Local = "backend\smtc-query.js" },
    @{ Remote = "start.ps1"; Local = "start.ps1" }
  )
  foreach ($asset in $assets) {
    $destination = Join-Path $stagingRoot $asset.Local
    Invoke-WebRequest -UseBasicParsing -Uri "$runtimeBase/$($asset.Remote)" -OutFile $destination
    if (-not (Test-Path -LiteralPath $destination) -or (Get-Item -LiteralPath $destination).Length -eq 0) {
      throw "The downloaded runtime asset is empty: $($asset.Remote)"
    }
  }
  & $nodeCommand.Source --check (Join-Path $stagingBackend "server.js")
  if ($LASTEXITCODE -ne 0) { throw "The downloaded companion server failed JavaScript validation." }
  & $nodeCommand.Source --check (Join-Path $stagingBackend "strict-ai-tools.js")
  if ($LASTEXITCODE -ne 0) { throw "The downloaded PC tool module failed JavaScript validation." }
  & $nodeCommand.Source --check (Join-Path $stagingBackend "smtc-query.js")
  if ($LASTEXITCODE -ne 0) { throw "The downloaded Windows media module failed JavaScript validation." }
  $launcherTokens = $null
  $launcherErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $stagingRoot "start.ps1"), [ref]$launcherTokens, [ref]$launcherErrors) | Out-Null
  if ($launcherErrors.Count -gt 0) { throw "The downloaded companion launcher failed PowerShell validation." }

  Copy-Item -LiteralPath (Join-Path $stagingRoot "package.json") -Destination (Join-Path $installRoot "package.json") -Force
  Copy-Item -LiteralPath (Join-Path $stagingBackend "server.js") -Destination (Join-Path $backendRoot "server.js") -Force
  Copy-Item -LiteralPath (Join-Path $stagingBackend "strict-ai-tools.js") -Destination (Join-Path $backendRoot "strict-ai-tools.js") -Force
  Copy-Item -LiteralPath (Join-Path $stagingBackend "smtc-query.js") -Destination (Join-Path $backendRoot "smtc-query.js") -Force
  Copy-Item -LiteralPath (Join-Path $stagingRoot "start.ps1") -Destination (Join-Path $installRoot "start.ps1") -Force

  Write-Step "Preserving configuration and creating any missing pairing credentials"
  $envPath = Join-Path $backendRoot ".env"
  if (-not (Test-Path -LiteralPath $envPath)) {
    New-Item -ItemType File -Path $envPath -Force | Out-Null
  }
  $bridgeSecret = Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_BRIDGE_SECRET" -Value (New-RandomHex 32)
  $localToken = Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_LOCAL_LLM_TOKEN" -Value (New-RandomHex 32)
  $portText = Ensure-EnvValue -Path $envPath -Name "PORT" -Value "3000"
  Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_BRIDGE_BIND" -Value "127.0.0.1" | Out-Null
  Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_BRIDGE_LAN" -Value "false" | Out-Null
  Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_LM_STUDIO_BASE_URL" -Value "http://127.0.0.1:1234" | Out-Null
  Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_OLLAMA_BASE_URL" -Value "http://127.0.0.1:11434" | Out-Null
  Ensure-EnvValue -Path $envPath -Name "SIGNAL_SHARE_SITE_URL" -Value $SiteUrl | Out-Null
  $bridgePort = 0
  if (-not [int]::TryParse($portText, [ref]$bridgePort) -or $bridgePort -lt 1 -or $bridgePort -gt 65535) {
    throw "PORT in $envPath must be an integer from 1 through 65535. The existing value was preserved; correct it and run setup again."
  }

  Write-Step "Installing the companion's local Node.js dependencies"
  Push-Location $installRoot
  try {
    & $npmCommand.Source install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  Write-Step "Starting the companion in the background"
  Stop-PreviousCompanion -InstallRoot $installRoot
  $stdoutLog = Join-Path $logsRoot "companion.out.log"
  $stderrLog = Join-Path $logsRoot "companion.error.log"
  $serverPath = Join-Path $backendRoot "server.js"
  $process = Start-Process -FilePath $nodeCommand.Source -ArgumentList "`"$serverPath`"" -WorkingDirectory $installRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
  Set-Content -LiteralPath (Join-Path $installRoot "companion.pid") -Value $process.Id -Encoding ASCII

  $healthUrl = "http://127.0.0.1:$bridgePort/api/health"
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($process.HasExited) { break }
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
      if ($health.ok -eq $true -and $health.service -eq "Signal Share Companion") {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }
  if (-not $ready) {
    $errorTail = ""
    if (Test-Path -LiteralPath $stderrLog) {
      $errorTail = (Get-Content -LiteralPath $stderrLog -Tail 12) -join [Environment]::NewLine
    }
    throw "The companion did not become ready at $healthUrl.`n$errorTail`nLogs: $logsRoot"
  }

  $programsFolder = [Environment]::GetFolderPath("Programs")
  if ($programsFolder) {
    $shortcutPath = Join-Path $programsFolder "Signal Share Companion.lnk"
    $powerShellPath = Join-Path $PSHOME "powershell.exe"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShellPath
    $shortcut.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $installRoot 'start.ps1')`""
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.Description = "Start and open the Signal Share Companion"
    $shortcut.Save()
  }

  Write-Step "Pairing this browser with the running companion"
  $cleanSiteUrl = $SiteUrl -replace "#.*$", ""
  $fragment = "#ss_bridge_url=$([Uri]::EscapeDataString("http://127.0.0.1:$bridgePort"))&ss_bridge_secret=$([Uri]::EscapeDataString($bridgeSecret))"
  if ($localToken) {
    $fragment += "&ss_local_llm_token=$([Uri]::EscapeDataString($localToken))"
  }
  Start-Process ($cleanSiteUrl + $fragment)

  Write-Host "`nSUCCESS: Signal Share Companion is installed, running, and paired." -ForegroundColor Green
  Write-Host "Bridge: http://127.0.0.1:$bridgePort"
  Write-Host "Install: $installRoot"
  Write-Host "Logs: $logsRoot"
  if (-not $health.aiAvailable) {
    Write-Host "AI is waiting for LM Studio, Ollama, or a configured OpenAI-compatible endpoint with a loaded model." -ForegroundColor Yellow
  }
} catch {
  Write-Host "`nSETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($stagingRoot -and (Test-Path -LiteralPath $stagingRoot)) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
