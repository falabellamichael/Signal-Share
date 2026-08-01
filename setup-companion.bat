@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Signal Share Companion Setup
color 0B

echo.
echo  ========================================================
echo    SIGNAL SHARE COMPANION
echo    One-click AI and Windows media bridge setup
echo  ========================================================
echo.
echo  This installs under your Windows user profile, preserves
echo  existing settings, starts the bridge, verifies it, and
echo  securely pairs the Signal Share website. No admin needed.
echo.

set "SS_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%SS_POWERSHELL%" (
  color 0C
  echo  [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

set "SS_RUNTIME_BASE=https://falabellamichael.github.io/Signal-Share/companion-runtime"
if defined SIGNAL_SHARE_COMPANION_RUNTIME_BASE_URL set "SS_RUNTIME_BASE=%SIGNAL_SHARE_COMPANION_RUNTIME_BASE_URL%"
set "SS_SITE_URL=https://falabellamichael.github.io/Signal-Share/"
if defined SIGNAL_SHARE_SITE_URL set "SS_SITE_URL=%SIGNAL_SHARE_SITE_URL%"
set "SS_SETUP_FILE=%TEMP%\SignalShareCompanionSetup-%RANDOM%-%RANDOM%.ps1"

echo  [1/2] Downloading the current companion installer...
"%SS_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%SS_RUNTIME_BASE%/setup.ps1' -OutFile '%SS_SETUP_FILE%'"
if errorlevel 1 (
  color 0C
  echo.
  echo  [ERROR] Setup could not be downloaded from the official site.
  echo  Check your internet connection and try again.
  if exist "%SS_SETUP_FILE%" del /q "%SS_SETUP_FILE%" >nul 2>&1
  pause
  exit /b 1
)

echo  [2/2] Installing, starting, and pairing the companion...
"%SS_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SS_SETUP_FILE%" -RuntimeBaseUrl "%SS_RUNTIME_BASE%" -SiteUrl "%SS_SITE_URL%"
set "SS_EXIT=%ERRORLEVEL%"
del /q "%SS_SETUP_FILE%" >nul 2>&1

if not "%SS_EXIT%"=="0" (
  color 0C
  echo.
  echo  Setup did not complete. Review the error above, then try again.
  pause
  exit /b %SS_EXIT%
)

color 0A
echo.
echo  Setup is complete. Signal Share has opened in your browser.
timeout /t 8 /nobreak >nul
exit /b 0
