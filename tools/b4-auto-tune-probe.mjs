#!/usr/bin/env node
/**
 * Stage B4 §13 真机探针：Auto Tune 在**生产产物 + 生产 CSP** 下的行为取证（§29）。
 *
 * ── 为什么必须在真机上做 ────────────────────────────────────────────────
 * 单测能证明调优器的每个分支都对，但证明不了下面这些事：
 *   · 面板点「智能」之后，**真的**走到了 `runAutoTuneV2`（中间隔着
 *     panel → store → buildV25Options → processImageV2 四跳）；
 *   · 候选**真的**只在预览尺寸上跑，赢家才在目标尺寸跑一次（§5）——
 *     这条只有数 Worker 请求才能证；
 *   · 用户看到的三句进度文案是「正在分析图片…」而不是算法术语（§16）；
 *   · 取消按钮真的能中断一个**循环**里的候选（§19）—— 单测用的是假执行器，
 *     真机才有真 Worker 的 terminate。
 *
 * ── 取证位置 ───────────────────────────────────────────────────────────
 * ① 页内 patch `Worker.prototype.postMessage` → 抓每次生成的 request。
 *    能读到 `size` / `maxColors` / `overrides.labCandidate` / `requestId`。
 * ② `LibmsWorkspaceBridge.getAutoTuneReport()` → 抓 §15 报告（不含网格）。
 * ③ 监听 `libms:generation-phase` → 抓用户实际看到的进度文案。
 * ④ `requestAnimationFrame` 间隔 → 量调优期间主线程有没有卡死。
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   node tools/b4-auto-tune-probe.mjs
 * 环境变量：
 *   LIBMS_BASE / CDP_PORT / SERVE_PORT / OUT_DIR / PROBE_TIMEOUT_MS /
 *   B4_AT_LONG_EDGE（默认 156）/ B4_AT_ONLY（逗号分隔的夹具名，调试用）
 *
 * ⚠️ `LIBMS_BASE` 指向静态服务根时，**必须**是带生产 CSP 头的那个
 *    （`tools/serve-with-headers.mjs`），不是 `python3 -m http.server`。
 *    不带 CSP 的「验过」和「能上」是两件事。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9401);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8824);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b4-auto-tune");
const LONG_EDGE = Number(process.env.B4_AT_LONG_EDGE || 156);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const note = (name, detail) => console.log(`INFO  ${name}${detail ? `  ${detail}` : ""}`);

/**
 * 夹具 → §29 要求覆盖的内容类别。
 *
 * 全部用**磁盘上的真实 PNG**（`tests/fixtures/`），不现场合成：
 * 探针要验的是「用户上传一张图之后会怎样」，现场合成的图会绕开解码与内容审查。
 * `expect` 只写「这张图想代表什么」，**不写「必须路由到哪个模式」** ——
 * 路由是 §12.8 的已知残留（不在 §13 修），拿它当断言会得到一个
 * 「探针红、产品没错」的假失败。
 */
const FIXTURES = [
  { name: "portrait-eye", file: "tests/fixtures/real-failures/rf-portrait-eye/image.png", represents: "人像 / 眼睛高光" },
  { name: "anime-hl", file: "tests/fixtures/real-failures/rf-anime-hl/image.png", represents: "动漫 / 高光强调色" },
  { name: "complex-scene", file: "tests/fixtures/real-failures/rf-complex/image.png", represents: "写实 / 多结构场景" },
  { name: "edge-contam", file: "tests/fixtures/real-failures/rf-edge-contam/image.png", represents: "Logo / 边缘污染" },
  { name: "pixel-art", file: "tests/fixtures/b4-race/race-b-600x480.png", represents: "像素画" },
  { name: "flat-gradient", file: "tests/fixtures/real-failures/rf-flat-frag/image.png", represents: "渐变 / 大平区" },
  { name: "thin-struct", file: "tests/fixtures/real-failures/rf-thin-struct/image.png", represents: "细结构 / 弱光" },
  { name: "aa-leak", file: "tests/fixtures/real-failures/rf-aa-leak/image.png", represents: "抗锯齿中间色" },
];

const only = process.env.B4_AT_ONLY ? new Set(process.env.B4_AT_ONLY.split(",")) : null;
const fixtureList = FIXTURES.filter((f) => !only || only.has(f.name));

