import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function openAndLogin(page, platform, label) {
  if (platform.preferredUrl) {
    console.log(`优先打开${label}业务页：${platform.preferredUrl}`);
    await page.goto(platform.preferredUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    const passwordVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (!passwordVisible && /订单管理|路线管理|产品投保|旅意险|导出列表|系统通知/.test(bodyText)) {
      console.log(`${label}已复用现有登录态。`);
      return;
    }
  }

  console.log(`打开${label}：${platform.url}`);
  await page.goto(platform.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const passwordInput = await waitForPasswordOrLoggedIn(page, label);
  if (!passwordInput) return;

  if (!platform.username || !platform.password) {
    console.log(`${label}账号密码未配置，请在浏览器中手动登录。`);
    await waitForManual(`请完成${label}登录后按回车继续`);
    return;
  }

  const usernameInput = await findUsernameInput(page);
  await usernameInput.fill(platform.username);
  await passwordInput.fill(platform.password);
  const captchaMode = await handleCaptchaIfPresent(page, label);

  if (captchaMode === "wait-for-user") {
    await waitForLoggedIn(page, label);
    return;
  }

  const loginButton = page.getByRole("button").filter({ hasText: /登录|登 录|Login|Sign in/i }).first();
  if ((await loginButton.count()) > 0) {
    await loginButton.click();
  } else {
    await passwordInput.first().press("Enter");
  }

  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  console.log(`${label}已尝试自动登录；如遇验证码/短信验证，请在浏览器中手动完成一次。`);
}

async function waitForPasswordOrLoggedIn(page, label) {
  const passwordInput = page.locator('input[type="password"]').first();
  try {
    await passwordInput.waitFor({ state: "visible", timeout: 18000 });
    return passwordInput;
  } catch {
    const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (/订单管理|路线管理|产品投保|旅意险|导出列表|系统通知/.test(bodyText)) {
      console.log(`${label}已处于登录态。`);
      return null;
    }
    console.log(`${label}没有检测到密码框，可能仍在加载或登录页结构变化。`);
    await waitForManual(`请确认${label}页面已打开；如需手动登录，请完成后按回车继续`);
    return null;
  }
}

async function findUsernameInput(page) {
  const candidates = [
    'input[name*="user" i]',
    'input[name*="account" i]',
    'input[placeholder*="账号"]',
    'input[placeholder*="用户"]',
    'input[type="text"]',
    'input[type="tel"]',
    'input[type="email"]',
    "input:not([type])",
  ];
  for (const selector of candidates) {
    const inputBox = page.locator(selector).first();
    if ((await inputBox.count()) > 0 && (await inputBox.isVisible().catch(() => false))) {
      return inputBox;
    }
  }
  throw new Error("未找到账号输入框");
}

async function handleCaptchaIfPresent(page, label) {
  const captchaInput = page
    .locator('input[placeholder*="验证码"], input[name*="captcha" i], input[name*="code" i]')
    .first();
  const hasCaptchaInput = (await captchaInput.count()) > 0 && (await captchaInput.isVisible().catch(() => false));
  if (!hasCaptchaInput) return "none";

  console.log(`${label}检测到验证码。请在页面输入验证码并点击登录；脚本会等待登录成功后继续。`);
  await captchaInput.click();
  return "wait-for-user";
}

async function waitForLoggedIn(page, label) {
  const loginPattern = /login/i;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await page.waitForTimeout(1000);
    const url = page.url();
    const passwordVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    const bodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
    if (!loginPattern.test(url) && !passwordVisible) {
      console.log(`${label}登录成功，继续执行。`);
      return;
    }
    if (/订单管理|路线管理|产品投保|旅意险|导出列表|系统通知/.test(bodyText) && !passwordVisible) {
      console.log(`${label}登录成功，继续执行。`);
      return;
    }
  }
  throw new Error(`${label}等待人工验证码登录超时`);
}

export async function exportOrderList(page, task, downloadDir, adminPlatform = {}) {
  console.log(`导出订单列表：${task.routeName} / ${task.packageName} / ${task.startDate}`);
  await openAdminMenu(page, "订单管理", "订单列表");
  console.log("订单列表：已进入页面");
  await dismissAdminInterruptions(page);
  await handleSecurityPassword(page, adminPlatform);
  console.log("订单列表：开始填写筛选条件");
  await fillOrderListFilters(page, task);
  console.log("订单列表：已填写筛选条件，开始搜索");
  await clickText(page, "搜索");
  await waitForListSearchToSettle(page, "订单列表");
  console.log("订单列表：搜索完成，准备切换分页");
  await choosePageSize(page, "100条/页");
  await waitForListSearchToSettle(page, "订单列表分页");
  console.log("订单列表：准备勾选全选");
  await checkVisibleCheckbox(page);
  console.log("订单列表：准备点击导出");
  const requestedAt = new Date();
  await clickText(page, "导出");
  console.log("订单列表：准备确认导出弹窗");
  await confirmExportDialog(page);
  console.log("订单列表：准备去导出列表下载");
  return await downloadLatestExport(page, "订单列表", downloadDir, { requestedAt });
}

export async function exportSalesTable(page, task, downloadDir, adminPlatform = {}) {
  console.log(`导出销转表：${task.routeName} / ${task.startDate}`);
  await openAdminMenu(page, "路线管理", "销转表");
  console.log("销转表：已进入页面");
  await dismissAdminInterruptions(page);
  await handleSecurityPassword(page, adminPlatform);
  console.log("销转表：开始填写筛选条件");
  await fillSalesTableFilters(page, task);
  console.log("销转表：已填写筛选条件，开始搜索");
  await clickText(page, "搜索");
  await waitForListSearchToSettle(page, "销转表");
  console.log("销转表：准备点击导出");
  const requestedAt = new Date();
  await clickText(page, "导出");
  console.log("销转表：等待并确认导出弹窗");
  await waitForExportConfirmation(page, "销转表");
  console.log("销转表：准备去导出列表下载");
  return await downloadLatestExport(page, "销转表", downloadDir, { requestedAt });
}

export async function fillInsuranceProposal(page, payload, company, options = {}) {
  const { insurance } = payload;
  console.log(`填写保险平台：${insurance.category} / ${insurance.insurer} / ${insurance.product}`);

  await clickText(page, insurance.category);
  await clickText(page, insurance.insurer);
  await fillProduct(page, insurance.product);
  await fillInsuranceDuration(page, insurance.durationDays);
  await fillDateTime(page, "起保时间", insurance.startDate, insurance.startTime);
  await fillDateTime(page, "止保时间", insurance.endDate, insurance.endTime);
  await fillTravelDestination(page, payload.routeInfo?.城市 || payload.task?.routeName || "");
  await fillFieldByText(page, "团号/备注", insurance.remark, { component: "input" });

  await clickText(page, "粘贴名单");
  await pasteTravelerList(page, payload.pasteList);

  await ensureCompany(page, company);
  await readInsuranceMaterials(page);

  if (options.confirmMode !== "auto") {
    await waitForManual("即将点击确认投保，请核对页面后按回车继续");
  }
  await clickText(page, "确定投保");

  if (options.payMode !== "auto") {
    await waitForManual("即将点击支付/确认支付，请核对投保成功信息后按回车继续");
  }
  await clickTextIfVisible(page, "支付");
  await clickTextIfVisible(page, "确认支付");

  await handleSuccessDialog(page);
}

export async function readInsuranceMaterials(page) {
  await clickAgreementCheckbox(page);

  const tabs = ["投保注意事项", "保险条款", "投保通知", "投保须知", "客户告知书"];
  for (const tab of tabs) {
    const clicked = await clickTextIfVisible(page, tab);
    if (!clicked) continue;
    await page.waitForTimeout(400);
    await clickReadButton(page);
  }

  await clickTextIfVisible(page, "关闭");
  await clickAgreementCheckbox(page);
}

export async function handleSuccessDialog(page) {
  const success = page.getByText("投保成功", { exact: false });
  if ((await success.count()) === 0) return;

  console.log("检测到投保成功弹窗。");
  await clickTextIfVisible(page, "下载电子保单");
  await clickTextIfVisible(page, "下载保险条款");
  await clickTextIfVisible(page, "查看订单");
}

async function pasteTravelerList(page, pasteList) {
  const dialog = await findVisibleDialog(page, 10000);
  if (!dialog) throw new Error("未检测到粘贴名单弹窗");
  const textbox =
    (await firstVisible([
      dialog.getByRole("textbox").first(),
      dialog.locator("textarea").first(),
      dialog.locator(".el-textarea__inner").first(),
      dialog.locator("[contenteditable='true']").first(),
      dialog.locator("div[role='textbox']").first(),
    ])) || dialog;

  await textbox.waitFor({ state: "visible", timeout: 10000 });
  await textbox.click({ force: true }).catch(() => {});
  await textbox.fill(pasteList).catch(async () => {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await page.keyboard.type(pasteList, { delay: 10 }).catch(() => {});
  });
  await clickDialogButtonIfVisible(page, "确定");
  await page.waitForTimeout(500);
}

async function fillProduct(page, product) {
  const keyword = product
    .replace(/^\[/, "")
    .replace(/\].*$/, "")
    .replace(/\s+/g, "")
    .trim();
  const normalizedTarget = normalizeLabel(product).replace(/[\[\]（）()]/g, "");
  const normalizedKeyword = normalizeLabel(keyword).replace(/[\[\]（）()]/g, "");

  const productRow = await findInsuranceProductRow(page);
  if (productRow) {
    const rowText = normalizeLabel(await productRow.innerText().catch(() => "")).replace(/[\[\]（）()]/g, "");
    if (textMatchesProduct(rowText, normalizedTarget, normalizedKeyword)) {
      console.log(`保险平台：产品行已是目标值 -> ${product}`);
      return;
    }

    const rowControl =
      (await firstVisibleInField(productRow, [
        "[role='combobox']",
        ".el-select",
        ".ant-select",
        ".el-input",
        "input",
      ])) || productRow;
    await selectDropdownOption(page, rowControl, product, {
      optionText: product,
      fallbackOptionText: keyword,
      currentMatcher: async () => {
        const currentText = normalizeLabel(await productRow.innerText().catch(() => "")).replace(/[\[\]（）()]/g, "");
        return textMatchesProduct(currentText, normalizedTarget, normalizedKeyword);
      },
    });
    return;
  }

  const field = await findFieldContainer(page, "产品");
  const control =
    (field
      ? await firstVisibleInField(field, [
          ".el-select .el-input__inner",
          ".el-select .el-select__caret",
          ".el-select",
          "[role='combobox']",
          ".el-input",
          "input",
        ])
      : null) || (await findInputAfterLabel(page, "产品"));

  if (field) {
    const fieldText = normalizeLabel(await field.innerText().catch(() => "")).replace(/[\[\]（）()]/g, "");
    if (fieldText && textMatchesProduct(fieldText, normalizedTarget, normalizedKeyword)) {
      console.log(`保险平台：产品区域已包含目标值 -> ${product}`);
      return;
    }
  }
  if (control) {
    const currentParts = [
      await control.inputValue().catch(() => ""),
      await control.innerText().catch(() => ""),
      await control.textContent().catch(() => ""),
    ]
      .map((item) => normalizeLabel(item).replace(/[\[\]（）()]/g, ""))
      .filter(Boolean);

    if (currentParts.some((item) => textMatchesProduct(item, normalizedTarget, normalizedKeyword))) {
      console.log(`保险平台：产品已是目标值 -> ${product}`);
      return;
    }
  }

  await fillFieldByText(page, "产品", product, {
    component: "select",
    optionText: product,
    fallbackOptionText: keyword,
  });
}

async function findInsuranceProductRow(page) {
  const rows = page.locator("tr");
  const count = await rows.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const text = normalizeLabel(await row.innerText().catch(() => ""));
    if (text.includes("产品") && !text.includes("产品内容") && !text.includes("产品投保")) {
      return row;
    }
  }
  return null;
}

