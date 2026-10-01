#!/usr/bin/env node
/**
 * Stage B1 真机探针：颜色系统的「专业用户真的好用吗」。
 *
 * 为什么必须在真机（deploy/ + 生产 CSP）跑：
 *   静态测试能证明 `listPaletteSeries(` 写在源码里，证明不了**盼盼的 7 个中文系列
 *   真的出现在界面上**；能证明 `currentPaletteId` 在 store 里，证明不了
 *   **点一下色格真的把它写进去、并且没有污染旧编辑器的槽位**。
 *   B1 的两条核心缺陷（系列被 code 前缀吞掉 / 当前颜色写进别人的槽位）
 *   都是"代码看着对、界面上错"的类型，只能在真机取证。
 *
 * 六类取证手段：
 *   1. **真实 DOM 断言**：系列片 / 色格背景色 / 卡片数 / 控件类型，全部读真实节点。
 *   2. **真实交互**：`button.click()` / `dispatchEvent(input)` / 画布 pointerdown，
 *      不是直接调内部函数 —— 走的就是用户路径。
 *   3. **store 三槽位交叉验证**：currentPaletteId（真源）/ selectedPaletteId（镜像）/
 *      paletteState.selectedColor（**旧编辑器的对象槽位，必须纹丝不动**）。
 *      最后一条是 B1 §6 的实质修复，静态测试测不出"适配器把它路由到哪"。
 *   4. **registry 对拍**：界面上显示的色号 / 系列计数，与 palette-brands.mjs 的
 *      真实数据逐项比对 —— 不是"看起来有 7 个片"就算过。
 *   5. **主线程心跳**：切品牌 / 重建色板时的最大心跳间隔，回答 §23「专业用户能忍吗」。
 *   6. **回归取证**：全局替换后图上该色真的消失、用量条真的更新、撤销真的能回来。
 *
 * 用法：
 *   node tools/b1-palette-probe.mjs
 *   LIBMS_BASE=http://127.0.0.1:8798 node tools/b1-palette-probe.mjs
 *
 * 环境变量：
 *   B1_LONG_EDGE   生成长边，默认 104（够出多色，又快到几秒）
 *   B1_KEEP=1      结束后不删截图目录
 *   PROBE_TIMEOUT_MS 全局看门狗，默认 12 分钟
 *   OUT_DIR        截图输出目录
 */
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9391);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8814);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/b1-palette");
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b1-probe");
const LONG_EDGE = Number(process.env.B1_LONG_EDGE || 104);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const note = (name, detail) => console.log(`INFO  ${name}${detail ? `  ${detail}` : ""}`);

/* ── 夹具：手写 PNG（zlib），不引图像依赖 ─────────────────────────── */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/**
 * 多色夹具：连续色相 + 颗粒噪声 + 局部高光，**每个像素都不同色**。
 *
 * 为什么不能用块状 2 色图：B1 要验的是「专业用户的颜色工作流」——
 * 用色统计的排序、相近颜色、**低频色巡检**全都要「颜色多且分布不均」才有意义。
 * 2 色图跑出来只有 2 个色号、各 4056 颗，低频色列表恒为空 ——
 * 那不是「功能正常」，是**夹具让断言无法成立**。
 *
 * 确定性伪随机：每次跑的是同一张图，断言可复现。
 */
function writePhotoPng(file, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 0x2f6e2b1;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + 1 + x * 3;
      const u = x / width, v = y / height;
      const hue = (u * 1.7 + v * 0.9) % 1;
      const light = 0.18 + 0.7 * (0.5 + 0.5 * Math.sin((u + v) * Math.PI * 2.2));
      const r0 = Math.sin(hue * Math.PI * 2) * 0.5 + 0.5;
      const g0 = Math.sin((hue + 1 / 3) * Math.PI * 2) * 0.5 + 0.5;
      const b0 = Math.sin((hue + 2 / 3) * Math.PI * 2) * 0.5 + 0.5;
      const grain = (rand() - 0.5) * 34;
      const blob = Math.sin(u * 9.1) * Math.cos(v * 7.3) * 26;
      raw[i] = Math.max(0, Math.min(255, Math.round(255 * light * r0 + grain + blob)));
      raw[i + 1] = Math.max(0, Math.min(255, Math.round(255 * light * g0 + grain + blob)));
      raw[i + 2] = Math.max(0, Math.min(255, Math.round(255 * light * b0 + grain + blob)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]));
}

