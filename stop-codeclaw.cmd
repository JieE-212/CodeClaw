@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-codeclaw.ps1" %*
set "CODECLAW_EXIT=%ERRORLEVEL%"
if errorlevel 1 (
  echo.
  echo CodeClaw could not verify and stop this candidate. Review the message above.
  pause
)
exit /b %CODECLAW_EXIT%
