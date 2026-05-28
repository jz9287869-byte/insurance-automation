import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  exportOrderList,
  exportSalesTable,
  fillInsuranceProposal,
  loadPayloads,
  openAndLogin,
  takeFailureSnapshot,
} from "./browser-actions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(projectRoot, args.config || "automation/config.json");
const profileDir = path.resolve(projectRoot, args.profile || "automation/.browser-profile");
const downloadDir = path.resolve(projectRoot, args.downloads || "automation/downloads");
const outputDir = path.resolve(projectRoot, args["output-dir"] || "automation/outputs");
const statusPath = path.resolve(projectRoot, "automation/status.json");
const headless = args.headless === "true";
const skipAdmin = args["skip-admin"] === "true";

await fs.mkdir(downloadDir, { recursive: true });
await fs.mkdir(profileDir, { recursive: true });
await prepareChromiumProfile(profileDir);

const config = await loadConfig(configPath);
const adminPreferredUrl = new URL("#/admin/orderManage", config.platforms.admin.url).href;
config.platforms.admin.preferredUrl = adminPreferredUrl;
const plan = buildRunPlan(config);

console.log(`读取配置：${configPath}`);
console.log(`本次执行路线：${plan.tasks.length} 条`);
await writeStatus({ phase: "starting", message: "执行器已启动", tasks: plan.tasks.map((item) => item.task) });
plan.tasks.forEach((item, index) => {
  console.log(
    `${index + 1}. ${item.task.routeName} / ${item.task.packageName} / ${item.task.startDate} -> ${item.route.insurer} / ${item.route.product}`,
  );
});

if (args["dry-run"] === "true") {
  console.log("预检通过。");
  process.exit(0);
}

if (args.orders && args.routes) {
  await runCleanData(args.orders, args.routes, configPath, outputDir);
}

const { chromium } = await importPlaywright();
const context = await chromium.launchPersistentContext(profileDir, {
  acceptDownloads: true,
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=PasswordLeakDetection,PasswordCheck,PasswordManagerOnboarding,ImprovedPasswordChangeService,Translate,TranslateUI,ImprovedTranslate",
  ],
  downloadsPath: downloadDir,
  headless,
  viewport: { width: 1440, height: 950 },
});

let failed = false;
try {
  const exportedFiles = [];
  if (!skipAdmin) {
    const adminPage = await context.newPage();
    await writeStatus({ phase: "admin_login", message: "正在登录后台管理系统" });
    await openAndLogin(adminPage, config.platforms.admin, "后台管理系统");

    if (args.export === "true") {
      for (const item of plan.tasks) {
        await writeStatus({
          phase: "export_orders",
          message: `正在导出订单列表：${item.task.routeName} ${item.task.startDate}`,
          currentTask: item.task,
        });
        const orders = await exportOrderList(adminPage, item.task, downloadDir, config.platforms.admin);
        await writeStatus({
          phase: "export_routes",
          message: `正在导出销转表：${item.task.routeName} ${item.task.startDate}`,
          currentTask: item.task,
          orders,
        });
        const routes = await exportSalesTable(adminPage, item.task, downloadDir, config.platforms.admin);
        exportedFiles.push({ task: item.task, orders, routes });
      }
    } else {
      console.log("后台管理系统已打开。传入 --export true 后会执行订单列表和销转表导出。");
    }
  } else {
    console.log("已按参数跳过后台管理系统，直接进入保险平台验证。");
  }

  let summaryPath = args.summary ? path.resolve(projectRoot, args.summary) : "";
  if (!summaryPath && args.orders && args.routes) {
    await writeStatus({ phase: "cleaning", message: "正在清洗本地 Excel 数据" });
    summaryPath = await runCleanData(args.orders, args.routes, configPath, outputDir);
  }
  if (!summaryPath && exportedFiles.length > 0) {
    const latest = exportedFiles.at(-1);
    await writeStatus({ phase: "cleaning", message: "正在清洗导出的订单和销转表", currentTask: latest.task });
    summaryPath = await runCleanData(latest.orders, latest.routes, configPath, outputDir);
  }

  const insurancePage = await context.newPage();
  await writeStatus({ phase: "insurance_login", message: "正在登录保险平台", summaryPath });
  await openAndLogin(insurancePage, config.platforms.insurance, "保险平台");

  if (summaryPath) {
    const payloads = await loadPayloads(summaryPath);
    for (const payload of payloads) {
      await writeStatus({
        phase: "insurance_fill",
        message: `正在填写保险平台：${payload.task.routeName} ${payload.task.startDate}`,
        currentTask: payload.task,
        summaryPath,
      });
      const company = config.companies.find((item) => item.code === payload.insurance.companyCode);
      await fillInsuranceProposal(insurancePage, payload, company, {
        confirmMode: payload.task.confirmMode,
        payMode: payload.task.payMode,
      });
    }
  } else {
    console.log("保险平台已打开。传入 --summary automation/outputs/summary.json 后会填写投保信息。");
  }

  console.log("执行完成。浏览器会保持打开，方便核对结果。");
  await writeStatus({ phase: "completed", message: "执行完成", summaryPath });

  await waitForClose(context);
} catch (error) {
  failed = true;
  console.error(`执行失败：${error.message}`);
  await takeFailureSnapshot(context, outputDir).catch(() => {});
  await writeStatus({ phase: "failed", message: error.message, outputDir });
  console.error("浏览器已保持打开，请查看当前页面定位问题。修复脚本后可重新点击开始执行。");
  await waitForClose(context);
} finally {
  if (!failed && args["close-on-success"] === "true") {
    await context.close().catch(() => {});
  }
}