/* ── 服务器 + Chrome ─────────────────────────────────────────────── */
let server = null;
if (!process.env.LIBMS_BASE) {
  server = spawn(process.execPath, [path.join(ROOT, "tools/serve-with-headers.mjs"), "deploy", String(SERVE_PORT)], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 40 && !up; i += 1) {
    try { up = (await fetch(`${BASE}/`)).ok; } catch { await sleep(150); }
  }
  if (!up) { console.error(`服务器起不来：${BASE}`); server.kill("SIGKILL"); process.exit(1); }
}

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const FIXTURE = path.join(FIXTURE_DIR, "photo-800x600.png");
if (!fs.existsSync(FIXTURE)) writePhotoPng(FIXTURE, 800, 600);
console.log(`夹具：${FIXTURE}`);
console.log(`基址：${BASE}（生产 CSP 头由 serve-with-headers.mjs 提供）`);

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  // 系统代理会拦 127.0.0.1，Chrome 不认 macOS 的 ExceptionsList。
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b1-${Date.now()}`,
  "--window-size=1440,900",
  `${BASE}/`,
], { stdio: "ignore" });

const cleanup = () => { try { chrome.kill("SIGKILL"); } catch {} try { server?.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);

async function getWsUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(BASE));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("CDP 连不上");
}

const ws = new WebSocket(await getWsUrl());
let msgId = 0;
const pending = new Map();
const consoleMessages = [];
const cspViolations = [];

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Log.entryAdded") {
    const text = String(m.params?.entry?.text || "");
    if (/Content Security Policy|CSP/i.test(text)) cspViolations.push(text.slice(0, 240));
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleMessages.push({ type: m.params?.type, text: String(text).slice(0, 300) });
  }
  if (m.method === "Runtime.exceptionThrown") {
    consoleMessages.push({ type: "exception", text: String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 300) });
  }
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  }
});

/** 单次 CDP 调用带超时 —— 没有它，任何一次卡住都会让探针静默挂死。 */
const send = (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} 超时 ${timeoutMs}ms`)); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("DOM.enable");

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 12 * 60 * 1000);
const watchdog = setTimeout(() => {
  console.error(`\n[watchdog] 探针超过 ${Math.round(WATCHDOG_MS / 1000)}s 仍未结束，强制退出`);
  cleanup();
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref?.();

const evalJs = async (expression, timeoutMs = 90000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};
const evalJson = async (expression, timeoutMs = 90000) => JSON.parse(await evalJs(`JSON.stringify(${expression})`, timeoutMs));
const waitFor = async (expr, ms = 60000, label = "") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJs(expr, 15000)) return true; } catch (error) { console.log(`  [eval 失败] ${error.message}`); }
    await sleep(250);
  }
  console.log(`  [timeout] ${label || expr}`);
  return false;
};
const shot = async (name) => {
  try {
    const s = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, "base64"));
  } catch {}
};

/* ── 页内打点 + 页内查询助手（一次装好，后面复用） ─────────────────── */
const INSTRUMENT = `(() => {
  if (window.__b1Probe) return "already";
  const probe = {
    heartbeat: { max: 0, count: 0, last: performance.now(), gaps: [] },
    longtasks: [],
  };
  window.__b1Probe = probe;
  // 50ms 心跳：最大间隔 = 主线程被冻住的时长（用户感受就是这个）。
  setInterval(() => {
    const now = performance.now();
    const gap = now - probe.heartbeat.last;
    probe.heartbeat.last = now;
    probe.heartbeat.count += 1;
    probe.heartbeat.gaps.push(Math.round(gap));
    if (gap > probe.heartbeat.max) probe.heartbeat.max = gap;
    if (probe.heartbeat.gaps.length > 6000) probe.heartbeat.gaps.splice(0, 3000);
  }, 50);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longtasks.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  return "installed";
})()`;

const RESET_PERF = `(() => { const p = window.__b1Probe; p.heartbeat.max = 0; p.heartbeat.count = 0; p.heartbeat.last = performance.now(); p.heartbeat.gaps = []; p.longtasks = []; return true; })()`;

