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
const requestedPort = Number(process.env.PORT ?? 4173);
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
console.log(`Watching content/, schemas/, scripts/`);
console.log(`Build debounce: ${buildDebounceMs}ms`);

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
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDir, normalized);

  if (!filePath.startsWith(distDir)) {
    return null;
  }

  if (decoded.endsWith("/")) {
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
    ".webp": "image/webp"
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
