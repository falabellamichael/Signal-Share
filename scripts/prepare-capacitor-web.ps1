$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"

$files = @(
  "index.html",
  "styles.css",
  "styles-1.css",
  "styles-2.css",
  "styles-3.css",
  "api-v3.js",
  "app-v3.js",
  "app-v3-ui.js",
  "hero-media-player.js",
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
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $dist $file) -Force
}

foreach ($directory in $directories) {
  Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $dist $directory) -Recurse -Force
}

Write-Host "Prepared Capacitor web assets in $dist"
