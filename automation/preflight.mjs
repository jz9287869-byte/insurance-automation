import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));

const configPath = path.resolve(projectRoot, args.config || "automation/config.json");
const downloadDir = path.resolve(projectRoot, args.downloads || "automation/downloads");
const outputDir = path.resolve(projectRoot, args["output-dir"] || "automation/outputs");
const profileDir = path.resolve(projectRoot, args.profile || "automation/.browser-profile");

const checks = [];
const errors = [];

await checkNodeVersion();
const config = await checkConfigFile();
await checkWritableDir(downloadDir, "下载目录");
await checkWritableDir(outputDir, "输出目录");
await checkWritableDir(profileDir, "浏览器 profile 目录");
await checkPlaywrightChromium();

if (config) {
  validateConfigShape(config);
  validateTasks(config);
}

if (args.orders || args.routes) {
  await checkReadableFile(args.orders, "订单列表");
  await checkReadableFile(args.routes, "销转表");
}

const ok = errors.length === 0;
process.stdout.write(
  JSON.stringify(
    {
      ok,
      configPath,
      checks,
      errors,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

async function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) {
    checks.push({ name: "Node.js", ok: true, detail: `当前版本 ${process.versions.node}` });
    return;
  }
  errors.push(`Node.js 版本过低：${process.versions.node}，需要 18+`);
  checks.push({ name: "Node.js", ok: false, detail: `当前版本 ${process.versions.node}` });
}

async function checkConfigFile() {
  try {
    const text = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(text);
    checks.push({ name: "配置文件", ok: true, detail: `已读取 ${configPath}` });
    return config;
  } catch (error) {
    errors.push(`配置文件不可用：${error.message}`);
    checks.push({ name: "配置文件", ok: false, detail: error.message });
    return null;
  }
}

function validateConfigShape(config) {
  if (!config.platforms?.admin?.url || !config.platforms?.insurance?.url) {
    errors.push("配置缺少 platforms.admin.url 或 platforms.insurance.url");
    checks.push({ name: "平台地址", ok: false, detail: "后台或保险平台地址缺失" });
  } else {
    checks.push({ name: "平台地址", ok: true, detail: "后台与保险平台地址已配置" });
  }

  if (!Array.isArray(config.tasks) || !Array.isArray(config.routes) || !Array.isArray(config.companies)) {
    errors.push("配置必须包含 tasks、routes、companies 三个数组");
    checks.push({ name: "配置结构", ok: false, detail: "tasks/routes/companies 结构不完整" });
    return;
  }

  checks.push({ name: "配置结构", ok: true, detail: "tasks/routes/companies 结构完整" });
}

function validateTasks(config) {
  const enabledTasks = config.tasks.filter((item) => item.enabled);
  if (!enabledTasks.length) {
    errors.push("本次执行表没有勾选任何路线");
    checks.push({ name: "执行任务", ok: false, detail: "没有启用任务" });
    return;
  }

  const unmatched = enabledTasks.filter((task) => !findRouteConfig(config.routes, task.routeName));
  if (unmatched.length) {
    errors.push(`存在 ${unmatched.length} 条任务无法匹配路线库`);
    checks.push({ name: "路线匹配", ok: false, detail: `${unmatched.length} 条任务未匹配` });
  } else {
    checks.push({ name: "路线匹配", ok: true, detail: `${enabledTasks.length} 条任务已匹配路线库` });
  }

  const missingCompanies = config.routes.filter((route) => {
    return route.enabled && route.companyCode && !config.companies.some((company) => company.code === route.companyCode);
  });
  if (missingCompanies.length) {
    errors.push(`存在 ${missingCompanies.length} 条路线缺少公司主体映射`);
    checks.push({ name: "公司主体", ok: false, detail: `${missingCompanies.length} 条路线缺少主体` });
  } else {
    checks.push({ name: "公司主体", ok: true, detail: "路线库主体映射完整" });
  }
}

async function checkWritableDir(dirPath, label) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    const probePath = path.join(dirPath, ".write-test");
    await fs.writeFile(probePath, "ok", "utf8");
    await fs.rm(probePath, { force: true });
    checks.push({ name: label, ok: true, detail: dirPath });
  } catch (error) {
    errors.push(`${label}不可写：${error.message}`);
    checks.push({ name: label, ok: false, detail: error.message });
  }
}

async function checkReadableFile(filePath, label) {
  if (!filePath) {
    errors.push(`${label}路径未填写`);
    checks.push({ name: label, ok: false, detail: "未提供路径" });
    return;
  }
  try {
    await fs.access(path.resolve(projectRoot, filePath));
    checks.push({ name: label, ok: true, detail: path.resolve(projectRoot, filePath) });
  } catch (error) {
    errors.push(`${label}不可读：${path.resolve(projectRoot, filePath)} (${error.message})`);
    checks.push({ name: label, ok: false, detail: error.message });
  }
}

async function checkPlaywrightChromium() {
  try {
    const playwright = await import("playwright");
    const executablePath = playwright.chromium.executablePath();
    if (!executablePath) {
      throw new Error("未检测到 Chromium 可执行文件");
    }
    await fs.access(executablePath);
    checks.push({ name: "Playwright Chromium", ok: true, detail: executablePath });
  } catch (error) {
    errors.push(`Playwright Chromium 不可用：${error.message}`);
    checks.push({ name: "Playwright Chromium", ok: false, detail: error.message });
  }
}

function findRouteConfig(routes, routeName) {
  const target = normalize(routeName);
  return routes.find((route) => {
    if (!route.enabled) return false;
    if (normalize(route.routeName) === target) return true;
    const keywords = String(route.keywords || "")
      .split(/[,，、]/)
      .map(normalize)
      .filter(Boolean);
    return keywords.length > 0 && keywords.every((keyword) => target.includes(keyword));
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? next : "true";
    if (parsed[key] === next) index += 1;
  }
  return parsed;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
