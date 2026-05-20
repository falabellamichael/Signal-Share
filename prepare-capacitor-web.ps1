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
$directories = @("icons", "arcade-commands", "src")

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
