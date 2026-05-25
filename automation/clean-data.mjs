import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const args = parseArgs(process.argv.slice(2));

if (!args.orders || !args.routes || !args.config) {
  console.error("用法：node automation/clean-data.mjs --orders 订单列表.xlsx --routes 销转表.xlsx --config automation/config.json");
  process.exit(1);
}

const outputDir = path.resolve(args["output-dir"] || "automation/outputs");
await fs.mkdir(outputDir, { recursive: true });

const config = JSON.parse(await fs.readFile(path.resolve(args.config), "utf8"));
const orderRows = readSheetRows(args.orders);
const routeRows = readRouteExport(args.routes);
const results = [];

for (const task of config.tasks.filter((item) => item.enabled)) {
  const routeConfig = findRouteConfig(config.routes, task.routeName);
  if (!routeConfig) {
    throw new Error(`未匹配总路线配置：${task.routeName}`);
  }

  const taskOrders = filterOrders(orderRows, task);
  if (taskOrders.length === 0) {
    results.push({ task, status: "empty", message: "没有有效已付款旅客" });
    continue;
  }

  const routeInfo = matchRouteInfo(routeRows, taskOrders, task);
  const payload = buildInsurancePayload(task, routeConfig, routeInfo, taskOrders);
  const baseName = safeFilename(`${task.routeName}_${task.startDate}`);
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const txtPath = path.join(outputDir, `${baseName}_粘贴名单.txt`);

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(txtPath, payload.pasteList, "utf8");
  results.push({
    task,
    status: "ok",
    travelerCount: payload.travelers.length,
    json: jsonPath,
    pasteList: txtPath,
  });
}

const summaryPath = path.join(outputDir, "summary.json");
await fs.writeFile(summaryPath, JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify({ summary: summaryPath, results }, null, 2));

function readSheetRows(filePath) {
  const workbook = XLSX.readFile(path.resolve(filePath), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function readRouteExport(filePath) {
  const workbook = XLSX.readFile(path.resolve(filePath), { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  if (matrix.length < 2) throw new Error("销转表格式异常：少于两行表头");
  const headers = matrix[1].map((value) => String(value || "").trim());
  return matrix.slice(2).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? "";
    });
    return item;
  });
}

function filterOrders(rows, task) {
  const routeName = normalize(task.routeName);
  const packageName = normalize(task.packageName);
  const startDate = normalize(task.startDate);
  const seen = new Set();

  return rows.filter((row) => {
    if (row["订单状态"] !== "已付款") return false;
    if (row["参团状态"] !== "有效") return false;
    if (!String(row["旅客姓名"] || "").trim()) return false;
    if (!String(row["旅客证件号码"] || "").trim()) return false;
    if (normalize(row["路线"]) !== routeName) return false;
    if (!normalize(row["出行时间"]).startsWith(startDate)) return false;
    if (packageName && normalize(row["套餐"]) !== packageName) return false;

    const idNumber = String(row["旅客证件号码"]).trim();
    if (seen.has(idNumber)) return false;
    seen.add(idNumber);
    return true;
  });
}

function matchRouteInfo(routeRows, orders, task) {
  const packageIds = new Set(orders.map((row) => String(row["套餐编号"] || "").trim()).filter(Boolean));
  let match = routeRows.find((row) => packageIds.has(String(row["套餐编号"] || "").trim()));
  if (match) return match;

  const routeName = normalize(task.routeName);
  const startDate = normalize(task.startDate).replaceAll("-", "/");
  match = routeRows.find((row) => {
    return normalize(row["路线名称"]).includes(routeName) && normalize(row["开始时间"]).startsWith(startDate);
  });
  return match || {};
}

function buildInsurancePayload(task, routeConfig, routeInfo, orders) {
  const startDate = parseDate(task.startDate);
  const endDate = parseDate(task.endDate || task.startDate);
  const durationDays = Number(routeConfig.durationDays || dayDiff(startDate, endDate) + 1 || 1);
  const insuranceStart = addDays(startDate, Number(routeConfig.startOffsetDays || 0));
  const insuranceEnd = addDays(insuranceStart, durationDays - 1);
  const remark = renderTemplate(routeConfig.remarkTemplate || "{routeName} {startDate}", task, routeInfo);

  const travelers = orders.map((row) => ({
    name: String(row["旅客姓名"] || "").trim(),
    gender: String(row["旅客性别"] || "").trim(),
    idType: String(row["旅客证件类型"] || "身份证").trim(),
    idNumber: String(row["旅客证件号码"] || "").trim(),
    birthday: String(row["旅客出生日期"] || "").trim(),
  }));

  return {
    task,
    insurance: {
      category: routeConfig.category || "",
      insurer: routeConfig.insurer || "",
      product: routeConfig.product || "",
      plan: routeConfig.plan || "",
      startDate: formatDate(insuranceStart),
      startTime: routeConfig.startTime || "00:00:00",
      endDate: formatDate(insuranceEnd),
      endTime: routeConfig.endTime || "23:59:59",
      durationDays,
      remark,
      companyCode: routeConfig.companyCode || "",
    },
    routeInfo,
    travelers,
    pasteList: travelers
      .map((item) => [item.name, item.gender, item.idNumber, item.birthday].filter(Boolean).join(" "))
      .join("\n"),
  };
}

function findRouteConfig(routes, routeName) {
  const target = normalize(routeName);
  return routes.find((route) => {
    if (!route.enabled) return false;
    if (normalize(route.routeName) === target) return true;
    const keywords = String(route.keywords || "")
      .split(/[,，、/]/)
      .map(normalize)
      .filter(Boolean);
    return keywords.length > 0 && keywords.every((keyword) => target.includes(keyword));
  });
}

function renderTemplate(template, task, routeInfo) {
  const values = {
    routeName: task.routeName || "",
    packageName: task.packageName || "",
    startDate: task.startDate || "",
    endDate: task.endDate || "",
    routeFullName: routeInfo["路线名称"] || task.routeName || "",
    leader: routeInfo["队长安排"] || "",
  };
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
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

function parseDate(value) {
  const [year, month, day] = String(value).slice(0, 10).replaceAll("/", "-").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeFilename(value) {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
