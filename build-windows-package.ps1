$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $projectRoot "dist"
$packageRoot = Join-Path $distRoot "insurance-automation-windows"

if (Test-Path $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $packageRoot | Out-Null

$include = @(
  "index.html",
  "app.js",
  "styles.css",
  "package.json",
  "package-lock.json",
  "README.md",
  ".gitignore",
  "one-click-start.cmd",
  "ensure-config.cmd",
  "install-deps.cmd",
  "install-browsers.cmd",
  "open-config.cmd",
  "start-bridge.cmd",
  "dry-run.cmd",
  "run-auto-export.cmd",
  "run-local-excel.cmd",
  "automation",
  "node_modules"
)

foreach ($item in $include) {
  $source = Join-Path $projectRoot $item
  if (-not (Test-Path $source)) { continue }
  $target = Join-Path $packageRoot $item
  if ((Get-Item $source) -is [System.IO.DirectoryInfo]) {
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
  } else {
    $parent = Split-Path -Parent $target
    if ($parent -and -not (Test-Path $parent)) {
      New-Item -ItemType Directory -Path $parent | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

$cleanup = @(
  "automation\.browser-profile",
  "automation\.browser-profile-diagnose",
  "automation\downloads",
  "automation\logs",
  "automation\outputs",
  "automation\status.json",
  "automation\config.json",
  "automation\clean_data.py"
)

foreach ($item in $cleanup) {
  $target = Join-Path $packageRoot $item
  if (Test-Path $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

$localBrowsers = Join-Path $env:LOCALAPPDATA "ms-playwright"
$bundledBrowsers = Join-Path $packageRoot "ms-playwright"
if (Test-Path $localBrowsers) {
  Copy-Item -LiteralPath $localBrowsers -Destination $bundledBrowsers -Recurse -Force
  $browserCleanup = @(
    "__dirlock",
    ".links"
  )
  foreach ($item in $browserCleanup) {
    $target = Join-Path $bundledBrowsers $item
    if (Test-Path $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
}

$zipPath = Join-Path $distRoot "insurance-automation-windows.zip"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force
Write-Output "Package created: $zipPath"
