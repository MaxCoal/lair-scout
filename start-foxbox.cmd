@echo off
setlocal
title FoxBox
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

if not exist "package.json" (
  echo FoxBox files were not found in:
  echo   %CD%
  pause
  exit /b 1
)

echo Starting FoxBox from %CD%
echo Close this window to stop FoxBox.
echo.
call npm run dev
if errorlevel 1 (
  echo.
  echo FoxBox failed to start.
  pause
)
