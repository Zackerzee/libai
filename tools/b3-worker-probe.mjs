#!/usr/bin/env node
/**
 * Stage B3 真机探针：生成 Worker 的「真的在用 / 界面真的不冻 / 取消真的停 / 旧结果真的丢」。
 *
 * 为什么必须在真机跑：静态测试能证明 `new Worker(url, {type:"module"})` 写在代码里，
 * 证明不了**生产 CSP 下它真能起来**。B3 §34 要的正是这一条 ——
 * `worker-src 'self' blob:` 是有的，但「头里有」和「Worker 真起来了」是两件事。
 * 同理 §31 要的「300/400/500 时界面能滚动、能点取消」也只能在真机上量。
 *
 * 四类取证手段：
 *   1. **CDP Target 发现**：`Target.targetCreated` 里出现 type=worker 且 URL 指向
 *      generation.worker.mjs —— 这是「真的有独立线程」的硬证据，不是靠日志猜的。
 *   2. **控制台取证**：主线程兜底路径会打印「生成 Worker 失败，退回主线程执行」。
 *      全程不出现这句 = 走的就是 Worker 路径。
 *   3. **页内心跳**：50ms 心跳的最大间隔直接就是「主线程被冻了多久」。
 *      这是比 longtask 更贴近用户感受的指标（用户感受的就是「点不动」）。
 *   4. **PerformanceObserver longtask**：官方 Long Task API，作为交叉验证。
 *
 * Benchmark（§35）按档位逐个跑，每档记录：
 *   总耗时 / 主线程最大心跳间隔 / 最长 longtask / 是否完成。
 * 大档位（400/500）有单档预算，超预算就**取消并记录取消延迟** ——
 * 这比「跑不完就跳过」更有信息量：它直接回答 §32 的「500 到底允不允许」。
 *
 * 用法：
 *   node tools/b3-worker-probe.mjs                      # 全档位
 *   B3_TIERS=52,104,300 node tools/b3-worker-probe.mjs  # 只跑指定档位
 *   LIBMS_BASE=http://127.0.0.1:8798 node tools/b3-worker-probe.mjs
 *
 * 环境变量：
 *   B3_TIERS             逗号分隔的长边档位，默认 52,78,104,200,300,400,500
 *   B3_BIG_TIER_MS       单档预算（毫秒），默认 240000（4 分钟）
 *   B3_SKIP_BENCH=1      只跑正确性/响应性，不跑 benchmark
 *   PROBE_TIMEOUT_MS     全局看门狗，默认 25 分钟
 *   OUT_DIR              截图输出目录
 */
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9388);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8813);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/b3-worker");
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b3-probe");
const TIERS = (process.env.B3_TIERS || "52,78,104,200,300,400,500").split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
const BIG_TIER_MS = Number(process.env.B3_BIG_TIER_MS || 240000);
const SKIP_BENCH = process.env.B3_SKIP_BENCH === "1";

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
 * 800×600、8px 均匀块 —— 与 B0 探针同款夹具。
 * 块内必须**完全同色**：带逐像素渐变会让 detectPixelMultiple 退回 1×，
 * 逻辑尺寸从 100×75 变成 800×600 再被夹到 500，白白拖长每次生成。
 * 同时块状结构保证采样/匹配阶段不会走纯色图特殊分支。
 */
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

/**
 * 照片质感夹具：平滑渐变 + 细纹理 + 高光，**每个像素都不同色**。
 *
 * 为什么必须有第二个夹具：块状 2 色图是**下界**，不是真实工作量。
 * 它让调色板匹配几乎退化成查表，预算合并阶段无事可做 ——
 * 实测 500 档只要 8.2s。真实照片会走满「数千种源色 × 数百种调色板色」
 * 的匹配与 maxColors 合并，量级完全不同。
 *
 * 拿 2 色图的结果去回答 §32「500 允不允许」就是拍脑袋。
 * 所以这里生成一张有连续色相、有暗部、有高光、有细噪声的图，
 * 让两个数字（下界 / 上界）都摆出来。
 */
