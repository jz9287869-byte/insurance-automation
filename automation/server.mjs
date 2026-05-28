import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 17820);
const configPath = path.join(projectRoot, "automation", "config.json");
const statusPath = path.join(projectRoot, "automation", "status.json");

let currentRun = null;

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/save-config") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const config = payload.config || payload;
      validateConfig(config);
      await saveConfig(config);
      sendJson(res, 200, { ok: true, message: "配置已保存", configPath });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/preflight") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const config = payload.config || payload;
      const execution = payload.execution || config.execution || {};
      validateConfig(config);
      await saveConfig(config);
      const result = await runPreflight(configPath, execution);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/start-run") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const config = payload.config || payload;
      const execution = payload.execution || config.execution || {};
      validateConfig(config);
      await saveConfig(config);

      if (currentRun && !currentRun.killed) {
        sendJson(res, 409, { ok: false, message: "已有执行器正在运行" });
        return;
      }

      const preflight = await runPreflight(configPath, execution);
      if (!preflight.ok) {
        sendJson(res, 400, {
          ok: false,
          message: "预检未通过，请先修复配置",
          ...preflight,
        });
        return;
      }

      const runArgs = [path.join(projectRoot, "automation", "run.mjs"), "--config", configPath, ...buildExecutionArgs(execution)];
      console.log(`启动执行器：node ${runArgs.join(" ")}`);
      currentRun = spawn(process.execPath, runArgs, {
        cwd: projectRoot,
        stdio: "inherit",
        shell: false,
      });
      currentRun.on("exit", () => {
        currentRun = null;
      });

      sendJson(res, 200, { ok: true, message: "执行器已启动", args: runArgs });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      let status = null;
      try {
        status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      } catch {}
      sendJson(res, 200, { ok: true, running: Boolean(currentRun && !currentRun.killed), status });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message });
  }
});

server.listen(port, () => {
  console.log(`本地桥接服务已启动：http://localhost:${port}`);
});

async function serveStatic(urlPath, res) {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  const filePath = path.resolve(projectRoot, relative);
  if (!filePath.startsWith(projectRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const content = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
  res.end(content);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function saveConfig(config) {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

function validateConfig(config) {
  if (!config.platforms?.admin?.url || !config.platforms?.insurance?.url) {
    throw new Error("平台地址未配置完整");
  }
  if (!Array.isArray(config.tasks) || !Array.isArray(config.routes) || !Array.isArray(config.companies)) {
    throw new Error("配置格式不正确");
  }
}

function buildExecutionArgs(execution = {}) {
  const args = [];
  if (execution.mode === "local-excel") {
    if (execution.ordersPath) args.push("--orders", execution.ordersPath);
    if (execution.routesPath) args.push("--routes", execution.routesPath);
  } else {
    args.push("--export", "true");
  }
  if (execution.headless) args.push("--headless", "true");
  if (execution.closeOnSuccess) args.push("--close-on-success", "true");
  return args;
}

async function runPreflight(savedConfigPath, execution = {}) {
  const args = [path.join(projectRoot, "automation", "preflight.mjs"), "--config", savedConfigPath, ...buildExecutionArgs(execution)];

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      try {
        const payload = JSON.parse(stdout || "{}");
        resolve({ ok: code === 0, ...payload, stderr: stderr.trim() });
      } catch {
        resolve({
          ok: false,
          message: "预检输出解析失败",
          checks: [],
          errors: [stderr.trim() || stdout.trim() || "未知错误"],
        });
      }
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error("请求内容过大"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}
