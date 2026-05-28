const STORAGE_KEY = "insuranceAutomationConfig.v2";
const AUTH_KEY = "insuranceAutomationAuth.v1";
const BRIDGE_ORIGIN = "http://localhost:17820";
const CONFIG_PATH = "automation\\config.json";

const defaultConfig = {
  platforms: {
    admin: {
      url: "https://master.walking20s.com/go20/mgr/#/login",
      username: "",
      password: "",
      securityPassword: "",
    },
    insurance: {
      url: "https://9sdtb.hizom.cn/",
      username: "",
      password: "",
    },
  },
  tasks: [
    {
      enabled: true,
      routeName: "徒步东西冲",
      packageName: "深圳出发（周六）",
      startDate: "2026-06-06",
      endDate: "2026-06-06",
      confirmMode: "manual",
      payMode: "manual",
    },
  ],
  routes: [
    {
      enabled: true,
      routeName: "徒步东西冲",
      routeType: "1天短线",
      keywords: "徒步,东西冲",
      companyCode: "GZXS20",
      category: "户外徒步",
      insurer: "太平洋",
      product: "太平洋 漫游港澳台计划",
      plan: "计划一-[20万]",
      startOffsetDays: 0,
      durationDays: 1,
      remarkTemplate: "{routeName} {startDate}",
    },
  ],
  companies: [
    {
      code: "GZXS20",
      name: "广州行走贸易国际旅行社有限公司",
      taxId: "91440101MA5D5UHG6K",
    },
  ],
  execution: {
    mode: "auto-export",
    ordersPath: "",
    routesPath: "",
    headless: false,
    closeOnSuccess: false,
  },
};

let state = loadState();
let bridgeAvailable = false;
let bridgeMessage = "正在检查 localhost 桥接服务...";

const loginScreen = document.querySelector("#loginScreen");
const appShell = document.querySelector("#appShell");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const tasksBody = document.querySelector("#tasksTable tbody");
const routesBody = document.querySelector("#routesTable tbody");
const companiesBody = document.querySelector("#companiesTable tbody");
const checkList = document.querySelector("#checkList");
const toast = document.querySelector("#toast");
const runStatusText = document.querySelector("#runStatusText");
const bridgeStatusText = document.querySelector("#bridgeStatusText");
const commandPreview = document.querySelector("#commandPreview");
const preflightOutput = document.querySelector("#preflightOutput");

const executionInputs = {
  mode: document.querySelector("#executionModeInput"),
  ordersPath: document.querySelector("#ordersPathInput"),
  routesPath: document.querySelector("#routesPathInput"),
  headless: document.querySelector("#headlessInput"),
  closeOnSuccess: document.querySelector("#closeOnSuccessInput"),
};

const platformInputs = {
  admin: {
    url: document.querySelector("#adminUrlInput"),
    username: document.querySelector("#adminUsernameInput"),
    password: document.querySelector("#adminPasswordInput"),
    securityPassword: document.querySelector("#adminSecurityPasswordInput"),
  },
  insurance: {
    url: document.querySelector("#insuranceUrlInput"),
    username: document.querySelector("#insuranceUsernameInput"),
    password: document.querySelector("#insurancePasswordInput"),
  },
};

Object.values(platformInputs).forEach((group) => {
  Object.values(group).forEach((input) => input.addEventListener("input", onConfigInput));
});

Object.values(executionInputs).forEach((input) => {
  input.addEventListener("input", onConfigInput);
  input.addEventListener("change", onConfigInput);
});

document.querySelector("#saveBtn").addEventListener("click", async () => {
  syncInputsToState();
  saveState();
  const savedToBridge = await saveConfigToBridge();
  showToast(savedToBridge ? `已保存到本地配置文件 ${CONFIG_PATH}` : "已保存到浏览器本地缓存");
});

