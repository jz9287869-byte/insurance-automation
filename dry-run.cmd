@echo off
setlocal
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0ms-playwright"
call ensure-config.cmd
if errorlevel 1 exit /b 1
node automation\preflight.mjs --config automation\config.json
if errorlevel 1 exit /b 1
node automation\run.mjs --config automation\config.json --dry-run true
