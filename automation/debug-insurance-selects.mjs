import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(projectRoot, args.config || "automation/config.json");
const profileDir = path.resolve(projectRoot, args.profile || "automation/.browser-profile");
const outputDir = path.resolve(projectRoot, args["output-dir"] || "automation/outputs");
const targetUrl = args.url || "https://9sdtb.hizom.cn/#/travelProposal?id=2593";

await fs.mkdir(outputDir, { recursive: true });

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const { chromium } = await import("playwright");

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 950 },
});

try {
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const productInfo = await inspectAntSelectByLabel(page, "产品");
  const durationInfo = await inspectAntSelectByLabel(page, "保险期限");

  const result = {
    url: page.url(),
    expected: {
      product: config.routes?.[0]?.product || "",
      plan: config.routes?.[0]?.plan || "",
      durationDays: config.routes?.[0]?.durationDays || "",
    },
    productInfo,
    durationInfo,
  };

  const outPath = path.join(outputDir, `debug-insurance-selects-${Date.now()}.json`);
  await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  await page.screenshot({ path: path.join(outputDir, `debug-insurance-selects-${Date.now()}.png`), fullPage: true });
  console.log(JSON.stringify({ ok: true, outPath, result }, null, 2));
} finally {
  await context.close().catch(() => {});
}

async function inspectAntSelectByLabel(page, label) {
  const info = {
    label,
    currentText: "",
    expanded: false,
    optionCount: 0,
    options: [],
  };

  const field = await findFieldByLabel(page, label);
  if (!field) {
    info.error = `未找到字段：${label}`;
    return info;
  }

  const selectRoot = field.locator(".ant-select").first();
  if ((await selectRoot.count().catch(() => 0)) === 0) {
    info.error = `字段不是 ant-select：${label}`;
    return info;
  }

  info.currentText =
    (await selectRoot.locator(".ant-select-selection-selected-value").first().getAttribute("title").catch(() => "")) ||
    (await selectRoot.locator(".ant-select-selection-selected-value").first().innerText().catch(() => "")) ||
    (await selectRoot.innerText().catch(() => ""));

  const trigger =
    (await firstVisible([
      selectRoot.locator(".ant-select-selection").first(),
      selectRoot.locator(".ant-select-selection__rendered").first(),
      selectRoot.locator(".ant-select-arrow").first(),
      selectRoot.locator("[role='combobox']").first(),
    ])) || selectRoot;

  await trigger.click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
  await trigger.press("ArrowDown").catch(() => {});
  await page.waitForTimeout(250);

  info.expanded = (await selectRoot.getAttribute("aria-expanded").catch(() => "")) === "true";

  const dropdown = page.locator(".ant-select-dropdown:visible").last();
  if ((await dropdown.count().catch(() => 0)) > 0 && (await dropdown.isVisible().catch(() => false))) {
    const items = dropdown.locator(".ant-select-dropdown-menu-item");
    const count = await items.count().catch(() => 0);
    info.optionCount = count;
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      info.options.push({
        text: (await item.innerText().catch(() => "")).trim(),
        className: (await item.getAttribute("class").catch(() => "")) || "",
      });
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  return info;
}

async function findFieldByLabel(page, label) {
  const cells = page.locator("td");
  const count = await cells.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const cell = cells.nth(index);
    if (!(await cell.isVisible().catch(() => false))) continue;
    const text = ((await cell.innerText().catch(() => "")) || "").replace(/\s+/g, "");
    if (!text.includes(label.replace(/\s+/g, ""))) continue;
    const row = cell.locator("xpath=ancestor::tr[1]");
    if ((await row.count().catch(() => 0)) > 0) return row;
  }
  return null;
}

async function firstVisible(locators) {
  for (const locator of locators) {
    if (!locator) continue;
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
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