document.querySelector("#copyCommandBtn").addEventListener("click", async () => {
  syncInputsToState();
  const command = buildRunCommand();
  const copied = await copyText(command);
  showToast(copied ? "已复制推荐命令" : "复制失败，请手动复制命令");
});

document.querySelector("#runPreflightBtn").addEventListener("click", async () => {
  syncInputsToState();
  saveState();
  if (!bridgeAvailable) {
    preflightOutput.textContent = `桥接未开启，请先运行 start-bridge.cmd。\n\n推荐命令：\n${buildPreflightCommand()}`;
    showToast("桥接未开启，已生成预检命令");
    return;
  }

  try {
    preflightOutput.textContent = "正在执行预检...";
    const result = await postJson("/api/preflight", { config: state, execution: state.execution });
    preflightOutput.textContent = formatPreflightResult(result);
    showToast(result.ok ? "预检通过" : "预检未通过，请查看结果");
  } catch (error) {
    preflightOutput.textContent = `预检失败：${error.message}`;
    showToast(`预检失败：${error.message}`);
  }
});

document.querySelector("#startRunBtn").addEventListener("click", async () => {
  syncInputsToState();
  saveState();

  const issues = getBlockingIssues();
  if (issues.length) {
    showToast(`暂不能开始：${issues[0]}`);
    return;
  }

  if (!bridgeAvailable) {
    showToast("桥接未开启，已生成推荐命令。请先运行 start-bridge.cmd 或直接用命令执行。");
    commandPreview.textContent = buildRunCommand();
    return;
  }

  try {
    await saveConfigToBridge();
    const result = await postJson("/api/start-run", { config: state, execution: state.execution });
    showToast(result.message || "执行器已启动");
    await refreshRunStatus();
  } catch (error) {
    showToast(`启动执行器失败：${error.message}`);
  }
});

document.querySelector("#exportJsonBtn").addEventListener("click", () => {
  syncInputsToState();
  downloadText("保险自动化配置.json", JSON.stringify(state, null, 2), "application/json");
});

document.querySelector("#importJsonInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    validateImportedConfig(imported);
    state = normalizeState(imported);
    saveState();
    render();
    showToast("配置导入成功");
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#importTasksInput").addEventListener("change", async (event) => {
  await importTableData(event, {
    key: "tasks",
    label: "本次执行表",
    defaults: defaultTask,
    validator: validateTaskRows,
  });
});

document.querySelector("#importRoutesInput").addEventListener("change", async (event) => {
  await importTableData(event, {
    key: "routes",
    label: "总路线配置库",
    defaults: defaultRoute,
    validator: validateRouteRows,
  });
});

document.querySelector("#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_KEY);
  loginScreen.hidden = false;
  appShell.hidden = true;
  document.querySelector("#pagePasswordInput").value = "";
});

document.querySelector("#openAdminBtn").addEventListener("click", () => {
  syncInputsToState();
  window.open(state.platforms.admin.url, "_blank", "noopener");
});

document.querySelector("#openInsuranceBtn").addEventListener("click", () => {
  syncInputsToState();
  window.open(state.platforms.insurance.url, "_blank", "noopener");
});

document.querySelector("#addTaskBtn").addEventListener("click", () => {
  state.tasks.push(defaultTask());
  render();
});

document.querySelector("#addRouteBtn").addEventListener("click", () => {
  state.routes.push(defaultRoute());
  render();
});

document.querySelector("#addCompanyBtn").addEventListener("click", () => {
  state.companies.push({ code: "", name: "", taxId: "" });
  render();
});

document.querySelector("#exportTasksCsvBtn").addEventListener("click", () => {
  downloadText("本次执行表.csv", toCsv(state.tasks), "text/csv;charset=utf-8");
});