function textMatchesProduct(text, normalizedTarget, normalizedKeyword) {
  return Boolean(
    text &&
      (text.includes(normalizedTarget) ||
        normalizedTarget.includes(text) ||
        text.includes(normalizedKeyword) ||
        normalizedKeyword.includes(text)),
  );
}

async function fillDateTime(page, label, dateValue, timeValue) {
  await fillFieldByText(page, label, dateValue, { component: "date", dateValue });
  if (!timeValue) return;
  if (label.includes("止保")) return;
  const timeInputs = [
    page.locator(`text=${label}`).locator("xpath=following::input[2]").first(),
    page.locator(`input[value="${dateValue}"]`).locator("xpath=following::input[1]").first(),
  ];
  for (const inputBox of timeInputs) {
    if ((await inputBox.count()) > 0 && (await inputBox.isVisible().catch(() => false))) {
      const placeholder = await inputBox.getAttribute("placeholder").catch(() => "");
      if (/旅行目的地|始发地|团号|备注/.test(String(placeholder || ""))) continue;
      await inputBox.fill(timeValue).catch(() => {});
      return;
    }
  }
}

async function fillTravelDestination(page, value) {
  if (!value) return;
  await fillFieldByText(page, "旅行目的地", value, { component: "input" }).catch(() => {});
}

