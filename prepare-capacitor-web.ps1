param(
  [switch]$SkipCapSync
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$dist = Join-Path $root "dist"

# Extensions to automatically include from the root
$includeExtensions = @("*.html", "*.js", "*.css", "*.png", "*.jpg", "*.jpeg", "*.svg", "*.webmanifest", "*.ico", "*.txt")

# Specific files to exclude from the automatic copy (system/config files)
$excludeFiles = @(
    "package.json", 
    "package-lock.json", 
    "capacitor.config.json", 
    "capacitor.settings.gradle", 
    "build.gradle", 
    "variables.gradle", 
    "settings.gradle",
    "schema.sql",
    "project-review.md"
)

# Specific directories to copy entirely
$directories = @("icons", "arcade-commands", "src", "companion-runtime")

# Clean and recreate dist
if (Test-Path -LiteralPath $dist) {
  Write-Host "Cleaning existing dist directory..." -ForegroundColor Gray
  Remove-Item -LiteralPath $dist -Recurse -Force
}
New-Item -ItemType Directory -Path $dist | Out-Null

Write-Host "--- Copying Web Assets (Auto-Discovery) ---" -ForegroundColor Cyan
$copiedCount = 0

foreach ($ext in $includeExtensions) {
    Get-ChildItem -Path $root -Filter $ext | Where-Object { 
        $excludeFiles -notcontains $_.Name 
    } | ForEach-Object {
        $dest = Join-Path $dist $_.Name
        Copy-Item -Path $_.FullName -Destination $dest -Force
        $copiedCount++
    }
}
Write-Host "Copied $copiedCount files to dist." -ForegroundColor Gray

Write-Host "`n--- Copying Directories ---" -ForegroundColor Cyan
foreach ($directory in $directories) {
  $src = Join-Path $root $directory
  if (Test-Path -LiteralPath $src) {
    Copy-Item -Path $src -Destination $dist -Recurse -Force
    Write-Host "[Dir]  $directory"
  } else {
    Write-Warning "Directory missing: $directory"
  }
}

Write-Host "`n--- Packaging Companion Installer ---" -ForegroundColor Cyan
$companionSetupSource = Join-Path $root "setup-companion.bat"
$companionManifestSource = Join-Path $root "companion-runtime-package.json"
$companionRuntimeDest = Join-Path $dist "companion-runtime"
$companionBackendDest = Join-Path $companionRuntimeDest "backend"
New-Item -ItemType Directory -Path $companionBackendDest -Force | Out-Null

if (-not (Test-Path -LiteralPath $companionSetupSource)) { throw "Missing companion installer: setup-companion.bat" }
if (-not (Test-Path -LiteralPath $companionManifestSource)) { throw "Missing companion runtime manifest: companion-runtime-package.json" }
Copy-Item -LiteralPath $companionSetupSource -Destination (Join-Path $dist "setup-companion.bat") -Force
Copy-Item -LiteralPath $companionManifestSource -Destination (Join-Path $companionRuntimeDest "package.json") -Force

$companionBackendFiles = @("server.js", "strict-ai-tools.js", "smtc-query.js")
foreach ($file in $companionBackendFiles) {
  $source = Join-Path (Join-Path $root "backend") $file
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing companion backend file: backend/$file" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $companionBackendDest $file) -Force
  Write-Host "[Companion] backend/$file"
}

Write-Host "`n--- Verifying Critical Dist Files ---" -ForegroundColor DarkCyan
$criticalDistFiles = @(
  "index.html",
  "mini-games.html",
  "mini-games.js",
  "app-v3.js",
  "app-v3-ui.js",
  "arcade-chat.js",
  "companion-ai-core.js",
  "hero-media-player.js",
  "config.js",
  "notifications.js",
  "setup-companion.bat",
  "companion-runtime/setup.ps1",
  "companion-runtime/start.ps1",
  "companion-runtime/package.json",
  "companion-runtime/backend/server.js",
  "companion-runtime/backend/strict-ai-tools.js",
  "companion-runtime/backend/smtc-query.js",
  "arcade-commands/manager.js",
  "arcade-commands/edit.js",
  "arcade-commands/rewrite.js",
  "arcade-commands/fix.js",
  "arcade-commands/deep.js",
  "arcade-commands/publish.js",
  "arcade-commands/clear.js",
  "arcade-commands/help.js"
)

foreach ($file in $criticalDistFiles) {
  $target = Join-Path $dist $file
  if (Test-Path -LiteralPath $target) {
    Write-Host "[OK] $file"
  } else {
    throw "Missing critical dist file: $file"
  }
}

if ($SkipCapSync) {
  Write-Host "`nSkipped Capacitor sync (`-SkipCapSync supplied)." -ForegroundColor Yellow
} else {
  Write-Host "`n--- Syncing with Capacitor ---" -ForegroundColor Green
  Set-Location -Path $root
  # Use sync instead of copy to ensure plugins and project structure are updated
  npx cap sync android
  Write-Host "`nSync Complete! Ready to build in Android Studio." -ForegroundColor White
}
