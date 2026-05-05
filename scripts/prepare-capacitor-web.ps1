$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"

$files = @(
  "index.html",
  "styles.css",
  "api-v3.js",
  "app-ui-v3.js",
  "app-v3.js",
  "messenger-realtime.js",
  "config.js",
  "notifications.js",
  "notifications.css",
  "keyboard-bindings-v3.js",
  "notification-keyboard-integration.js",
  "site.webmanifest",
  "service-worker.js"
)

$directories = @(
  "icons"
)

if (Test-Path -LiteralPath $dist) {
  Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Path $dist | Out-Null

foreach ($file in $files) {
  $src = Join-Path $root $file
  $dest = Join-Path $dist $file
  if (Test-Path $src) {
    # Using Get-Content | Set-Content forces the creation of a regular file, 
    # breaking the OneDrive ReparsePoint/symlink behavior that breaks Android builds.
    Get-Content -Path $src -Raw | Set-Content -Path $dest -Force
  }
}

foreach ($directory in $directories) {
  Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $dist $directory) -Recurse -Force
}

Write-Host "Prepared Capacitor web assets in $dist"
