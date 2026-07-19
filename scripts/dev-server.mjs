import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const watchDirs = [
  path.join(rootDir, "content"),
  path.join(rootDir, "schemas"),
  path.join(rootDir, "scripts")
];
const defaultPortBase = 4173;
const defaultPortRange = 100;
const requestedPort = resolveRequestedPort();
const buildDebounceMs = Number(process.env.BUILD_DEBOUNCE_MS ?? 2500);
const clients = new Set();
let buildTimer;
let isBuilding = false;
let needsBuild = false;

await runBuild();
const server = await listenWithFallback(requestedPort);
startWatchers();

const { port } = server.address();
console.log(`Character Cameo dev server`);
console.log(`Local: http://127.0.0.1:${port}/`);
console.log(`Zannenin: http://127.0.0.1:${port}/zannenin/`);
console.log(`Port source: ${process.env.PORT ? "PORT env" : "worktree default"}`);
console.log(`Watching content/, schemas/, scripts/`);
console.log(`Build debounce: ${buildDebounceMs}ms`);

function resolveRequestedPort() {
  if (process.env.PORT) {
    return parsePort(process.env.PORT, "PORT");
  }

  return defaultPortBase + (stableHash(rootDir) % defaultPortRange);
}

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer port from 1 to 65535.`);
  }
  return port;
}

function stableHash(value) {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash + char.codePointAt(0)) | 0;
  }
  return Math.abs(hash);
}

async function listenWithFallback(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    try {
      const server = http.createServer(handleRequest);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      return server;
    } catch (error) {
      if (error.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw new Error(`No available port found from ${startPort} to ${startPort + 19}.`);
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname === "/__live-reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    res.write("event: hello\ndata: connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const filePath = resolveDistPath(requestUrl.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  if (path.extname(filePath) === ".html") {
    const html = await readFile(filePath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(injectLiveReload(html));
    return;
  }

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

function resolveDistPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded.replace(/^[/\\]+/, "")).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.resolve(distDir, normalized);

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) {
    return null;
  }

  if (decoded.endsWith("/") || filePath === distDir) {
    filePath = path.join(filePath, "index.html");
  }

  return filePath;
}

function injectLiveReload(html) {
  const snippet = `
<script>
(() => {
  const events = new EventSource("/__live-reload");
  events.addEventListener("reload", () => location.reload());
})();
</script>`;

  if (html.includes("/__live-reload")) {
    return html;
  }

  return html.replace("</body>", `${snippet}\n  </body>`);
}

function contentType(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".m4a": "audio/mp4"
  };

  return types[path.extname(filePath)] ?? "application/octet-stream";
}

function startWatchers() {
  for (const dir of watchDirs) {
    if (!existsSync(dir)) continue;
    watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      scheduleBuild();
    });
  }
}

function scheduleBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(async () => {
    if (isBuilding) {
      needsBuild = true;
      return;
    }

    const built = await runBuild({ allowFailure: true });
    if (built) {
      broadcastReload();
    }

    if (needsBuild) {
      needsBuild = false;
      scheduleBuild();
    }
  }, buildDebounceMs);
}

async function runBuild({ allowFailure = false } = {}) {
  isBuilding = true;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(rootDir, "scripts", "build.mjs")], {
        cwd: rootDir,
        stdio: "inherit"
      });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with exit code ${code}.`));
      });
      child.on("error", reject);
    });
    return true;
  } catch (error) {
    console.error(error);
    if (!allowFailure) {
      throw error;
    }
    return false;
  } finally {
    isBuilding = false;
  }
}

function broadcastReload() {
  for (const client of clients) {
    client.write(`event: reload\ndata: ${Date.now()}\n\n`);
  }
}
