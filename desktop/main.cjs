const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let server = null;
let mainWindow = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function getWebRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.resolve(__dirname, "..");
}

function safePath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] || "/");
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative || "index.html");
  if (!candidate.startsWith(path.resolve(root) + path.sep) && candidate !== path.resolve(root)) {
    return null;
  }
  return candidate;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function createLocalServer() {
  const root = getWebRoot();

  server = http.createServer((req, res) => {
    if (!req.url || !["GET", "HEAD"].includes(req.method || "GET")) {
      sendJson(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const pathname = new URL(req.url, "http://127.0.0.1").pathname;

    if (pathname.startsWith("/api/")) {
      sendJson(res, 503, {
        error: "OFFLINE_DESKTOP",
        message: "当前为 Windows 本地离线版，在线接口未启用。",
      });
      return;
    }

    let filePath = safePath(root, pathname);
    if (!filePath) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        sendJson(res, 404, { error: "Not Found" });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      sendJson(res, 500, { error: "Local server error", message: error.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

async function createWindow() {
  const port = await createLocalServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#f5f5f7",
    title: "时里白 · 拼豆图纸工作台",
    autoHideMenuBar: true,
    icon: path.join(getWebRoot(), "favicon-rounded.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const localOrigin = `http://127.0.0.1:${port}`;
    if (!url.startsWith(localOrigin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !mainWindow) {
    createWindow().catch(console.error);
  }
});

app.on("window-all-closed", () => {
  if (server) {
    server.close();
    server = null;
  }
  mainWindow = null;
  if (process.platform !== "darwin") app.quit();
});
