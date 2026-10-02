#!/usr/bin/env node
/**
 * Stage B4 §0 真机探针：尺寸竞态。
 *
 * 要证明的事（规范原文）：
 *   1 导入图片
 *   2 自动识别尚未 settle
 *   3 用户输入 104
 *   4 点击应用尺寸
 *   5 等所有自动异步任务结束
 *   6 最终仍然是用户选择
 *
 * 为什么必须真机：单测能证明「闸写在正确的位置」，但证明不了
 *   · 在真实导入时序里，用户点击**真的**落在识别 settle 之前；
 *   · 识别回调**真的**跑过（而不是压根没跑 —— 那是另一个 bug）；
 *   · 最终出图的宽**真的**是用户选的值。
 *
 * ── 上一版探针 14/21，全部 7 条失败都是探针自己的问题 ──────────────────
 * `blockedAutoWrites=0` 是诚实信号：**这一轮压根没抢到窗口**，什么都没验到。
 * 三条根因，都记在这里免得下次再踩：
 *
 *  1. 「源图就绪」的判据是 `#ws-size-apply` 可用，而按钮可用发生在 source-loaded
 *     之后的一次 paint；探针又靠 60ms 轮询才发现它。于是点击落点比真实事件晚
 *     60–100ms，识别早就 settle 了。
 *     → 改成页内 `armRace()`：挂在 `libms:source-loaded` 上，用 MutationObserver
 *       + 8ms 轮询，按钮一可用就在**同一帧内**输入并点击。这才是「用户抢在识别
 *       settle 之前点」的真实形态。
 *
 *  2. `ui/pixel-multiple.js` 的 `logicalSize()` 默认 `longest = 200`，把上一版三张
 *     夹具（1600×1200 / 800×600 / 1200×900）的自动尺寸**全部**压成 200×150。
 *     于是「换源图后出图不是 200」这条断言恒假 —— 跟产品行为无关。
 *     → 夹具改成自动尺寸互不相同：A/D 自动 200×150，B 自动 150×120。
 *
 *  3. `runAutoGenerate` 是「跑完再排下一轮（60ms 后）」。只要求「有结果且不在跑」
 *     的等待会在两轮之间的空档立刻返回，读到上一轮的陈旧结果。
 *     → 改成 `waitQuiet(600ms)`：连续 600ms 既不生成、又有结果，才算第 5 步
 *       「等所有自动异步任务结束」。
 *
 * 另外两条口径修正：
 *   · `EvalError`（cdn.jsdelivr.net 的 tfjs/nsfwjs 在 CSP 下 new Function 被拦）
 *     是第三方已知项，按 INFO 记，不算本站未捕获异常 —— 与 B2 探针一致。
 *   · 点「自动」档**只改草稿、不生成**（B0 §7/§8 的纪律：只有「应用尺寸」生成）。
 *     所以点完自动，出图仍是上一轮的值，必须再点一次「应用尺寸」才出自动值。
 *
 * 用法：
 *   node tools/b4-size-race-probe.mjs
 *   LIBMS_BASE=http://127.0.0.1:8798 node tools/b4-size-race-probe.mjs
 *
 * 环境变量：
 *   B4_RACE_USER_EDGE  用户输入的尺寸，默认 104
 *   B4_KEEP=1          结束后不删截图目录
 *   PROBE_TIMEOUT_MS   全局看门狗，默认 10 分钟
 *   OUT_DIR            截图输出目录
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9396);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8819);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b4-race-probe");
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/b4-race");
const USER_EDGE = Number(process.env.B4_RACE_USER_EDGE || 104);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const note = (name, detail) => console.log(`INFO  ${name}${detail ? `  ${detail}` : ""}`);

/* ── 夹具：确定性像素画。scale 倍块状 → 像素倍数识别应当认出 scale ──
 *
 * 关键约束：`logicalSize()` 会把逻辑长边压到 ≤200，所以「自动尺寸」= 源图像素 ÷ 倍数
 * 再封顶 200。要让两张图的自动尺寸不同，就必须让**逻辑长边 ≤ 200**（否则一律是 200）。
 * 同时像素总数要大（≥3M）：识别要跑 getImageData + 边界扫描，只有大图才留得住
 * 「用户抢在识别之前点」的窗口。
 *   A/D：512×384 格 @4× = 2048×1536 px → 逻辑 512×384 → 封顶 → 自动 200×150
 *   B  ：150×120 格 @4× =  600×480 px → 逻辑 150×120 → 不封顶 → 自动 150×120
 * 2048 = loadImageData 的 maxSide，再大就会被降采样，而降采样会破坏像素块周期。
 */
