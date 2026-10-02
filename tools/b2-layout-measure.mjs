#!/usr/bin/env node
/**
 * Stage B2 布局量测：预检条到底占了哪一格。
 *
 * 为什么需要它：`02-preview-reliable.png` 里预检条看起来压在画布提示行上。
 * `.ws-canvas-area` 声明的是 **3 行** grid（`minmax(0,1fr) auto 26px`），
 * 而 B2 往里塞了**第 4 个 child**（预检条）。第 4 个 child 会掉进隐式行 ——
 * 隐式行按 `grid-auto-rows: auto` 尺寸，**且会挤占 `1fr` 那一行**。
 * 光看截图判断不了是「挤掉」还是「叠上去」，所以直接量 box，不猜。
 *
 * 用法：
 *   node tools/b2-layout-measure.mjs
 *   B2_MEASURE_OFF=1 node tools/b2-layout-measure.mjs   # 只量预检条隐藏时的基线
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";
import { BACKGROUND_FIXTURES, FIXTURE_SIZE, buildFixtureData, rasterizeSource } from "../tests/background-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9393);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8816);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/background");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
const logo = BACKGROUND_FIXTURES.find((f) => f.id === "white-logo");
const logoPath = path.join(FIXTURE_DIR, "white-logo.png");
if (!fs.existsSync(logoPath)) {
  fs.writeFileSync(logoPath, encodePng(rasterizeSource(buildFixtureData(FIXTURE_SIZE, FIXTURE_SIZE, logo.paint), 4)));
}

let server = null;
if (!process.env.LIBMS_BASE) {
  server = spawn(process.execPath, [path.join(ROOT, "tools/serve-with-headers.mjs"), "deploy", String(SERVE_PORT)], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) { try { up = (await fetch(`${BASE}/`)).ok; } catch { await sleep(150); } }
  if (!up) { console.error("服务器起不来"); server.kill("SIGKILL"); process.exit(1); }
}

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b2-measure-${Date.now()}`,
  "--window-size=1440,900", `${BASE}/`,
], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill("SIGKILL"); } catch {} try { server?.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);

const wsUrl = await (async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("CDP 连不上");
})();

const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
});
const send = (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} 超时 ${timeoutMs}ms`)); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");

const evalJs = async (expression, timeoutMs = 90000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};
const evalJson = async (expr) => JSON.parse(await evalJs(`JSON.stringify(${expr})`));
const waitFor = async (expr, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJs(expr, 15000)) return true; } catch {}
    await sleep(250);
  }
  console.log(`  [timeout] ${label || expr}`);
  return false;
};

const MEASURE = `(() => {
  const sel = [".ws-center", ".ws-canvas-area", ".ws-canvas-well", ".ws-canvas-stats",
               "#ws-bg-preview", ".ws-canvas-hint", ".ws-dock"];
  const rows = sel.map((s) => {
    const el = document.querySelector(s);
    if (!el) return { selector: s, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      selector: s,
      top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
      display: cs.display,
      position: cs.position,
      gridRow: cs.gridRowStart + " / " + cs.gridRowEnd,
      zIndex: cs.zIndex,
      bg: cs.backgroundColor,
    };
  });
  const area = document.querySelector(".ws-canvas-area");
  return { rows, areaTemplate: area ? getComputedStyle(area).gridTemplateRows : null,
           areaChildren: area ? [...area.children].map((c) => c.className || c.tagName) : [] };
})()`;

console.log(`基址：${BASE}`);
await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
const doc = await send("DOM.getDocument", { depth: -1 });
const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [logoPath] });
await waitFor(`(() => { const b = document.querySelector('#ws-size-apply'); return Boolean(b) && !b.disabled; })()`, 180000, "源图就绪");
await waitFor(`(() => { const b = window.LibmsWorkspaceBridge; const r = b.getResult(); return !b.isGenerating() && r && r.grid.length > 0; })()`, 180000, "首帧生成");
await sleep(500);

const dump = async (title) => {
  const m = await evalJson(MEASURE);
  console.log(`\n=== ${title} ===`);
  console.log(`.ws-canvas-area 实际行轨：${m.areaTemplate}`);
  console.log(`子元素顺序：${m.areaChildren.join(" → ")}`);
  console.log("选择器".padEnd(20), "top".padStart(6), "bottom".padStart(7), "height".padStart(7),
    "display".padEnd(10), "position".padEnd(9), "grid-row".padEnd(12), "z".padStart(4));
  for (const r of m.rows) {
    if (r.missing) { console.log(r.selector.padEnd(20), "（不存在）"); continue; }
    console.log(r.selector.padEnd(20), String(r.top).padStart(6), String(r.bottom).padStart(7),
      String(r.height).padStart(7), r.display.padEnd(10), r.position.padEnd(9), r.gridRow.padEnd(12), String(r.zIndex).padStart(4));
  }
  const by = Object.fromEntries(m.rows.filter((r) => !r.missing).map((r) => [r.selector, r]));
  const hint = by[".ws-canvas-hint"], strip = by["#ws-bg-preview"], dock = by[".ws-dock"];
  if (hint && strip && strip.height > 0) {
    console.log(`提示行 ${hint.top}–${hint.bottom} vs 预检条 ${strip.top}–${strip.bottom} → ` +
      (strip.top < hint.bottom && hint.top < strip.bottom ? "★ 重叠" : "不重叠"));
  }
  if (strip && dock && strip.height > 0) {
    console.log(`预检条 ${strip.top}–${strip.bottom} vs 工具坞 ${dock.top}–${dock.bottom} → ` +
      (strip.top < dock.bottom && dock.top < strip.bottom ? "★ 重叠" : "不重叠"));
  }
  return m;
};

await dump("预检条隐藏（基线）");

if (!process.env.B2_MEASURE_OFF) {
  await evalJs(`(() => { const el = document.querySelector("#generationPanel input[data-field='backgroundRemoval']");
    el.checked = true; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  await waitFor(`(() => { const s = document.querySelector("#ws-bg-preview"); return s && !s.hidden && s.dataset.status !== "probing"; })()`, 60000, "预检条出结论");
  await sleep(400);
  await dump("预检条可见");
}

cleanup();
process.exit(0);
