@echo off
setlocal
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0ms-playwright"
call ensure-config.cmd
if errorlevel 1 (
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 18+ is required. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules\playwright\package.json (
  echo [STEP] Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [STEP] Ensuring Playwright Chromium is installed...
node automation\install-browsers.mjs
if errorlevel 1 (
  echo [ERROR] Chromium installation failed.
  pause
  exit /b 1
)

echo [STEP] Starting local bridge...
start "Insurance Automation Bridge" cmd /c "cd /d %~dp0 && set PLAYWRIGHT_BROWSERS_PATH=%PLAYWRIGHT_BROWSERS_PATH% && node automation\server.mjs"

timeout /t 3 /nobreak >nul

echo [STEP] Opening local configuration page...
start "" "%cd%\index.html"

echo [DONE] The local product is ready. Keep the bridge window open while running automation.
exit /b 0
