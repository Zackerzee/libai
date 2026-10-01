#!/usr/bin/env node
/**
 * Stage B0 真机探针：生成尺寸链路的「触发纪律」取证。
 *
 * 为什么必须在真机跑：静态测试只能证明「代码里没有把 scheduleAutoGenerate 写进滑杆」，
 * 证明不了「拖到 500 真的不出图」。而 B0 要修的头号问题恰恰是
 * **拖到 500 会把主线程锁死几分钟**（实测 400×200 单次 >200s，500 更长）。
 * 所以这里数的是真机上的 `bridge.generate` 调用次数。
 *
 * 验收口径（对应 B0 §7 / §8 / §11）：
 *   · 滑杆 / 数字框 / 滚轮 / Shift+滚轮 / 方向键 → generation count = 0
 *   · 点「应用尺寸」                            → generation count = 1
 *   · 4:3 源图 + 长边 500                       → 派生尺寸必须 = 500×375（不是 500×500）
 *   · 无源图                                    → resolved=false，宽高为 null（不是 500×500）
 *   · 编辑器画布调整（宽高独立）不受影响，且不触发重新生成
 *
 * 用法：
 *   node tools/b0-size-probe.mjs                 # 自动起带生产 CSP 头的服务器
 *   LIBMS_BASE=http://127.0.0.1:8798 node tools/b0-size-probe.mjs   # 用已在跑的服务
 *
 * 注意：本探针**故意不点 500 的应用**。500×375 = 18.7 万格，真跑要几分钟，
 * 而它要验证的是「不跑」和「尺寸算对」，不需要真的算完。
 */
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9377);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8811);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/b0-size");
// 截图默认落临时目录，不往仓库里塞产物；要归档就传 OUT_DIR。
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b0-probe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

/* ── 夹具：用 zlib 手写 PNG，避免给仓库加图像依赖 ───────────────────── */
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
/** 画一张有边界、有细节的图 —— 纯色图会让像素倍数识别退化，也测不出尺寸差异。
 *
 *  关键：**块内颜色必须完全一致**，块与块之间才跳变。
 *  如果块内还带逐像素渐变（例如 `(x*7)%60`），渐变回绕处会产生不在 8 的整数倍上的
 *  伪边界，`detectPixelMultiple` 的格点判据立刻失效、退回 1× —— 实测踩过。
 *
 *  块大小固定 8：像素倍数会被识别成 8，逻辑尺寸 = 100×75（800×600 ÷ 8），
 *  刚好落在 logicalSize 的 longest=200 上限之内，首帧生成约 2 秒。
 *  用 40 会得到 20×15，再被放大到 200×150 —— 那一次要 24 秒，白白拖长探针。 */
function writePng(file, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const BLOCK = 8;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + 1 + x * 3;
      const bx = Math.floor(x / BLOCK), by = Math.floor(y / BLOCK);
      const light = (bx + by) % 2 === 0;
      raw[i] = light ? 224 : 32;
      raw[i + 1] = light ? 96 : 64;
      raw[i + 2] = light ? 48 : 176;
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

/* ── 起服务器 + Chrome ──────────────────────────────────────────────── */
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
const FIXTURE_4_3 = path.join(FIXTURE_DIR, "ratio-4x3-800x600.png");
if (!fs.existsSync(FIXTURE_4_3)) writePng(FIXTURE_4_3, 800, 600);

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  // 本机系统代理会拦截 127.0.0.1；Chrome 不认 macOS 的 ExceptionsList，
  // 不加这两项会落在 chrome-error://chromewebdata/，所有选择器静默变 null。
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b0-${Date.now()}`,
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
const consoleErrors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  // window.confirm() 会**同步阻塞渲染进程**，直到对话框被应答为止。
  // 无头 Chrome 不会自己应答，于是 Runtime.evaluate 永远不返回 ——
  // 表现是「CDP Runtime.evaluate 超时」，看着像卡死，其实是等一个没人点的确认框。
  // 画布调整的 apply 处理器第一句就是 `if (!window.confirm(message)) return;`。
  // 必须在浏览器进程侧自动接受，否则这一步永远是假失败。
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    return;
  }
  if (m.method === "Runtime.exceptionThrown") consoleErrors.push(String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 300));
});
/**
 * 单次 CDP 调用带超时。
 *
 * 必须有：生成是**同步跑在主线程**的，一次 300×150 就能把渲染进程锁住几十秒，
 * 期间 Runtime.evaluate 的回复根本不会来。没有这层超时，waitFor 的循环
 * 卡在 await 上永远等不到下一次判断，整个探针会静默挂死（实测挂过 20 分钟）。
 */
const send = (method, params = {}, timeoutMs = 20000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} 超时 ${timeoutMs}ms`)); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");

