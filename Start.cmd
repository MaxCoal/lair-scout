@echo off
setlocal
title Lair Scout
cd /d "%~dp0"

:: ── find Node ────────────────────────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo Lair Scout needs Node.js to run.
  echo Download it free from https://nodejs.org  ^(LTS version^)
  echo then double-click Start.cmd again.
  echo.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo Could not find package.json in:
  echo   %CD%
  echo Make sure Start.cmd is inside the Lair Scout folder.
  echo.
  pause
  exit /b 1
)

:: ── install on first run or after a pull ─────────────────────────────────────
if not exist "node_modules\.bin\electron-vite.cmd" (
  echo Installing packages ^(first run or after an update^)...
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo npm install failed. Check the error above.
    pause
    exit /b 1
  )
  echo.
)

:: ── launch ───────────────────────────────────────────────────────────────────
echo Starting Lair Scout...
echo Close this window ^(or use the × button in the app^) to stop.
echo.
call npm run dev
if %ERRORLEVEL% neq 0 (
  echo.
  echo Lair Scout stopped unexpectedly. Check the output above.
  pause
)