for (const f of fixtureList) {
  const p = path.join(ROOT, f.file);
  if (!fs.existsSync(p)) { console.error(`缺少夹具：${p}`); process.exit(1); }
}
fs.mkdirSync(OUT, { recursive: true });
console.log(`基址：${BASE}（生产 CSP 头由 serve-with-headers.mjs 提供）`);
console.log(`夹具 ${fixtureList.length} 张，目标长边 ${LONG_EDGE}\n`);

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

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b4-at-${Date.now()}`,
  "--window-size=1440,900",
  `${BASE}/`,
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
const cspViolations = [];
const pageErrors = [];
const thirdPartyEvalErrors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Log.entryAdded" && /Content Security Policy/i.test(String(m.params?.entry?.text || ""))) {
    cspViolations.push(String(m.params.entry.text).slice(0, 200));
  }
  if (m.method === "Runtime.exceptionThrown") {
    const text = String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 200);
    if (/EvalError/.test(text)) thirdPartyEvalErrors.push(text);
    else pageErrors.push(text);
  }
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  }
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
await send("Log.enable");
await send("DOM.enable");

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 25 * 60 * 1000);
const watchdog = setTimeout(() => {
  console.error(`\n[watchdog] 探针超过 ${Math.round(WATCHDOG_MS / 1000)}s 仍未结束，强制退出`);
  cleanup();
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref?.();

const evalJs = async (expression, timeoutMs = 120000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};
const evalJson = async (expression) => JSON.parse(await evalJs(`JSON.stringify(${expression})`));
const waitFor = async (expr, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJs(expr, 15000)) return true; } catch (error) { console.log(`  [eval 失败] ${error.message}`); }
    await sleep(60);
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

/* ── 页内助手 ─────────────────────────────────────────────────────── */
const HELPERS = `(() => {
  const $ = (sel) => document.querySelector(sel);
  const bridge = () => window.LibmsWorkspaceBridge;

  // ① 抓生成请求。Worker 客户端走 target.postMessage({type:"generate", request})。
  //    这是唯一能证明「§5 候选只在预览尺寸上跑」的位置。
  window.__atRequests = [];
  const rawPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function patched(message, transfer) {
    try {
      if (message && message.type === "generate" && message.request) {
        const q = message.request;
        window.__atRequests.push({
          mode: q.mode,
          maxColors: q.maxColors,
          size: { width: q.size?.width, height: q.size?.height },
          // §13 的接缝：生产白名单是空集，所以这里应当**永远**是 null。
          labCandidate: q.overrides?.labCandidate ?? null,
          cleanupStrength: q.overrides?.cleanupStrength ?? null,
          requestId: q.requestId,
        });
      }
    } catch {}
    return rawPost.call(this, message, transfer);
  };

  // ② 出图版本号
  window.__atRev = 0;
  window.addEventListener("libms:project-result", () => { window.__atRev += 1; });

  // ③ 用户实际看到的进度文案（§16）
  window.__atPhases = [];
  window.addEventListener("libms:generation-phase", (e) => {
    window.__atPhases.push({ phase: e.detail?.phase ?? null, label: e.detail?.label ?? null });
  });

  // ④ 主线程卡顿：连续 rAF 之间超过 250ms 的间隔都记下来。
  //    调优要连跑 2–4 次生成，如果它在主线程上同步跑，这里会看到长间隔。
  //
  //    ⚠️ 必须带**时间戳**，而且要能被「窗口」筛。
  //    最早那版只 push 一个数字，然后把整页生命周期的清单拿去断言
  //    「调优期间没有卡顿」—— 上传后的本地内容审查（首次要下几 MB 模型、
  //    在主线程上跑 tfjs 推理）天然会留下 ~550ms / ~495ms 两个间隔，
  //    每张图都一样，于是**每张图都红**，而调优器一次都没卡过。
  //    这类「断言的范围比它的名字大」是本探针栽得最多的一种。
  window.__atJank = [];
  let lastFrame = performance.now();
  const frameTick = () => {
    const now = performance.now();
    const gap = now - lastFrame;
    lastFrame = now;
    if (gap > 250) window.__atJank.push({ gap: Math.round(gap), at: Math.round(now) });
    requestAnimationFrame(frameTick);
  };
  requestAnimationFrame(frameTick);

  // ⑤ 长任务观察：给出「这段时间主线程到底在干什么」的直接证据。
  //    rAF 间隔只能说「卡了」，longtask 能说「哪一段卡了、卡多久」，
  //    配合 mark 就能把账算到具体阶段头上。
  window.__atLongTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__atLongTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration), name: e.name || "longtask" });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {}

  // ⑥ 时间锚点：把「哪一段是调优」显式标出来。
  window.__atMarks = [];

  window.__at = {
    rev: () => window.__atRev,
    requestCount: () => window.__atRequests.length,
    requests: () => window.__atRequests.slice(),
    phases: () => window.__atPhases.slice(),
    /** 只回间隔数字，供「整页有没有卡」这类粗看。 */
    jank: () => window.__atJank.map((j) => j.gap),
    /** 带时间戳的明细，供归因。 */
    jankDetail: () => window.__atJank.slice(),
    mark: (label) => { window.__atMarks.push({ label, at: Math.round(performance.now()) }); return true; },
    marks: () => window.__atMarks.slice(),
    /**
     * 只取 [startLabel, endLabel] 这个窗口内的帧间隔。
     *
     * 这是本文件唯一正确的「调优期间卡不卡」的判据。少了它，
     * 断言会把上传阶段的内容审查也算进调优的账上（见 ④ 的注释）。
     * 缺锚点时退化成整页清单 —— 宁可吵，也不要静默变成空数组让断言假绿。
     */
    jankBetween: (startLabel, endLabel) => {
      const at = (l) => { const m = window.__atMarks.find((x) => x.label === l); return m ? m.at : null; };
      const a = at(startLabel); const b = at(endLabel);
      if (a === null || b === null) return window.__atJank.slice();
      return window.__atJank.filter((j) => j.at >= a && j.at <= b);
    },
    longTasks: () => window.__atLongTasks.slice(),
    longTasksBetween: (startLabel, endLabel) => {
      const at = (l) => { const m = window.__atMarks.find((x) => x.label === l); return m ? m.at : null; };
      const a = at(startLabel); const b = at(endLabel);
      if (a === null || b === null) return window.__atLongTasks.slice();
      return window.__atLongTasks.filter((t) => t.start + t.dur >= a && t.start <= b);
    },
    resetPhases: () => { window.__atPhases = []; },
    report: () => bridge().getAutoTuneReport(),
    /**
     * §15 报告的**有界投影**。
     *
     * 为什么不直接回传整份：报告里有 candidates[].metrics 和赢家的
     * diagnostics（引擎侧诊断），整份 JSON.stringify 之后体积不可控。
     * Runtime.evaluate + returnByValue 传一个几 MB 的对象会把 CDP 调用卡住 ——
     * 实测表现是 CDP Runtime.evaluate 超时 120000ms，而报错完全指不到
     * 「报告太大了」这个原因（2026-10-04 栽过一次）。
     *
     * 所以：整份只在页内量一个字节数（reportBytes，顺便当契约断言），
     * 回传的永远是这里列出来的字段 —— 也就是探针真正断言的那些。
     */
    reportSummary: () => {
      const r = bridge().getAutoTuneReport();
      if (!r) return null;
      return {
        routedMode: r.routedMode, mode: r.mode, decision: r.decision, reason: r.reason,
        selectedProfileId: r.selectedProfileId, standardProfileId: r.standardProfileId,
        selectedProfile: r.selectedProfile ?? null,
        cached: r.cached, reusedPreview: r.reusedPreview,
        previewSize: r.previewSize, targetSize: r.targetSize,
        maxColors: r.maxColors, previewMaxColors: r.previewMaxColors, runtimeMs: r.runtimeMs,
        candidates: (r.candidates || []).map((c) => ({
          profileId: c.profileId, label: c.label, accepted: c.accepted,
          rejectReason: c.rejectReason, violations: c.violations, runtimeMs: c.runtimeMs,
          metrics: c.metrics ? {
            usedColors: c.metrics.usedColors, nullCells: c.metrics.nullCells,
            perceptualError: c.metrics.perceptualError, edgeRetention: c.metrics.edgeRetention,
            detailRetention: c.metrics.detailRetention, fragmentation: c.metrics.fragmentation,
            isolatedPixels: c.metrics.isolatedPixels, flatAreaStability: c.metrics.flatAreaStability,
            skinError: c.metrics.skinError, tonalError: c.metrics.tonalError,
          } : null,
        })),
      };
    },
    /** 整份报告的 JSON 长度 —— 用来证明「报告不该膨胀成几 MB」。 */
    reportBytes: () => {
      const r = bridge().getAutoTuneReport();
      if (!r) return 0;
      try { return JSON.stringify(r).length; } catch { return -1; }
    },
    clickMode: (mode) => {
      const card = document.querySelector('[data-preset="' + mode + '"]');
      if (!card || card.disabled) return false;
      card.click();
      return true;
    },
    activeMode: () => ($("[data-preset].is-active") || {}).dataset?.preset ?? null,
    generating: () => Boolean(bridge().isGenerating()),
    cancelVisible: () => { const b = $("#ws-cancel-generate"); return Boolean(b) && !b.hidden && !b.disabled; },
    /**
     * 取消按钮的现场快照。
     *
     * 为什么要有它：cancelVisible() 只回一个布尔，红了之后完全看不出
     * 「按钮不存在 / 被 hidden / 被 disabled / 只是还没画出来」这四种的哪一种，
     * 而它们的修法完全不同。把四个事实一次打出来。
     */
    cancelDebug: () => {
      const b = $("#ws-cancel-generate");
      return {
        exists: Boolean(b),
        hidden: b ? Boolean(b.hidden) : null,
        hasHiddenAttr: b ? b.hasAttribute("hidden") : null,
        disabled: b ? Boolean(b.disabled) : null,
        bridgeGenerating: Boolean(bridge().isGenerating()),
        status: (($("#ws-status") || {}).textContent || "").trim(),
        generateDisabled: (() => { const g = $("#ws-generate"); return g ? Boolean(g.disabled) : null; })(),
      };
    },
    clickCancel: () => { const b = $("#ws-cancel-generate"); if (!b || b.hidden || b.disabled) return false; b.click(); return true; },
    generateDisabled: () => { const b = $("#ws-generate"); return b ? b.disabled : null; },
    /**
     * 按主操作按钮。
     *
     * ⚠️ 必须显式按。模式卡片只改参数，**不触发生成** —— 改完参数工作台会显示
     * 「参数待更新」，等用户按生成。本探针最早那版没按，靠「等一个恰好还在路上的
     * 上一轮结果事件」蒙对了第一个夹具（waitNewResult 立刻满足，读到的是
     * **上一次**的图，state.width/height 也正好是刚 apply 的那个尺寸，看起来天衣无缝）。
     * 第二个夹具起就会等满 240s。这正是本文件头部警告过的那个坑的第二种形态。
     *
     * 注意：本文件是一整个模板字符串（HELPERS），注释里**不能出现反引号** ——
     * 会提前结束模板字符串，报的是「Unexpected identifier」这种完全指不到重点的错。
     */
    clickGenerate: () => { const b = $("#ws-generate"); if (!b || b.disabled) return false; b.click(); return true; },
    statusText: () => (($("#ws-status") || $(".ws-status") || {}).textContent || "").trim(),
    // 工作台可见文本 —— §16 用它扫「有没有算法术语漏到界面上」
    visibleText: () => {
      const root = $("#ws-root") || document.body;
      return (root.innerText || "").replace(/\\s+/g, " ");
    },
    result: () => {
      const r = bridge().getResult();
      const used = new Set();
      let nulls = 0;
      for (const row of r.grid || []) for (const cell of row) { if (cell) used.add(cell.code); else nulls += 1; }
      return { width: r.width, height: r.height, rows: r.grid?.length ?? 0, usedColors: used.size, nulls, generating: Boolean(bridge().isGenerating()) };
    },
    /**
     * 出图网格的内容哈希（FNV-1a，只看豆子编号）。
     *
     * 用途是**跨页面会话比对同一张图的产物**：先在「同一页面里已经生成过另一张图」
     * 的条件下跑一次，再整页重载、单独跑同一张图，两次哈希必须一致。
     * 不一致 = 单例调优器的上下文没刷新，用的是上一张图（§13 真机抓到过的形状）。
     * 只看编号，不看颜色对象，避免渲染细节把比对搅浑。
     */
    gridHash: () => {
      const r = bridge().getResult();
      let h = 2166136261;
      for (const row of r.grid || []) for (const cell of row) {
        const s = cell ? String(cell.code) : "-";
        for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 44; h = Math.imul(h, 16777619) >>> 0;
      }
      return h.toString(16).padStart(8, "0");
    },
    setLongEdge: (value) => {
      const node = $("#ws-size-number");
      if (!node) return false;
      node.value = String(value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      const apply = $("#ws-size-apply");
      if (!apply || apply.disabled) return false;
      apply.click();
      return true;
    },
    setMaxColors: (value) => {
      // maxColors 有**两条**通路，都得走：
      //   ① 工作台面板 <input type="number" data-field="maxColors">（ui/generation-panel.js）
      //      —— 它是 store 的入口，界面读它；
      //   ② 生成链路真正读的是 els.maxColorsInput = #max-colors-input（index.html 里的旧控件）
      //      —— 只写 ① 的话 store 变了、生成参数没变，这一轮就退化成「什么都没改」，
      //      缓存不会失效，探针却以为自己制造了一次 miss。
      // 老选择器只找 id 里带 max 的输入框，漏掉 ① 就会静默返回 false。
      let touched = false;
      const panel = $('[data-field="maxColors"]');
      if (panel) {
        panel.value = String(value);
        panel.dispatchEvent(new Event("input", { bubbles: true }));
        panel.dispatchEvent(new Event("change", { bubbles: true }));
        touched = true;
      }
      // 桥接里那个 setMaxColors 写的就是 ②；没有就退回到直接写 DOM。
      try {
        if (typeof bridge().setMaxColors === "function") { bridge().setMaxColors(value); touched = true; }
      } catch {}
      const legacy = $("#max-colors-input");
      if (legacy) {
        legacy.value = String(value);
        legacy.dispatchEvent(new Event("input", { bubbles: true }));
        legacy.dispatchEvent(new Event("change", { bubbles: true }));
        touched = true;
      }
      return touched;
    },
    waitNewResult: (target, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (window.__atRev > target) { resolve({ ok: true, ms: Math.round(performance.now() - t0) }); return; }
        if (performance.now() - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(performance.now() - t0) }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }),
    waitQuiet: (quietMs, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      let quietSince = null;
      const tick = () => {
        const r = window.__at.result();
        if (r.rows > 0 && !r.generating) { if (quietSince === null) quietSince = performance.now(); }
        else quietSince = null;
        const now = performance.now();
        if (quietSince !== null && now - quietSince >= quietMs) { resolve({ ok: true, ms: Math.round(now - t0) }); return; }
        if (now - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(now - t0) }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }),
    // 等生成真的开始（取消按钮出现）。**不要用固定 sleep** ——
    // 上传后先跑本地内容审查，首次要下几 MB 模型，时间完全不可预测。
    waitGenerating: (timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (window.__at.generating()) { resolve({ ok: true, ms: Math.round(performance.now() - t0) }); return; }
        if (performance.now() - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(performance.now() - t0) }); return; }
        setTimeout(tick, 25);
      };
      setTimeout(tick, 25);
    }),
  };
  return true;
})()`;

const TERMS = ["Auto Tune", "Profile", "profile", "Bean Fit", "bean-fit", "lab", "候选", "oracle", "regret"];

/* ── 主流程 ─────────────────────────────────────────────────────── */
let current = null;
try {
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");
  await evalJs(HELPERS);

  /* ════════ 逐夹具：智能模式端到端 ════════ */
  for (const fixture of fixtureList) {
    current = fixture.name;
    console.log(`\n──── 夹具 ${fixture.name}（${fixture.represents}）────`);
    const file = path.join(ROOT, fixture.file);

    // 重新加载，保证每张图都是干净的一轮（避免上一张的缓存命中）。
    await send("Page.navigate", { url: `${BASE}/` });
    await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页(重载)");
    await evalJs(HELPERS);

    const doc = await send("DOM.getDocument", { depth: -1 });
    const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
    if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");
    await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [file] });
    const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
    check(`${fixture.name}：上传并挂载工作台`, ready);
    if (!ready) continue;
    await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);

    await evalJs(`window.__at.setLongEdge(${LONG_EDGE})`);
    await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);

    // 目标：智能模式
    const revBefore = await evalJs(`window.__at.rev()`);
    const countBefore = await evalJs(`window.__at.requestCount()`);
    await evalJs(`window.__at.resetPhases()`);
    // 锚点打在**点卡片之前**：卡片会 scheduleAutoGenerate（320ms 去抖），
    // 真正那一次生成可能由卡片触发、也可能由下面手动按触发，打在这儿两种都覆盖。
    await evalJs(`window.__at.mark("tune-start")`);
    const clicked = await evalJs(`window.__at.clickMode("auto")`);
    check(`${fixture.name}：智能模式卡片可点`, clicked, `activeMode=${await evalJs(`window.__at.activeMode()`)}`);
    if (!clicked) continue;
    // 卡片只改参数、不触发生成 —— 必须自己按一下（见 clickGenerate 的注释）。
    if (!(await evalJs(`window.__at.generating()`))) {
      const pressed = await evalJs(`window.__at.clickGenerate()`);
      check(`${fixture.name}：生成按钮可点`, pressed,
        pressed ? "" : `disabled=${await evalJs(`window.__at.generateDisabled()`)}`);
    }

    const waited = await evalJs(`window.__at.waitNewResult(${revBefore}, 240000)`, 260000);
    await evalJs(`window.__at.waitQuiet(600, 60000)`, 90000);
    await evalJs(`window.__at.mark("tune-end")`);

    const state = await evalJson(`window.__at.result()`);
    const report = await evalJson(`window.__at.reportSummary()`);
    const phases = await evalJson(`window.__at.phases()`);
    // 只取「点卡片 → 这一轮生成结束」这个窗口。整页清单会把上传阶段
    // 本地内容审查（首次下几 MB 模型 + 主线程 tfjs 推理）的 ~550ms 记进来。
    const jank = await evalJson(`window.__at.jankBetween("tune-start", "tune-end")`);
    const jankAll = await evalJson(`window.__at.jankDetail()`);
    const longTasks = await evalJson(`window.__at.longTasksBetween("tune-start", "tune-end")`);
    const allReq = await evalJson(`window.__at.requests()`);
    const newReq = allReq.slice(countBefore);

    check(`${fixture.name}：出图`, waited?.ok && state.rows > 0 && state.usedColors > 0,
      `${state.width}×${state.height} · ${state.usedColors} 色 · ${state.nulls} 空豆 · 等到新图 ${waited?.ms}ms`);

    // ── §15 报告契约 ──
    check(`${fixture.name}：拿到 §13 调优报告`, Boolean(report),
      report ? `routedMode=${report.routedMode} selected=${report.selectedProfileId}` : "getAutoTuneReport() 返回空");
    if (!report) continue;

    const reportFields = ["routedMode", "selectedProfileId", "selectedProfile", "candidates", "reason", "decision", "standardProfileId"];
    const missing = reportFields.filter((f) => !(f in report));
    check(`${fixture.name}：报告字段齐全（§15）`, missing.length === 0, missing.length ? `缺 ${missing.join(", ")}` : `decision=${report.decision}`);

    const candFields = ["profileId", "accepted", "rejectReason", "metrics", "runtimeMs"];
    const badCand = (report.candidates || []).filter((c) => candFields.some((f) => !(f in c)));
    check(`${fixture.name}：候选条目字段齐全`, badCand.length === 0,
      badCand.length ? JSON.stringify(badCand[0]) : `${report.candidates.length} 个候选`);

    // single-candidate（pixel / logo）的候选表**故意是空的**：那一个候选不进表，
    // 直接作为 selectedProfileId 返回（§9 禁止 Auto Tune 改算法 → 没得比）。
    // 用「必须在表里」去卡它会得到一个假失败。
    check(`${fixture.name}：选中项在候选表里`,
      report.decision === "single-candidate"
        ? (report.candidates || []).length === 0 && Boolean(report.selectedProfileId)
        : (report.candidates || []).some((c) => c.profileId === report.selectedProfileId),
      `decision=${report.decision} selected=${report.selectedProfileId} 候选 ${(report.candidates || []).length} 个`);

    // ── §13 生产闸门：一个 lab 候选都不许跑 ──
    const labSeen = newReq.filter((r) => r.labCandidate);
    check(`${fixture.name}：生产档没跑 lab 候选（§13）`, labSeen.length === 0,
      labSeen.length ? JSON.stringify(labSeen[0]) : `requests=${newReq.length}`);

    // ── §7-B 空豆完整性：所有候选的空豆数必须一致 ──
    const nullCounts = (report.candidates || []).filter((c) => c.metrics).map((c) => c.metrics.nullCells);
    check(`${fixture.name}：候选之间空豆数一致（§7-B）`, new Set(nullCounts).size <= 1,
      `nullCells=${JSON.stringify([...new Set(nullCounts)])}`);
    check(`${fixture.name}：输出的空豆数与报告一致（§7-B）`, nullCounts.length === 0 || nullCounts[0] === state.nulls,
      nullCounts.length === 0
        ? `无候选指标（${report.decision}），跳过对比 · 实际 ${state.nulls} 空豆`
        : `报告 ${nullCounts[0]} vs 实际 ${state.nulls}`);

    // ── §5 候选只在预览尺寸跑，赢家才在目标尺寸跑一次 ──
    //
    // ⚠️ §17 允许缓存，而且**这里是命中**：上传后自动生成那一轮已经把同一个键
    //    （source / crop / palette / maxColors / mode / 目标尺寸 / overrides）算过一遍，
    //    所以再点一次「智能」会直接复用结论 —— 0 次请求。这是正确行为，不是漏跑。
    //    硬要「候选数 + 1」会把这个正确行为判成失败。
    //    完整的候选扫描证据放在下面 maxColors 轮（那一轮 maxColors 变了 → 必然 miss）。
    const targetLong = Math.max(state.width, state.height);
    const sweep = report.candidates.length;
    if (report.cached) {
      check(`${fixture.name}：缓存命中时一次候选都不跑（§17）`, newReq.length === 0,
        `cached=true，本轮请求 ${newReq.length} 次（期望 0）`);
      note(`${fixture.name} 缓存`, `命中 · ${report.routedMode} · ${report.selectedProfileId} · ${report.runtimeMs}ms`);
    } else {
      const previewReq = newReq.filter((r) => Math.max(r.size.width, r.size.height) === 104);
      const finalReq = newReq.filter((r) => Math.max(r.size.width, r.size.height) === targetLong && targetLong !== 104);
      const otherReq = newReq.filter((r) => Math.max(r.size.width, r.size.height) !== 104
        && Math.max(r.size.width, r.size.height) !== targetLong);
      const expected = targetLong > 104 ? sweep + 1 : sweep;   // 预览==目标时复用，不再跑正式
      check(`${fixture.name}：请求次数 = 候选数 ${targetLong > 104 ? "+ 1 次正式" : "（复用预览）"}`,
        newReq.length === expected,
        `实得 ${newReq.length}（预览 ${previewReq.length} / 正式 ${finalReq.length} / 其它 ${otherReq.length}），期望 ${expected}（目标长边 ${targetLong}）`);
      check(`${fixture.name}：候选都在预览尺寸上跑（§5）`,
        previewReq.length >= sweep - 1,
        `预览 ${previewReq.length} 次 / 候选 ${sweep} 个`);
      check(`${fixture.name}：没有候选在目标尺寸上跑（§5）`,
        finalReq.length <= 1,
        finalReq.length > 1 ? `正式生成跑了 ${finalReq.length} 次` : `正式 ${finalReq.length} 次`);
    }

    // ── §16 进度文案：三句人话，且界面无算法术语 ──
    //
    // ⚠️ 这里必须区分「真的跑了一轮调优」和「短路返回」。
    // auto-tune.mjs 有两种**故意不发 tune-* 阶段**的早返回（见该文件 725–749 行）：
    //   ① candidates.length <= 1（pixel / logo，§9 禁止 Auto Tune 改算法）
    //   ② 缓存命中（§17）—— 整轮 23–42ms，再播三句进度只会闪一下
    // 把这两种当成「§16 坏了」会让每张图都红，而产品一次都没错。
    // 真调优的进度证据放在下面 maxColors 轮（那一轮必然 miss）。
    const labels = [...new Set(phases.map((p) => p.label).filter(Boolean))];
    const tuneLabels = phases.filter((p) => String(p.phase || "").startsWith("tune-"));
    const shortCircuit = report.cached === true || report.decision === "single-candidate";
    if (shortCircuit) {
      check(`${fixture.name}：短路返回不播调优进度、且不该慢（§16/§17）`,
        tuneLabels.length === 0 && report.runtimeMs < 200,
        `${report.decision}${report.cached ? " + 缓存命中" : ""} · tune-* ${tuneLabels.length} 次 · ${report.runtimeMs}ms`);
    } else {
      check(`${fixture.name}：调优阶段文案走的是同一条进度广播（§16）`, tuneLabels.length >= 2,
        `tune-* 事件 ${tuneLabels.length} 次，文案：${JSON.stringify([...new Set(tuneLabels.map((p) => p.label))])}`);
    }
    const badLabel = labels.filter((l) => TERMS.some((t) => l.includes(t)));
    check(`${fixture.name}：进度文案不含算法术语（§16）`, badLabel.length === 0,
      badLabel.length ? JSON.stringify(badLabel) : `${labels.length} 种文案`);

    const uiText = await evalJs(`window.__at.visibleText()`);
    const leaked = TERMS.filter((t) => uiText.includes(t));
    check(`${fixture.name}：工作台可见文本不含算法术语（§16）`, leaked.length === 0,
      leaked.length ? `漏出：${leaked.join(", ")}` : `文本 ${uiText.length} 字`);

    // ── §27 主线程可操作性 ──
    //
    // 阈值 400ms，不是 250ms。理由是可取证的一条：**缓存命中那一轮**调优本身
    // 只花了 20–40ms，窗口内照样出现 251ms 的帧间隔（实测 edge-contam）。
    // 也就是说这个卡顿不是调优占的主线程，而是**结果提交时的画布重绘**
    // （156×156 = 24336 格）+ GC。250ms 的阈值会把每一次正常出图都判红。
    // 400ms 才是「用户能明显感到界面卡住」的量级，也正是 §27 要防的东西。
    // 每张夹具的窗口内最大帧间隔与长任务都打在 INFO 行里，可复核。
    const worstGap = jank.length ? Math.max(...jank.map((j) => j.gap)) : 0;
    check(`${fixture.name}：调优期间主线程没有长卡顿（§27）`, worstGap <= 400,
      worstGap
        ? `窗口内最大帧间隔 ${worstGap}ms（整页 ${JSON.stringify(jankAll.map((j) => j.gap))}）`
        : `窗口内无 >250ms 帧间隔（整页另有 ${jankAll.length} 次，全在生成窗口外）`);
    note(`${fixture.name} 窗口内长任务`, longTasks.length
      ? longTasks.map((t) => `${t.dur}ms@${t.start}`).join(" ")
      : "无（主线程全程可交互）");

    note(`${fixture.name} 决策`, `${report.decision} · ${report.reason}`);
    await shot(`fixture-${fixture.name}`);
  }

  /* ════════ maxColors 硬约束 ════════ */
  console.log("\n──── maxColors 与 Auto Tune 同时生效 ────");
  {
    const fixture = fixtureList[0];
    const file = path.join(ROOT, fixture.file);
    await send("Page.navigate", { url: `${BASE}/` });
    await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页(重载)");
    await evalJs(HELPERS);
    const doc = await send("DOM.getDocument", { depth: -1 });
    const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
    await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [file] });
    const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
    check("maxColors 轮：上传并挂载", ready);
    if (ready) {
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      await evalJs(`window.__at.setLongEdge(${LONG_EDGE})`);
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);

      const hasInput = await evalJs(`window.__at.setMaxColors(12)`);
      note("maxColors 输入框", hasInput ? "找到并设为 12" : "没找到 maxColors 输入框（跳过数值断言）");
      // 改 maxColors 顺带把缓存键改了（§18）→ 这一轮**必然 miss**，
      // 于是它是全流程里唯一能拿到「完整候选扫描」证据的地方。
      check("maxColors 轮：改了 maxColors 必然让缓存失效（§18）", hasInput);

      const cntBefore = await evalJs(`window.__at.requestCount()`);
      const revBefore = await evalJs(`window.__at.rev()`);
      await evalJs(`window.__at.resetPhases()`);
      await evalJs(`window.__at.mark("mc-start")`);
      await evalJs(`window.__at.clickMode("auto")`);
      if (!(await evalJs(`window.__at.generating()`))) await evalJs(`window.__at.clickGenerate()`);
      const waited = await evalJs(`window.__at.waitNewResult(${revBefore}, 240000)`, 260000);
      await evalJs(`window.__at.waitQuiet(600, 60000)`, 90000);
      await evalJs(`window.__at.mark("mc-end")`);
      const state = await evalJson(`window.__at.result()`);
      const report = await evalJson(`window.__at.reportSummary()`);
      const mcPhases = await evalJson(`window.__at.phases()`);
      const mcJank = await evalJson(`window.__at.jankBetween("mc-start", "mc-end")`);
      const mcLong = await evalJson(`window.__at.longTasksBetween("mc-start", "mc-end")`);
      const newReq = (await evalJson(`window.__at.requests()`)).slice(cntBefore);

      // ── §16 真调优的进度文案证据就在这里（这一轮必然 miss）──
      // 逐张夹具那一轮多半命中缓存，短路返回不发 tune-*，所以那边只能验「不发」；
      // 「发了什么」只有这一轮能证。
      const mcTune = mcPhases.filter((p) => String(p.phase || "").startsWith("tune-"));
      const mcTuneLabels = [...new Set(mcTune.map((p) => p.label).filter(Boolean))];
      check("maxColors 轮：真调优会播 tune-* 进度且文案是人话（§16）",
        mcTune.length >= 2 && mcTuneLabels.every((l) => !TERMS.some((t) => l.includes(t))),
        `tune-* ${mcTune.length} 次 · 文案 ${JSON.stringify(mcTuneLabels)}`);
      check("maxColors 轮：调优期间主线程没有长卡顿（§27）",
        mcJank.every((j) => j.gap <= 400),
        mcJank.length
          ? `窗口内最大帧间隔 ${Math.max(...mcJank.map((j) => j.gap))}ms`
          : `窗口内无 >250ms 帧间隔 · 长任务 ${mcLong.length} 个`);
      check("maxColors 轮：出图", waited?.ok && state.rows > 0, `${state.usedColors} 色`);
      // ── §6 / §7-A 的**前提**：请求里带的 maxColors 必须各就各位 ──
      //
      // 调优器每次调用传的 maxColors 不一样：
      //   预览候选 → §6 比例缩放后的 previewMaxColors（104 档 / 目标 156 → 8）
      //   正式赢家 → 界面上的原始值（12）
      // 这一条是 2026-10-04 抓到的两个真缺陷的唯一证据位：
      //   ① 单例 runCandidate 把形参闭包住 → 每个请求都是 0（界面 12，报告也写 12）
      //   ② 同一个闭包还**盖掉了入参** → 预览也用 12，`previewMaxColors` 从未生效
      // 两者都表现为「报告看起来正常、出图不对」，所以必须先钉住这一条，
      // 否则红的是「引擎不守上限」，真正坏的却是「参数没接到位」。
      const previewReqs = newReq.filter((r) => Math.max(r.size.width, r.size.height) === 104);
      const finalReqs = newReq.filter((r) => Math.max(r.size.width, r.size.height) === Math.max(state.width, state.height)
        && Math.max(state.width, state.height) !== 104);
      const previewCaps = [...new Set(previewReqs.map((r) => r.maxColors))];
      const finalCaps = [...new Set(finalReqs.map((r) => r.maxColors))];
      const wantPreviewCap = Number(report?.previewMaxColors) || 12;
      check("maxColors 轮：预览跑缩过的上限、正式跑界面值（§6 / §7-A 前提）",
        newReq.length > 0
        && previewCaps.length === 1 && previewCaps[0] === wantPreviewCap
        && finalCaps.length === 1 && finalCaps[0] === 12,
        `预览 ${JSON.stringify(previewCaps)}（期望 ${wantPreviewCap}）· 正式 ${JSON.stringify(finalCaps)}（期望 12）`
        + ` · 报告 maxColors=${report?.maxColors} previewMaxColors=${report?.previewMaxColors}`);
      check("maxColors 轮：仍产出调优报告", Boolean(report), report ? `selected=${report.selectedProfileId}` : "");
      if (report) {
        check("maxColors 轮：缓存已失效（§18）", report.cached !== true,
          report.cached === true ? "改了 maxColors 却仍然命中缓存" : `cached=${report.cached}`);
        // ── §5 的完整证据就在这一轮 ──
        const targetLong = Math.max(state.width, state.height);
        const sweep = report.candidates.length;
        const previewReq = newReq.filter((r) => Math.max(r.size.width, r.size.height) === 104);
        const finalReq = newReq.filter((r) => Math.max(r.size.width, r.size.height) === targetLong && targetLong !== 104);
        const expected = targetLong > 104 ? sweep + 1 : sweep;
        check("maxColors 轮：请求次数 = 候选数 + 1 次正式（§5）", newReq.length === expected,
          `实得 ${newReq.length}（预览 ${previewReq.length} / 正式 ${finalReq.length}），期望 ${expected}，候选 ${sweep}`);
        check("maxColors 轮：候选只在预览尺寸跑（§5）", previewReq.length >= sweep - 1,
          `预览 ${previewReq.length} / 候选 ${sweep}`);
        check("maxColors 轮：目标尺寸最多只跑一次（§5）", finalReq.length <= 1, `正式 ${finalReq.length} 次`);
        check("maxColors 轮：预览尺寸就是 104（§5）",
          !report.previewSize || Math.max(report.previewSize.width, report.previewSize.height) <= 104,
          `previewSize=${JSON.stringify(report.previewSize)}`);
        // ── §17 反向：同参数再点一次必须命中缓存 ──
        const rev2 = await evalJs(`window.__at.rev()`);
        const cnt2 = await evalJs(`window.__at.requestCount()`);
        await evalJs(`window.__at.clickMode("auto")`);
        if (!(await evalJs(`window.__at.generating()`))) await evalJs(`window.__at.clickGenerate()`);
        const waited2 = await evalJs(`window.__at.waitNewResult(${rev2}, 240000)`, 260000);
        const report2 = await evalJson(`window.__at.reportSummary()`);
        const grew = (await evalJs(`window.__at.requestCount()`)) - cnt2;
        check("maxColors 轮：同参数再点一次命中缓存、不再跑候选（§17）",
          waited2?.ok && report2?.cached === true && grew === 0,
          `cached=${report2?.cached} 新增请求 ${grew}`);
        // ── §17 反向：换一个**没用过**的 maxColors → 键变了 → 必须重跑 ──
        //
        // ⚠️ 不能用 0。0 是「不限额」= 上传后那一轮的**原始值**，
        // 那个键在夹具挂载时就已经算过并进了缓存，改回 0 是**正确命中**，
        // 拿它当「必须 miss」会得到一个假失败（2026-10-04 栽过一次）。
        // 换成一个本夹具没用过的值，才是真的新键。
        const rev3 = await evalJs(`window.__at.rev()`);
        const cnt3 = await evalJs(`window.__at.requestCount()`);
        await evalJs(`window.__at.setMaxColors(14)`);
        await evalJs(`window.__at.clickMode("auto")`);
        if (!(await evalJs(`window.__at.generating()`))) await evalJs(`window.__at.clickGenerate()`);
        const waited3 = await evalJs(`window.__at.waitNewResult(${rev3}, 240000)`, 260000);
        const report3 = await evalJson(`window.__at.reportSummary()`);
        const grew3 = (await evalJs(`window.__at.requestCount()`)) - cnt3;
        check("maxColors 轮：换成没用过的 maxColors → 缓存失效并重跑（§18）",
          waited3?.ok && report3?.cached !== true && grew3 > 0,
          `cached=${report3?.cached} 新增请求 ${grew3}`);
      }
      if (hasInput && report) {
        // 赢家的指标是在**预览尺寸**上量的，所以它的上限是 `previewMaxColors`
        // （§6 的比例策略：12 色在 104/156 档缩成 8），不是界面上那个 12。
        const previewCap = Number(report.previewMaxColors) || 12;
        const winner = (report.candidates || []).find((c) => c.profileId === report.selectedProfileId);
        check("maxColors 轮：赢家用色数不超预览上限（§7-A）",
          !winner?.metrics || winner.metrics.usedColors <= previewCap,
          `winner.usedColors=${winner?.metrics?.usedColors} 预览上限=${previewCap}（界面 ${12}）`);
        check("maxColors 轮：实际出图用色数不超上限", state.usedColors <= 12, `实际 ${state.usedColors}`);
      }
    }
    await shot("max-colors");
  }

  /* ════════ 同一页面内换图（§13 单例上下文）════════ */
  console.log("\n──── 同一页面内换第二张图（单例调优器的上下文）────");
  {
    // ── 这一轮为什么必须存在 ─────────────────────────────────────────────
    // 上面每一轮夹具都 `Page.navigate` 整页重载，所以模块级单例 `autoTuner`
    // 每次都是新建的。「单例把形参闭包住、被第一次调用的值冻死」这个形状
    // 在整页重载的探针里**根本不显形** —— 这正是它藏了这么久的原因。
    //
    // 后果按严重程度排：
    //   ① maxColors 冻在第一次的值 → 界面改颜色数量不生效（§7-A 失效）
    //   ② sourceImageData 冻在第一次的图 → 换图之后出图**还是上一张**
    // ① 由上面的 maxColors 轮钉住（它跑在同一页面里，前提已满足）；
    // ② 只有「同一页面换图」能证，就是这一轮。
    //
    // 判据用**跨会话比对**：先在同一页面里（已经跑过第一张图）生成第二张图，
    // 记下网格哈希；再整页重载、单独跑第二张图，哈希必须一致。
    // 只比哈希不看颜色对象，避免渲染细节搅浑。
    const first = fixtureList.find((f) => f.name === "portrait-eye") || fixtureList[0];
    const second = fixtureList.find((f) => f.name === "flat-gradient") || fixtureList[1];
    const SECOND_CAP = 19;   // 两张图都没用过的值 → 两次都必然是 miss

    const loadFixture = async (fixture) => {
      const doc = await send("DOM.getDocument", { depth: -1 });
      const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
      if (!node.result?.nodeId) throw new Error("找不到 #file-input");
      await send("DOM.setFileInputFiles", { nodeId: node.result.nodeId, files: [path.join(ROOT, fixture.file)] });
      const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, `挂载 ${fixture.name}`);
      if (ready) await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      return ready;
    };

    // ── 先在这个页面里跑第一张图（建立「单例已被第一次调用初始化」的前提）──
    await send("Page.navigate", { url: `${BASE}/` });
    await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页(重载)");
    await evalJs(HELPERS);
    const firstOk = await loadFixture(first);
    check("换图轮：第一张图挂载", firstOk, first.name);
    let sameSessionHash = null;
    if (firstOk) {
      await evalJs(`window.__at.setLongEdge(${LONG_EDGE})`);
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      const rev0 = await evalJs(`window.__at.rev()`);
      await evalJs(`window.__at.clickMode("auto")`);
      if (!(await evalJs(`window.__at.generating()`))) await evalJs(`window.__at.clickGenerate()`);
      await evalJs(`window.__at.waitNewResult(${rev0}, 240000)`, 260000);
      await evalJs(`window.__at.waitQuiet(600, 60000)`, 90000);
      note("换图轮 第一张图", `已生成（单例调优器至此建立）· 网格 ${await evalJs(`window.__at.gridHash()`)}`);

      // ── 同一个页面里换成第二张图，不重载 ──
      const secondOk = await loadFixture(second);
      check("换图轮：同一页面内换成第二张图", secondOk, second.name);
      if (secondOk) {
        await evalJs(`window.__at.setLongEdge(${LONG_EDGE})`);
        await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
        const rev1 = await evalJs(`window.__at.rev()`);
        const cnt1 = await evalJs(`window.__at.requestCount()`);
        await evalJs(`window.__at.setMaxColors(${SECOND_CAP})`);
        await evalJs(`window.__at.clickMode("auto")`);
        if (!(await evalJs(`window.__at.generating()`))) await evalJs(`window.__at.clickGenerate()`);
        const waited = await evalJs(`window.__at.waitNewResult(${rev1}, 240000)`, 260000);
        await evalJs(`window.__at.waitQuiet(600, 60000)`, 90000);
        const st = await evalJson(`window.__at.result()`);
        const rep = await evalJson(`window.__at.reportSummary()`);
        const reqs = (await evalJson(`window.__at.requests()`)).slice(cnt1);
        sameSessionHash = await evalJs(`window.__at.gridHash()`);
        check("换图轮：换图后出图", waited?.ok && st.rows > 0, `${st.width}×${st.height} · ${st.usedColors} 色`);
        check("换图轮：换图后仍产出调优报告", Boolean(rep),
          rep ? `routedMode=${rep.routedMode} selected=${rep.selectedProfileId}` : "");
        // 换图后 maxColors 也必须各就各位 —— ① 的另一半证据。
        // 注意**不是**「所有请求都是 19」：预览候选跑的是 §6 缩过的上限
        // （19 色在 104/156 档 → 13），正式赢家才是 19。
        // 第一版这里写成了「全是 19」，被 §6 修复后的正确行为判成了失败。
        const wantCap = Number(rep?.previewMaxColors) || SECOND_CAP;
        const pReqs = reqs.filter((r) => Math.max(r.size.width, r.size.height) === 104);
        const fReqs = reqs.filter((r) => Math.max(r.size.width, r.size.height) !== 104);
        const pCaps = [...new Set(pReqs.map((r) => r.maxColors))];
        const fCaps = [...new Set(fReqs.map((r) => r.maxColors))];
        check("换图轮：换图后预览跑缩过的上限、正式跑界面值（§6 / §7-A 前提）",
          reqs.length > 0
          && pCaps.length === 1 && pCaps[0] === wantCap
          && fCaps.length === 1 && fCaps[0] === SECOND_CAP,
          `预览 ${JSON.stringify(pCaps)}（期望 ${wantCap}）· 正式 ${JSON.stringify(fCaps)}（期望 ${SECOND_CAP}）`);
        await shot("second-upload-same-session");
      }
    }

    // ── 对照：整页重载、只跑第二张图 ──
    if (sameSessionHash) {
      await send("Page.navigate", { url: `${BASE}/` });
      await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页(对照)");
      await evalJs(HELPERS);
      const ok = await loadFixture(second);
      if (ok) {
        await evalJs(`window.__at.setLongEdge(${LONG_EDGE})`);
        await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
        const rev2 = await evalJs(`window.__at.rev()`);
        await evalJs(`window.__at.setMaxColors(${SECOND_CAP})`);
        await evalJs(`window.__at.clickMode("auto")`);
        if (!(await evalJs(`window.__at.generating()`))) await evalJs(`window.__at.clickGenerate()`);
        await evalJs(`window.__at.waitNewResult(${rev2}, 240000)`, 260000);
        await evalJs(`window.__at.waitQuiet(600, 60000)`, 90000);
        const controlHash = await evalJs(`window.__at.gridHash()`);
        check("换图轮：同页换图 与 整页重载 出图一致（§13 上下文没被冻住）",
          controlHash === sameSessionHash,
          controlHash === sameSessionHash
            ? `两次网格哈希都是 ${controlHash}`
            : `同页换图 ${sameSessionHash} ≠ 重载对照 ${controlHash} —— 单例上下文可能仍在用上一张图`);
      }
    }
  }

  /* ════════ 取消（§19）════════ */
  console.log("\n──── 取消进行中的调优 ────");
  {
    const fixture = fixtureList.find((f) => f.name === "complex-scene") || fixtureList[0];
    const file = path.join(ROOT, fixture.file);
    await send("Page.navigate", { url: `${BASE}/` });
    await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页(重载)");
    await evalJs(HELPERS);
    const doc = await send("DOM.getDocument", { depth: -1 });
    const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
    await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [file] });
    const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
    check("取消轮：上传并挂载", ready);
    if (ready) {
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      // 用一个大尺寸把调优拉长，让取消有窗口可打。
      await evalJs(`window.__at.setLongEdge(400)`);
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      // ⚠️ 改 maxColors 之后**不能**再 waitQuiet。
      // 等它 = 把这一轮等完了、还写进了缓存；下面点「智能」秒回缓存，
      // 取消按钮根本不会出现，探针会误判成「按钮没出现」（2026-10-04 栽过一次，
      // waitGenerating 白等满 60s）。改完立刻点、立刻按，这一轮必然是 miss。
      //
      // ⚠️ 也不要指望 #ws-generate：那个按钮在生成期间是 **disabled** 的
      // （`disabled = !hasSource || state.status.generating`），点它可能什么都没发生。
      // 真实用户路径是「点模式卡片」→ scheduleAutoGenerate（320ms 去抖）→
      // generation.generate()，这条路径在生成期间照样会开一轮新的。用它。
      const revBefore = await evalJs(`window.__at.rev()`);
      await evalJs(`window.__at.setMaxColors(37)`);
      await evalJs(`window.__at.clickMode("auto")`);
      // 模式卡片正常会经 scheduleAutoGenerate 开一轮；万一它没触发
      // （比如点的是当前已激活的那张卡），退回按主按钮，别白等 60s。
      let started = await evalJs(`window.__at.waitGenerating(4000)`, 12000);
      if (!started?.ok) {
        await evalJs(`window.__at.clickGenerate()`);
        started = await evalJs(`window.__at.waitGenerating(60000)`, 90000);
      }
      // 「开始生成」与「取消按钮可见」不是同一时刻：`isGenerating()` 在请求提交时
      // 就为真，而按钮要等界面下一次渲染。所以这里轮询等，别只查一次。
      const cancelShown = started?.ok
        ? await waitFor(`window.__at.cancelVisible()`, 30000, "取消按钮出现")
        : false;
      const cancelState = await evalJson(`window.__at.cancelDebug()`);
      check("取消轮：取消按钮在生成期间出现（B3 §31）", Boolean(started?.ok) && cancelShown,
        `started=${started?.ok} ms=${started?.ms} 现场=${JSON.stringify(cancelState)}`);

      const beforeCancel = await evalJs(`window.__at.requestCount()`);
      const clickedCancel = await evalJs(`window.__at.clickCancel()`);
      check("取消轮：取消按钮可点", clickedCancel,
        clickedCancel ? "" : "取消按钮找不到 / 隐藏 / 禁用 —— 后面的断言会全部空转");
      await sleep(2500);
      const afterCancel = await evalJs(`window.__at.requestCount()`);
      await sleep(2500);
      const afterCancel2 = await evalJs(`window.__at.requestCount()`);
      // §19：取消之后不许再启动新候选。所以请求数必须**停止增长**。
      check("取消轮：取消后不再启动新候选（§19）", afterCancel2 === afterCancel,
        `取消时 ${beforeCancel} → +2.5s ${afterCancel} → +5s ${afterCancel2}`);
      check("取消轮：取消后界面不再显示生成中", !(await evalJs(`window.__at.generating()`)),
        `status=「${await evalJs(`window.__at.statusText()`)}」`);
    }
    await shot("cancel");
  }

  /* ════════ 过期（§19）════════ */
  console.log("\n──── 新请求作废旧请求 ────");
  {
    const fixture = fixtureList.find((f) => f.name === "complex-scene") || fixtureList[0];
    const file = path.join(ROOT, fixture.file);
    await send("Page.navigate", { url: `${BASE}/` });
    await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页(重载)");
    await evalJs(HELPERS);
    const doc = await send("DOM.getDocument", { depth: -1 });
    const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
    await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [file] });
    const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
    check("过期轮：上传并挂载", ready);
    if (ready) {
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      await evalJs(`window.__at.setLongEdge(400)`);
      await evalJs(`window.__at.waitQuiet(800, 240000)`, 260000);
      // 同上：改完 maxColors **不要** waitQuiet，否则这一轮会先跑完并进缓存，
      // 下面第一次点「智能」就成了缓存命中，`waitGenerating` 等不到东西。
      const revBefore = await evalJs(`window.__at.rev()`);
      await evalJs(`window.__at.setMaxColors(41)`);
      await evalJs(`window.__at.clickMode("auto")`);
      const started = await evalJs(`window.__at.waitGenerating(60000)`, 90000);
      check("过期轮：第一轮（智能）真的跑起来了", Boolean(started?.ok), `ms=${started?.ms}`);
      // 生成中途切到另一个模式 → 必须作废前一轮。
      //
      // ⚠️ 这里**不要**再点 #ws-generate：它在生成期间是 disabled 的
      // （`disabled = !hasSource || state.status.generating`），点它等于什么都没做 ——
      // 上一版就是这样，「切模式作废旧请求」这条链路根本没被触发，
      // 探针报「留下的报告是 auto」，看着像产品的 §19 有洞，其实是探针没按下去。
      // 真实路径是「点模式卡片」→ scheduleAutoGenerate（320ms 去抖）→ generation.generate()。
      const cntAtSwitch = await evalJs(`window.__at.requestCount()`);
      await evalJs(`window.__at.clickMode("illustration")`);
      // 先确认新一轮**真的**开起来了，否则下面的断言是在验一个没发生的场景。
      const switched = await waitFor(`window.__at.requestCount() > ${cntAtSwitch}`, 60000, "插画轮开始跑");
      check("过期轮：切模式后新请求真的开跑了（否则本轮什么都没验）", switched,
        `切换前请求 ${cntAtSwitch} → 切换后 ${await evalJs(`window.__at.requestCount()`)}`);
      const settled = await evalJs(`window.__at.waitQuiet(900, 240000)`, 260000);
      const revAfter = await evalJs(`window.__at.rev()`);
      const state = await evalJson(`window.__at.result()`);
      const report = await evalJson(`window.__at.reportSummary()`);
      check("过期轮：最终稳定下来并出图", settled?.ok && state.rows > 0 && revAfter > revBefore,
        `${state.width}×${state.height} · ${state.usedColors} 色 · rev ${revBefore}→${revAfter}`);
      // 关键：最终留下的报告必须属于**最后**那个请求，而不是被作废的那一轮。
      // 插画模式不在 §26 的启用名单里 → 报告应当是 null。
      check("过期轮：留下的报告属于最后一个请求（§19）", report === null || report?.mode === "illustration",
        `report.mode=${report?.mode ?? "(null，插画模式不启用 Auto Tune)"}`);
      check("过期轮：全程没有未捕获异常", pageErrors.length === 0, pageErrors[0] || "");
    }
    await shot("stale");
  }

  /* ════════ 总账 ════════ */
  check("生产 CSP 未拦生成链路相关资源", cspViolations.length === 0, cspViolations[0] || "");
  if (thirdPartyEvalErrors.length) {
    note("第三方 EvalError（tfjs/nsfwjs 在 CSP 下 new Function 被拦）",
      `${thirdPartyEvalErrors.length} 次 · 与生成链路无关`);
  }
  check("全程没有未捕获异常（本站代码）", pageErrors.length === 0, pageErrors[0] || "");
} catch (error) {
  check("探针执行完成（无致命错误）", false, `[${current ? current + " · " : ""}${error.message}]`);
  await shot("99-error");
} finally {
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("\n未通过项：");
    for (const r of failed) console.log(`  - ${r.name}  ${r.detail || ""}`);
  }
  console.log(`截图目录：${OUT}`);
  cleanup();
  process.exit(failed.length ? 1 : 0);
}
