param(
  [string]$BaseUrl = "http://127.0.0.1:1234/v1",
  [string]$Model = "",
  [switch]$WriteConfig,
  [switch]$ListModels,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-LmStudioModels {
  param([Parameter(Mandatory = $true)][string]$BaseUrl)

  $normalizedBaseUrl = $BaseUrl.TrimEnd("/")
  $modelsUrl = "$normalizedBaseUrl/models"

  try {
    $response = Invoke-RestMethod -Uri $modelsUrl -Method Get -TimeoutSec 8
  } catch {
    throw "LM Studio did not respond at $modelsUrl. Start LM Studio > Developer > Local Server on port 1234 and load a model. $($_.Exception.Message)"
  }

  $models = @($response.data | ForEach-Object {
    $id = "$($_.id)".Trim()
    if ($id) { $id }
  })

  if ($models.Count -eq 0) {
    throw "LM Studio responded at $modelsUrl, but returned no model IDs. Load a model in LM Studio first."
  }

  return $models
}

function Select-LmStudioModel {
  param(
    [Parameter(Mandatory = $true)][string[]]$Models,
    [string]$RequestedModel = ""
  )

  $requested = "$RequestedModel".Trim()
  if ($requested) {
    if ($Models -contains $requested) { return $requested }
    throw "Requested model '$requested' was not returned by LM Studio. Available models: $($Models -join ', ')"
  }

  $preferred = $Models | Where-Object {
    $_ -notmatch "(?i)embedding|embed|rerank|vision|mmproj"
  } | Select-Object -First 1

  if ($preferred) { return $preferred }
  return $Models[0]
}

function Upsert-TomlScalar {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $line = "$Key = `"$Value`""
  $pattern = "(?m)^\s*$([regex]::Escape($Key))\s*=.*$"

  if ($Text -match $pattern) {
    return [regex]::Replace($Text, $pattern, $line)
  }

  return "$line`r`n$Text"
}

function Upsert-TomlBool {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][bool]$Value
  )

  $tomlValue = if ($Value) { "true" } else { "false" }
  $line = "$Key = $tomlValue"
  $pattern = "(?m)^\s*$([regex]::Escape($Key))\s*=.*$"

  if ($Text -match $pattern) {
    return [regex]::Replace($Text, $pattern, $line)
  }

  return "$line`r`n$Text"
}

function Upsert-TomlSectionBool {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Section,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][bool]$Value
  )

  $tomlValue = if ($Value) { "true" } else { "false" }
  $line = "$Key = $tomlValue"
  $sectionPattern = "(?m)^\[$([regex]::Escape($Section))\]\s*$"

  if ($Text -notmatch $sectionPattern) {
    return "$Text`r`n`r`n[$Section]`r`n$line"
  }

  $sectionStart = [regex]::Match($Text, $sectionPattern).Index
  $afterSection = $Text.Substring($sectionStart)
  $nextSectionMatch = [regex]::Match($afterSection, "(?m)^\[[^\]]+\]\s*$", [System.Text.RegularExpressions.RegexOptions]::Multiline, [TimeSpan]::FromSeconds(1))

  $sectionEnd = $Text.Length
  if ($nextSectionMatch.Success -and $nextSectionMatch.Index -gt 0) {
    $sectionEnd = $sectionStart + $nextSectionMatch.Index
  }

  $before = $Text.Substring(0, $sectionStart)
  $sectionText = $Text.Substring($sectionStart, $sectionEnd - $sectionStart)
  $after = $Text.Substring($sectionEnd)
  $keyPattern = "(?m)^\s*$([regex]::Escape($Key))\s*=.*$"

  if ($sectionText -match $keyPattern) {
    $sectionText = [regex]::Replace($sectionText, $keyPattern, $line)
  } else {
    $sectionText = $sectionText.TrimEnd() + "`r`n$line`r`n"
  }

  return $before + $sectionText + $after
}

function Write-CodexConfig {
  param([Parameter(Mandatory = $true)][string]$ModelId)

  $codexDir = Join-Path $env:USERPROFILE ".codex"
  $configPath = Join-Path $codexDir "config.toml"

  if (!(Test-Path $codexDir)) {
    New-Item -ItemType Directory -Path $codexDir | Out-Null
  }

  $existing = ""
  if (Test-Path $configPath) {
    $existing = Get-Content $configPath -Raw
  }

  $existing = Upsert-TomlScalar -Text $existing -Key "model" -Value $ModelId
  $existing = Upsert-TomlScalar -Text $existing -Key "model_provider" -Value "lmstudio"
  $existing = Upsert-TomlScalar -Text $existing -Key "oss_provider" -Value "lmstudio"
  $existing = Upsert-TomlScalar -Text $existing -Key "web_search" -Value "disabled"
  $existing = Upsert-TomlScalar -Text $existing -Key "model_reasoning_effort" -Value "minimal"
  $existing = Upsert-TomlScalar -Text $existing -Key "model_reasoning_summary" -Value "none"
  $existing = Upsert-TomlBool -Text $existing -Key "model_supports_reasoning_summaries" -Value $false
  $existing = Upsert-TomlBool -Text $existing -Key "hide_agent_reasoning" -Value $true

  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "multi_agent" -Value $false
  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "apps" -Value $false
  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "web_search" -Value $false
  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "web_search_cached" -Value $false
  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "web_search_request" -Value $false
  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "browser_use" -Value $false
  $existing = Upsert-TomlSectionBool -Text $existing -Section "features" -Key "computer_use" -Value $false

  Set-Content -Path $configPath -Value $existing.Trim() -Encoding UTF8
  Write-Host "Updated Codex config for LM Studio app/CLI use: $configPath"
}

if (!(Test-CommandExists -Name "codex")) {
  throw "The 'codex' command was not found in PATH. Install or expose Codex CLI before running this launcher."
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$models = Get-LmStudioModels -BaseUrl $BaseUrl

if ($ListModels) {
  Write-Host "LM Studio models:"
  foreach ($item in $models) { Write-Host "- $item" }
  exit 0
}

$selectedModel = Select-LmStudioModel -Models $models -RequestedModel $Model
Write-Host "Using LM Studio model: $selectedModel"

if ($WriteConfig) {
  Write-CodexConfig -ModelId $selectedModel
}

$env:OPENAI_BASE_URL = $BaseUrl
$env:OPENAI_API_KEY = "lm-studio"

$codexArgs = @(
  "--oss",
  "-c",
  'oss_provider="lmstudio"',
  "-m",
  $selectedModel
)

Write-Host "Starting Codex with LM Studio at $BaseUrl"
Write-Host "codex $($codexArgs -join ' ')"

if ($DryRun) {
  exit 0
}

& codex @codexArgs
