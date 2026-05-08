@echo off
setlocal
title Signal Share Companion Setup

:: Color 0B is Aqua on Black, looks modern
color 0B

echo.
echo  --------------------------------------------------------
echo    SIGNAL SHARE COMPANION
echo    Desktop Media Bridge Setup
echo  --------------------------------------------------------
echo.
echo  This tool will prepare your PC to sync YouTube, Spotify,
echo  and other system media with the Signal Share player.
echo.

:: Check for Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [!] ERROR: Node.js was not found.
    echo.
    echo  The companion requires Node.js to run. 
    echo  Please download it from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo  [STEP 1] Installing core components...
echo  (This may take a minute on the first run)
echo.
call npm install --no-audit --no-fund --quiet
if %errorlevel% neq 0 (
    color 0C
    echo  [!] ERROR: Failed to install components.
    echo  Check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

echo.
echo  [STEP 2] Launching the Media Bridge...
echo.
echo  --------------------------------------------------------
echo    SUCCESS! The bridge is now active.
echo.
echo    WHAT IS HAPPENING?
echo    We are running 'npm start', which triggers a local
echo    web server on your PC. This server securely bridges
echo    the Signal Share website to your Windows media keys.
echo.
echo    IMPORTANT: Keep this window open!
echo    If you close it, the Media Player won't be able
echo    to control your PC playback.
echo  --------------------------------------------------------
echo.

:: Run the bridge
npm start

echo.
echo  The bridge has stopped.
pause
