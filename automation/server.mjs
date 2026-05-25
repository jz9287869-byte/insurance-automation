import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 17820);
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

    if (req.method === "POST" && url.pathname === "/api/start-run") {
      const body = await readBody(req);
      const config = JSON.parse(body || "{}");
      validateConfig(config);

      const configPath = path.join(projectRoot, "automation", "config.json");
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

      if (currentRun && !currentRun.killed) {
        sendJson(res, 409, { ok: false, message: "已有执行器正在运行" });
        return;
      }

      const runArgs = [path.join(projectRoot, "automation", "run.mjs"), "--config", configPath, "--export", "true"];
      console.log(`启动执行器：node ${runArgs.join(" ")}`);
      currentRun = spawn(process.execPath, runArgs, {
        cwd: projectRoot,
        stdio: "inherit",
        shell: false,
      });

      currentRun.on("exit", () => {
        currentRun = null;
      });

      sendJson(res, 200, { ok: true, message: "执行器已启动" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const statusPath = path.join(projectRoot, "automation", "status.json");
      let status = null;
      try {
        status = JSON.parse(await fs.readFile(statusPath, "utf8"));
      } catch {}
      sendJson(res, 200, { running: Boolean(currentRun && !currentRun.killed), status });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message });
  }
});

server.listen(port, () => {
  console.log(`配置页面已启动：http://localhost:${port}`);
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

function validateConfig(config) {
  if (!config.platforms?.admin?.url || !config.platforms?.insurance?.url) {
    throw new Error("平台地址未配置完整");
  }
  if (!Array.isArray(config.tasks) || !Array.isArray(config.routes) || !Array.isArray(config.companies)) {
    throw new Error("配置格式不正确");
  }
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
