const STORAGE_KEY = "insuranceAutomationConfig.v1";
const AUTH_KEY = "insuranceAutomationAuth.v1";
const PAGE_USERNAME = "";
const PAGE_PASSWORD = "";
const DASHBOARD_ORIGIN = "http://localhost:17820";

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
      product: "太平洋-漫游港澳台计划",
      plan: "计划一-[20万]",
      startOffsetDays: 0,
      durationDays: 1,
      remarkTemplate: "{routeName} {startDate}",
    },
  ],
  companies: [
    {
      code: "COMPANY001",
      name: "",
      taxId: "",
    },
  ],
};

let state = loadState();

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
const modeBanner = document.querySelector("#modeBanner");
const modeBadge = document.querySelector("#modeBadge");
const modeBannerText = document.querySelector("#modeBannerText");
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
  Object.values(group).forEach((input) => {
    input.addEventListener("input", syncPlatformsFromInputs);
  });
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  syncPlatformsFromInputs();
  saveState();
  showToast("已保存到当前浏览器。");
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pageAuthEnabled()) {
    showApp();
    return;
  }
  const username = document.querySelector("#pageUsernameInput").value.trim();
  const password = document.querySelector("#pagePasswordInput").value;

  if (username === PAGE_USERNAME && password === PAGE_PASSWORD) {
    sessionStorage.setItem(AUTH_KEY, "1");
    showApp();
    return;
  }

  loginError.textContent = "账号或密码不正确";
});

document.querySelector("#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_KEY);
  loginScreen.hidden = false;
  appShell.hidden = true;
  document.querySelector("#pagePasswordInput").value = "";
});