async function loadConfig(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const config = JSON.parse(text);

  if (!config.platforms?.admin?.url || !config.platforms?.insurance?.url) {
    throw new Error("配置缺少 platforms.admin.url 或 platforms.insurance.url");
  }
  if (!Array.isArray(config.tasks) || !Array.isArray(config.routes) || !Array.isArray(config.companies)) {
    throw new Error("配置必须包含 tasks、routes、companies 三个数组");
  }

  return config;
}

function buildRunPlan(config) {
  const tasks = config.tasks
    .filter((task) => task.enabled)
    .map((task) => {
      const route = findRouteConfig(config.routes, task);
      if (!route) {
        throw new Error(`执行路线未匹配总路线配置：${task.routeName}`);
      }
      return { task, route };
    });

  if (!tasks.length) {
    throw new Error("本次执行表没有勾选任何路线");
  }

  return { tasks };
}

function findRouteConfig(routes, task) {
  const routeName = normalize(task.routeName);
  return routes.find((route) => {
    if (!route.enabled) return false;
    if (normalize(route.routeName) === routeName) return true;

    const keywords = String(route.keywords || "")
      .split(/[,，、/]/)
      .map(normalize)
      .filter(Boolean);
    return keywords.length > 0 && keywords.every((keyword) => routeName.includes(keyword));
  });
}

async function waitForClose(context) {
  while (context.pages().length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
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

async function runCleanData(orders, routes, config, outDir) {
  console.log("开始清洗订单列表和销转表。");
  const script = path.join(__dirname, "clean-data.mjs");
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    script,
    "--orders",
    path.resolve(projectRoot, orders),
    "--routes",
    path.resolve(projectRoot, routes),
    "--config",
    config,
    "--output-dir",
    outDir,
  ]);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  const match = stdout.match(/"summary":\s*"([^"]+)"/);
  return match ? match[1] : path.join(outDir, "summary.json");
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error("未安装 Playwright。请先运行：npm install，然后运行：npm run install-browsers");
  }
}

async function writeStatus(status) {
  const payload = {
    updatedAt: new Date().toISOString(),
    ...status,
  };
  await fs.writeFile(statusPath, JSON.stringify(payload, null, 2), "utf8");
}

async function prepareChromiumProfile(profileDirPath) {
  const defaultDir = path.join(profileDirPath, "Default");
  await fs.mkdir(defaultDir, { recursive: true });

  await Promise.all([
    removeIfExists(path.join(defaultDir, "Login Data")),
    removeIfExists(path.join(defaultDir, "Login Data For Account")),
    removeIfExists(path.join(defaultDir, "Login Data-journal")),
    removeIfExists(path.join(profileDirPath, "SingletonLock")),
    removeIfExists(path.join(profileDirPath, "SingletonSocket")),
  ]);

  await patchJsonFile(path.join(defaultDir, "Preferences"), (prefs) => {
    prefs.credentials_enable_service = false;
    prefs.profile = prefs.profile || {};
    prefs.profile.password_manager_enabled = false;
    prefs.profile.password_manager_leak_detection = false;
    prefs.translate = prefs.translate || {};
    prefs.translate.enabled = false;
    prefs.translate_offer_enabled = false;
    prefs.enable_translate = false;
    prefs.profile.default_content_setting_values = prefs.profile.default_content_setting_values || {};
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    prefs.autofill = prefs.autofill || {};
    prefs.autofill.enabled = false;
    return prefs;
  });

  await patchJsonFile(path.join(profileDirPath, "Local State"), (state) => {
    state.profile = state.profile || {};
    state.profile.exit_type = "Normal";
    state.profile.exited_cleanly = true;
    return state;
  });
}

async function patchJsonFile(filePath, updater) {
  let json = {};
  try {
    json = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {}
  const next = updater(json) || json;
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { force: true }).catch(() => {});
}
