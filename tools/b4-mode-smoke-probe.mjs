#!/usr/bin/env node
/**
 * Stage B4 §2 真机探针：8 个公开模式在生产链路（真实 Worker + 生产 CSP）里都要能出图。
 *
 * 为什么必须真机：单测能证明「模式表只有一份」「字段都有读取点」，
 * 但证明不了**面板点下去之后，那个模式真的走到了 Worker 里**。
 * 中间隔着 panel → store → buildV25Options → request.mode/overrides → Worker 五跳，
 * 任何一跳改名或漏传，静态测试都是绿的。
 *
 * 取证方式：页内 patch `Worker.prototype.postMessage`，把每次生成的 request 抓下来。
 * 于是可以直接断言：
 *   · `request.mode` 等于用户点的那个模式；
 *   · `request.overrides.cleanupStrength` 等于该模式的档案值
 *     （pixel=10 / logo=85 / portrait=35 …）—— 这条在 B4 §2 之前是「传了但引擎丢掉」，
 *     现在至少能证明它**到了请求里**；引擎侧的落地由
 *     tests/mode-profile-contract.test.mjs 的 stroke 阈值取证负责。
 *
 * 「小白一键」会打开「去除纯色背景」，因此先出预检条再出图 —— 探针按真实用户路径
 * 点预检条上的「应用」，不绕过那道确认。
 *
 * ── 两条踩过的坑（都是探针自己的，不是生产缺陷）────────────────────────
 *  ① 预检条一出现就是 `data-status="probing"`，此时**三个按钮全部 hidden**。
 *     只等 `strip.hidden === false` 就去点「应用」必然落空，文案还停在
 *     「正在检测背景…」。必须等 `status !== "probing"`。
 *  ② 点完之后不能用 `waitQuiet` 判「出了新图」：它的判据是
 *     「有结果且不在生成中」，生成还没启动时立刻满足 → 读到的是**上一轮**的结果。
 *     必须等 `libms:project-result` 版本号真的推进（`waitNewResult`）。
 *
 * 用法：
 *   node tools/b4-mode-smoke-probe.mjs
 * 环境变量：
 *   LIBMS_BASE / CDP_PORT / SERVE_PORT / OUT_DIR / PROBE_TIMEOUT_MS / B4_KEEP
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9397);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8820);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b4-mode-smoke");
// 复用 §0 的夹具（已被 .gitignore 忽略，确定性 4× 像素画）。600×480 出图快，
// 8 个模式跑完不会把探针拖成十几分钟。
const FIXTURE = path.join(ROOT, "tests/fixtures/b4-race/race-b-600x480.png");
const LONG_EDGE = Number(process.env.B4_MODE_LONG_EDGE || 104);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const note = (name, detail) => console.log(`INFO  ${name}${detail ? `  ${detail}` : ""}`);

/** 8 个公开模式 + 该模式档案里 `cleanupStrength` 的期望值（B4 §2 后必须真的传出去）。 */
const MODES = [
  { mode: "beginner", label: "小白一键", cleanupStrength: 45, needsPreview: true },
  { mode: "auto", label: "智能", cleanupStrength: 50 },
  { mode: "portrait", label: "人像", cleanupStrength: 35 },
  { mode: "anime", label: "动漫", cleanupStrength: 45 },
  { mode: "illustration", label: "插画", cleanupStrength: 55 },
  { mode: "pixel", label: "像素", cleanupStrength: 10 },
  { mode: "logo", label: "Logo", cleanupStrength: 85 },
  { mode: "photo", label: "写实", cleanupStrength: 40 },
];