document.querySelector("#startRunBtn").addEventListener("click", async () => {
  syncPlatformsFromInputs();
  saveState();

  const issues = getBlockingIssues();
  if (issues.length) {
    showToast(`暂不能开始：${issues[0]}`);
    return;
  }

  if (!(await hasDashboardConnection())) {
    showToast("未连接本地执行器，请先运行 npm run dashboard。");
    refreshRunStatus();
    return;
  }

  try {
    const response = await fetch(`${dashboardBaseUrl()}/api/start-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "启动失败");
    showToast("配置已提交给本地执行器，自动化已启动。");
    refreshRunStatus();
  } catch (error) {
    showToast(`本地执行器启动失败：${error.message}`);
    refreshRunStatus();
  }
});

document.querySelector("#openAdminBtn").addEventListener("click", () => {
  syncPlatformsFromInputs();
  window.open(state.platforms.admin.url, "_blank", "noopener");
});

document.querySelector("#openInsuranceBtn").addEventListener("click", () => {
  syncPlatformsFromInputs();
  window.open(state.platforms.insurance.url, "_blank", "noopener");
});

document.querySelector("#addTaskBtn").addEventListener("click", () => {
  state.tasks.push({
    enabled: true,
    routeName: "",
    packageName: "",
    startDate: "",
    endDate: "",
    confirmMode: "manual",
    payMode: "manual",
  });
  render();
});

document.querySelector("#addRouteBtn").addEventListener("click", () => {
  state.routes.push({
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
  });
  render();
});

document.querySelector("#addCompanyBtn").addEventListener("click", () => {
  state.companies.push({ code: "", name: "", taxId: "" });
  render();
});

document.querySelector("#exportJsonBtn").addEventListener("click", () => {
  downloadText("投保自动化配置.json", JSON.stringify(state, null, 2), "application/json");
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
    showToast("配置导入成功。");
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#exportTasksCsvBtn").addEventListener("click", () => {
  downloadText("本次执行表.csv", toCsv(state.tasks), "text/csv;charset=utf-8");
});

document.querySelector("#exportRoutesCsvBtn").addEventListener("click", () => {
  downloadText("总路线配置库.csv", toCsv(state.routes), "text/csv;charset=utf-8");
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
  renderTasks();
  renderRoutes();
  renderCompanies();
  renderChecks();
  refreshRunStatus();
}

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
  render();
  window.clearInterval(window.__runStatusTimer);
  window.__runStatusTimer = window.setInterval(refreshRunStatus, 2000);
}

function pageAuthEnabled() {
  return Boolean(String(PAGE_USERNAME || "").trim() && String(PAGE_PASSWORD || "").trim());
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
      inputCell(route, "insurer", "保司"),
      inputCell(route, "product", "产品"),
      inputCell(route, "plan", "计划"),
      inputCell(route, "startOffsetDays", "提前天数", "number"),
      inputCell(route, "durationDays", "保险天数", "number"),
      inputCell(route, "remarkTemplate", "备注格式"),
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
  const missingAccountCount = getMissingAccountFields().length;
  const missingCompanies = state.routes.filter((route) => {
    return route.enabled && route.companyCode && !state.companies.some((company) => company.code === route.companyCode);
  });

  const checks = [
    {
      title: "待执行路线",
      detail: `${enabledTasks.length} 条已勾选`,
      ok: enabledTasks.length > 0,
    },
    {
      title: "路线配置匹配",
      detail: unmatchedTasks.length ? `${unmatchedTasks.length} 条未匹配` : "全部已匹配",
      ok: unmatchedTasks.length === 0,
    },
    {
      title: "公司主体",
      detail: missingCompanies.length ? `${missingCompanies.length} 条配置缺主体` : "主体配置完整",
      ok: missingCompanies.length === 0,
    },
    {
      title: "平台账号",
      detail: missingAccountCount ? `${missingAccountCount} 项未填写` : "账号配置完整",
      ok: missingAccountCount === 0,
    },
    {
      title: "支付策略",
      detail: autoPayTasks.length ? `${autoPayTasks.length} 条开启自动支付` : "全部人工支付",
      ok: autoPayTasks.length === 0,
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
      <span class="badge ${check.ok ? "ok" : "warn"}">${check.ok ? "正常" : "注意"}</span>
    `;
    checkList.appendChild(item);
  });
}

function findRouteConfig(task) {
  const routeName = normalize(task.routeName);
  if (!routeName) return null;

  return state.routes.find((route) => {
    if (!route.enabled) return false;
    if (normalize(route.routeName) === routeName) return true;

    const keywords = String(route.keywords || "")
      .split(/[,，、/]/)
      .map(normalize)
      .filter(Boolean);
    return keywords.length > 0 && keywords.every((keyword) => routeName.includes(keyword));
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
    row[key] = type === "number" ? Number(input.value) : input.value;
    renderChecks();
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}

async function refreshRunStatus() {
  const statusState = { mode: "offline", text: "", banner: "" };
  const fileMode = location.protocol === "file:";

  if (!(await hasDashboardConnection())) {
    if (fileMode) {
      statusState.mode = "offline";
      statusState.text = "当前为本地离线模式，可保存浏览器配置；要执行自动化请先启动 dashboard";
      statusState.banner = "当前页面只保存浏览器本地配置；如需执行自动化，请先运行 npm run dashboard 并访问 http://localhost:17820";
    } else {
      statusState.mode = "error";
      statusState.text = "执行器连接失败";
      statusState.banner = "当前页面已通过 localhost 打开，但本地执行器未响应，请检查 npm run dashboard 是否仍在运行";
    }
    applyRunStatus(statusState);
    return;
  }

  try {
    const response = await fetch(`${dashboardBaseUrl()}/api/status`);
    const result = await response.json();
    if (!result.status) {
      statusState.mode = "online";
      statusState.text = result.running ? "执行器运行中，等待状态回报" : "执行器已连接，未启动任务";
      statusState.banner = "当前已连接本地执行器，可以直接开始执行自动化";
      applyRunStatus(statusState);
      return;
    }

    const parts = [
      `阶段：${result.status.phase || "-"}`,
      `时间：${result.status.updatedAt || "-"}`,
      `说明：${result.status.message || "-"}`,
    ];
    statusState.mode = "online";
    statusState.text = parts.join("\n");
    statusState.banner = "当前已连接本地执行器，可以直接开始执行自动化";
    applyRunStatus(statusState);
  } catch {
    statusState.mode = fileMode ? "offline" : "error";
    statusState.text = fileMode
      ? "当前为本地离线模式，可保存浏览器配置；要执行自动化请先启动 dashboard"
      : "执行器连接失败";
    statusState.banner = fileMode
      ? "当前页面只保存浏览器本地配置；如需执行自动化，请先运行 npm run dashboard 并访问 http://localhost:17820"
      : "当前页面已通过 localhost 打开，但本地执行器未响应，请检查 npm run dashboard 是否仍在运行";
    applyRunStatus(statusState);
  }
}

function canUseDashboardApi() {
  return Boolean(dashboardBaseUrl());
}

function dashboardBaseUrl() {
  if (location.protocol === "http:" || location.protocol === "https:") {
    return location.origin;
  }
  return DASHBOARD_ORIGIN;
}

async function hasDashboardConnection() {
  if (!canUseDashboardApi()) return false;

  try {
    const response = await fetch(`${dashboardBaseUrl()}/api/status`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

function applyRunStatus({ mode, text, banner }) {
  runStatusText.textContent = text;
  modeBanner.hidden = false;
  modeBannerText.textContent = banner;
  modeBadge.className = `mode-badge ${mode}`;
  modeBadge.textContent =
    mode === "online" ? "执行器在线" : mode === "error" ? "执行器未连接" : "离线配置模式";
}

function syncPlatformsFromInputs() {
  state.platforms.admin.url = platformInputs.admin.url.value.trim();
  state.platforms.admin.username = platformInputs.admin.username.value.trim();
  state.platforms.admin.password = platformInputs.admin.password.value;
  state.platforms.admin.securityPassword = platformInputs.admin.securityPassword.value;
  state.platforms.insurance.url = platformInputs.insurance.url.value.trim();
  state.platforms.insurance.username = platformInputs.insurance.username.value.trim();
  state.platforms.insurance.password = platformInputs.insurance.password.value;
  renderChecks();
}

function getBlockingIssues() {
  const enabledTasks = state.tasks.filter((task) => task.enabled);
  const unmatchedTasks = enabledTasks.filter((task) => !findRouteConfig(task));
  const missingAccounts = getMissingAccountFields();

  if (!enabledTasks.length) return ["本次执行表没有勾选路线"];
  if (unmatchedTasks.length) return ["存在未匹配总路线配置的执行路线"];
  if (missingAccounts.length) return ["后台或保险平台账号未填写完整"];
  return [];
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
    tasks: Array.isArray(config.tasks) ? config.tasks : [],
    routes: Array.isArray(config.routes) ? config.routes : [],
    companies: Array.isArray(config.companies) ? config.companies : [],
  };
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

if (!pageAuthEnabled() || sessionStorage.getItem(AUTH_KEY) === "1") {
  showApp();
}
