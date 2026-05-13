$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$dist = Join-Path $root "dist"

# List of specific files to copy to dist
$files = @(
  # Core Web UI
  "index.html",
  "terms.html",
  "privacy.html",
  "contact.html",
  "how-to-guide.html",
  "security.html",
  "styles.css",
  "styles-1.css",
  "styles-2.css",
  "styles-3.css",
  "notifications.css",
  "questions-guide.css",
  "android-optimizations.css",
  "favicon.ico",
  
  # Core Logic
  "config.js",
  "api-v3.js",
  "app-v3.js",
  "app-v3-ui.js",
  "app-v3-ai.js",
  "shared-utils.js",
  "notifications.js",
  "profiles.js",
  "profile.js",
  "service-worker.js",
  "site.webmanifest",
  "banned_foul_language.txt",
  
  # Arcade & AI Companion
  "arcade-api.js",
  "arcade-chat.js",
  "arcade-chat.css",
  "arcade-chatbot-engine.js",
  "arcade-chat-prompts.js",
  "companion-ai-core.js",
  "mini-games.html",
  "mini-games.js",
  "leaderboard-metrics.js",
  
  # Media Player Suite
  "hero-media-player.js",
  "hero-media-player-preview.js",
  "hero-media-player-actions.js",
  "messenger-realtime.js",
  "keyboard-bindings-v3.js",
  "notification-keyboard-integration.js",
  "hero-player-deepdive.html",
  
  # Deep Dives & Docs
  "llm-deepdive.html",
  "llm-deepdive-2.html",
  "llm-integration-bridge.html",
  "llm-tools-context.html",
  
  # Asset Modules (Emojis/Data)
  "emojis.js",
  "faces.js",
  "gestures.js",
  "food.js",
  "nature.js",
  "places.js",
  "activities.js",
  "objects.js",
  
  # Mini Games & Utilities
  "snake-game.html",
  "gameLogic.js",
  "basketball-game.html",
  "basketball-game-v2.js",
  "pinball-game.html",
  "pinball-game-v2.js",
  "sudoku-game.html",
  "sudoku-game.js",
  "Calculator.html",
  
  # Posters & Assets
  "snake_game_poster_1778466261855.png",
  "calculator_tool_poster_1778466276736.png",
  "basketball_game_poster.png",
  "neon_pinball_v2_poster.png",
  "pinball_poster_1778481948543.png",
  "neon_sudoku_poster.png",
  
  # System Icons & Avatars
  "apple-touch-icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon.svg",
  "profile_avatar.png",
  
  # Capacitor Requirements
  "cordova_plugins.js"
)

# Optional files that may not exist in every workspace/environment
$optionalFiles = @(
  "cordova.js"
)

$directories = @(
  "icons"
)

# Clean and recreate dist
if (Test-Path -LiteralPath $dist) {
  Write-Host "Cleaning existing dist directory..." -ForegroundColor Gray
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

Write-Host "`n--- Copying Optional Files ---" -ForegroundColor DarkCyan
foreach ($file in $optionalFiles) {
  $src = Join-Path $root $file
  $dest = Join-Path $dist $file
  if (Test-Path -LiteralPath $src) {
    Copy-Item -Path $src -Destination $dest -Force
    Write-Host "[Optional] $file"
  } else {
    Write-Host "[Optional missing] $file" -ForegroundColor DarkGray
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

Write-Host "`n--- Verifying Critical Dist Files ---" -ForegroundColor DarkCyan
$criticalDistFiles = @(
  "index.html",
  "mini-games.html",
  "app-v3.js",
  "arcade-chat.js",
  "companion-ai-core.js",
  "hero-media-player.js"
)

foreach ($file in $criticalDistFiles) {
  $target = Join-Path $dist $file
  if (Test-Path -LiteralPath $target) {
    Write-Host "[OK] $file"
  } else {
    throw "Missing critical dist file: $file"
  }
}

Write-Host "`n--- Syncing with Capacitor ---" -ForegroundColor Green
Set-Location -Path $root
# Use sync instead of copy to ensure plugins and project structure are updated
npx cap sync android

Write-Host "`nSync Complete! Ready to build in Android Studio." -ForegroundColor White