async function fillInsuranceDuration(page, durationDays) {
  const target = String(durationDays || "").trim();
  if (!target) return;

  const rows = page.locator("tr");
  const count = await rows.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const text = normalizeLabel(await row.innerText().catch(() => ""));
    if (!text.includes(normalizeLabel("保险期限"))) continue;

    const control =
      (await firstVisibleInField(row, [
        "[role='combobox']",
        ".el-select .el-input__inner",
        ".el-select",
        "input.el-input__inner",
        "input",
      ])) || row;

    const currentMatcher = async () => {
      const current = [
        await control.inputValue().catch(() => ""),
        await control.innerText().catch(() => ""),
        await control.textContent().catch(() => ""),
      ]
        .map((item) => String(item || "").trim())
        .join(" ");
      return normalizeLabel(current) === normalizeLabel(target);
    };

    if (await currentMatcher()) return;

    await selectDropdownOption(page, control, target, {
      optionText: target,
      fallbackOptionText: target,
      currentMatcher,
    });
    return;
  }

  await fillFieldByText(page, "保险期限", target, {
    component: "select",
    optionText: target,
    fallbackOptionText: target,
  });
}

async function clickAgreementCheckbox(page) {
  const clickedByText = await page.evaluate(() => {
    const text = "我已详细阅读并理解";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const content = node.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!content.includes(text)) continue;
      const clickable =
        node.querySelector?.(".el-checkbox__inner, .ant-checkbox-input, input[type='checkbox']") ||
        node.closest?.("label") ||
        node;
      clickable?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }
    return false;
  }).catch(() => false);
  if (clickedByText) {
    await page.waitForTimeout(300);
    return;
  }

  const checkbox = await firstVisible([
    page.locator("label").filter({ hasText: /我已详细阅读并理解/ }).first(),
    page.locator(".el-checkbox").filter({ hasText: /我已详细阅读并理解/ }).first(),
    page.getByText(/我已详细阅读并理解/, { exact: false }).first(),
  ]);
  if (checkbox) {
    await checkbox.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function ensureCompany(page, company) {
  if (!company) return;
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (company.name && !bodyText.includes(company.name)) {
    throw new Error(`保险平台投保人公司主体不匹配，页面未找到：${company.name}`);
  }
  if (company.taxId && !bodyText.includes(company.taxId)) {
    throw new Error(`保险平台投保人纳税人识别号不匹配，页面未找到：${company.taxId}`);
  }
}

async function downloadLatestExport(page, keyword, downloadDir, options = {}) {
  const { requestedAt } = options;
  await openAdminMenu(page, "系统设置", "导出列表");
  console.log(`导出列表：当前页面 ${page.url()}`);
  await fillFieldByText(page, "表格名称", keyword).catch(() => {});
  const knownFiles = new Set(await fs.readdir(downloadDir).catch(() => []));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    console.log(`导出列表：第 ${attempt + 1} 次查找 ${keyword}`);
    await page.waitForTimeout(5000);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await fillFieldByText(page, "表格名称", keyword).catch(() => {});
    await clickTextIfVisible(page, "搜索");
    await page.waitForTimeout(1000);

    const row = await findExportRow(page, keyword, requestedAt, { allowFallback: false });
    const rowVisible = (await row.count()) > 0 && (await row.isVisible().catch(() => false));
    if (!rowVisible) {
      await page.waitForTimeout(1500);
      continue;
    }

    const downloadLink = await findVisibleText(row, "下载", 0);
    if (!downloadLink) {
      await page.waitForTimeout(1500);
      continue;
    }

    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await downloadLink.click({ force: true }).catch(() => {});
    const download = await downloadPromise;
    if (download) {
      const suggested = download.suggestedFilename();
      const target = path.join(downloadDir, suggested);
      await download.saveAs(target);
      console.log(`已下载：${target}`);
      return target;
    }

    const fileFromDir = await waitForNewFile(downloadDir, knownFiles, 15000);
    if (fileFromDir) {
      console.log(`已检测到下载文件：${fileFromDir}`);
      return fileFromDir;
    }
  }

  throw new Error(`导出列表中未找到本轮可下载文件：${keyword}`);
}

