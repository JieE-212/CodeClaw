@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-codeclaw.ps1"
if errorlevel 1 (
  echo.
  echo CodeClaw failed to start. See the message above.
  pause
)
