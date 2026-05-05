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
  # Force OneDrive hydration by reading content
  [void](Get-Content -LiteralPath $src -Raw -ErrorAction SilentlyContinue)
  Copy-Item -LiteralPath $src -Destination (Join-Path $dist $file) -Force
}

foreach ($directory in $directories) {
  Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $dist $directory) -Recurse -Force
}

Write-Host "Prepared Capacitor web assets in $dist"
