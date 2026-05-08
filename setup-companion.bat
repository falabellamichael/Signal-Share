@echo off
setlocal
echo Signal Share Companion Setup
echo ============================
echo.

:: Check for Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install it from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/2] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo [2/2] Starting the bridge...
echo.
echo ========================================================
echo SUCCESS! The companion bridge is starting.
echo Keep this window open while using the Media Player.
echo ========================================================
echo.
npm start

pause