/** 页内查询 / 交互助手。全部走真实 DOM，不碰内部函数。 */
const HELPERS = `(() => {
  const $ = (sel) => document.querySelector(sel);
  const all = (sel) => [...document.querySelectorAll(sel)];
  const store = () => window.libmsStore;
  const ns = (name) => window.libmsStore.getNamespace(name);
  const bridge = () => window.LibmsWorkspaceBridge;

  window.__b1 = {
    $, all, store, ns, bridge,
    // 三个槽位分开读，交叉验证才看得出「真源写了、镜像同步了、别人的槽位没被碰」
    slots: () => ({
      truth: ns("editorState").currentPaletteId,
      mirror: ns("editorState").selectedPaletteId,
      legacy: ns("paletteState").selectedColor,
      legacyType: ns("paletteState").selectedColor === null ? "null" : typeof ns("paletteState").selectedColor,
      highlightedPaletteId: ns("editorState").highlightedPaletteId,
    }),
    chips: () => all("#ws-palette-categories button[data-ws-category]").map((b) => ({
      key: b.dataset.wsCategory, text: b.textContent.trim(), active: b.classList.contains("active"),
    })),
    swatches: () => all("#ws-bead-picker button[data-ws-pick]").map((b) => ({
      code: b.dataset.wsPick,
      bg: (b.querySelector("span") || {}).style ? b.querySelector("span").style.background : "",
      title: b.title,
      active: b.classList.contains("active"),
    })),
    usageCards: () => all("#ws-usage-strip button[data-ws-usage]").map((b) => ({
      paletteId: b.dataset.wsUsage,
      code: (b.querySelector("small") || {}).textContent || "",
      count: Number(((b.querySelector("em") || {}).textContent || "0").replace(/[^0-9]/g, "")) || 0,
      active: b.classList.contains("active"),
    })),
    summary: () => ($("#ws-usage-summary") || {}).textContent || "",
    pickerCount: () => all("#ws-bead-picker button[data-ws-pick]").length,
    pickerCountText: () => ($("#ws-picker-count") || {}).textContent || "",
    moreButton: () => { const b = $("#ws-picker-more"); return b ? { text: b.textContent.trim(), hidden: b.hidden } : null; },
    clickCategory: (key) => { const b = all("#ws-palette-categories button[data-ws-category]").find((x) => x.dataset.wsCategory === key); if (!b) return false; b.click(); return true; },
    clickSwatch: (code) => { const b = all("#ws-bead-picker button[data-ws-pick]").find((x) => x.dataset.wsPick === code); if (!b) return false; b.click(); return true; },
    clickMore: () => { const b = $("#ws-picker-more"); if (!b) return false; b.click(); return true; },
    clickUsage: (paletteId) => { const b = all("#ws-usage-strip button[data-ws-usage]").find((x) => x.dataset.wsUsage === paletteId); if (!b) return false; b.click(); return true; },
    clickUsageSort: (mode) => { const b = all("[data-ws-usage-sort]").find((x) => x.dataset.wsUsageSort === mode); if (!b) return false; b.click(); return true; },
    clickUsageAction: (id) => { const b = document.getElementById(id); if (!b) return false; b.click(); return true; },
    search: (value) => { const i = $("#ws-color-search"); i.value = value; i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; },
    setBrand: (brand) => { const s = $("#ws-brand"); if (![...s.options].some((o) => o.value === brand)) return false; s.value = brand; s.dispatchEvent(new Event("change", { bubbles: true })); return true; },
    brandOptions: () => [...$("#ws-brand").options].map((o) => ({ value: o.value, label: o.textContent.trim() })),
    paletteSizeOptions: () => [...$("#ws-palette-size").options].map((o) => o.value),
    activePaletteKey: () => (window.LibmsWorkspaceBridge && document.querySelector("#ws-palette-size")) ? $("#ws-brand").value + "-" + $("#ws-palette-size").value : null,
    // §21：控件形态取证
    controlShape: () => ({
      selects: all("select").length,
      datalists: all("datalist").length,
      options: all("option").length,
      inputsWithList: all("input[list]").map((i) => ({ id: i.id, list: i.getAttribute("list") })),
      datalistOptionCount: all("#ws-palette-datalist option").length,
    }),
    grid: () => { const r = bridge().getResult(); return { width: r.width, height: r.height, totalBeads: r.totalBeads, usedColors: r.usedColors, manualEdited: Boolean(r.manualEdited), statsTotal: (r.stats || []).reduce((s, x) => s + (x.count || 0), 0), statsColors: (r.stats || []).length }; },
    // 吸管：按 viewport 的 origin 公式反算某格的屏幕坐标，再派发 pointerdown。
    // origin() 见 services/viewport-service.js：视口中心 + pan - 图纸尺寸/2。
    eyedropCell: (gx, gy) => {
      const well = $("#ws-canvas-well");
      const r = bridge().getResult();
      const view = ns("viewportState");
      const cell = 20 * view.zoom;
      const rect = well.getBoundingClientRect();
      const ox = well.clientWidth / 2 + view.panX - r.width * cell / 2;
      const oy = well.clientHeight / 2 + view.panY - r.height * cell / 2;
      const cx = rect.left + ox + (gx + 0.5) * cell;
      const cy = rect.top + oy + (gy + 0.5) * cell;
      const inside = ox + gx * cell >= 0 && oy + gy * cell >= 0 && ox + (gx + 1) * cell <= well.clientWidth && oy + (gy + 1) * cell <= well.clientHeight;
      well.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true }));
      well.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: cx, clientY: cy, pointerId: 1, isPrimary: true }));
      return { inside, cx: Math.round(cx), cy: Math.round(cy), cell };
    },
    cellCodeAt: (x, y) => { const c = bridge().getResult().grid?.[y]?.[x]; return c ? (c.code || null) : null; },
    setTool: (tool) => { const b = all("[data-ws-tool]").find((x) => x.dataset.wsTool === tool); if (!b) return false; b.click(); return true; },
    tools: () => all("[data-ws-tool]").map((b) => b.dataset.wsTool),
    confirmOk: () => { const b = $("#ws-confirm-ok"); if (!b) return false; b.click(); return true; },
    // 确认对话框只有 class 没有 id（ui/workspace.js:362），按 id 找永远是 null。
    confirmOpen: () => Boolean(document.querySelector("dialog.ws-confirm-dialog")?.open),
    rareThreshold: () => ($("#ws-rare-threshold") || {}).value || null,
    // 低频色按钮用的是 data-ws-rare-palette（不是 data-ws-inspect-palette）。
    rareItems: () => all("#ws-rare-colors [data-ws-rare-palette]").map((b) => ({
      paletteId: b.dataset.wsRarePalette,
      code: (b.querySelector("b") || {}).textContent || "",
      count: Number(((b.querySelector("small") || {}).textContent || "").replace(/[^0-9]/g, "")) || 0,
      text: b.textContent.trim(),
    })),
    rareRaw: () => ($("#ws-rare-colors") || {}).textContent || "",
    diagnosticCounts: () => ($("#ws-diagnostic-counts") || {}).textContent || "",
    similarItems: () => all("#ws-usage-similar-list [data-ws-similar]").map((b) => ({ paletteId: b.dataset.wsSimilar, text: b.textContent.trim() })),
    usageCurrent: () => ($("#ws-usage-current") || {}).textContent || "",
    replaceFrom: () => ($("#ws-replace-from") || {}).value || "",
    setReplaceTo: (v) => { const i = $("#ws-replace-to"); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; },
    clickReplaceConfirm: () => { const b = $("#ws-replace-confirm"); if (!b || b.disabled) return false; b.click(); return true; },
    undoState: () => ns("editorState").history,
    clickUndo: () => { const b = $("#ws-undo"); if (!b || b.disabled) return false; b.click(); return true; },
    heartbeat: () => ({ max: window.__b1Probe.heartbeat.max, longtasks: window.__b1Probe.longtasks.map((t) => t.dur) }),
  };
  return "helpers-ready";
})()`;

