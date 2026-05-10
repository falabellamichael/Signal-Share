$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$dist = Join-Path $root "dist"

$files = @(
  "index.html",
  "terms.html",
  "privacy.html",
  "styles.css",
  "styles-1.css",
  "styles-2.css",
  "styles-3.css",
  "notifications.css",
  "config.js",
  "api-v3.js",
  "app-v3.js",
  "app-v3-ui.js",
  "hero-media-player.js",
  "hero-media-player-preview.js",
  "notifications.js",
  "profiles.js",
  "profile.js",
  "emojis.js",
  "faces.js",
  "gestures.js",
  "food.js",
  "nature.js",
  "places.js",
  "activities.js",
  "objects.js",
  "hero-media-player-actions.js",
  "messenger-realtime.js",
  "keyboard-bindings-v3.js",
  "notification-keyboard-integration.js",
  "site.webmanifest",
  "service-worker.js",
  "banned_foul_language.txt",
  "questions-guide.css",
  "contact.html",
  "how-to-guide.html",
  "security.html",
  "hero-player-deepdive.html",
  "llm-deepdive.html",
  "llm-deepdive-2.html",
  "snake-game.html",
  "Calculator.html",
  "apple-touch-icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon.svg",
  "profile_avatar.png",
  "cordova.js",
  "cordova_plugins.js"
)

$directories = @(
  "icons"
)

if (Test-Path -LiteralPath $dist) {
  Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Path $dist | Out-Null

Write-Host "--- Copying Files ---"
foreach ($file in $files) {
  $src = Join-Path $root $file
  $dest = Join-Path $dist $file
  if (Test-Path -LiteralPath $src) {
    Copy-Item -Path $src -Destination $dest -Force
    Write-Host "[File] $file"
  } else {
    Write-Warning "File missing: $file"
  }
}

Write-Host "`n--- Copying Directories ---"
foreach ($directory in $directories) {
  $src = Join-Path $root $directory
  $dest = Join-Path $dist $directory
  if (Test-Path -LiteralPath $src) {
    # Ensure the destination parent exists
    Copy-Item -Path $src -Destination $dist -Recurse -Force
    Write-Host "[Dir]  $directory"
  } else {
    Write-Warning "Directory missing: $directory"
  }
}

Write-Host "`nReady for Capacitor Sync."