function writePhotoPng(file, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  // 确定性伪随机，保证每次跑的是同一张图（benchmark 必须可复现）。
  let seed = 0x2f6e2b1;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + 1 + x * 3;
      const u = x / width, v = y / height;
      // 连续色相 + 明暗，避免大面积同色导致提前收敛。
      const hue = (u * 1.7 + v * 0.9) % 1;
      const light = 0.18 + 0.7 * (0.5 + 0.5 * Math.sin((u + v) * Math.PI * 2.2));
      const r0 = Math.sin(hue * Math.PI * 2) * 0.5 + 0.5;
      const g0 = Math.sin((hue + 1 / 3) * Math.PI * 2) * 0.5 + 0.5;
      const b0 = Math.sin((hue + 2 / 3) * Math.PI * 2) * 0.5 + 0.5;
      // 细纹理：高频低幅噪声，模拟照片颗粒与细节。
      const grain = (rand() - 0.5) * 34;
      // 局部高光 / 阴影块，制造「需要保留细节」的结构。
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
// B3_FIXTURE=blocks（默认，2 色块状，下界）/ photo（照片质感，上界）
const FIXTURE_KIND = process.env.B3_FIXTURE === "photo" ? "photo" : "blocks";
const FIXTURE = path.join(FIXTURE_DIR, FIXTURE_KIND === "photo" ? "photo-800x600.png" : "blocks-800x600.png");
if (!fs.existsSync(FIXTURE)) {
  if (FIXTURE_KIND === "photo") writePhotoPng(FIXTURE, 800, 600);
  else writePng(FIXTURE, 800, 600);
}
console.log(`夹具：${FIXTURE_KIND}（${FIXTURE}）`);

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  // 系统代理会拦 127.0.0.1，Chrome 不认 macOS 的 ExceptionsList。
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b3-${Date.now()}`,
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
const workerTargets = [];
const cspViolations = [];

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }

  // §34：CSP 违规是 Worker 起不来的头号原因，必须显式收集而不是靠猜。
  if (m.method === "Log.entryAdded") {
    const entry = m.params?.entry || {};
    const text = String(entry.text || "");
    if (/Content Security Policy|CSP/i.test(text)) cspViolations.push(text.slice(0, 240));
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleMessages.push({ type: m.params?.type, text: String(text).slice(0, 300) });
  }
  if (m.method === "Runtime.exceptionThrown") {
    consoleMessages.push({ type: "exception", text: String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 300) });
  }
  // §34 硬证据：真的多了一个独立线程。
  // 注意 CDP 对 dedicated worker 常在 targetCreated 时给 url:""，
  // 真实 URL 要等 targetInfoChanged —— 所以两处都收。
  if (m.method === "Target.targetCreated" && m.params?.targetInfo?.type === "worker") {
    workerTargets.push({ url: m.params.targetInfo.url, id: m.params.targetInfo.targetId });
  }
  if (m.method === "Target.targetInfoChanged" && m.params?.targetInfo?.type === "worker") {
    const info = m.params.targetInfo;
    const existing = workerTargets.find((t) => t.id === info.targetId);
    if (existing) { if (info.url) existing.url = info.url; }
    else workerTargets.push({ url: info.url, id: info.targetId });
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
await send("Target.setDiscoverTargets", { discover: true });

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 25 * 60 * 1000);
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

/* ── 页内打点：一次装好，后面每个用例复用 ─────────────────────────── */
/*
 * 为什么必须**在上传之前**装：上传完成后 ui/workspace.js 会立刻排一次自动生成，
 * 那一次就会走 getGenerationWorkerClient() 把 WorkerCtor 定下来。
 * 装晚了就再也看不到 `new Worker` 的真实 URL 了（实测：workers=[]）。
 *
 * 但上传时工作台还没挂载，拿不到 #ws-status / bridge。所以这里拆成两段：
 *   · 立刻装：心跳 + longtask + window.Worker 打点（不依赖 DOM）
 *   · 轮询装：状态栏 MutationObserver + bridge.generate 包装（等挂载完成）
 */
const INSTRUMENT = `(() => {
  if (window.__b3Probe) return "already";
  const probe = {
    runs: [],            // 每次 bridge.generate 的 {ms, ok, error, at}
    heartbeat: { max: 0, count: 0, last: performance.now(), gaps: [] },
    longtasks: [],
    phases: [],          // #ws-status 文案变化序列
    workers: [],         // 真的被 new 出来的 Worker（url + options）
    domReady: false,
    startAt: 0,
  };
  window.__b3Probe = probe;

  // §34 最硬的证据：把 window.Worker 包一层，记录**实际被 new 出来的 URL 与 type**。
  // 光看 CDP 的 worker target 不够 —— 它只说明「多了个线程」，不说明是哪个脚本；
  // 而 CDP 对 dedicated worker 常常先报 url:""（要等 targetInfoChanged 才有）。
  try {
    const NativeWorker = window.Worker;
    if (NativeWorker && !NativeWorker.__b3Probed) {
      class ProbedWorker extends NativeWorker {
        constructor(url, options) {
          probe.workers.push({ url: String(url), type: options && options.type ? String(options.type) : null });
          super(url, options);
        }
      }
      ProbedWorker.__b3Probed = true;
      window.Worker = ProbedWorker;
    }
  } catch (error) {
    probe.workerPatchError = String((error && error.message) || error);
  }

  // 50ms 心跳：最大间隔 = 主线程被冻住的时长（用户感受就是这个）。
  setInterval(() => {
    const now = performance.now();
    const gap = now - probe.heartbeat.last;
    probe.heartbeat.last = now;
    probe.heartbeat.count += 1;
    probe.heartbeat.gaps.push(Math.round(gap));
    if (gap > probe.heartbeat.max) probe.heartbeat.max = gap;
    if (probe.heartbeat.gaps.length > 4000) probe.heartbeat.gaps.splice(0, 2000);
  }, 50);

  // 官方 Long Task API 交叉验证。
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longtasks.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}

  // 第二段：等工作台挂载完成再挂 DOM / bridge 打点。
  const attachDom = () => {
    const statusNode = document.querySelector("#ws-status");
    const bridge = window.LibmsWorkspaceBridge;
    if (!statusNode || !bridge || !bridge.generate) { setTimeout(attachDom, 100); return; }

    new MutationObserver(() => {
      const text = statusNode.textContent.trim();
      const last = probe.phases[probe.phases.length - 1];
      if (!last || last.text !== text) {
        const at = Math.round(performance.now());
        probe.phases.push({ text, at });
        // 记住「正在完成图纸…」这一帧：它是引擎里最后一个 phase 钩子。
        // 之后的活（engine 收尾 / encode / postMessage / 主线程 decode+提交）
        // 全在这条线之后 —— 归因长任务时要用它当分界。
        if (!probe.finalizeAt && /正在完成图纸/.test(text)) probe.finalizeAt = at;
      }
    }).observe(statusNode, { childList: true, characterData: true, subtree: true });

    // 包一层 bridge.generate 量总耗时。绝不改行为，只记录。
    //
    // commitMs = 「最后一次进度」到「generate 落地」之间的时间。
    // 为什么要它：Worker 只搬走了**计算**，结果回来之后主线程还要
    //   decodeGenerationResult 建 w×h 个格子 → state.grid.map 再建一遍
    //   → cloneGrid 再深拷一遍 → calculateStats → 渲染。
    // 500 档就是 18.75 万格 × 3 遍。这一段如果长，长在「提交」而不是「计算」；
    // 不量出来就会误判成「Worker 没起作用」。
    const original = bridge.generate.bind(bridge);
    bridge.generate = async (args) => {
      const t0 = performance.now();
      probe.startAt = t0;
      probe.phases = [];
      probe.finalizeAt = 0;
      try {
        const result = await original(args);
        probe.runs.push({ ms: Math.round(performance.now() - t0), ok: Boolean(result), error: null, at: Math.round(t0) });
        return result;
      } catch (error) {
        probe.runs.push({ ms: Math.round(performance.now() - t0), ok: false, error: String((error && error.name) || "") + ":" + String((error && error.message) || error), at: Math.round(t0) });
        throw error;
      }
    };
    probe.domReady = true;
  };
  attachDom();
  return "installed";
})()`;

/** 清空打点，准备量下一档。 */
const RESET_PROBE = `(() => {
  const p = window.__b3Probe;
  p.runs = []; p.longtasks = []; p.phases = [];
  p.heartbeat.max = 0; p.heartbeat.count = 0; p.heartbeat.last = performance.now(); p.heartbeat.gaps = [];
  return true;
})()`;

const readProbe = () => evalJson(`(() => {
  const p = window.__b3Probe;
  const gaps = p.heartbeat.gaps.filter((g) => g > 200);
  const t0 = p.startAt;
  const tasks = p.longtasks.map((t) => ({ startOffset: Math.round(t.start - t0), dur: t.dur }))
    .sort((a, b) => b.dur - a.dur).slice(0, 5);
  return {
    runs: p.runs,
    workers: p.workers,
    heartbeatMax: p.heartbeat.max,
    heartbeatCount: p.heartbeat.count,
    blockedGaps: gaps.slice(0, 10),
    blockedCount: gaps.length,
    longtasks: p.longtasks,
    longestTask: p.longtasks.reduce((m, t) => Math.max(m, t.dur), 0),
    topTasks: tasks,
    // 归因：finalize 相对生成起点的偏移，以及最后一个阶段文案的时间。
    finalizeOffset: p.finalizeAt ? Math.round(p.finalizeAt - t0) : null,
    phases: p.phases.map((x) => ({ text: x.text, offset: Math.round(x.at - t0) })),
    generating: window.LibmsWorkspaceBridge.isGenerating(),
    status: document.querySelector("#ws-status").textContent.trim(),
    canvas: (() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })(),
  };
})()`);

/* ── 主流程 ─────────────────────────────────────────────────────── */
try {
  /* 0. 进入工作台：走真实用户路径（上传图片） */
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");

  // 打点必须在**上传之前**装好：上传完成后会立刻排一次自动生成，
  // 那一次就会把 WorkerCtor 定下来，装晚了就看不到真实 Worker URL（实测踩过）。
  await evalJs(INSTRUMENT);
  check("页内打点已安装（含 window.Worker 打点）",
    (await evalJs(`Boolean(window.__b3Probe && window.__b3Probe.workers)`)) === true);

  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");
  await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [FIXTURE] });

  const mounted = await waitFor(
    `document.body.dataset.workspaceState === 'ready' && Boolean(document.querySelector('#ws-size-controls'))`,
    120000, "工作台挂载");
  check("工作台挂载（带生产 CSP 头）", mounted, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!mounted) throw new Error("工作台没挂上，后续断言无意义");

  // 上传后会先跑本地内容审查（首次要下 ~4.8MB 模型）。
  // 不能靠固定 sleep：要等「生成按钮可用 + 源图预览已是 data URL」。
  const ready = await waitFor(
    `(() => { const b = document.querySelector('#ws-size-apply'); const p = document.querySelector('#source-preview'); return Boolean(b) && !b.disabled; })()`,
    180000, "源图就绪");
  check("源图就绪（内容审查完成）", ready);
  await sleep(1500);
  // 等第二段打点（状态栏观察者 + bridge 包装）挂上。
  const domReady = await waitFor(`window.__b3Probe?.domReady === true`, 30000, "页内 DOM 打点");
  check("页内 DOM 打点已挂载（状态栏 + bridge）", domReady);
  await shot("01-workspace");

  /* 1. §34：Worker 在生产 CSP 下真的起来了 */
  await evalJs(RESET_PROBE);
  // 先做一次小档位生成，观察是否出现 worker target / CSP 违规 / 兜底告警。
  await evalJs(`(() => {
    const n = document.querySelector('#ws-size-number');
    n.value = '52'; n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ws-size-apply').click();
    return true;
  })()`);
  const firstDone = await waitFor(`window.__b3Probe.runs.length > 0 && !window.LibmsWorkspaceBridge.isGenerating()`, 180000, "首次生成完成");
  check("首次生成完成", firstDone);
  await sleep(800);

  const firstProbe = await readProbe();
  const workerByUrl = workerTargets.filter((t) => /generation\.worker\.mjs/.test(t.url));
  const spawned = firstProbe.workers.filter((w) => /generation\.worker\.mjs/.test(w.url));
  check("§34 真的 new 出了生成 Worker（URL + module 类型取证）",
    spawned.length > 0 && spawned[0].type === "module",
    spawned.length ? `${spawned[0].url.split("/").pop()} type=${spawned[0].type}` : `workers=${JSON.stringify(firstProbe.workers)}`);
  check("§34 真的多了一个独立线程（CDP Target 取证，与上一条互为交叉验证）",
    workerTargets.length > 0 || workerByUrl.length > 0,
    `workerTargets=${workerTargets.length} urlMatch=${workerByUrl.length}`);

  const fellBack = consoleMessages.filter((m) => /退回主线程/.test(m.text));
  check("§34 没有走主线程兜底（无「退回主线程」告警）", fellBack.length === 0,
    fellBack.length ? fellBack[0].text.slice(0, 160) : "");

  const workerCsp = cspViolations.filter((t) => /worker/i.test(t));
  check("§34 生产 CSP 未拦 Worker（worker-src 'self' blob: 生效）", workerCsp.length === 0,
    workerCsp.length ? workerCsp[0].slice(0, 200) : "");
  const anyCsp = cspViolations.filter((t) => !/EvalError|wasm-unsafe-eval/i.test(t));
  note("CSP 违规条目", anyCsp.length ? `${anyCsp.length} 条（首条：${anyCsp[0].slice(0, 140)}）` : "0 条");

  /* 2. §30：进度文案真的出现在界面上 */
  const phaseTexts = firstProbe.phases.map((p) => p.text);
  const progressPhases = phaseTexts.filter((t) => /正在分析图片|正在匹配真实色号|正在整理色块|正在完成图纸/.test(t));
  check("§30 生成过程中界面上出现过中文阶段进度", progressPhases.length > 0,
    progressPhases.length ? progressPhases.slice(0, 4).join(" → ") : `phases=${JSON.stringify(phaseTexts.slice(0, 6))}`);
  check("§30 进度文案不含内部算法名",
    !phaseTexts.some((t) => /palette matching|smart cleanup|accentProtection|paletteBudget|sampling/i.test(t)),
    phaseTexts.slice(0, 4).join(" → "));
  check("首次生成产出图纸（52 档）", firstProbe.canvas.w > 0 && firstProbe.canvas.h > 0, `canvas=${firstProbe.canvas.w}×${firstProbe.canvas.h}`);

  /* 3. §31：主线程在生成期间没有被冻住 */
  check("§31 52 档生成期间主线程可响应（心跳最大间隔 < 400ms）",
    firstProbe.heartbeatMax < 400, `max=${firstProbe.heartbeatMax}ms count=${firstProbe.heartbeatCount}`);
  note("52 档耗时", `${firstProbe.runs.map((r) => r.ms).join("ms, ")}ms`);

  /* 4. §29：取消真的停，且不报「失败」 */
  await evalJs(RESET_PROBE);
  await evalJs(`(() => {
    const n = document.querySelector('#ws-size-number');
    n.value = '300'; n.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ws-size-apply').click();
    return true;
  })()`);
  // 等到真的开始算（进度出现）再取消，否则取消的是空气。
  const started = await waitFor(`window.LibmsWorkspaceBridge.isGenerating()`, 60000, "300 档开始生成");
  check("300 档开始生成", started);
  await sleep(600);

  const cancelButtonVisible = await evalJs(`!document.querySelector('#ws-cancel-generate').hidden`);
  check("§31 生成中「取消生成」按钮可见", cancelButtonVisible === true);

  const cancelLatency = await evalJs(`(async () => {
    const t0 = performance.now();
    document.querySelector('#ws-cancel-generate').click();
    // 等到 isGenerating() 归位：这才是用户视角的「真的停了」。
    for (let i = 0; i < 400; i += 1) {
      if (!window.LibmsWorkspaceBridge.isGenerating()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return Math.round(performance.now() - t0);
  })()`, 60000);
  check("§29 取消延迟在 2s 内（真 terminate，不是等它跑完）", cancelLatency < 2000, `${cancelLatency}ms`);

  const afterCancel = await readProbe();
  check("§29 取消后状态显示「已取消生成」，不是「生成失败」",
    /已取消生成/.test(afterCancel.status) && !/生成失败/.test(afterCancel.status), `status="${afterCancel.status}"`);
  check("§29 取消后没有写入生成错误",
    !consoleMessages.some((m) => /现有生成链路未返回结果/.test(m.text)),
    "");
  check("§29 取消后 isGenerating() 归位", afterCancel.generating === false);
  const cancelledRun = afterCancel.runs[afterCancel.runs.length - 1];
  note("取消那次的结局", cancelledRun ? `${cancelledRun.ms}ms ok=${cancelledRun.ok} error=${cancelledRun.error || "无"}` : "无记录");
  await shot("02-after-cancel");

  /* 5. §33：旧结果绝不覆盖新尺寸 */
  await evalJs(RESET_PROBE);
  const staleOutcome = await evalJs(`(async () => {
    const n = document.querySelector('#ws-size-number');
    const apply = document.querySelector('#ws-size-apply');
    // 先起一个 300 档（慢），不等它完就改成 52 档（快）。
    n.value = '300'; n.dispatchEvent(new Event('input', { bubbles: true })); apply.click();
    for (let i = 0; i < 120; i += 1) {
      if (window.LibmsWorkspaceBridge.isGenerating()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 500));
    n.value = '52'; n.dispatchEvent(new Event('input', { bubbles: true })); apply.click();
    // 等两轮都彻底安静下来。
    for (let i = 0; i < 900; i += 1) {
      if (!window.LibmsWorkspaceBridge.isGenerating()) {
        await new Promise((r) => setTimeout(r, 400));
        if (!window.LibmsWorkspaceBridge.isGenerating()) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const result = window.LibmsWorkspaceBridge.getResult();
    return { width: result.width, height: result.height };
  })()`, 240000);
  check("§33 换尺寸后最终图纸是**新**尺寸（旧结果没覆盖回去）",
    staleOutcome.width === 52, `最终 ${staleOutcome.width}×${staleOutcome.height}（期望宽 52）`);
  await shot("03-after-restale");

  /* 6. §35：Benchmark */
  if (SKIP_BENCH) {
    note("Benchmark", "B3_SKIP_BENCH=1，已跳过");
  } else {
    console.log(`\n── Benchmark（§35）：档位 ${TIERS.join(" / ")}，单档预算 ${Math.round(BIG_TIER_MS / 1000)}s ──`);
    const bench = [];
    for (const tier of TIERS) {
      await evalJs(RESET_PROBE);
      // 单档预算按档位分档：小档位不该占用大档位的时间预算，
      // 否则「500 跑不完」会掩盖「52 档其实早就跑完了」。
      const budget = tier <= 104 ? 60000 : (tier <= 300 ? 180000 : BIG_TIER_MS);
      const outcome = await evalJs(`(async () => {
        const n = document.querySelector('#ws-size-number');
        const apply = document.querySelector('#ws-size-apply');
        n.value = String(${tier}); n.dispatchEvent(new Event('input', { bubbles: true }));
        const t0 = performance.now();
        apply.click();
        let completed = false;
        while (performance.now() - t0 < ${budget}) {
          const p = window.__b3Probe;
          if (p.runs.length > 0 && !window.LibmsWorkspaceBridge.isGenerating()) { completed = true; break; }
          await new Promise((r) => setTimeout(r, 50));
        }
        let cancelMs = null;
        if (!completed) {
          const c0 = performance.now();
          window.LibmsWorkspaceBridge.cancelGeneration('benchmark 超预算');
          for (let i = 0; i < 400; i += 1) {
            if (!window.LibmsWorkspaceBridge.isGenerating()) break;
            await new Promise((r) => setTimeout(r, 25));
          }
          cancelMs = Math.round(performance.now() - c0);
        }
        await new Promise((r) => setTimeout(r, 300));
        const result = window.LibmsWorkspaceBridge.getResult();
        return { completed, cancelMs, width: result.width, height: result.height, status: document.querySelector('#ws-status').textContent.trim() };
      })()`, budget + 120000);

      const probe = await readProbe();
      const run = probe.runs[0] || null;
      const topTask = probe.topTasks[0] || null;
      const row = {
        tier,
        completed: outcome.completed,
        ms: run ? run.ms : null,
        cells: outcome.width * outcome.height,
        heartbeatMax: probe.heartbeatMax,
        longestTask: probe.longestTask,
        // 归因：最长任务相对生成起点的偏移，与 finalize 偏移对比。
        // 任务起点 > finalize → 这段停顿在「结果回来之后」，即主线程提交；
        // 任务起点 < finalize → 说明还有活留在主线程上（不该发生）。
        longestTaskAt: topTask ? topTask.startOffset : null,
        finalizeOffset: probe.finalizeOffset,
        blockedCount: probe.blockedCount,
        cancelMs: outcome.cancelMs,
        canvas: `${outcome.width}×${outcome.height}`,
        status: outcome.status,
      };
      bench.push(row);
      const perCell = run && outcome.width * outcome.height ? (run.ms / (outcome.width * outcome.height)).toFixed(3) : "—";
      const where = topTask == null ? "—"
        : (probe.finalizeOffset != null && topTask.startOffset >= probe.finalizeOffset ? "结果提交段" : "finalize 之前");
      console.log(`  ${String(tier).padStart(3)} 档 → ${outcome.width}×${outcome.height}  ` +
        `${row.completed ? `${run ? run.ms : "?"}ms` : `超预算(${Math.round(budget / 1000)}s)未完成`}  ` +
        `主线程最大间隔 ${probe.heartbeatMax}ms  最长任务 ${probe.longestTask}ms@t+${topTask ? topTask.startOffset : "?"}ms（${where}）  ` +
        `单格 ${perCell}ms` +
        `${row.cancelMs != null ? `  取消延迟 ${row.cancelMs}ms` : ""}`);
      await shot(`bench-${tier}`);
    }

    fs.writeFileSync(path.join(OUT, `benchmark-${FIXTURE_KIND}.json`), JSON.stringify({ fixture: FIXTURE_KIND, tiers: bench }, null, 2));
    note("Benchmark 明细", path.join(OUT, `benchmark-${FIXTURE_KIND}.json`));

    // §31 的**硬要求**：不得「冻结几十秒/几分钟」。
    // 这是这一阶段真正要证明的事 —— 之前 300 档就能锁死主线程几十秒。
    const completedRows = bench.filter((r) => r.completed);
    const frozen = completedRows.filter((r) => r.heartbeatMax >= 5000);
    check("§31 所有完成档位主线程未被冻结（最大停顿 < 5s，非「几十秒」）",
      frozen.length === 0,
      frozen.length ? frozen.map((r) => `${r.tier}档 ${r.heartbeatMax}ms`).join(", ") : completedRows.map((r) => `${r.tier}:${Math.round(r.heartbeatMax)}ms`).join(" "));

    // 更严的目标值单独报，**不混进 PASS/FAIL** —— 它是我自己定的质量线，不是规范要求。
    // 不藏起来：这条数字就是下一个瓶颈，必须原样出现在报告里。
    const tight = completedRows.filter((r) => r.heartbeatMax >= 1000);
    note("§31 更严目标（< 1000ms，非规范要求）",
      tight.length
        ? `${tight.map((r) => `${r.tier}档 ${Math.round(r.heartbeatMax)}ms（最长任务 ${r.longestTask}ms 起于 t+${r.longestTaskAt}ms，finalize 在 t+${r.finalizeOffset}ms）`).join("；")}`
        : "全部档位 < 1000ms");

    // §31：大档位即使没跑完，也必须「能点取消」且取消很快生效。
    const cancelledRows = bench.filter((r) => !r.completed);
    if (cancelledRows.length) {
      check("§31 超预算档位仍能取消，且取消延迟 < 2s",
        cancelledRows.every((r) => r.cancelMs != null && r.cancelMs < 2000),
        cancelledRows.map((r) => `${r.tier}档 ${r.cancelMs}ms`).join(", "));
    }

    // §32：基于真实数据给出「500 允不允许」的结论，不拍脑袋。
    // 必须带上夹具口径 —— 合成块状图与照片质感图差 5 倍，只报一个数就是误导。
    const biggest = bench.filter((r) => r.completed).map((r) => r.tier).sort((a, b) => b - a)[0] || null;
    const notCompleted = bench.filter((r) => !r.completed).map((r) => r.tier);
    note("§32 结论", `夹具=${FIXTURE_KIND}；` + (biggest == null
      ? "没有任何档位在预算内完成 —— 需重新评估"
      : `预算内可完成的最大档位 = ${biggest}；${notCompleted.length ? `${notCompleted.join("/")} 档超预算` : "无档位超预算"}`));
  }
} catch (error) {
  check("探针未抛异常", false, String(error?.message || error));
  console.error(error);
} finally {
  clearTimeout(watchdog);
  await shot("99-final");
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("失败项：");
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? `  ${f.detail}` : ""}`);
  }
  console.log(`截图与 benchmark.json：${OUT}`);
  cleanup();
  // 注意：沙箱会拦截 Chrome 自己的临时文件清理，导致 shell 退出码非 0。
  // 判定标准是上面的 `N/N PASS`，不是退出码。
  process.exitCode = failed.length ? 1 : 0;
}