async function findExportRow(page, keyword, requestedAt, options = {}) {
  const { allowFallback = true } = options;
  const rows = page.locator("tr");
  const count = await rows.count().catch(() => 0);
  let fallback = null;
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const visible = await row.isVisible().catch(() => false);
    if (!visible) continue;
    const text = await row.innerText().catch(() => "");
    if (!text.includes(keyword)) continue;
    if (!/已导出|下载/.test(text)) continue;
    if (!fallback) fallback = row;
    if (!requestedAt) return row;
    const matched = text.match(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
    if (!matched) continue;
    const rowTime = parseAdminDateTime(matched[0]);
    if (!rowTime) continue;
    if (rowTime.getTime() >= requestedAt.getTime() - 60_000) return row;
  }
  return (allowFallback ? fallback : null) || page.locator("_missing_row_");
}

function parseAdminDateTime(value) {
  const normalized = String(value || "").trim().replace(/\s+/, " ");
  const [datePart, timePart] = normalized.split(" ");
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  if ([year, month, day, hour, minute, second].some((item) => Number.isNaN(item))) return null;
  return new Date(year, month - 1, day, hour, minute, second);
}

async function confirmExportDialog(page) {
  const dialog = await findVisibleDialog(page, 2000);
  if (dialog) {
    await ensureExportFieldsAllSelected(dialog);
    await clickDialogButtonIfVisible(page, "确定");
    await clickDialogButtonIfVisible(page, "确认");
    await page.waitForTimeout(300);
  }
  await confirmSimpleDialog(page);
}

async function ensureExportFieldsAllSelected(dialog) {
  const fullSelectText = await findVisibleText(dialog, "全选", 0);
  if (fullSelectText) {
    await fullSelectText.click({ force: true }).catch(() => {});
    await dialog.page().waitForTimeout(300);
  }

  const checkboxes = dialog.locator(".el-checkbox");
  const count = await checkboxes.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (!(await checkbox.isVisible().catch(() => false))) continue;
    const className = await checkbox.getAttribute("class").catch(() => "");
    if (String(className || "").includes("is-checked")) continue;
    const clickable =
      (await firstVisible([
        checkbox.locator(".el-checkbox__input").first(),
        checkbox.locator(".el-checkbox__inner").first(),
        checkbox,
      ])) || checkbox;
    await clickable.click({ force: true }).catch(() => {});
    await dialog.page().waitForTimeout(80);
  }
}

async function confirmSimpleDialog(page) {
  await clickDialogButtonIfVisible(page, "确定");
  await clickDialogButtonIfVisible(page, "确认");
}