document.querySelector("#exportRoutesCsvBtn").addEventListener("click", () => {
  downloadText("总路线配置库.csv", toCsv(state.routes), "text/csv;charset=utf-8");
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sessionStorage.setItem(AUTH_KEY, "1");
  showApp();
});

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return normalizeState(saved ? JSON.parse(saved) : structuredClone(defaultConfig));
  } catch {
    return structuredClone(defaultConfig);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  renderPlatforms();
  renderExecution();
  renderTasks();
  renderRoutes();
  renderCompanies();
  renderChecks();
  updateBridgeBanner();
  updateCommandPreview();
}

function renderPlatforms() {
  platformInputs.admin.url.value = state.platforms.admin.url;
  platformInputs.admin.username.value = state.platforms.admin.username;
  platformInputs.admin.password.value = state.platforms.admin.password;
  platformInputs.admin.securityPassword.value = state.platforms.admin.securityPassword || "";
  platformInputs.insurance.url.value = state.platforms.insurance.url;
  platformInputs.insurance.username.value = state.platforms.insurance.username;
  platformInputs.insurance.password.value = state.platforms.insurance.password;
}

function renderExecution() {
  executionInputs.mode.value = state.execution.mode;
  executionInputs.ordersPath.value = state.execution.ordersPath || "";
  executionInputs.routesPath.value = state.execution.routesPath || "";
  executionInputs.headless.checked = Boolean(state.execution.headless);
  executionInputs.closeOnSuccess.checked = Boolean(state.execution.closeOnSuccess);
  togglePathInputs();
}

function renderTasks() {
  tasksBody.innerHTML = "";
  state.tasks.forEach((task, index) => {
    const tr = document.createElement("tr");
    const matched = findRouteConfig(task);

    tr.append(
      checkboxCell(task, "enabled"),
      inputCell(task, "routeName", "路线名称"),
      inputCell(task, "packageName", "规格/套餐"),
      inputCell(task, "startDate", "出发日期", "date"),
      inputCell(task, "endDate", "结束日期", "date"),
      badgeCell(matched ? "已匹配" : "未匹配", matched ? "ok" : "warn"),
      selectCell(task, "confirmMode", [
        ["manual", "人工确认"],
        ["auto", "自动确认"],
      ]),
      selectCell(task, "payMode", [
        ["manual", "人工支付"],
        ["auto", "自动支付"],
      ]),
      actionCell(() => {
        state.tasks.splice(index, 1);
        render();
      }),
    );
    tasksBody.appendChild(tr);
  });
}

function renderRoutes() {
  routesBody.innerHTML = "";
  state.routes.forEach((route, index) => {
    const tr = document.createElement("tr");
    tr.append(
      checkboxCell(route, "enabled"),
      inputCell(route, "routeName", "路线名称"),
      inputCell(route, "routeType", "路线类型"),
      inputCell(route, "keywords", "关键词"),
      selectCell(route, "companyCode", companyOptions()),
      inputCell(route, "category", "分类"),
      inputCell(route, "insurer", "保险公司"),
      inputCell(route, "product", "产品"),
      inputCell(route, "plan", "计划"),
      inputCell(route, "startOffsetDays", "提前天数", "number"),
      inputCell(route, "durationDays", "保险天数", "number"),
      inputCell(route, "remarkTemplate", "备注模板"),
      actionCell(() => {
        state.routes.splice(index, 1);
        render();
      }),
    );
    routesBody.appendChild(tr);
  });
}

function renderCompanies() {
  companiesBody.innerHTML = "";
  state.companies.forEach((company, index) => {
    const tr = document.createElement("tr");
    tr.append(
      inputCell(company, "code", "主体编码"),
      inputCell(company, "name", "公司名称"),
      inputCell(company, "taxId", "纳税人识别号"),
      actionCell(() => {
        state.companies.splice(index, 1);
        render();
      }),
    );
    companiesBody.appendChild(tr);
  });
}

