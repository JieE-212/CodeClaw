@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-codeclaw.ps1" %*
set "CODECLAW_EXIT=%ERRORLEVEL%"
if errorlevel 1 (
  echo.
  echo CodeClaw failed to start. Review the bounded diagnostic summary above.
  pause
)
exit /b %CODECLAW_EXIT%
