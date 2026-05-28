@echo off
setlocal
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0ms-playwright"
call ensure-config.cmd
if errorlevel 1 exit /b 1
echo Starting local bridge on http://localhost:17820
node automation\server.mjs