if (!fs.existsSync(FIXTURE)) {
  console.error(`缺少夹具：${FIXTURE}\n先跑一次 tools/b4-size-race-probe.mjs 生成它。`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
console.log(`夹具：${FIXTURE}`);
console.log(`基址：${BASE}（生产 CSP 头由 serve-with-headers.mjs 提供）`);

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
  `--user-data-dir=/tmp/chrome-libms-b4-modes-${Date.now()}`,
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

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 15 * 60 * 1000);
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

  // 抓生成请求：Worker 客户端走 target.postMessage({type:"generate", request})。
  // 这是唯一能证明「面板点的模式真的走到了 Worker」的位置 —— request.mode 与
  // request.overrides 都是纯数据，可以直接读。
  window.__b4sRequests = [];
  const rawPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function patched(message, transfer) {
    try {
      if (message && message.type === "generate" && message.request) {
        const request = message.request;
        window.__b4sRequests.push({
          mode: request.mode,
          maxColors: request.maxColors,
          size: { width: request.size?.width, height: request.size?.height },
          cleanupStrength: request.overrides?.cleanupStrength ?? null,
          detailProtection: request.overrides?.detailProtection ?? null,
          autoBackground: request.overrides?.autoBackground ?? null,
          requestId: request.requestId,
        });
      }
    } catch {}
    return rawPost.call(this, message, transfer);
  };

  // 出图版本号：靠 project-result 事件推进，用来判「这一轮真的出了新图」。
  window.__b4sRev = 0;
  window.addEventListener("libms:project-result", () => { window.__b4sRev += 1; });

  window.__b4s = {
    rev: () => window.__b4sRev,
    lastRequest: () => window.__b4sRequests[window.__b4sRequests.length - 1] || null,
    requestCount: () => window.__b4sRequests.length,
    activeMode: () => ($("[data-preset].is-active") || {}).dataset?.preset ?? null,
    clickMode: (mode) => {
      const card = document.querySelector('[data-preset="' + mode + '"]');
      if (!card || card.disabled) return false;
      card.click();
      return true;
    },
    result: () => {
      const r = bridge().getResult();
      const used = new Set();
      for (const row of r.grid || []) for (const cell of row) if (cell) used.add(cell.code);
      return {
        width: r.width, height: r.height,
        rows: r.grid?.length ?? 0,
        usedColors: used.size,
        generating: Boolean(bridge().isGenerating()),
      };
    },
    // 预检条有三个状态：probing（转圈，三个按钮**全部 hidden**）→ 结论
    // （apply/keep 可见，或 dismiss 可见）。**只看 strip.hidden 是不够的** ——
    // 条子一出现就是 probing，此时点「应用」必然落空。B4 首次实测就栽在这里：
    // 探针在条子出现的同一帧读文案，拿到「正在检测背景…」，点应用返回 false，
    // 于是 beginner 那 4 条全红，而生产链路其实没问题。
    previewState: () => {
      const n = $("#ws-bg-preview");
      const a = $("#ws-bg-preview-apply");
      const k = $("#ws-bg-preview-keep");
      const d = $("#ws-bg-preview-dismiss");
      return {
        visible: Boolean(n) && !n.hidden,
        status: (n && n.dataset ? n.dataset.status : null) || null,
        text: (($("#ws-bg-preview-text") || {}).textContent || "").trim(),
        applyVisible: Boolean(a) && !a.hidden && !a.disabled,
        keepVisible: Boolean(k) && !k.hidden,
        dismissVisible: Boolean(d) && !d.hidden,
      };
    },
    applyPreview: () => {
      const b = $("#ws-bg-preview-apply");
      if (!b || b.hidden || b.disabled) return false;
      b.click();
      return true;
    },
    // 预检的**第三种结论**：不可靠 → 只有「知道了」可见，且**不会自动出图**
    // （B2 §4「不确定时 NO-OP」）。用户点掉它才回到正常生成 —— 这是真实路径，
    // 探针必须走，否则会误判成「beginner 不出图」。
    dismissPreview: () => {
      const b = $("#ws-bg-preview-dismiss");
      if (!b || b.hidden || b.disabled) return false;
      b.click();
      return true;
    },
    // 第二种结论：用户主动「保留背景」→ 把开关真的关掉再生成。
    keepPreview: () => {
      const b = $("#ws-bg-preview-keep");
      if (!b || b.hidden || b.disabled) return false;
      b.click();
      return true;
    },
    // 等出图版本号推进到超过 target。
    // **不要用 waitQuiet 代替**：waitQuiet 的判据是「有结果且不在生成中」，
    // 如果点下去之后生成还没启动（scheduleAutoGenerate 有延迟），它会立刻满足，
    // 于是读到的是**上一轮**的结果 —— 表现就是「明明出了图却判成没出图」。
    waitNewResult: (target, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (window.__b4sRev > target) { resolve({ ok: true, ms: Math.round(performance.now() - t0) }); return; }
        if (performance.now() - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(performance.now() - t0) }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }),
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
    waitQuiet: (quietMs, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      let quietSince = null;
      const tick = () => {
        const r = window.__b4s.result();
        if (r.rows > 0 && !r.generating) { if (quietSince === null) quietSince = performance.now(); }
        else quietSince = null;
        const now = performance.now();
        if (quietSince !== null && now - quietSince >= quietMs) { resolve({ ok: true, ms: Math.round(now - t0) }); return; }
        if (now - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(now - t0) }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }),
  };
  return true;
})()`;

/* ── 主流程 ─────────────────────────────────────────────────────── */
try {
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");

  // 先挂助手（含 postMessage patch），再上传 —— 否则第一轮生成的请求抓不到。
  await evalJs(HELPERS);

  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");
  await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [FIXTURE] });
  const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 180000, "工作台挂载");
  check("夹具上传并挂载工作台", ready);
  await evalJs(`window.__b4s.waitQuiet(800, 180000)`, 200000);

  // 固定长边，8 个模式在同一尺寸下比较（出图快 + 可比）。
  await evalJs(`window.__b4s.setLongEdge(${LONG_EDGE})`);
  await evalJs(`window.__b4s.waitQuiet(800, 180000)`, 200000);

  for (const { mode, label, cleanupStrength, needsPreview } of MODES) {
    const revBefore = await evalJs(`window.__b4s.rev()`);
    const countBefore = await evalJs(`window.__b4s.requestCount()`);
    const clicked = await evalJs(`window.__b4s.clickMode("${mode}")`);
    if (!clicked) { check(`模式 ${label}（${mode}）可点`, false, "卡片不存在或被禁用"); continue; }

    let previewText = "";
    if (needsPreview) {
      // 小白一键会先出背景预检条。按真实用户路径点按钮，不绕过确认。
      // 必须等到**出结论**（status 不再是 probing）才能点 —— probing 期间按钮全隐藏。
      const settled = await waitFor(
        `(() => { const s = window.__b4s.previewState(); return !s.visible || s.status !== "probing"; })()`,
        90000, `${mode} 背景预检出结论`);
      const preview = await evalJson(`window.__b4s.previewState()`);
      previewText = preview.text || "";
      // 三种结论都算「给出了结论」：可分离→[应用]/[保留背景]；不可分离→[知道了]。
      // 断言的是「结论可达且可操作」，不是「一定要能去背景」—— 后者由图片内容决定，
      // 拿一张没有纯色背景的合成图去要求它必然可分离，是在测夹具不是测产品。
      const actionable = preview.applyVisible || preview.keepVisible || preview.dismissVisible;
      check(`模式 ${label} 的背景预检条给出可操作结论`, settled && preview.visible && actionable,
        `status=${preview.status} 文案「${previewText}」 apply=${preview.applyVisible} keep=${preview.keepVisible} dismiss=${preview.dismissVisible}`);
      if (preview.applyVisible) await evalJs(`window.__b4s.applyPreview()`);
      else if (preview.dismissVisible) await evalJs(`window.__b4s.dismissPreview()`);
      else if (preview.keepVisible) await evalJs(`window.__b4s.keepPreview()`);
    }

    // 等待的 CDP 超时必须**大于**页内的等待上限，否则先抛 CDP 超时。
    const waited = await evalJs(`window.__b4s.waitNewResult(${revBefore}, 180000)`, 200000);
    const quiet = await evalJs(`window.__b4s.waitQuiet(600, 60000)`, 90000);
    const revAfter = await evalJs(`window.__b4s.rev()`);
    const state = await evalJson(`window.__b4s.result()`);
    const request = await evalJson(`window.__b4s.lastRequest()`);
    const countAfter = await evalJs(`window.__b4s.requestCount()`);

    const produced = waited?.ok && revAfter > revBefore && state.rows > 0 && state.usedColors > 0;
    check(`模式 ${label}（${mode}）出图`, produced,
      `${state.width}×${state.height} · ${state.usedColors} 色 · 等到新图 ${waited?.ms}ms · 静默 ${quiet?.ms}ms · 预检「${previewText}」`);
    check(`模式 ${label} 的生成请求到达 Worker`, countAfter > countBefore && request?.mode === mode,
      `request.mode=${request?.mode}`);
    check(`模式 ${label} 的档案值随请求发出（cleanupStrength=${cleanupStrength}）`,
      Number(request?.cleanupStrength) === cleanupStrength,
      `实得 ${request?.cleanupStrength}`);
    if (mode === "beginner") {
      check("小白一键的智能辅助开关随请求发出", request?.autoBackground === true,
        `autoBackground=${request?.autoBackground}`);
    }
  }

  note("本轮抓到的生成请求总数", String(await evalJs(`window.__b4s.requestCount()`)));
  // 把整张请求表打出来 —— 这是唯一能一眼看出「哪个模式实际拿到了什么参数」的证据。
  // §11（maxColors 硬约束）要用的基线数字就藏在这一列里。
  const allRequests = await evalJson(`window.__b4sRequests`);
  console.log("\n抓到的生成请求（按时间顺序）：");
  console.log("  mode          尺寸        maxColors  清理强度  autoBg  细节保护");
  for (const r of allRequests) {
    console.log(`  ${String(r.mode).padEnd(13)} ${`${r.size?.width}×${r.size?.height}`.padEnd(10)} `
      + `${String(r.maxColors).padEnd(10)} ${String(r.cleanupStrength).padEnd(8)} `
      + `${String(r.autoBackground).padEnd(7)} ${r.detailProtection}`);
  }
  await shot("modes-final");

  check("生产 CSP 未拦生成链路相关资源", cspViolations.length === 0, cspViolations[0] || "");
  if (thirdPartyEvalErrors.length) {
    note("第三方 EvalError（tfjs/nsfwjs 在 CSP 下 new Function 被拦）",
      `${thirdPartyEvalErrors.length} 次 · 与生成链路无关`);
  }
  check("全程没有未捕获异常（本站代码）", pageErrors.length === 0, pageErrors[0] || "");
} catch (error) {
  check("探针执行完成（无致命错误）", false, `[${error.message}]`);
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
