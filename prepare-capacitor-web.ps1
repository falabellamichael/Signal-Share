$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$dist = Join-Path $root "dist"

# List of specific files to copy to dist
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
  "shared-utils.js",
  "arcade-api.js",
  "arcade-chat.js",
  "arcade-chat.css",
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
  "llm-integration-bridge.html",
  "llm-tools-context.html",
  "mini-games.html",
  "mini-games.js",
  "leaderboard-metrics.js",
  "android-optimizations.css",
  "snake-game.html",
  "gameLogic.js",
  "Calculator.html",
  "basketball-game.html",
  "basketball-game-v2.js",
  "pinball-game.html",
  "pinball-game-v2.js",
  "snake_game_poster_1778466261855.png",
  "calculator_tool_poster_1778466276736.png",
  "basketball_game_poster.png",
  "neon_pinball_v2_poster.png",
  "pinball_poster_1778481948543.png",
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

# Clean and recreate dist
if (Test-Path -LiteralPath $dist) {
  Remove-Item -LiteralPath $dist -Recurse -Force
}
New-Item -ItemType Directory -Path $dist | Out-Null

Write-Host "--- Copying Files ---" -ForegroundColor Cyan
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

Write-Host "`n--- Syncing with Capacitor ---" -ForegroundColor Green
Set-Location -Path $root
npx cap copy android

Write-Host "`nSync Complete! Ready to build in Android Studio." -ForegroundColor White
