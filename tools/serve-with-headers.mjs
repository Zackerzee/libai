#!/usr/bin/env node
/**
 * 带生产 CSP 头的静态服务器。
 *
 * 为什么需要它：本地用 `python3 -m http.server` 验收时**没有任何 CSP**，
 * 而线上有 netlify.toml / _headers 里那套严格策略。
 * 「本地全绿、线上被 CSP 拦掉」是一整类只在生产出现的故障，
 * 常规本地验收抓不到。这个服务器把 _headers 里的头原样加上，
 * 让验收环境与生产对齐。
 *
 * 用法：node tools/serve-with-headers.mjs <目录> <端口>
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const ROOT = process.argv[2] || "deploy";
const PORT = Number(process.argv[3] || 8798);

/** 从 _headers 里解析出要应用的头（忽略路径匹配，本项目是 /* 通配） */
function loadHeaders() {
  const file = join(ROOT, "_headers");
  if (!existsSync(file)) return {};
  const headers = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s{2,}([A-Za-z-]+):\s*(.+?)\s*$/);
    if (m) headers[m[1]] = m[2];
  }
  return headers;
}

const HEADERS = loadHeaders();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  const abs = join(ROOT, path);
  if (!abs.startsWith(join(ROOT)) || !existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { "content-type": "text/plain", ...HEADERS });
    res.end("404");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
    ...HEADERS,
  });
  res.end(readFileSync(abs));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}  (${Object.keys(HEADERS).length} 个生产头)`);
  for (const [k, v] of Object.entries(HEADERS)) console.log(`  ${k}: ${v.slice(0, 70)}${v.length > 70 ? "…" : ""}`);
});