function renderChecks() {
  const enabledTasks = state.tasks.filter((task) => task.enabled);
  const unmatchedTasks = enabledTasks.filter((task) => !findRouteConfig(task));
  const autoPayTasks = enabledTasks.filter((task) => task.payMode === "auto");
  const autoConfirmTasks = enabledTasks.filter((task) => task.confirmMode === "auto");
  const missingAccountCount = getMissingAccountFields().length;
  const missingCompanies = state.routes.filter((route) => {
    return route.enabled && route.companyCode && !state.companies.some((company) => company.code === route.companyCode);
  });

  const checks = [
    {
      title: "待执行路线",
      detail: `${enabledTasks.length} 条已勾选`,
      ok: enabledTasks.length > 0,
      tone: enabledTasks.length > 0 ? "ok" : "warn",
    },
    {
      title: "路线配置匹配",
      detail: unmatchedTasks.length ? `${unmatchedTasks.length} 条未匹配` : "全部已匹配",
      ok: unmatchedTasks.length === 0,
      tone: unmatchedTasks.length === 0 ? "ok" : "warn",
    },
    {
      title: "公司主体",
      detail: missingCompanies.length ? `${missingCompanies.length} 条配置缺主体` : "主体配置完整",
      ok: missingCompanies.length === 0,
      tone: missingCompanies.length === 0 ? "ok" : "warn",
    },
    {
      title: "平台账号",
      detail: missingAccountCount ? `${missingAccountCount} 项未填写` : "账号配置完整",
      ok: missingAccountCount === 0,
      tone: missingAccountCount === 0 ? "ok" : "warn",
    },
    {
      title: "Excel 输入",
      detail:
        state.execution.mode === "local-excel"
          ? hasLocalExcelPaths()
            ? "本地 Excel 路径已填写"
            : "本地 Excel 模式需要填写两个路径"
          : "自动导出模式无需手填 Excel 路径",
      ok: state.execution.mode !== "local-excel" || hasLocalExcelPaths(),
      tone: state.execution.mode !== "local-excel" || hasLocalExcelPaths() ? "ok" : "warn",
    },
    {
      title: "自动确认/支付",
      detail:
        autoConfirmTasks.length || autoPayTasks.length
          ? `${autoConfirmTasks.length} 条自动确认，${autoPayTasks.length} 条自动支付`
          : "默认人工确认与人工支付",
      ok: autoConfirmTasks.length === 0 && autoPayTasks.length === 0,
      tone: autoConfirmTasks.length === 0 && autoPayTasks.length === 0 ? "ok" : "warn",
    },
  ];

  checkList.innerHTML = "";
  checks.forEach((check) => {
    const item = document.createElement("div");
    item.className = "check-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(check.title)}</strong>
        <span>${escapeHtml(check.detail)}</span>
      </div>
      <span class="badge ${check.tone}">${check.ok ? "正常" : "注意"}</span>
    `;
    checkList.appendChild(item);
  });
}

function checkboxCell(row, key) {
  const td = document.createElement("td");
  td.className = "cell-narrow";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(row[key]);
  input.addEventListener("change", () => {
    row[key] = input.checked;
    renderChecks();
    updateCommandPreview();
  });
  td.appendChild(input);
  return td;
}

function inputCell(row, key, placeholder, type = "text") {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.value = row[key] ?? "";
  input.addEventListener("input", () => {
    row[key] = type === "number" ? Number(input.value || 0) : input.value;
    renderChecks();
    updateCommandPreview();
  });
  td.appendChild(input);
  return td;
}

function selectCell(row, key, options) {
  const td = document.createElement("td");
  const select = document.createElement("select");
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = row[key] ?? "";
  select.addEventListener("change", () => {
    row[key] = select.value;
    renderChecks();
    updateCommandPreview();
  });
  td.appendChild(select);
  return td;
}

function badgeCell(text, tone) {
  const td = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${tone}`;
  badge.textContent = text;
  td.appendChild(badge);
  return td;
}

function actionCell(onDelete) {
  const td = document.createElement("td");
  td.className = "cell-action";
  const button = document.createElement("button");
  button.className = "delete-btn";
  button.type = "button";
  button.textContent = "删除";
  button.addEventListener("click", onDelete);
  td.appendChild(button);
  return td;
}

function companyOptions() {
  const options = [["", "请选择"]];
  state.companies.forEach((company) => {
    options.push([company.code, company.code || company.name || "未命名主体"]);
  });
  return options;
}

function validateImportedConfig(config) {
  if (!Array.isArray(config.tasks) || !Array.isArray(config.routes) || !Array.isArray(config.companies)) {
    throw new Error("JSON 必须包含 tasks、routes、companies 三个数组");
  }
}

function normalizeState(config) {
  return {
    platforms: {
      admin: {
        ...defaultConfig.platforms.admin,
        ...(config.platforms?.admin || {}),
      },
      insurance: {
        ...defaultConfig.platforms.insurance,
        ...(config.platforms?.insurance || {}),
      },
    },
    tasks: normalizeRows(config.tasks, defaultTask),
    routes: normalizeRows(config.routes, defaultRoute),
    companies: Array.isArray(config.companies) ? config.companies : [],
    execution: {
      ...defaultConfig.execution,
      ...(config.execution || {}),
    },
  };
}

function normalizeRows(rows, factory) {
  return Array.isArray(rows) ? rows.map((item) => ({ ...factory(), ...item })) : [];
}

function defaultTask() {
  return {
    enabled: true,
    routeName: "",
    packageName: "",
    startDate: "",
    endDate: "",
    confirmMode: "manual",
    payMode: "manual",
  };
}

function defaultRoute() {
  return {
    enabled: true,
    routeName: "",
    routeType: "",
    keywords: "",
    companyCode: "",
    category: "",
    insurer: "",
    product: "",
    plan: "",
    startOffsetDays: 0,
    durationDays: 1,
    remarkTemplate: "{routeName} {startDate}",
  };
}

function findRouteConfig(task) {
  const routeName = normalize(task.routeName);
  if (!routeName) return null;

  return state.routes.find((route) => {
    if (!route.enabled) return false;
    if (normalize(route.routeName) === routeName) return true;

    const keywords = String(route.keywords || "")
      .split(/[,，、]/)
      .map(normalize)
      .filter(Boolean);
    return keywords.length > 0 && keywords.every((keyword) => routeName.includes(keyword));
  });
}

function syncInputsToState() {
  state.platforms.admin.url = platformInputs.admin.url.value.trim();
  state.platforms.admin.username = platformInputs.admin.username.value.trim();
  state.platforms.admin.password = platformInputs.admin.password.value;
  state.platforms.admin.securityPassword = platformInputs.admin.securityPassword.value;
  state.platforms.insurance.url = platformInputs.insurance.url.value.trim();
  state.platforms.insurance.username = platformInputs.insurance.username.value.trim();
  state.platforms.insurance.password = platformInputs.insurance.password.value;
  state.execution.mode = executionInputs.mode.value;
  state.execution.ordersPath = executionInputs.ordersPath.value.trim();
  state.execution.routesPath = executionInputs.routesPath.value.trim();
  state.execution.headless = executionInputs.headless.checked;
  state.execution.closeOnSuccess = executionInputs.closeOnSuccess.checked;
}

function onConfigInput() {
  syncInputsToState();
  renderChecks();
  togglePathInputs();
  updateCommandPreview();
}

function togglePathInputs() {
  const localMode = state.execution.mode === "local-excel";
  executionInputs.ordersPath.disabled = !localMode;
  executionInputs.routesPath.disabled = !localMode;
}

function getMissingAccountFields() {
  const required = [
    state.platforms.admin.url,
    state.platforms.admin.username,
    state.platforms.admin.password,
    state.platforms.insurance.url,
    state.platforms.insurance.username,
    state.platforms.insurance.password,
  ];
  return required.filter((value) => !String(value || "").trim());
}

function hasLocalExcelPaths() {
  return Boolean(state.execution.ordersPath && state.execution.routesPath);
}

function getBlockingIssues() {
  const enabledTasks = state.tasks.filter((task) => task.enabled);
  const unmatchedTasks = enabledTasks.filter((task) => !findRouteConfig(task));
  const missingAccounts = getMissingAccountFields();
  const missingCompanies = state.routes.some((route) => {
    return route.enabled && route.companyCode && !state.companies.some((company) => company.code === route.companyCode);
  });

  if (!enabledTasks.length) return ["本次执行表没有勾选路线"];
  if (unmatchedTasks.length) return ["存在未匹配总路线配置的执行路线"];
  if (missingAccounts.length) return ["后台或保险平台账号未填写完整"];
  if (missingCompanies) return ["存在启用路线未配置公司主体"];
  if (state.execution.mode === "local-excel" && !hasLocalExcelPaths()) return ["本地 Excel 模式需要填写订单列表与销转表路径"];
  return [];
}

function updateBridgeBanner() {
  bridgeStatusText.textContent = bridgeMessage;
}

function updateCommandPreview() {
  commandPreview.textContent = `${buildPreflightCommand()}\n${buildRunCommand()}`;
}

function buildPreflightCommand() {
  const parts = ["node automation\\preflight.mjs", "--config automation\\config.json"];
  if (state.execution.mode === "local-excel") {
    parts.push("--orders", quoteArg(state.execution.ordersPath), "--routes", quoteArg(state.execution.routesPath));
  } else {
    parts.push("--export", "true");
  }
  return parts.join(" ");
}

function buildRunCommand() {
  const parts = ["node automation\\run.mjs", "--config automation\\config.json"];
  if (state.execution.mode === "local-excel") {
    parts.push("--orders", quoteArg(state.execution.ordersPath), "--routes", quoteArg(state.execution.routesPath));
  } else {
    parts.push("--export", "true");
  }
  if (state.execution.headless) parts.push("--headless", "true");
  if (state.execution.closeOnSuccess) parts.push("--close-on-success", "true");
  return parts.join(" ");
}

function quoteArg(value) {
  const text = String(value || "");
  return text.includes(" ") ? `"${text}"` : text;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    return true;
  } catch {
    return false;
  }
}

async function saveConfigToBridge() {
  if (!bridgeAvailable) return false;

  try {
    await postJson("/api/save-config", { config: state });
    return true;
  } catch {
    return false;
  }
}

async function refreshBridgeAvailability() {
  try {
    const response = await fetch(`${BRIDGE_ORIGIN}/api/status`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    bridgeAvailable = true;
    bridgeMessage = result.running
      ? "桥接服务在线，执行器运行中。"
      : "桥接服务在线，可直接保存配置、执行预检和启动 Playwright。";
    updateBridgeBanner();
    await refreshRunStatus(result);
  } catch {
    bridgeAvailable = false;
    bridgeMessage = "桥接未开启。请运行 start-bridge.cmd，或者导出配置后直接使用 Windows 命令执行。";
    updateBridgeBanner();
    runStatusText.textContent = "未连接到本地桥接服务";
  }
}

async function refreshRunStatus(prefetched = null) {
  if (!bridgeAvailable && !prefetched) {
    runStatusText.textContent = "未连接到本地桥接服务";
    return;
  }

  try {
    const result = prefetched || (await fetch(`${BRIDGE_ORIGIN}/api/status`).then((response) => response.json()));
    if (!result.status) {
      runStatusText.textContent = result.running ? "执行器正在运行，等待状态回报..." : "尚未执行";
      return;
    }

    const parts = [
      `阶段：${result.status.phase || "-"}`,
      `时间：${result.status.updatedAt || "-"}`,
      `说明：${result.status.message || "-"}`,
    ];
    if (result.status.logPath) parts.push(`日志：${result.status.logPath}`);
    if (result.status.currentTask?.routeName) {
      parts.push(`任务：${result.status.currentTask.routeName} ${result.status.currentTask.startDate || ""}`.trim());
    }
    runStatusText.textContent = parts.join("\n");
  } catch {
    runStatusText.textContent = "状态读取失败";
  }
}

function formatPreflightResult(result) {
  const lines = [`结果：${result.ok ? "通过" : "失败"}`];
  if (Array.isArray(result.checks)) {
    result.checks.forEach((check) => {
      lines.push(`- [${check.ok ? "OK" : "ERR"}] ${check.name}: ${check.detail}`);
    });
  }
  if (Array.isArray(result.errors) && result.errors.length) {
    lines.push("", "错误：");
    result.errors.forEach((error) => lines.push(`- ${error}`));
  }
  return lines.join("\n");
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((key) => csvValue(row[key])).join(","));
  return `\ufeff${headers.join(",")}\n${body.join("\n")}`;
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function importTableData(event, options) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    if (!window.confirm(`导入后将覆盖当前全部${options.label}，是否继续？`)) {
      return;
    }

    const rows = await parseImportedTable(file, options.key);
    const normalizedRows = normalizeRows(rows, options.defaults);
    options.validator(normalizedRows);
    state[options.key] = normalizedRows;
    saveState();
    render();
    showToast(`${options.label}导入成功，已覆盖当前全部数据`);
  } catch (error) {
    showToast(`${options.label}导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

async function parseImportedTable(file, key) {
  const text = await file.text();
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed[key])) return parsed[key];
    throw new Error("JSON 格式不正确");
  }

  if (lowerName.endsWith(".csv")) {
    return csvToRows(text);
  }

  throw new Error("仅支持 JSON 或 CSV 文件");
}

function csvToRows(text) {
  const rows = parseCsv(text.replace(/^\ufeff/, ""));
  if (rows.length < 2) {
    throw new Error("CSV 至少需要表头和一行数据");
  }

  const headers = rows[0].map((item) => String(item || "").trim());
  return rows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim())).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = coerceCsvValue(row[index] ?? "");
    });
    return item;
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function coerceCsvValue(value) {
  const text = String(value ?? "").trim();
  if (text === "") return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function validateTaskRows(rows) {
  if (!rows.length) throw new Error("任务表不能为空");
  const enabledTasks = rows.filter((item) => item.enabled);
  if (!enabledTasks.length) throw new Error("至少需要一条启用任务");

  enabledTasks.forEach((task, index) => {
    if (!String(task.routeName || "").trim()) throw new Error(`第 ${index + 1} 条任务缺少路线名称`);
    if (!String(task.startDate || "").trim()) throw new Error(`第 ${index + 1} 条任务缺少出发日期`);
  });
}

function validateRouteRows(rows) {
  if (!rows.length) throw new Error("路线库不能为空");
  rows.forEach((route, index) => {
    if (!String(route.routeName || "").trim()) throw new Error(`第 ${index + 1} 条路线缺少路线名称`);
    if (!String(route.category || "").trim()) throw new Error(`第 ${index + 1} 条路线缺少分类`);
    if (!String(route.insurer || "").trim()) throw new Error(`第 ${index + 1} 条路线缺少保险公司`);
    if (!String(route.product || "").trim()) throw new Error(`第 ${index + 1} 条路线缺少产品`);
    if (!Number(route.durationDays || 0)) throw new Error(`第 ${index + 1} 条路线缺少保险天数`);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function postJson(path, payload) {
  const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.message || `请求失败: ${response.status}`);
  }
  return result;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
  render();
  window.clearInterval(window.__bridgeTimer);
  window.__bridgeTimer = window.setInterval(refreshBridgeAvailability, 2500);
  refreshBridgeAvailability();
}

if (sessionStorage.getItem(AUTH_KEY) === "1") {
  showApp();
}