async function waitForExportConfirmation(page, contextLabel = "导出") {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const dialog = await findVisibleDialog(page, 0);
    if (dialog) {
      const text = await dialog.innerText().catch(() => "");
      console.log(`${contextLabel}：检测到导出确认弹窗${text ? ` -> ${text.replace(/\s+/g, " ").slice(0, 80)}` : ""}`);
      await confirmSimpleDialog(page);
      await page.waitForTimeout(500);
      return;
    }
    await page.waitForTimeout(250);
  }

  console.log(`${contextLabel}：未等待到导出确认弹窗，继续检查是否已有系统提示`);
  const successTexts = ["导出成功后可在导出列表进行下载查看", "后台正在加载导出表格数据", "已导出"];
  for (const text of successTexts) {
    const target = await findVisibleText(page, text, 0);
    if (target) {
      await confirmSimpleDialog(page);
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function waitForListSearchToSettle(page, contextLabel = "列表") {
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const loadingMasks = page.locator(".el-loading-mask:visible, .el-loading-spinner:visible");
    const loadingCount = await loadingMasks.count().catch(() => 0);
    if (loadingCount === 0) {
      await page.waitForTimeout(500);
      console.log(`${contextLabel}：列表加载已稳定`);
      return;
    }
    await page.waitForTimeout(300);
  }
  console.log(`${contextLabel}：未检测到明确完成信号，按当前页面继续`);
}

async function choosePageSize(page, text) {
  if (await clickTextIfVisible(page, text)) return;
  const sizeInput = page.locator(".el-pagination .el-select input, .el-pagination .el-input__inner, .el-pagination input[placeholder='请选择']").last();
  if ((await sizeInput.count()) > 0) {
    try {
      await selectDropdownOption(page, sizeInput, "100条/页", { fallbackOptionText: "100" });
      return;
    } catch {
      await sizeInput.click({ force: true }).catch(() => {});
      for (let step = 0; step < 3; step += 1) {
        await page.keyboard.press("ArrowDown").catch(() => {});
        await page.waitForTimeout(120);
      }
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function checkVisibleCheckbox(page) {
  const headerCheckboxes = page.locator(".el-table__header-wrapper .el-checkbox");
  const headerCount = await headerCheckboxes.count().catch(() => 0);
  for (let index = 0; index < headerCount; index += 1) {
    const checkbox = headerCheckboxes.nth(index);
    if (!(await checkbox.isVisible().catch(() => false))) continue;
    const clickable =
      (await firstVisible([
        checkbox.locator(".el-checkbox__input").first(),
        checkbox.locator(".el-checkbox__inner").first(),
        checkbox,
      ])) || checkbox;
    await clickable.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    if (await allVisibleTableRowsChecked(page)) {
      console.log("订单列表：表头全选已生效");
      return;
    }
  }

  const candidateGroups = [
    page.locator(".el-table__body-wrapper .el-checkbox"),
    page.locator(".el-table .el-checkbox"),
    page.getByRole("checkbox"),
    page.locator('input[type="checkbox"]'),
  ];
  for (const group of candidateGroups) {
    const count = await group.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const checkbox = group.nth(index);
      if (!(await checkbox.isVisible().catch(() => false))) continue;
      const tag = await checkbox.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
      if (tag === "input") {
        await checkbox.check({ force: true }).catch(() => {});
      } else {
        const clickable =
          (await firstVisible([
            checkbox.locator(".el-checkbox__input").first(),
            checkbox.locator(".el-checkbox__inner").first(),
            checkbox,
          ])) || checkbox;
        await clickable.click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(250);
      if (await allVisibleTableRowsChecked(page)) {
        console.log("订单列表：已检测到行内选中复选框");
        return;
      }
    }
  }

  const forced = await page.evaluate(() => {
    const selectors = [
      ".el-table__header-wrapper .el-checkbox",
      ".el-table__body-wrapper .el-checkbox",
      ".el-table .el-checkbox",
    ];
    for (const selector of selectors) {
      const wrapper = document.querySelector(selector);
      if (!wrapper) continue;
      const input = wrapper.querySelector('input[type="checkbox"]');
      if (input) {
        input.click();
        if (input.checked) return true;
      }
      wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      if (wrapper.className.includes("is-checked")) return true;
      const checkedInput = wrapper.querySelector('input[type="checkbox"]:checked');
      if (checkedInput) return true;
    }
    return false;
  }).catch(() => false);

  if (forced) {
    await page.waitForTimeout(300);
    if (await allVisibleTableRowsChecked(page)) {
      console.log("订单列表：JS 强制点击后已检测到选中复选框");
      return;
    }
  }

  throw new Error("未找到可勾选的订单列表复选框，或勾选后未生效");
}

async function hasCheckedSelection(page) {
  const count = await page
    .locator(
      ".el-table__body-wrapper .el-checkbox.is-checked, .el-table__header-wrapper .el-checkbox.is-checked, .el-table input[type='checkbox']:checked",
    )
    .count()
    .catch(() => 0);
  return count > 0;
}

async function allVisibleTableRowsChecked(page) {
  const rows = page.locator(".el-table__body-wrapper tr");
  const rowCount = await rows.count().catch(() => 0);
  let visibleRowCount = 0;
  let checkedRowCount = 0;

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    if (!(await row.isVisible().catch(() => false))) continue;
    const text = (await row.innerText().catch(() => "")).trim();
    if (!text) continue;
    const checkbox = row.locator(".el-checkbox").first();
    if ((await checkbox.count().catch(() => 0)) === 0) continue;

    visibleRowCount += 1;
    const klass = await checkbox.getAttribute("class").catch(() => "");
    const checkedInput = await row.locator("input[type='checkbox']:checked").count().catch(() => 0);
    if ((klass && klass.includes("is-checked")) || checkedInput > 0) {
      checkedRowCount += 1;
    }
  }

  if (visibleRowCount === 0) return false;
  console.log(`订单列表：可见数据行 ${visibleRowCount}，已勾选 ${checkedRowCount}`);
  return checkedRowCount === visibleRowCount;
}

async function clickReadButton(page) {
  const button = page.getByRole("button").filter({ hasText: /已详细阅读并理解/ }).first();
  if ((await button.count()) > 0) {
    await button.click().catch(() => {});
  }
}

async function fillFieldByText(page, label, value, options = {}) {
  const byLabel = page.getByLabel(label, { exact: false });
  if ((await byLabel.count()) > 0) {
    await fillControl(page, byLabel.first(), value, options);
    return;
  }

  const nearInput = page.locator(`text=${label}`).locator("xpath=following::input[1]");
  if ((await nearInput.count()) > 0) {
    await fillControl(page, nearInput.first(), value, options);
    return;
  }

  const placeholder = page.locator(`input[placeholder*="${label}"], textarea[placeholder*="${label}"]`);
  if ((await placeholder.count()) > 0) {
    await fillControl(page, placeholder.first(), value, options);
    return;
  }

  throw new Error(`未找到字段：${label}`);
}

async function fillControl(page, locator, value, options = {}) {
  const tag = await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  const readonly = await locator.getAttribute("readonly").catch(() => null);
  const disabled = await locator.getAttribute("disabled").catch(() => null);
  const classes = await locator.getAttribute("class").catch(() => "");
  const placeholder = await locator.getAttribute("placeholder").catch(() => "");

  if (options.component === "date-range") {
    await fillDateRange(page, locator, value, options.endDate || value);
    return;
  }
  if (options.component === "date" || /日期|时间/.test(placeholder || "")) {
    await fillDateInput(page, locator, options.dateValue || value);
    return;
  }
  if (options.component === "select" || readonly || /el-input__inner/.test(classes || "")) {
    await selectDropdownOption(page, locator, options.optionText || value, options);
    return;
  }
  if (tag === "textarea" || (!readonly && !disabled)) {
    await locator.fill(value);
    return;
  }

  await selectDropdownOption(page, locator, options.optionText || value, options);
}

async function selectDropdownOption(page, inputLocator, value, options = {}) {
  if (options.currentMatcher && (await options.currentMatcher().catch(() => false))) return;
  await openDropdown(page, inputLocator);
  if (options.currentMatcher && (await options.currentMatcher().catch(() => false))) return;
  const values = [value, options.fallbackOptionText].filter(Boolean);

  if (options.searchable) {
    await inputLocator.fill(value).catch(() => {});
    await page.waitForTimeout(250);
    if (options.currentMatcher && (await options.currentMatcher().catch(() => false))) return;
    const searchInput = page.locator(".el-select-dropdown:visible input.el-select-dropdown__input, .el-select-dropdown:visible input").first();
    if ((await searchInput.count()) > 0 && (await searchInput.isVisible().catch(() => false))) {
      await searchInput.fill(value).catch(() => {});
      await page.waitForTimeout(300);
      if (options.currentMatcher && (await options.currentMatcher().catch(() => false))) return;
    }
  }

  for (const text of values) {
    const candidates = [
      page.locator(".el-select-dropdown:visible .el-select-dropdown__item", { hasText: text }).first(),
      page.locator(".el-cascader__dropdown:visible .el-cascader-node", { hasText: text }).first(),
      page.locator(".el-picker-panel:visible").getByText(text, { exact: false }).first(),
      page.getByText(text, { exact: false }).first(),
    ];

    for (const candidate of candidates) {
      if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
        await candidate.click({ force: true });
        return;
      }
    }
  }

  if (options.searchable) {
    await inputLocator.press("Enter").catch(() => {});
    await page.waitForTimeout(250);
    if (options.currentMatcher && (await options.currentMatcher().catch(() => false))) return;
    const currentValue = ((await inputLocator.inputValue().catch(() => "")) || "").trim();
    if (
      currentValue &&
      (currentValue.includes(value) ||
        value.includes(currentValue) ||
        values.some((candidate) => candidate && currentValue.includes(candidate)))
    ) {
      return;
    }
  }

  await inputLocator.press("Escape").catch(() => {});
  throw new Error(`下拉框没有找到可选项：${values.join(" / ")}`);
}

async function openDropdown(page, inputLocator) {
  await inputLocator.click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
  if (await hasVisiblePopup(page)) return;

  await inputLocator.press("ArrowDown").catch(() => {});
  await page.waitForTimeout(200);
  if (await hasVisiblePopup(page)) return;

  await inputLocator.evaluate((node) => {
    const trigger = node.closest(".el-select") || node.closest(".el-input") || node.parentElement || node;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }).catch(() => {});
  await page.waitForTimeout(250);
}

async function hasVisiblePopup(page) {
  const popup = await firstVisible([
    page.locator(".el-select-dropdown:visible").first(),
    page.locator(".el-picker-panel:visible").first(),
    page.locator(".el-date-range-picker:visible").first(),
    page.locator(".el-popper:visible").first(),
  ]);
  return Boolean(popup);
}

async function waitForNewFile(downloadDir, knownFiles, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const names = await fs.readdir(downloadDir).catch(() => []);
    const fresh = names.find((name) => !knownFiles.has(name) && !name.endsWith(".crdownload"));
    if (fresh) {
      return path.join(downloadDir, fresh);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "";
}

async function fillDateInput(page, inputLocator, dateValue) {
  const readonly = await inputLocator.getAttribute("readonly").catch(() => null);
  if (!readonly) {
    await inputLocator.fill(dateValue);
    await inputLocator.press("Enter").catch(() => {});
    return;
  }
  await inputLocator.click({ force: true });
  await page.keyboard?.type?.(dateValue).catch(() => {});
  await inputLocator.evaluate((node, value) => {
    node.removeAttribute("readonly");
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, dateValue);
  await inputLocator.press("Enter").catch(() => {});
}

async function fillDateRange(page, firstInput, startDate, endDate) {
  const secondInput = firstInput.locator("xpath=following::input[1]").first();
  await fillDateInput(page, firstInput, startDate);
  if ((await secondInput.count()) > 0 && (await secondInput.isVisible().catch(() => false))) {
    await fillDateInput(page, secondInput, endDate);
  }
}

async function fillOrderListFilters(page, task) {
  await selectFormField(page, "状态", "已付款");
  await selectFormField(page, "路线", task.routeName, {
    fallbackOptionText: task.routeName.replace(/\s+/g, ""),
    searchable: true,
  });
  await fillFormDateRange(page, "出行时间", task.startDate, task.endDate || task.startDate);
}

async function fillSalesTableFilters(page, task) {
  const startInput =
    (await firstVisible([
      page.locator('input[placeholder="开始日期"]').first(),
      page.locator('input[placeholder*="开始日期"]').first(),
      page.locator('input[placeholder*="开始时间"]').first(),
    ])) ||
    (await findInputAfterLabel(page, "开始时间", 1));
  const endInput =
    (await firstVisible([
      page.locator('input[placeholder="结束日期"]').first(),
      page.locator('input[placeholder*="结束日期"]').first(),
      page.locator('input[placeholder*="结束时间"]').first(),
    ])) ||
    (await findInputAfterLabel(page, "开始时间", 2));

  if (!startInput || !endInput) {
    throw new Error("销转表未找到开始日期/结束日期输入框");
  }
  await fillDateInput(page, startInput, task.startDate);
  await fillDateInput(page, endInput, task.endDate || task.startDate);

  const routeNameInput =
    (await firstVisible([
      page.locator('input[placeholder="路线名称"]').first(),
      page.locator('input[placeholder*="路线名称"]').first(),
    ])) ||
    (await findFieldInput(page, "路线名称")) ||
    (await findFieldInput(page, "路线")) ||
    (await findRouteKeywordInput(page));
  if (!routeNameInput) throw new Error("销转表未找到路线名称输入框");
  await routeNameInput.fill(task.routeName);
}

async function selectFormField(page, label, value, options = {}) {
  const field = await findFieldContainer(page, label);
  const control =
    (field
      ? await firstVisibleInField(field, [
          ".el-select input.el-input__inner",
          ".el-select .el-input__inner",
          "input.el-input__inner",
          "input[placeholder='请选择']",
          "input",
          ".el-input",
        ])
      : null) || (await findInputAfterLabel(page, label));

  if (!control) throw new Error(`未找到字段控件：${label}`);

  await selectDropdownOption(page, control, value, options);
}

async function fillFormDateRange(page, label, startDate, endDate) {
  const field = await findFieldContainer(page, label);
  const rangeInputs = field ? field.locator("input.el-range-input, .el-date-editor input") : page.locator("_unused");
  const count = field ? await rangeInputs.count() : 0;
  if (count >= 2) {
    await fillDateInput(page, rangeInputs.nth(0), startDate);
    await fillDateInput(page, rangeInputs.nth(1), endDate);
    await page.keyboard.press("Tab").catch(() => {});
    return;
  }

  const startInput = (field ? await firstVisibleInField(field, ["input.el-input__inner", "input"]) : null) ||
    (await findInputAfterLabel(page, label, 1));
  const endInput = await findInputAfterLabel(page, label, 2);
  if (!startInput) throw new Error(`日期字段没有可用输入框：${label}`);
  await fillDateInput(page, startInput, startDate);
  if (endInput) {
    await fillDateInput(page, endInput, endDate);
    await page.keyboard.press("Tab").catch(() => {});
    return;
  }
  await fillDateRange(page, startInput, startDate, endDate);
}

async function findFieldInput(page, label) {
  const field = await findFieldContainer(page, label);
  if (field) {
    const input = await firstVisibleInField(field, ["input.el-input__inner", "input"]);
    if (input) return input;
  }
  return findInputAfterLabel(page, label);
}

async function findRouteKeywordInput(page) {
  const candidates = page.locator(".el-form input.el-input__inner, .el-form input");
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const locator = candidates.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    const placeholder = (await locator.getAttribute("placeholder").catch(() => "")) || "";
    const value = (await locator.inputValue().catch(() => "")) || "";
    const readonly = await locator.getAttribute("readonly").catch(() => null);
    if (readonly) continue;
    if (/套餐名称|请选择|开始时间|结束时间/.test(placeholder)) continue;
    if (value && /广州出发|深圳出发|周六|周日/.test(value)) continue;
    return locator;
  }
  return null;
}

async function findInputAfterLabel(page, label, index = 1) {
  const candidates = [
    page.locator(`xpath=(//*[normalize-space(text())='${label}：'])[1]/following::input[${index}]`).first(),
    page.locator(`xpath=(//*[normalize-space(text())='${label}:'])[1]/following::input[${index}]`).first(),
    page.locator(`xpath=(//*[contains(normalize-space(text()),'${label}')])[1]/following::input[${index}]`).first(),
  ];
  return firstVisible(candidates);
}

async function openAdminMenu(page, parentText, childText) {
  const directRoutes = {
    订单列表: "#/admin/orderManage",
    销转表: "#/admin/carryoverList",
    导出列表: "#/admin/exportList",
  };
  const directTarget = directRoutes[childText];
  const currentUrl = page.url();
  if (directTarget && currentUrl.includes(directTarget.replace(/^#/, ""))) {
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    return;
  }

  const currentBody = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (!directTarget && currentBody.includes(childText)) {
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    return;
  }

  if (directTarget) {
    const directUrl = directTarget.startsWith("http") ? directTarget : new URL(directTarget, currentUrl).href;
    await page.goto(directUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    if (page.url().includes(directTarget.replace(/^#/, ""))) return;
  }

  const sidebar = page.locator("body");
  const parentCandidates = [
    sidebar.locator(".el-menu, .sidebar, aside").getByText(parentText, { exact: false }).first(),
    page.locator(`text=${parentText}`).first(),
  ];
  const childCandidates = [
    sidebar.locator(".el-menu, .sidebar, aside").getByText(childText, { exact: false }).first(),
    page.locator(`text=${childText}`).first(),
  ];

  const childVisibleNow = await firstVisible(childCandidates);
  if (!childVisibleNow) {
    const parentNode = await firstVisible(parentCandidates);
    if (!parentNode) throw new Error(`后台菜单未找到：${parentText}`);
    await parentNode.click({ force: true });
    await page.waitForTimeout(500);
  }

  const childNode = await firstVisible(childCandidates);
  if (!childNode) throw new Error(`后台子菜单未找到：${childText}`);
  const href = await childNode.getAttribute("href").catch(() => null);
  if (href) {
    const targetUrl = href.startsWith("http") ? href : new URL(href, currentUrl).href;
    if (targetUrl !== currentUrl) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    } else {
      await childNode.click({ force: true });
    }
  } else {
    await childNode.click({ force: true });
  }
  await page.waitForFunction(
    ({ before, target }) => window.location.href !== before || document.body.innerText.includes(target),
    { before: currentUrl, target: childText },
    { timeout: 8000 },
  ).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function handleSecurityPassword(page, adminPlatform = {}) {
  const dialog = await findVisibleDialog(page, 1500, /密码|口令|验证/);
  if (!dialog) return;

  const password = adminPlatform.securityPassword || adminPlatform.secondPassword || adminPlatform.password;
  if (!password) {
    console.log("检测到后台二次密码弹窗，请在页面输入后继续；脚本会等待弹窗关闭。");
    await waitForDialogClosed(page, dialog, "后台二次密码");
    return;
  }

  const passwordInput = dialog.locator('input[type="password"], input').first();
  await passwordInput.fill(password);
  await dialog.getByRole("button").filter({ hasText: /确定|确认|提交/ }).first().click();
  await waitForDialogClosed(page, dialog, "后台二次密码");
}

async function waitForDialogClosed(page, dialog, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await page.waitForTimeout(1000).catch(() => {});
    if (!(await dialog.isVisible().catch(() => false))) return;
  }
  throw new Error(`${label}弹窗未关闭`);
}

async function clickText(page, text) {
  const target = await findVisibleText(page, text, 15000);
  if (!target) {
    throw new Error(`未找到可见文本按钮：${text}`);
  }
  await target.click({ force: true });
}

async function clickTextIfVisible(page, text) {
  const target = await findVisibleText(page, text, 0);
  if (!target) return false;
  await target.click().catch(() => {});
  return true;
}

async function clickDialogButtonIfVisible(page, text) {
  const dialog = await findVisibleDialog(page, 0);
  const buttons = dialog ? dialog.locator("button, .el-button, [role='button']") : page.locator("_missing_buttons_");
  const targetLabel = normalizeLabel(text);
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const label = normalizeLabel(await candidate.innerText().catch(() => ""));
    if (!label || !label.includes(targetLabel)) continue;
    await candidate.click({ force: true }).catch(() => {});
    return true;
  }
  const textTarget = dialog ? await findVisibleText(dialog, text, 0) : null;
  if (!textTarget) return false;
  await textTarget.click().catch(() => {});
  return true;
}

export async function takeFailureSnapshot(context, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const [index, page] of context.pages().entries()) {
    const file = path.join(outputDir, `failure-${stamp}-${index + 1}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    console.error(`失败截图：${file}`);
  }
}

async function firstVisible(locators) {
  for (const locator of locators) {
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

async function dismissAdminInterruptions(page) {
  const dismissTexts = ["我知道了", "确定", "关闭", "以后再说", "暂不处理"];
  for (let round = 0; round < 3; round += 1) {
    const dialog = await findVisibleDialog(page, 0);
    if (!dialog) return;
    const text = await dialog.innerText().catch(() => "");
    if (!/更改您的密码|修改密码|密码|提醒|提示/.test(text)) return;
    let clicked = false;
    for (const label of dismissTexts) {
      if (await clickDialogButtonIfVisible(page, label)) {
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      const closeButton = dialog.locator(".el-dialog__close, .el-message-box__close").first();
      if ((await closeButton.count()) > 0 && (await closeButton.isVisible().catch(() => false))) {
        await closeButton.click({ force: true }).catch(() => {});
        clicked = true;
      }
    }
    if (!clicked) return;
    await page.waitForTimeout(500);
  }
}

async function findFieldContainer(page, label) {
  const items = page.locator(".el-form .el-form-item");
  const count = await items.count();
  const normalized = normalizeLabel(label);
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const labelNode = item.locator(".el-form-item__label").first();
    const labelText = normalizeLabel(await labelNode.innerText().catch(() => ""));
    if (labelText.includes(normalized)) {
      return item;
    }
  }

  const textNode = page.getByText(label, { exact: false }).first();
  if ((await textNode.count()) > 0) {
    const item = textNode.locator("xpath=ancestor::*[contains(@class,'el-form-item')][1]").first();
    if ((await item.count()) > 0) {
      return item;
    }
  }
  return null;
}

async function firstVisibleInField(field, selectors) {
  for (const selector of selectors) {
    const locator = field.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

function normalizeLabel(value) {
  return String(value || "").replace(/[\s:：*]/g, "");
}

async function findVisibleText(root, text, timeoutMs = 0) {
  const locator = root.getByText(text, { exact: false });
  const start = Date.now();
  while (true) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
    if (timeoutMs <= 0 || Date.now() - start >= timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function findVisibleDialog(page, timeoutMs = 0, textPattern = null) {
  const dialogs = page.locator(".el-dialog, .el-message-box");
  const start = Date.now();
  while (true) {
    const count = await dialogs.count().catch(() => 0);
    let lastVisible = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = dialogs.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      if (textPattern) {
        const text = await candidate.innerText().catch(() => "");
        if (!textPattern.test(text)) continue;
      }
      lastVisible = candidate;
    }
    if (lastVisible) return lastVisible;
    if (timeoutMs <= 0 || Date.now() - start >= timeoutMs) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

export async function loadPayloads(summaryPath) {
  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  const okItems = summary.filter((item) => item.status === "ok" && item.json);
  return Promise.all(okItems.map((item) => fs.readFile(item.json, "utf8").then((text) => JSON.parse(text))));
}

export async function waitForManual(message) {
  const rl = readline.createInterface({ input, output });
  await rl.question(`${message}\n`);
  rl.close();
}
