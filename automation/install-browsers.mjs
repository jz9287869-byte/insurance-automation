import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const playwrightCli = path.join(projectRoot, "node_modules", "playwright", "cli.js");
const installRoot = resolveInstallRoot();

const mirrors = [
  "",
  "https://playwright.azureedge.net",
  "https://playwright-akamai.azureedge.net",
  "https://playwright-verizon.azureedge.net",
];

await fs.mkdir(installRoot, { recursive: true }).catch(() => {});

for (const host of mirrors) {
  if (await isInstalled()) {
    process.stdout.write(`Chromium 已可用：${await resolveExecutablePath()}\n`);
    process.exit(0);
  }

  const env = { ...process.env };
  if (host) {
    env.PLAYWRIGHT_DOWNLOAD_HOST = host;
  } else {
    delete env.PLAYWRIGHT_DOWNLOAD_HOST;
  }
  env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT || "120000";

  const label = host || "default";
  process.stdout.write(`尝试安装 Chromium，下载源：${label}\n`);
  const code = await runInstaller(env);
  if (code === 0 && (await isInstalled())) {
    process.stdout.write(`Chromium 安装完成：${await resolveExecutablePath()}\n`);
    process.exit(0);
  }
}

process.stderr.write("Chromium 安装失败，请检查网络后重试。\n");
process.exit(1);

async function isInstalled() {
  try {
    await fs.access(await resolveExecutablePath());
    return true;
  } catch {
    return false;
  }
}

function runInstaller(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, "install", "chromium"], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function resolveInstallRoot() {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (configured && configured !== "0") {
    return path.resolve(projectRoot, configured);
  }
  return path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
}

async function resolveExecutablePath() {
  try {
    const playwright = await import("playwright");
    return playwright.chromium.executablePath();
  } catch {
    return path.join(installRoot, "chromium-1223", "chrome-win64", "chrome.exe");
  }
}
