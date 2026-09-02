@echo off
setlocal
title Lair Scout
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

if not exist "package.json" (
  echo Lair Scout files were not found in:
  echo   %CD%
  pause
  exit /b 1
)

echo Starting Lair Scout from %CD%
echo Close this window to stop Lair Scout.
echo.
call npm run dev
if errorlevel 1 (
  echo.
  echo Lair Scout failed to start.
  pause
)