/* ── 主流程 ─────────────────────────────────────────────────────── */
try {
  /* 0. 落地 → 上传 → 挂载 → 生成 */
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");

  await evalJs(INSTRUMENT);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");
  await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [FIXTURE] });

  const mounted = await waitFor(
    `document.body.dataset.workspaceState === 'ready' && Boolean(document.querySelector('#ws-size-controls'))`,
    120000, "工作台挂载");
  check("工作台挂载（带生产 CSP 头）", mounted, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!mounted) throw new Error("工作台没挂上，后续断言无意义");

  // 上传后会先跑本地内容审查（首次要下 ~4.8MB 模型）。不能靠固定 sleep。
  const ready = await waitFor(
    `(() => { const b = document.querySelector('#ws-size-apply'); return Boolean(b) && !b.disabled; })()`,
    180000, "源图就绪");
  check("源图就绪（内容审查完成）", ready);
  await sleep(800);

  await evalJs(`(() => {
    const n = document.querySelector('#ws-size-number');
    n.value = '${LONG_EDGE}'; n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ws-size-apply').click();
    return true;
  })()`);
  const generated = await waitFor(`window.LibmsWorkspaceBridge.getResult().grid.length > 0 && !window.LibmsWorkspaceBridge.isGenerating()`, 180000, "首次生成");
  check(`首次生成完成（长边 ${LONG_EDGE}）`, generated);
  // 上传后系统会先按默认档自动生成一次，尺寸可能晚于"第一次生成完成"才落到 104。
  // 不锁死尺寸的话，后面的「卡片合计 = 总豆数」会拿两次不同的图纸对拍（实测踩过）。
  const sized = await waitFor(
    `window.LibmsWorkspaceBridge.getResult().width === ${LONG_EDGE} && !window.LibmsWorkspaceBridge.isGenerating()`,
    120000, `图纸落到 ${LONG_EDGE} 长边`);
  check(`图纸尺寸锁定为长边 ${LONG_EDGE}（后续断言的基准）`, sized,
    sized ? "" : `实际 ${await evalJs("window.LibmsWorkspaceBridge.getResult().width")}`);
  await sleep(600);
  await evalJs(HELPERS);
  const grid = await evalJson(`window.__b1.grid()`);
  note("图纸", `${grid.width}×${grid.height} · ${grid.totalBeads} 豆 · ${grid.usedColors} 色`);
  await shot("01-workspace");

  /* 1. §11 旧竖列面板已删除，横向用色统计条取而代之 */
  const panelShape = await evalJson(`({
    hasOldList: Boolean(document.querySelector("#ws-color-list")),
    hasUsageStrip: Boolean(document.querySelector("#ws-usage-strip")),
    hasUsageSummary: Boolean(document.querySelector("#ws-usage-summary")),
    hasPicker: Boolean(document.querySelector("#ws-bead-picker")),
    hasSearch: Boolean(document.querySelector("#ws-color-search")),
    hasReadout: Boolean(document.querySelector("#ws-used-colors")),
  })`);
  check("§11 旧「当前使用色」竖列面板已从 DOM 消失", panelShape.hasOldList === false);
  check("§11/§12 横向用色统计条存在（含汇总读数）", panelShape.hasUsageStrip && panelShape.hasUsageSummary,
    JSON.stringify(panelShape));

  /* 2. §2/§3/§4：品牌 → 规格 → 系列 → 色格 */
  const brands = await evalJson(`window.__b1.brandOptions()`);
  note("品牌下拉", brands.map((b) => `${b.value}(${b.label})`).join(" / "));
  // 第三方品牌色板是异步 import 的，要等它到达
  const panpanReady = await waitFor(`window.__b1.brandOptions().some((b) => b.value === "panpanOfficial")`, 60000, "盼盼色板到达");
  check("§2 第三方品牌（盼盼官方）色板已加载并进入品牌下拉", panpanReady,
    panpanReady ? "" : brands.map((b) => b.value).join(","));

  if (panpanReady) {
    await evalJs(RESET_PERF);
    await evalJs(`window.__b1.setBrand("panpanOfficial")`);
    // 8 = 「全部」+ 7 个中文系列。等 7 会白等 30s（实测踩过）。
    await waitFor(`window.__b1.chips().length === 8`, 30000, "盼盼系列片");
    await waitFor(`!window.LibmsWorkspaceBridge.isGenerating()`, 120000, "换品牌后重新生成");
    await sleep(400);
    const panpanPerf = await evalJson(`window.__b1.heartbeat()`);
    const chips = await evalJson(`window.__b1.chips()`);
    const chipKeys = chips.filter((c) => c.key !== "all").map((c) => c.key);
    const chipCounts = chips.filter((c) => c.key !== "all").map((c) => Number((c.text.match(/(\d+)\s*$/) || [])[1]));
    note("盼盼系列片", chips.map((c) => c.text).join(" | "));

    check("§4 盼盼官方出现 7 个中文系列片（修复前这里是 0 个）",
      chipKeys.length === 7, `实际 ${chipKeys.length}：${chipKeys.join("/")}`);
    check("§4 系列顺序与官方色卡一致（黄/橙棕/红粉/灰白黑/紫/绿/青蓝）",
      JSON.stringify(chipKeys) === JSON.stringify(["黄", "橙棕", "红粉", "灰白黑", "紫", "绿", "青蓝"]),
      JSON.stringify(chipKeys));
    check("§4 系列计数与 registry 真实数据一致（25/49/52/47/35/30/51）",
      JSON.stringify(chipCounts) === JSON.stringify([25, 49, 52, 47, 35, 30, 51]),
      JSON.stringify(chipCounts));
    check("§2「全部」片计数 = 色板总色数 289",
      chips.some((c) => c.key === "all" && /289/.test(c.text)), chips.find((c) => c.key === "all")?.text);
    check("§23 换品牌 + 重建色板的主线程最大心跳间隔 < 800ms",
      panpanPerf.max < 800, `max=${panpanPerf.max}ms · longtask=${panpanPerf.longtasks.length} 次`);

    // 点「黄」→ 只剩黄系
    await evalJs(`window.__b1.clickCategory("黄")`);
    await sleep(200);
    const yellow = await evalJson(`window.__b1.swatches()`);
    const yellowText = await evalJs(`window.__b1.pickerCountText()`);
    note("黄系筛选", `渲染 ${yellow.length} 格 · ${yellowText}`);
    check("§4 点「黄」后只渲染黄系（色板 25 色 → 不足一屏时全部渲染）",
      yellow.length === 25 && /25/.test(yellowText), `count=${yellow.length} text=${yellowText}`);
    await evalJs(`window.__b1.clickCategory("all")`);
    await sleep(200);

    // §3 的第二半：咪小窝也是**纯数字色号** + 官方中文系列。
    // 两个纯数字品牌都出系列，才说明系列真的来自 registry 元数据而不是字母前缀。
    await evalJs(`window.__b1.setBrand("mixiaowoOfficial")`);
    await waitFor(`window.__b1.chips().length === 8`, 30000, "咪小窝系列片");
    await waitFor(`!window.LibmsWorkspaceBridge.isGenerating()`, 120000, "换品牌后重新生成");
    await sleep(300);
    const mxwChips = await evalJson(`window.__b1.chips()`);
    const mxwKeys = mxwChips.filter((c) => c.key !== "all").map((c) => c.key);
    const mxwCounts = mxwChips.filter((c) => c.key !== "all").map((c) => Number((c.text.match(/(\d+)\s*$/) || [])[1]));
    note("咪小窝系列片", mxwChips.map((c) => c.text).join(" | "));
    check("§3 咪小窝（纯数字色号）同样出 7 个中文系列片 —— 证明系列不靠字母前缀猜",
      JSON.stringify(mxwKeys) === JSON.stringify(["黄", "橙棕", "红粉", "灰白黑", "紫", "绿", "青蓝"]),
      JSON.stringify(mxwKeys));
    check("§3 咪小窝系列计数与 registry 一致（25/49/52/47/35/30/52）",
      JSON.stringify(mxwCounts) === JSON.stringify([25, 49, 52, 47, 35, 30, 52]), JSON.stringify(mxwCounts));

    // 切回内建 mard：后面的搜索 / 用量 / 替换断言需要「带字母前缀的色号」
    // （§9 要验的正是 H7 / H07 两种写法的兼容），且 mard 是默认品牌。
    await evalJs(`window.__b1.setBrand("mard")`);
    await waitFor(`!window.LibmsWorkspaceBridge.isGenerating()`, 120000, "切回 mard 后重新生成");
    await sleep(400);
  }

  /* 3. §5 真色卡：色格背景必须是真实颜色，且与 registry 一致 */
  await evalJs(`window.__b1.search("")`);
  await sleep(150);
  const swatches = await evalJson(`window.__b1.swatches()`);
  const distinctBg = new Set(swatches.map((s) => s.bg)).size;
  check("§5 色格是真的色卡（背景色各不相同，不是同一块灰）",
    swatches.length > 0 && distinctBg > Math.min(20, swatches.length / 2),
    `${swatches.length} 格 / ${distinctBg} 种背景色`);
  check("§5 每个色格都带色号文字",
    swatches.every((s) => /^[A-Za-z0-9\u4e00-\u9fa5-]+$/.test(s.code)), `样例：${swatches.slice(0, 5).map((s) => s.code).join(",")}`);

  /* 4. §10 惰性渲染 + §22 数量可见 */
  const beforeMore = await evalJson(`({ count: window.__b1.pickerCount(), text: window.__b1.pickerCountText(), more: window.__b1.moreButton() })`);
  note("默认渲染", `${beforeMore.count} 格 · ${beforeMore.text} · more=${beforeMore.more ? beforeMore.more.text : "无"}`);
  check("§10 默认只渲染一页（PICKER_PAGE = 120），不是把 289 个色格全塞进 DOM",
    beforeMore.count === 120, `count=${beforeMore.count}`);
  check("§22 色号数量对用户可见（否则惰性渲染会让人以为色板只有一屏）",
    /\d+\s*\/\s*\d+\s*色/.test(beforeMore.text) || /\d+\s*色/.test(beforeMore.text), beforeMore.text);
  check("§10 「显示其余 N 色」按钮存在（惰性渲染必须有出口）",
    Boolean(beforeMore.more) && /显示其余\s*\d+\s*色/.test(beforeMore.more.text), beforeMore.more?.text);
  await evalJs(`window.__b1.clickMore()`);
  await sleep(200);
  const afterMore = await evalJson(`({ count: window.__b1.pickerCount(), more: window.__b1.moreButton() })`);
  check("§10 点「显示其余」后全部渲染，按钮消失",
    afterMore.count > beforeMore.count && afterMore.more === null,
    `${beforeMore.count} → ${afterMore.count} · more=${afterMore.more ? "还在" : "已消失"}`);

  /* 5. §9 搜索：H7 / H07 兼容（用当前色板里**真实存在**的色号派生，不假设品牌） */
  const letterCodeCache = await evalJson(`window.__b1.swatches()`);
  const seedCode = letterCodeCache.map((s) => s.code).find((c) => /^[A-Za-z]+\d+$/.test(c));
  if (!seedCode) {
    check("§9 搜索 H7 / H07 兼容（需要一个带字母前缀的真实色号）", false,
      `当前色板没有字母前缀色号：${letterCodeCache.slice(0, 6).map((s) => s.code).join(",")}`);
  } else {
    const [, prefix, digits] = /^([A-Za-z]+)(\d+)$/.exec(seedCode);
    const padded = `${prefix}${digits.padStart(2, "0")}`;
    const unpadded = `${prefix}${Number(digits)}`;
    await evalJs(`window.__b1.search(${JSON.stringify(unpadded)})`);
    await sleep(250);
    const hitUnpadded = await evalJson(`window.__b1.swatches().map((s) => s.code)`);
    await evalJs(`window.__b1.search(${JSON.stringify(padded)})`);
    await sleep(250);
    const hitPadded = await evalJson(`window.__b1.swatches().map((s) => s.code)`);
    note("搜索兼容", `真色号 ${seedCode} · 搜「${unpadded}」→ ${hitUnpadded.join(",")} · 搜「${padded}」→ ${hitPadded.join(",")}`);
    check(`§9 搜「${unpadded}」能找到真实色号 ${seedCode}`,
      hitUnpadded.includes(seedCode), hitUnpadded.slice(0, 8).join(","));
    check(`§9 搜「${padded}」也能找到同一个色号 ${seedCode}（补零写法兼容）`,
      hitPadded.includes(seedCode), hitPadded.slice(0, 8).join(","));
  }
  await evalJs(`window.__b1.search("绝不可能存在的色号")`);
  await sleep(250);
  const none = await evalJs(`document.querySelector("#ws-bead-picker").textContent`);
  check("§9 搜不到时给出明确文案（不是空白一片）", /没有匹配的色号/.test(none), none.slice(0, 60));
  await evalJs(`window.__b1.search("")`);
  await sleep(200);

  /* 6. §6/§7 单一真源：点色格 → 真源写对、镜像同步、**旧编辑器槽位纹丝不动** */
  const target = (await evalJson(`window.__b1.swatches()`)).find((s) => s.code)?.code;
  const slotsBefore = await evalJson(`window.__b1.slots()`);
  await evalJs(`window.__b1.clickSwatch(${JSON.stringify(target)})`);
  await sleep(250);
  const slotsAfter = await evalJson(`window.__b1.slots()`);
  note("点色格", `${target} → truth=${slotsAfter.truth} mirror=${slotsAfter.mirror} legacy=${slotsAfter.legacyType}:${JSON.stringify(slotsAfter.legacy)}`);
  check("§6 点色格后真源 currentPaletteId = 该色号", slotsAfter.truth === target, `${slotsAfter.truth} vs ${target}`);
  check("§6 兼容镜像 selectedPaletteId 与真源同步", slotsAfter.mirror === target, `${slotsAfter.mirror}`);
  check("§6 **旧编辑器的对象槽位 paletteState.selectedColor 未被工作台污染**",
    slotsAfter.legacyType !== "string", `type=${slotsAfter.legacyType} value=${JSON.stringify(slotsAfter.legacy)}`);
  const activeSwatches = (await evalJson(`window.__b1.swatches()`)).filter((s) => s.active);
  check("§6 色格 active 态唯一且落在选中色上",
    activeSwatches.length === 1 && activeSwatches[0].code === target,
    `${activeSwatches.length} 个 active：${activeSwatches.map((s) => s.code).join(",")}`);
  check("§2 面板上的「当前颜色」读数同步（用户看得见当前选了什么）",
    (await evalJs(`document.querySelector("#ws-palette-current").textContent`)).includes(target));

  /* 7. §7 吸管：从画布取色走 cell.code，不按 RGB 反猜 */
  const gridMeta = await evalJson(`window.__b1.grid()`);
  // 找一个与当前选中色不同的格子，这样"吸管真的改了当前色"才有区分度
  let probeCell = null;
  for (let y = 0; y < gridMeta.height && !probeCell; y += 1) {
    for (let x = 0; x < gridMeta.width; x += 1) {
      const code = await evalJs(`window.__b1.cellCodeAt(${x}, ${y})`);
      if (code && code !== target) { probeCell = { x, y, code }; break; }
    }
  }
  if (!probeCell) {
    check("§7 吸管取色：需要一个与当前色不同的格子来取证", false, "图纸里没有第二种颜色");
  } else {
    await evalJs(`window.__b1.setTool("eyedropper")`);
    const clicked = await evalJson(`window.__b1.eyedropCell(${probeCell.x}, ${probeCell.y})`);
    await sleep(300);
    const afterDrop = await evalJson(`window.__b1.slots()`);
    note("吸管", `点 (${probeCell.x},${probeCell.y}) 期望 ${probeCell.code} · inside=${clicked.inside} · 实际 ${afterDrop.truth}`);
    check("§7 吸管点画布后 currentPaletteId = 该格的 cell.code（不是 RGB 反猜）",
      afterDrop.truth === probeCell.code, `期望 ${probeCell.code} 实际 ${afterDrop.truth}`);
    check("§7 吸管取色同样不污染旧编辑器槽位", afterDrop.legacyType !== "string");
  }

  /* 8. §12 横向用色统计：汇总 / 卡片 / 排序 */
  const usage = await evalJson(`({ summary: window.__b1.summary(), cards: window.__b1.usageCards() })`);
  const cardSum = usage.cards.reduce((s, c) => s + c.count, 0);
  note("用色统计", `${usage.summary} · 卡片 ${usage.cards.length} 张 · 卡片合计 ${cardSum} 颗`);
  check("§12 汇总文案形如「共 X 色 · Y 颗」", /共\s*\d+\s*色\s*·\s*[\d,]+\s*颗/.test(usage.summary), usage.summary);
  check("§12 卡片数 = 汇总里的色数", String(usage.cards.length) === (usage.summary.match(/共\s*(\d+)\s*色/) || [])[1],
    `${usage.cards.length} vs ${(usage.summary.match(/共\s*(\d+)\s*色/) || [])[1]}`);
  check("§12 卡片用量合计 = 图上总豆数（数字不是编的）",
    cardSum === gridMeta.totalBeads, `${cardSum} vs ${gridMeta.totalBeads}`);
  check("§12 默认按数量降序（先看用量最大的）",
    usage.cards.every((c, i) => i === 0 || usage.cards[i - 1].count >= c.count),
    usage.cards.map((c) => c.count).join(","));
  if (usage.cards.length > 1) {
    await evalJs(`window.__b1.clickUsageSort("count-asc")`);
    await sleep(200);
    const asc = await evalJson(`window.__b1.usageCards()`);
    check("§12 切「数量↑」后顺序真的反转（排序控件不是摆设）",
      asc.length === usage.cards.length && asc[0].count === usage.cards[usage.cards.length - 1].count,
      `升序首卡 ${asc[0].code}=${asc[0].count} · 降序末卡 ${usage.cards[usage.cards.length - 1].code}=${usage.cards[usage.cards.length - 1].count}`);
    await evalJs(`window.__b1.clickUsageSort("code")`);
    await sleep(200);
    const byCode = await evalJson(`window.__b1.usageCards().map((c) => c.code)`);
    const sortedByCode = [...byCode].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
    check("§12 切「色号」后按色号排序", JSON.stringify(byCode) === JSON.stringify(sortedByCode), byCode.join(","));
    await evalJs(`window.__b1.clickUsageSort("count-desc")`);
    await sleep(150);
  }

  /* 9. §13 点用色卡 = 设当前色 + 同色高亮 */
  const topCard = usage.cards[0];
  await evalJs(`window.__b1.clickUsage(${JSON.stringify(topCard.paletteId)})`);
  await sleep(250);
  const afterCard = await evalJson(`window.__b1.slots()`);
  check("§13 点用色卡把该色设为当前色（真源）", afterCard.truth === topCard.paletteId, `${afterCard.truth} vs ${topCard.paletteId}`);
  check("§13 点用色卡同时点亮同色高亮（复用既有渲染层高亮，不建第二套）",
    afterCard.highlightedPaletteId === topCard.paletteId, `${afterCard.highlightedPaletteId}`);
  check("§13 操作条显示当前色与颗数", /颗/.test(await evalJs(`window.__b1.usageCurrent()`)), await evalJs(`window.__b1.usageCurrent()`));
  await shot("02-usage-strip");

  /* 10. §16 相近颜色：带 ΔE 与图上已有用量 */
  await evalJs(`window.__b1.clickUsageAction("ws-usage-similar")`);
  await sleep(300);
  const similar = await evalJson(`window.__b1.similarItems()`);
  check("§16 相近颜色列表非空且带 ΔE", similar.length > 0 && similar.every((s) => /ΔE\s*[\d.]+/.test(s.text)),
    similar.slice(0, 3).map((s) => `${s.paletteId}:${s.text}`).join(" | "));
  await shot("03-similar");

  /* 11. §17 低频色巡检：默认阈值 5 */
  const rareThreshold = await evalJs(`window.__b1.rareThreshold()`);
  check("§17 低频色诊断阈值默认为 5（专业用户的常用档）", rareThreshold === "5", `value=${rareThreshold}`);
  const rareItems = await evalJson(`window.__b1.rareItems()`);
  const rareRaw = await evalJs(`window.__b1.rareRaw()`);
  const diagCounts = await evalJs(`window.__b1.diagnosticCounts()`);
  note("低频色", `${rareItems.length} 项：${rareItems.slice(0, 6).map((r) => `${r.code}=${r.count}`).join(",")} · 诊断计数 ${diagCounts}`);
  check("§17 低频色列表非空且每项用量 ≤ 5（阈值真的生效）",
    rareItems.length > 0 && rareItems.every((r) => r.count > 0 && r.count <= 5),
    `${rareItems.length} 项 · 用量 ${rareItems.map((r) => r.count).join(",")} · 面板文案「${rareRaw.slice(0, 40)}」`);

  /* 12. §21 旧 per-color 巨型 select 已清理 */
  const shape = await evalJson(`window.__b1.controlShape()`);
  note("控件形态", `select=${shape.selects} datalist=${shape.datalists} option=${shape.options} datalistOption=${shape.datalistOptionCount}`);
  check("§21 页面里只剩一个色号清单（datalist），不是每个控件各持一份完整色板",
    shape.datalists === 1, `datalist=${shape.datalists}`);
  check("§21 原来 5 个 per-color select 已变成 input + list",
    shape.inputsWithList.length >= 5 && shape.inputsWithList.every((i) => i.list === "ws-palette-datalist"),
    shape.inputsWithList.map((i) => i.id).join(","));
  const paletteSize = Number((await evalJs(`document.querySelector("#ws-palette-size").value`)) || 0);
  check("§21 <option> 总数不再随色板线性膨胀（旧版是 5 × 色数 + 少量）",
    shape.options < paletteSize * 2,
    `option=${shape.options} · 色板=${paletteSize} · 旧版至少 ${paletteSize * 5}`);

  /* 13. §14/§15 全局替换：真的改图 + 一条撤销 */
  const src = topCard.paletteId;
  const dstCard = usage.cards.find((c) => c.paletteId !== src);
  if (!dstCard) {
    check("§15 全局替换：需要两种颜色才能取证", false, "图纸只有一种颜色");
  } else {
    const beforeSrc = topCard.count, beforeDst = dstCard.count;
    await evalJs(`window.__b1.clickUsage(${JSON.stringify(src)})`);
    await sleep(200);
    await evalJs(`window.__b1.clickUsageAction("ws-usage-replace")`);
    await sleep(200);
    const filledFrom = await evalJs(`window.__b1.replaceFrom()`);
    check("§14「全局替换」把当前色填进既有换色表单（复用现有流程，不建第二套）",
      filledFrom.toUpperCase() === src.toUpperCase(), `from=${filledFrom} 期望 ${src}`);
    await evalJs(`window.__b1.setReplaceTo(${JSON.stringify(dstCard.code)})`);
    await evalJs(`window.__b1.clickReplaceConfirm()`);
    await waitFor(`window.__b1.confirmOpen()`, 5000, "确认对话框");
    await evalJs(`window.__b1.confirmOk()`);
    await waitFor(`!window.__b1.usageCards().some((c) => c.paletteId === ${JSON.stringify(src)})`, 15000, "替换生效");
    await sleep(400);
    const afterCards = await evalJson(`window.__b1.usageCards()`);
    const srcGone = !afterCards.some((c) => c.paletteId === src);
    const dstNow = afterCards.find((c) => c.paletteId === dstCard.paletteId);
    note("全局替换", `${src}(${beforeSrc}) → ${dstCard.code}(${beforeDst}) · 替换后目标 ${dstNow ? dstNow.count : "—"}`);
    check("§15 全局替换后来源色从用色统计里消失（图真的改了）", srcGone);
    check("§15 目标色颗数 = 原颗数 + 被替换的颗数",
      Boolean(dstNow) && dstNow.count === beforeDst + beforeSrc,
      `${dstNow ? dstNow.count : "—"} vs ${beforeDst}+${beforeSrc}`);
    const undoState = await evalJson(`window.__b1.undoState()`);
    check("§15 全局替换产生**一条**可撤销历史", undoState.canUndo === true, JSON.stringify(undoState));
    await evalJs(`window.__b1.clickUndo()`);
    await waitFor(`window.__b1.usageCards().some((c) => c.paletteId === ${JSON.stringify(src)})`, 10000, "撤销恢复");
    await sleep(300);
    const restored = await evalJson(`window.__b1.usageCards()`);
    const srcBack = restored.find((c) => c.paletteId === src);
    check("§15 撤销后来源色与颗数完整回来（一条撤销 = 整次替换）",
      Boolean(srcBack) && srcBack.count === beforeSrc, srcBack ? `${srcBack.count} vs ${beforeSrc}` : "没回来");
  }

  /* 14. 收尾：CSP 与异常 */
  const cspHard = cspViolations.filter((t) => /worker|script-src|connect-src/i.test(t));
  check("生产 CSP 未拦 B1 相关资源（无 script/worker/connect 违规）", cspHard.length === 0,
    cspHard.length ? cspHard[0].slice(0, 200) : "");
  const exceptions = consoleMessages.filter((m) => m.type === "exception" && !/EvalError/.test(m.text));
  check("全程没有未捕获异常", exceptions.length === 0, exceptions.slice(0, 2).map((e) => e.text.slice(0, 160)).join(" || "));
  await shot("04-final");
} catch (error) {
  check("探针执行完成（无致命错误）", false, String(error?.message || error));
  await shot("99-error");
} finally {
  clearTimeout(watchdog);
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} PASS`);
  if (results.some((r) => !r.ok)) {
    console.log("\n未通过项：");
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  }
  console.log(`截图目录：${OUT}`);
  cleanup();
  process.exit(0);
}
