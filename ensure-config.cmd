@echo off
setlocal
cd /d "%~dp0"
if exist automation\config.json exit /b 0
if exist automation\config.sample.json (
  copy /y automation\config.sample.json automation\config.json >nul
  echo [INFO] Created automation\config.json from config.sample.json
  exit /b 0
)
echo [ERROR] Missing automation\config.sample.json
exit /b 1
