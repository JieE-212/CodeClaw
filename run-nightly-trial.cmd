@echo off
setlocal
cd /d "%~dp0"
echo Starting CodeClaw nightly trial.
echo Default duration: 2.5 hours.
echo Reports: dist\nightly-trial\YYYYMMDD-HHMMSS\summary.md
echo.
npm.cmd run nightly:trial
set EXIT_CODE=%ERRORLEVEL%
echo.
if "%EXIT_CODE%"=="0" (
  echo Nightly trial finished successfully.
) else (
  echo Nightly trial failed with exit code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