/** 硬性看门狗：无论如何不能让探针无限挂着。 */
const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 8 * 60 * 1000);
const watchdog = setTimeout(() => {
  console.error(`\n[watchdog] 探针超过 ${Math.round(WATCHDOG_MS / 1000)}s 仍未结束，强制退出`);
  cleanup();
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref?.();

const evalJs = async (expression, timeoutMs = 60000) => {
  // 生成期间渲染进程会被锁住，给足时间但绝不无限等
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 60000, label = "") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJs(expr)) return true; } catch (error) { console.log(`  [eval 失败] ${error.message}`); }
    await sleep(300);
  }
  console.log(`  [timeout] ${label || expr}`);
  return false;
};
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, "base64"));
};

const rectOf = async (selector) => JSON.parse(await evalJs(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return "null";
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
})()`));

/** 真机滚轮：走 CDP 输入层，不是合成事件。modifiers: 8 = Shift。 */
async function wheel(selector, deltaY, shiftKey = false) {
  const rect = await rectOf(selector);
  if (!rect) throw new Error(`找不到 ${selector}`);
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x: rect.x, y: rect.y, deltaX: 0, deltaY, modifiers: shiftKey ? 8 : 0,
  });
  await sleep(120);
}
/** 真机按键：走 CDP 输入层。 */
async function pressKey(key, code, keyCode, shiftKey = false) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shiftKey ? 8 : 0 });
  }
  await sleep(120);
}

try {
  /* ── 0a. 落地页 → 空白画板进入工作台（此时**没有源图**） ──────────── */
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");

  await evalJs(`document.querySelector('#blank-board-button').click()`);
  const modalOpen = await waitFor(`document.querySelector('#blank-board-modal')?.open === true`, 10000, "空白画板弹窗");
  check("空白画板弹窗打开", modalOpen);
  await evalJs(`(() => {
    document.querySelector('#blank-board-width').value = '104';
    document.querySelector('#blank-board-height').value = '104';
    document.querySelector('#create-blank-board-button').click();
    return true;
  })()`);
  const mounted = await waitFor(
    `document.body.dataset.workspaceState === 'ready' && Boolean(document.querySelector('#ws-size-controls'))`,
    90000, "工作台挂载");
  check("工作台挂载（带生产 CSP 头）", mounted, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!mounted) throw new Error("工作台没挂上，后续断言无意义");
  await sleep(1200);

  /* ── 0b. 无源图：尺寸必须 unresolved，绝不能是 500×500（§1 / §11） ── */
  const noSource = JSON.parse(await evalJs(`JSON.stringify({
    size: window.LibmsWorkspaceBridge.getGenerationSize(),
    ratio: window.LibmsWorkspaceBridge.getEffectiveSourceRatio(),
    readout: document.querySelector('#ws-size-value').textContent.trim(),
    applyDisabled: document.querySelector('#ws-size-apply').disabled,
    canvas: (() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })(),
  })`));
  check("无源图：resolved=false 且宽高为 null（§1 无依据不得生成 1:1）",
    noSource.size.resolved === false && noSource.size.width === null && noSource.size.height === null,
    `resolved=${noSource.size.resolved} w=${noSource.size.width} h=${noSource.size.height}`);
  check("无源图：比例返回 null 而不是 1（§11）", noSource.ratio === null, `ratio=${noSource.ratio}`);
  check("无源图：读数显示 unresolved（— × —）", /^—\s*×\s*—$/.test(noSource.readout), `readout="${noSource.readout}"`);
  check("无源图：「应用尺寸」不可点", noSource.applyDisabled === true);
  check("无源图：空白画布本身仍有 104×104（生成尺寸 ≠ 画布尺寸，§5）",
    noSource.canvas.w === 104 && noSource.canvas.h === 104, `canvas=${noSource.canvas.w}×${noSource.canvas.h}`);
  await shot("01-no-source");

  /* ── 1. 重新载入，走「上传图片」入口进入工作台（真实用户路径） ─────── */
  await send("Page.navigate", { url: `${BASE}/` });
  const landed2 = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "重新载入落地页");
  check("重新载入落地页", landed2);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");

  // 打点必须在**上传之前**装好：要数的是「一次导入触发几次生成」。
  await evalJs(`(() => {
    const bridge = window.LibmsWorkspaceBridge;
    if (!bridge.__b0ProbeWrapped) {
      const originalGenerate = bridge.generate.bind(bridge);
      window.__b0GenCount = 0;
      window.__b0GenArgs = [];
      bridge.generate = async (args) => {
        window.__b0GenCount += 1;
        // 记录**调用瞬间**的生成尺寸：这是判断「读数 100 却出了 104」的唯一证据。
        window.__b0GenArgs.push({ args: args || {}, at: Date.now(), size: bridge.getGenerationSize() });
        return originalGenerate(args);
      };
      const originalSize = bridge.setGenerationLongEdge.bind(bridge);
      window.__b0SizeLog = [];
      bridge.setGenerationLongEdge = (value) => {
        const result = originalSize(value);
        window.__b0SizeLog.push({ value, t: Date.now(), after: bridge.getGenerationSize().longEdge, stack: (new Error().stack || "").split("\\n").slice(1, 3).join(" <- ") });
        return result;
      };
      bridge.__b0ProbeWrapped = true;
    }
    window.__b0GenCount = 0; window.__b0GenArgs = []; window.__b0SizeLog = [];
    // 时间线采样：在页内自跑，不走 CDP，所以生成把主线程锁住也不会丢样本。
    window.__b0Timeline = [];
    const t0 = Date.now();
    clearInterval(window.__b0Timer);
    window.__b0Timer = setInterval(() => {
      const r = window.LibmsWorkspaceBridge.getResult();
      const s = window.LibmsWorkspaceBridge.getGenerationSize();
      // 注意：这里不能再用反引号模板（外层就是模板串），用字符串拼接。
      window.__b0Timeline.push((Date.now() - t0) + "ms grid=" + r.width + "x" + r.height + " longEdge=" + s.longEdge + " resolved=" + s.resolved + " gen=" + window.__b0GenCount);
      if (Date.now() - t0 > 14000) clearInterval(window.__b0Timer);
    }, 250);
    return true;
  })()`);

  await send("DOM.setFileInputFiles", { files: [FIXTURE_4_3], nodeId: inputNode.result.nodeId });

  const mounted2 = await waitFor(
    `document.body.dataset.workspaceState === 'ready' && Boolean(document.querySelector('#ws-size-controls'))`,
    90000, "上传入口挂载工作台");
  check("上传图片入口进入工作台", mounted2);
  if (!mounted2) throw new Error("上传入口没挂上工作台");

  const firstPattern = await waitFor(
    `window.LibmsWorkspaceBridge.getResult().grid?.length > 0`, 150000, "首帧生成");
  check("导入后产出首帧图纸", firstPattern);
  if (!firstPattern) throw new Error("首帧生成失败，后续断言无意义");
  await sleep(1500);
  console.log(`  [尺寸写入记录] ${await evalJs("JSON.stringify(window.__b0SizeLog || [])")}`);
  console.log(`  [时间线] ${await evalJs("(window.__b0Timeline || []).filter((_, i) => i % 2 === 0).join(' | ')")}`);
  console.log(`  [生成调用] ${await evalJs("JSON.stringify(window.__b0GenArgs || [])")}`);
  // §4 触发风暴：一次导入只允许出一版图。
  // 历史上有三条互不相让的入口（loadFile 的 autoProcessAfterLoad 直调 processImage、
  // 工作台 500ms 定时、倍数识别回调），一次导入能跑 2–3 次生成。
  const importCount = await evalJs("window.__b0GenCount");
  check("导入只生成一次（§4 触发风暴）", importCount === 1, `count=${importCount}`);

  const afterImport = JSON.parse(await evalJs(`JSON.stringify({
    size: window.LibmsWorkspaceBridge.getGenerationSize(),
    readout: document.querySelector('#ws-size-value').textContent.replace(/\\s+/g, ''),
    grid: (() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })(),
    source: (() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.sourceWidth, h: r.sourceHeight }; })(),
  })`));
  check("导入后识别出 4:3 源图", afterImport.source.w === 800 && afterImport.source.h === 600,
    `source=${afterImport.source.w}×${afterImport.source.h}`);
  check("首帧尺寸保持 4:3 比例（不是方图）",
    afterImport.grid.w > afterImport.grid.h && Math.abs(afterImport.grid.h / afterImport.grid.w - 0.75) < 0.02,
    `grid=${afterImport.grid.w}×${afterImport.grid.h} ratio=${(afterImport.grid.h / afterImport.grid.w).toFixed(4)}`);
  // 关键不变量：识别回调与生成是两条独立异步链，首帧尺寸必须与顶栏读数一致，不能分叉。
  //
  // 这里必须比对**顶栏文本**，不能只比 bridge 的实时值：上一版探针只比 bridge，
  // 结果 `grid=104×78 / readout=100×75` 这种真分叉被判成了 PASS —— 因为生成过程把
  // state.generationLongEdge 改成了 104，bridge 跟着变，两边"一致"地错，而用户看到的
  // 顶栏文本还停在 100×75。文本才是用户实际看到的那份事实。
  check("首帧尺寸 === 顶栏读数文本（识别与生成不分叉）",
    afterImport.grid.w === afterImport.size.width && afterImport.grid.h === afterImport.size.height
      && afterImport.readout === `${afterImport.grid.w}×${afterImport.grid.h}`,
    `grid=${afterImport.grid.w}×${afterImport.grid.h} readout=${afterImport.readout} bridge=${afterImport.size.width}×${afterImport.size.height}`);
  check("首帧长边来自像素倍数识别（100 = 800÷8），不是挂载默认值 104（§2 / §3）",
    afterImport.grid.w === 100 && afterImport.grid.h === 75, `grid=${afterImport.grid.w}×${afterImport.grid.h}`);
  // §5 真机回归守卫：canvas 是回写命名空间，绝不能被 generation-service 当尺寸传回来。
  // 历史症状：一次自动生成后长边被 canvas 里的 104 冲掉，出图与顶栏读数分叉。
  const importArgs = JSON.parse(await evalJs("JSON.stringify(window.__b0GenArgs || [])"));
  const leaked = importArgs.filter((entry) => entry.args && ("width" in entry.args || "height" in entry.args));
  check("自动生成调用不携带 width/height（§5 回写命名空间不得当入参）", leaked.length === 0,
    leaked.length ? JSON.stringify(leaked.map((entry) => entry.args)) : `args=${JSON.stringify(importArgs.map((entry) => entry.args))}`);

  /* ── 3. 打点：数 bridge.generate 的调用次数 ───────────────────────── */
  await evalJs(`(() => {
    const bridge = window.LibmsWorkspaceBridge;
    if (!bridge.__b0ProbeWrapped) {
      const original = bridge.generate.bind(bridge);
      window.__b0GenCount = 0;
      window.__b0GenArgs = [];
      bridge.generate = async (args) => { window.__b0GenCount += 1; window.__b0GenArgs.push(args || {}); return original(args); };
      bridge.__b0ProbeWrapped = true;
    }
    window.__b0GenCount = 0; window.__b0GenArgs = [];
    return true;
  })()`);
  const genCount = () => evalJs("window.__b0GenCount");

  /* ── 4. 滑杆 104 → 500：generation count 必须为 0（§7 核心） ───────── */
  const sliderRect = await rectOf("#ws-size-range");
  await evalJs(`(() => { const el = document.querySelector('#ws-size-range'); el.value = '104'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  // 用 CDP 真鼠标把滑杆一路拖到最右（500）
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: sliderRect.x, y: sliderRect.y, button: "left", clickCount: 1 });
  for (let x = sliderRect.x; x <= sliderRect.x + 90; x += 15) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: sliderRect.y, button: "left" });
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: sliderRect.x + 90, y: sliderRect.y, button: "left", clickCount: 1 });
  await sleep(400);
  // 再直接写满 500，确保草稿到顶（滑杆像素宽度未必够精确到 500）
  await evalJs(`(() => { const el = document.querySelector('#ws-size-range'); el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(1200);

  const afterSlider = JSON.parse(await evalJs(`JSON.stringify({
    count: window.__b0GenCount,
    readout: document.querySelector('#ws-size-value').textContent.replace(/\\s+/g, ''),
    tier: document.querySelector('#ws-size-tier').dataset.tier,
    tierHidden: document.querySelector('#ws-size-tier').hidden,
    tierText: document.querySelector('#ws-size-tier').textContent,
    committed: window.LibmsWorkspaceBridge.getGenerationSize().longEdge,
    number: document.querySelector('#ws-size-number').value,
  })`));
  check("滑杆拖到 500：generation count = 0（§7）", afterSlider.count === 0, `count=${afterSlider.count}`);
  check("滑杆拖到 500：读数按 4:3 派生 = 500×375（§4 不是 500×500）", afterSlider.readout === "500×375", `readout=${afterSlider.readout}`);
  check("滑杆拖到 500：命中超大尺寸分档（§8）", afterSlider.tier === "xlarge" && afterSlider.tierHidden === false, `tier=${afterSlider.tier} text="${afterSlider.tierText}"`);
  check("滑杆只改草稿，未提交到 bridge", Number(afterSlider.committed) !== 500, `committed longEdge=${afterSlider.committed}`);
  check("数字框与滑杆同步", afterSlider.number === "500", `number=${afterSlider.number}`);
  await shot("02-slider-500");

  /* ── 5. 滚轮 / Shift+滚轮 / 方向键：count 仍为 0（§6 / §7） ────────── */
  await evalJs(`(() => { const el = document.querySelector('#ws-size-range'); el.value = '104'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
  await wheel("#ws-size-controls", -100);
  const afterWheel = await evalJs("document.querySelector('#ws-size-number').value");
  check("滚轮 +1（§6 Wheel ±1）", afterWheel === "105", `longEdge=${afterWheel}`);

  await wheel("#ws-size-controls", 100, true);
  const afterShiftWheel = await evalJs("document.querySelector('#ws-size-number').value");
  check("Shift+滚轮 ±10（§6）", afterShiftWheel === "95", `longEdge=${afterShiftWheel}`);

  await evalJs(`document.querySelector('#ws-size-range').focus()`);
  await pressKey("ArrowUp", "ArrowUp", 38);
  const afterArrowUp = await evalJs("document.querySelector('#ws-size-number').value");
  check("方向键 ↑ +1（§6）", afterArrowUp === "96", `longEdge=${afterArrowUp}`);
  await pressKey("ArrowDown", "ArrowDown", 40, true);
  const afterShiftDown = await evalJs("document.querySelector('#ws-size-number').value");
  check("Shift+方向键 ↓ −10（§6）", afterShiftDown === "86", `longEdge=${afterShiftDown}`);

  const wheelCount = await genCount();
  check("滚轮 / 方向键全程 generation count = 0（§7）", wheelCount === 0, `count=${wheelCount}`);

  /* ── 6. 点「应用尺寸」：generation count = 1（§7） ─────────────────── */
  await evalJs(`(() => { const el = document.querySelector('#ws-size-number'); el.value = '104'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
  await evalJs("window.__b0GenCount = 0; document.querySelector('#ws-size-apply').click(); true");
  await waitFor(`window.__b0GenCount > 0`, 15000, "应用尺寸触发生成");
  await waitFor(`window.LibmsWorkspaceBridge.getResult().width === 104`, 120000, "生成完成");
  await sleep(800);
  const applied = JSON.parse(await evalJs(`JSON.stringify({
    count: window.__b0GenCount,
    grid: (() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })(),
    committed: window.LibmsWorkspaceBridge.getGenerationSize(),
  })`));
  check("点「应用尺寸」：generation count = 1（§7）", applied.count === 1, `count=${applied.count}`);
  check("应用后图纸 = 104×78（4:3，§4 样例）", applied.grid.w === 104 && applied.grid.h === 78, `grid=${applied.grid.w}×${applied.grid.h}`);
  check("bridge 已提交长边 104", applied.committed.longEdge === 104 && applied.committed.resolved === true, `longEdge=${applied.committed.longEdge}`);
  await shot("03-applied-104x78");

  /* ── 7. 编辑器画布调整（宽高独立）不受生成尺寸链路影响（§5） ──────── */
  // 这一步单独兜底：渲染进程偶尔会在截图/绘制后短暂无响应，
  // 一次 CDP 超时不该把整轮探针的其余结论一起丢掉。
  const beforeResizeCount = await genCount();
  // 记录卡在哪一小步：只报「CDP Runtime.evaluate 超时」等于没报。
  // 每步用 20s 上限而不是默认 60s，卡住就快速失败，别把整轮预算吃光。
  let resizePhase = "打开调整尺寸弹窗";
  try {
    await evalJs("document.querySelector('#ws-resize-open').click()", 20000);
    resizePhase = "等待弹窗 open";
    await waitFor(`document.querySelector('#ws-resize-dialog')?.open === true`, 15000, "调整尺寸弹窗");
    resizePhase = "填 60×40 并应用";
    await evalJs(`(() => {
      document.querySelector('#ws-resize-width').value = '60';
      document.querySelector('#ws-resize-height').value = '40';
      document.querySelector('#ws-resize-apply').click();
      return true;
    })()`, 20000);
    resizePhase = "等待画布重建";
    await sleep(2000);
    resizePhase = "读取结果";
    const resized = JSON.parse(await evalJs(`JSON.stringify({
      grid: (() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })(),
      size: window.LibmsWorkspaceBridge.getGenerationSize(),
      count: window.__b0GenCount,
    })`, 20000));
    check("编辑器画布调整允许宽高独立（104×78 → 60×40，§5）",
      resized.grid.w === 60 && resized.grid.h === 40, `grid=${resized.grid.w}×${resized.grid.h}`);
    check("画布调整不触发重新生成（§5 两条链路不共用）",
      resized.count === beforeResizeCount, `before=${beforeResizeCount} after=${resized.count}`);
    check("画布调整不改生成尺寸（生成长边仍是 104）",
      resized.size.longEdge === 104 && resized.size.width === 104 && resized.size.height === 78,
      `size=${resized.size.width}×${resized.size.height} longEdge=${resized.size.longEdge}`);
    await shot("04-canvas-resize-60x40");
  } catch (error) {
    check("编辑器画布调整回归（§5）", false, `卡在「${resizePhase}」：${error.message}`);
  }

  /* ── 8. 控制台无未捕获异常 ─────────────────────────────────────────── */
  //
  // 生产 CSP 的 script-src 只给了 'wasm-unsafe-eval'，tfjs / nsfwjs 内部用
  // `new Function` 编译算子必然抛 EvalError。那是**第三方库**的行为，不是本站代码
  // （src/ 与 services/ 下 `new Function(` / `eval(` 全仓 0 命中）。
  // 单独列为 INFO，不让一条已知的第三方告警把「无未捕获异常」这条门禁长期染红 ——
  // 门禁一旦永远红着，真出问题时也没人看。
  const THIRD_PARTY_CSP = /EvalError|unsafe-eval|Content Security Policy/i;
  const thirdParty = consoleErrors.filter((text) => THIRD_PARTY_CSP.test(text));
  const realErrors = consoleErrors.filter((text) => !THIRD_PARTY_CSP.test(text));
  check("运行期无未捕获异常", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));
  if (thirdParty.length) {
    console.log(`  [INFO] 第三方 CSP 告警 ${thirdParty.length} 条（tfjs/nsfwjs 的 new Function，非本站代码）`);
  }
} catch (error) {
  check("探针执行完成", false, error.message);
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  console.log(`截图：${OUT}`);
  ws.close();
  cleanup();
  process.exit(failed.length ? 1 : 0);
}