const PALETTE = [
  [255, 255, 255], [38, 38, 42], [214, 64, 58], [58, 118, 214],
  [240, 200, 82], [78, 176, 120], [152, 92, 190], [246, 246, 240],
];

/** @returns {{data:Uint8ClampedArray,width:number,height:number}} RGBA */
function makePixelArt(cellsW, cellsH, scale, seed) {
  const width = cellsW * scale;
  const height = cellsH * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let cy = 0; cy < cellsH; cy += 1) {
    for (let cx = 0; cx < cellsW; cx += 1) {
      const [r, g, b] = PALETTE[Math.floor(rand() * PALETTE.length)];
      for (let y = cy * scale; y < (cy + 1) * scale; y += 1) {
        for (let x = cx * scale; x < (cx + 1) * scale; x += 1) {
          const at = (y * width + x) * 4;
          data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 255;
        }
      }
    }
  }
  return { data, width, height };
}

fs.mkdirSync(FIXTURE_DIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// 上一版的三张夹具自动尺寸全是 200（见文件头根因 2），已被这版取代，顺手清掉，
// 免得留着一堆「看起来像夹具、其实没人用」的文件。
for (const stale of ["race-a-1600x1200.png", "race-b-800x600.png", "race-c-1200x900.png"]) {
  try { fs.unlinkSync(path.join(FIXTURE_DIR, stale)); } catch {}
}

const FIXTURE_A = path.join(FIXTURE_DIR, "race-a-2048x1536.png");   // 自动 200×150
const FIXTURE_B = path.join(FIXTURE_DIR, "race-b-600x480.png");     // 自动 150×120
const FIXTURE_D = path.join(FIXTURE_DIR, "race-d-2048x1536.png");   // 自动 200×150（换内容，同名尺寸）
const makeFixture = (file, cellsW, cellsH, scale, seed) => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, encodePng(makePixelArt(cellsW, cellsH, scale, seed)));
};
makeFixture(FIXTURE_A, 512, 384, 4, 20261003);
makeFixture(FIXTURE_B, 150, 120, 4, 777);
makeFixture(FIXTURE_D, 512, 384, 4, 4242);
console.log(`夹具：${FIXTURE_DIR}`);
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
  // 页内 8ms 轮询是抢窗口的手段，被后台节流就白搭。
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b4-race-${Date.now()}`,
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
    // tfjs / nsfwjs 在 CSP 下 new Function 被拦（EvalError）。第三方已知项，
    // 不是本站代码的未捕获异常 —— 与 B2 探针同一口径。
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

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 10 * 60 * 1000);
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

/* ── 页内助手：全部走真实 DOM，不碰内部函数 ────────────────────────── */
const HELPERS = `(() => {
  const $ = (sel) => document.querySelector(sel);
  const bridge = () => window.LibmsWorkspaceBridge;
  /* 源图序号：换图是否真的发生过，只能靠它判断。
     用「按钮可用」当判据会漏 —— 第二张图上传时按钮本来就是可用的。 */
  window.__b4SourceSeq = 0;
  window.addEventListener("libms:source-loaded", () => { window.__b4SourceSeq += 1; });

  window.__b4 = {
    /* 尺寸栏的全部可观测状态 */
    size: () => {
      const controls = $("#ws-size-controls");
      const apply = $("#ws-size-apply");
      const result = bridge().getResult();
      return {
        number: ($("#ws-size-number") || {}).value ?? null,
        range: ($("#ws-size-range") || {}).value ?? null,
        authority: controls ? controls.dataset.longEdgeAuthority || "" : "",
        blocked: controls ? Number(controls.dataset.blockedAutoWrites || 0) : -1,
        applyDisabled: apply ? Boolean(apply.disabled) : null,
        lockedText: (($("#ws-size-authority") || {}).textContent || "").trim(),
        outWidth: result ? result.width : null,
        outHeight: result ? result.height : null,
        generating: Boolean(bridge().isGenerating()),
        settled: Boolean(result && result.grid && result.grid.length > 0) && !bridge().isGenerating(),
      };
    },
    sourceSeq: () => window.__b4SourceSeq,

    /* 用户输入长边（只改草稿，不生成） */
    setNumber: (value) => {
      const node = $("#ws-size-number");
      if (!node) return false;
      node.value = String(value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    /* 用户点「应用尺寸」 */
    clickApply: () => {
      const button = $("#ws-size-apply");
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    /* 用户点「自动」档 */
    clickAuto: () => {
      const chip = [...document.querySelectorAll("[data-size]")].find((n) => n.dataset.size === "auto");
      if (!chip || chip.disabled) return false;
      chip.click();
      return true;
    },
    sourceName: () => ($("#ws-source-name") || {}).textContent || "",

    /**
     * 抢窗口：在 source-loaded 之后**同一帧内**输入长边并点「应用尺寸」。
     *
     * 这是「用户抢在识别 settle 之前点」的真实形态，只是把人的手速换成了
     * MutationObserver + 8ms 轮询。生产监听器先注册，所以本监听器一定在它之后跑，
     * 而生产那条链（ensureMultipleDetection）从这一帧起还要走图片 onload →
     * getImageData → 边界扫描，中间隔着好几个宏任务 —— 抢得到。
     *
     * 不 await：调用方在 setFileInputFiles 之前把它挂上，之后再取结果。
     */
    armRace: (edge) => new Promise((resolve) => {
      const t0 = performance.now();
      const log = [];
      let sourceAt = null, done = false, mo = null, timer = null, poll = null, deadline = null;
      const cleanup = () => {
        try { mo?.disconnect(); } catch {}
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        if (deadline) clearTimeout(deadline);
      };
      const finish = (payload) => { if (!done) { done = true; cleanup(); resolve(payload); } };
      const attempt = (why) => {
        if (done || sourceAt === null) return;
        const button = $("#ws-size-apply");
        const node = $("#ws-size-number");
        if (!button || !node || button.disabled) return;
        const before = window.__b4.size();
        const at = performance.now();
        node.value = String(edge);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        button.click();
        log.push({ event: "clicked", why, atMs: Math.round(at - t0) });
        finish({
          ok: true, why, edge,
          clickAfterSourceMs: Math.round(at - sourceAt),
          outWidthAtClick: before.outWidth,
          authorityAtClick: before.authority,
          blockedAtClick: before.blocked,
          log,
        });
      };
      window.addEventListener("libms:source-loaded", () => {
        sourceAt = performance.now();
        log.push({ event: "source-loaded", atMs: Math.round(sourceAt - t0) });
        attempt("source-loaded");
        if (done) return;
        // 节点出现（childList）与可用性变化（disabled 属性）都要立刻反应。
        mo = new MutationObserver(() => attempt("mutation"));
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
        // 兜底：某些可用性变化不一定产生可观察的属性变更。
        poll = setInterval(() => attempt("poll"), 8);
        deadline = setTimeout(() => finish({ ok: false, why: "timeout", edge, log }), 8000);
      }, { once: true });
      timer = setTimeout(() => finish({ ok: false, why: "no-source-loaded", edge, log }), 60000);
    }),

    /**
     * 等到「真的安静」：连续 quietMs 既不生成、又有结果。
     *
     * 不能只等 settled —— runAutoGenerate 是「跑完再排下一轮（60ms 后）」，
     * 两轮之间那个空档里 settled 也是 true，读到的是上一轮的陈旧结果。
     */
    waitQuiet: (quietMs, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      let quietSince = null, sawResult = false, last = null;
      const tick = () => {
        const s = window.__b4.size();
        last = s;
        if (s.outWidth) sawResult = true;
        if (s.settled && !s.generating) { if (quietSince === null) quietSince = performance.now(); }
        else quietSince = null;
        const now = performance.now();
        if (quietSince !== null && now - quietSince >= quietMs) { resolve({ ok: true, sawResult, ms: Math.round(now - t0), last }); return; }
        if (now - t0 > timeoutMs) { resolve({ ok: false, sawResult, ms: Math.round(now - t0), last }); return; }
        setTimeout(tick, 30);
      };
      setTimeout(tick, 30);
    }),
  };
  return true;
})()`;

/** 上传文件并把「源图序号」推进一格 —— 这才是「新图真的进来了」。 */
const upload = async (file, label) => {
  const seqBefore = await evalJs(`window.__b4.sourceSeq()`);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");
  await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [file] });
  return waitFor(`window.__b4.sourceSeq() > ${seqBefore}`, 180000, label || "新源图");
};
const waitQuiet = (quietMs = 600, timeoutMs = 180000) =>
  evalJs(`window.__b4.waitQuiet(${quietMs}, ${timeoutMs})`, timeoutMs + 30000);

/* ── 主流程 ─────────────────────────────────────────────────────── */
try {
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");
  await evalJs(HELPERS);

  /* ───── 场景 1：竞态 —— 抢在识别 settle 之前点「应用尺寸」 ───── */
  await evalJs(`(() => { window.__b4Race1 = null; window.__b4.armRace(${USER_EDGE}).then((r) => { window.__b4Race1 = r; }); return true; })()`);
  const readyA = await upload(FIXTURE_A, "第一张源图");
  check("2048×1536 夹具上传完成", readyA);
  check("工作台挂载", await evalJs(`document.body.dataset.workspaceState === 'ready'`));
  const armed1 = await evalJson(`window.__b4Race1`);
  check(`§0 用户输入 ${USER_EDGE} 并点了「应用尺寸」（抢在识别 settle 之前）`,
    armed1?.ok, armed1?.ok ? `点击发生在 source-loaded 后 ${armed1.clickAfterSourceMs}ms` : `未点到：${armed1?.why}`);
  note("点击时状态", `authority=${armed1?.authorityAtClick} blocked=${armed1?.blockedAtClick} 出图宽=${armed1?.outWidthAtClick}`);

  const quiet1 = await waitQuiet();
  const after = await evalJson(`window.__b4.size()`);
  note("竞态后状态", `authority=${after.authority} blocked=${after.blocked} 出图 ${after.outWidth}×${after.outHeight} ` +
    `（安静等待 ${quiet1?.ms}ms）`);

  // 关键：证明窗口**真的**被命中。blocked 是 0 就说明识别在点击前就 settle 了，
  // 这一轮什么都没验到 —— 不能报 PASS（那是假绿灯，本仓库踩过好几次）。
  check("§0 竞态窗口确实被命中（自动链跑过且被闸挡下）", after.blocked >= 1,
    `blockedAutoWrites=${after.blocked}`);
  check(`§0 最终出图宽仍然是用户选的 ${USER_EDGE}`, after.outWidth === USER_EDGE, `实得 ${after.outWidth}`);
  check("§0 长边权威是 user-explicit", after.authority === "user-explicit", after.authority);
  check("§0 读数也是用户选的值（读数与出图不分叉）", Number(after.number) === USER_EDGE, `读数 ${after.number}`);
  await shot("01-race-user-wins");

  /* ───── 场景 2：用户主动点「自动」→ 交还控制权 ───── */
  const autoClicked = await evalJs(`window.__b4.clickAuto()`);
  check("§0 「自动」档可点", autoClicked);
  // 「自动」只改草稿、不生成（B0 §7/§8：生成只由「应用尺寸」发起），所以这里
  // 只等一帧让 UI 同步，不等出图。
  await sleep(200);
  const autoDraft = await evalJson(`window.__b4.size()`);
  note("点自动后（尚未应用）", `authority=${autoDraft.authority} 读数 ${autoDraft.number} 出图 ${autoDraft.outWidth}`);
  check("§0 「自动」把权威降回 auto", autoDraft.authority === "auto", autoDraft.authority);
  // 这条同时证明「自动链本身是活的」—— 否则「挡住了」可能只是因为它压根不工作。
  check("§0 自动链算出的尺寸**不是**用户那个值（证明自动链真的在工作）",
    Number(autoDraft.number) !== USER_EDGE, `自动得到 ${autoDraft.number}，用户给的是 ${USER_EDGE}`);
  // 自动值必须落地：再点一次「应用尺寸」才生成，且这次出来的必须是自动值。
  await evalJs(`window.__b4.clickApply()`);
  await waitQuiet();
  const auto = await evalJson(`window.__b4.size()`);
  note("自动值应用后", `读数 ${auto.number} 出图 ${auto.outWidth}×${auto.outHeight}`);
  check("§0 自动尺寸与出图一致（应用后）", Number(auto.number) === auto.outWidth,
    `读数 ${auto.number} vs 出图 ${auto.outWidth}`);
  await shot("02-restore-auto");

  /* ───── 场景 3：换源图必须清除 user-explicit ───── */
  await evalJs(`window.__b4.setNumber(160)`);
  await evalJs(`window.__b4.clickApply()`);
  await waitQuiet();
  const second = await evalJson(`window.__b4.size()`);
  check("§0 用户尺寸 160 生效", second.outWidth === 160 && second.authority === "user-explicit",
    `出图 ${second.outWidth} authority=${second.authority}`);

  const readyB = await upload(FIXTURE_B, "第二张源图（600×480）");
  check("换源图上传完成（600×480）", readyB);
  const afterSwap = await evalJson(`window.__b4.size()`);
  check("§0 换源图清除 user-explicit", afterSwap.authority === "auto",
    `authority=${afterSwap.authority}（必须已清空，否则新图会被上一张图的权威挡住）`);
  await waitQuiet();
  const newSource = await evalJson(`window.__b4.size()`);
  note("换图后", `读数 ${newSource.number} 出图 ${newSource.outWidth}×${newSource.outHeight}`);
  // 600×480 @4× → 逻辑 150×120 → 自动长边 150。上一张用户给的是 160。
  check("§0 新图按自动尺寸出图，不是上一张图的 160", newSource.outWidth !== 160, `实得 ${newSource.outWidth}`);
  check("§0 新图读数与出图一致", Number(newSource.number) === newSource.outWidth,
    `读数 ${newSource.number} vs 出图 ${newSource.outWidth}`);
  await shot("03-source-replaced");

  /* ───── 场景 4：第三张图重复一次竞态，确认不是一次侥幸 ───── */
  await evalJs(`(() => { window.__b4Race4 = null; window.__b4.armRace(${USER_EDGE}).then((r) => { window.__b4Race4 = r; }); return true; })()`);
  const readyD = await upload(FIXTURE_D, "第三张源图（2048×1536）");
  check("第三张夹具上传完成（2048×1536）", readyD);
  const armed4 = await evalJson(`window.__b4Race4`);
  check(`§0 第二次竞态：同样抢在识别之前点到「应用尺寸」`, armed4?.ok,
    armed4?.ok ? `点击发生在 source-loaded 后 ${armed4.clickAfterSourceMs}ms` : `未点到：${armed4?.why}`);
  await waitQuiet();
  const third = await evalJson(`window.__b4.size()`);
  note("第三张", `authority=${third.authority} blocked=${third.blocked} 出图 ${third.outWidth}`);
  check("§0 竞态可重复：第三张仍是用户选择", third.outWidth === USER_EDGE && third.authority === "user-explicit",
    `出图 ${third.outWidth} authority=${third.authority}`);
  check("§0 第二次竞态同样命中窗口（blocked 继续累加）", third.blocked >= 1, `blockedAutoWrites=${third.blocked}`);

  /* ───── 环境门禁 ───── */
  check("生产 CSP 未拦尺寸链路相关资源", cspViolations.length === 0, cspViolations[0] || "");
  if (thirdPartyEvalErrors.length) {
    note("第三方 EvalError（tfjs/nsfwjs 在 CSP 下 new Function 被拦）",
      `${thirdPartyEvalErrors.length} 次 · 与本站尺寸链路无关`);
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
