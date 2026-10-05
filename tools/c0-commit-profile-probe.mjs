#!/usr/bin/env node
/**
 * Stage C0 §16 —— 提交阶段（commit path）单点复测器。
 *
 * ── 为什么不能直接用 `stage-b-master-probe.mjs --only F` ──────────────────
 * `--only F` 会**假失败**：F 之前没跑过任何场景，页面是第一次上传，
 * 而「上传 → 本地内容审查」首次要下 ~4.8 MB 模型。那段下载期间
 * `isGenerating()` 是 false、计数器也不动 —— `waitStable(1500)` 会把
 * **下载的空档**误判成静止，于是 `bridge.generate({500,500})` 撞上
 * 紧接着启动的首帧自动生成，被 `processImage` 的「正在生成，请稍候」拒掉；
 * `waitNewResult` 随即被**自动生成那一轮**唤醒 —— 结果是 200×200，
 * 看起来像「500 档提交阶段只要 201ms」。
 *
 * 这个探针的唯一区别就是**等法**：它要求「图纸已经存在」才算静止
 * （`grid.length > 0 && !isGenerating()` 连续稳定），所以模型下载期
 * 一律不算静止。除此之外驱动方式与 master probe 完全一致（同一个
 * `bridge.generate`、同一份 commit profile），数字可以直接对比。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────────
 *   node tools/c0-commit-profile-probe.mjs                # 默认 400,500
 *   LIBMS_SIZES=300,400,500 node tools/c0-commit-profile-probe.mjs
 *   LIBMS_REPEAT=2 node tools/c0-commit-profile-probe.mjs  # 每档重复几轮
 *   LIBMS_WARM_LOADS=5 node tools/c0-commit-profile-probe.mjs  # 先做 5 次整页载入（复现 --all 口径）
 *   LIBMS_BASE=http://127.0.0.1:8836 node ...              # 复用已起的服务
 *   LIBMS_FIXTURE=tests/fixtures/... node ...
 *
 * 输出：每档一行的分段表 + 与 B5 发布门基线（docs/stage-b-architecture.md §8.3）
 * 的并排对比。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9421);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8839);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE = process.env.LIBMS_FIXTURE || path.join(ROOT, "tests/fixtures/real-failures/rf-complex/image.png");
const SIZES = (process.env.LIBMS_SIZES || "400,500").split(",").map((s) => Number(s.trim())).filter(Boolean);
const REPEAT = Number(process.env.LIBMS_REPEAT || 1);
/**
 * 测量前的「预热载入次数」。
 *
 * 存在的理由是一个**测量口径问题**，不是产品问题：`stage-b-master-probe.mjs --all`
 * 里场景 F 排在第 6 个，同一台 Chrome、**同一个 origin** 已经跑了 A–E 五次
 * 「整页重载 + 上传 + 生成」。`Page.navigate` 会清掉 JS 堆，但
 * **localStorage / IndexedDB / 缓存不会清** —— 草稿、作品画廊、库存台账都会
 * 累积下来，而这些东西都会进 `paint()`。
 *
 * 于是同一个 500 档提交，`--all` 报 1312ms，隔离复测报 861ms，
 * 差 450ms 却都不是「回归」。`LIBMS_WARM_LOADS=5` 用来复现 `--all` 的口径，
 * 从而判定这个差值到底来自哪里 —— 判定完再决定改产品还是改口径。
 */
const WARM_LOADS = Number(process.env.LIBMS_WARM_LOADS || 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * B5 发布门基线（docs/stage-b-architecture.md §8.3）。
 * 用它做并排对比，而不是「凭记忆觉得变慢了」。
 */
const BASELINE = {
  104: { commitTotal: 64.6, chartUrl: 36.3, eventDispatch: 21.4 },
  200: { commitTotal: 173.2, chartUrl: 86.4, eventDispatch: 67.8 },
  300: { commitTotal: 381.9, chartUrl: 190.6, eventDispatch: 141.3 },
  400: { commitTotal: 586.2, chartUrl: 300.4, eventDispatch: 214.6 },
  500: { commitTotal: 899.6, chartUrl: 449.3, eventDispatch: 343.4 },
};

/* ── 服务器 + Chrome ─────────────────────────────────────────────── */
let server = null;
if (!process.env.LIBMS_BASE) {
  server = spawn(process.execPath, [path.join(ROOT, "tools/serve-with-headers.mjs"), "deploy", String(SERVE_PORT)], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    try { up = (await fetch(`${BASE}/`)).ok; } catch { await sleep(150); }
  }
  if (!up) { console.error(`服务器起不来：${BASE}`); server.kill("SIGKILL"); process.exit(1); }
}

if (!fs.existsSync(FIXTURE)) { console.error(`缺少夹具：${FIXTURE}`); process.exit(1); }

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  // 本机系统代理会拦 127.0.0.1；不加这两项页面会落在 chrome-error://chromewebdata/。
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  // 与 master probe 保持一致：提交阶段要量的是真实主线程，不能被后台节流干扰。
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-c0-commit-${Date.now()}`,
  "--window-size=1600,1000",
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
const pageErrors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    return;
  }
  if (m.method === "Runtime.exceptionThrown") {
    const text = String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 200);
    if (!/EvalError/.test(text)) pageErrors.push(text);
  }
});
const send = (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} 超时 ${timeoutMs}ms`)); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});

await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");

const evalJs = async (expression, timeoutMs = 60000) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "页面求值失败");
  return r.result?.value;
};
const waitFor = async (expr, ms = 60000, label = "") => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await evalJs(expr, 15000)) return true; } catch {}
    await sleep(250);
  }
  console.log(`  [等超时] ${label || expr}`);
  return false;
};

/**
 * 页面侧助手：只做两件事 —— 打开 commit profile、观测长任务。
 *
 * 必须是 IIFE：`tests/b4-probe-helpers-syntax.test.mjs` 用「结尾是不是 `})()`」
 * 当**截断判据** —— 模板字符串遇到第一个未转义反引号就结束，而截断后的
 * 剩余源码往往**仍然能解析**（2026-10-04 实测：body 被腰斩到 3421 字符，
 * 文件级 `node --check` 照样绿，只有页内 eval 才炸）。
 * 所以这里不许写裸反引号，注释里也不行。
 */
const HELPERS = `(() => {
  window.__libmsProfileCommit = true;
  window.__c0Long = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__c0Long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  window.__c0Rev = 0;
  window.addEventListener("libms:project-result", () => { window.__c0Rev += 1; });
  return true;
})()`;

/**
 * 等「真的静止」：**图纸已经存在** + 不在生成 + 快照连续稳定。
 *
 * 这是与 master probe 的 `waitStable` 唯一的实质差别 —— 多了
 * 「图纸已经存在」这一条。少了它，首次上传的内容审查模型下载期
 * 会被当成静止（见文件头）。
 */
const waitQuiet = async (quietMs = 2000, timeoutMs = 300000) =>
  evalJs(`new Promise((resolve) => {
    const t0 = performance.now();
    let last = null, since = null;
    const tick = () => {
      const r = window.LibmsWorkspaceBridge.getResult();
      const has = Boolean(r?.grid?.length);
      const busy = Boolean(window.LibmsWorkspaceBridge.isGenerating());
      const snap = [r?.width, r?.height, r?.grid?.length, window.__c0Rev].join("|");
      const now = performance.now();
      if (!has || busy) { last = null; since = null; }
      else if (snap !== last) { last = snap; since = now; }
      else if (now - since >= ${quietMs}) { resolve({ ok: true, ms: Math.round(now - t0) }); return; }
      if (now - t0 > ${timeoutMs}) { resolve({ ok: false, ms: Math.round(now - t0) }); return; }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 0);
  })`, timeoutMs + 20000);

console.log(`基址：${BASE}（生产 CSP 头由 serve-with-headers.mjs 提供）`);
console.log(`夹具：${path.relative(ROOT, FIXTURE)}`);
console.log(`档位：${SIZES.join(", ")} · 每档 ${REPEAT} 轮${WARM_LOADS ? ` · 预热 ${WARM_LOADS} 次载入` : ""}\n`);

/** 一次完整的「整页重载 → 上传 → 等首帧出图」。预热与正式测量共用同一段。 */
async function bootAndUpload() {
  await send("Page.navigate", { url: `${BASE}/` });
  const ready = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  if (!ready) return { ok: false, why: "落地页没就绪" };
  await evalJs(HELPERS);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const node = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#file-input" });
  if (!node?.nodeId) return { ok: false, why: "找不到 #file-input" };
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [FIXTURE] });
  const mounted = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
  if (!mounted) return { ok: false, why: "工作台没挂载" };
  // 关键的一步：等首帧自动生成**真的出图**（而不是等「静默 1.5s」）。
  const quiet = await waitQuiet(2000);
  if (!quiet.ok) return { ok: false, why: "首帧没出图" };
  return { ok: true, ms: quiet.ms };
}

/* ── 预热载入（复现 `--all` 的跨场景口径）─────────────────────────── */
if (WARM_LOADS > 0) {
  console.log(`预热 ${WARM_LOADS} 次整页载入（同一 origin 累积 localStorage / IndexedDB）…`);
  for (let i = 1; i <= WARM_LOADS; i += 1) {
    const warm = await bootAndUpload();
    console.log(`  第 ${i} 次：${warm.ok ? `ok（${warm.ms}ms）` : `失败 —— ${warm.why}`}`);
    if (!warm.ok) break;
  }
  console.log("");
}

/* ── 正式测量用的那一次载入 ───────────────────────────────────────── */
const boot = await bootAndUpload();
if (!boot.ok) { console.error(boot.why); process.exit(1); }
console.log(`首帧就绪：ok（${boot.ms}ms）`);
// 同源残留数据的体量 —— `--all` 里 F 排在第 6 个，这里是判定「跨场景污染」的证物。
const siteData = await evalJs(`(() => {
  let bytes = 0, keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      keys += 1;
      bytes += (String(k).length + String(localStorage.getItem(k) || "").length) * 2;
    }
  } catch {}
  return { keys, kb: Math.round(bytes / 1024) };
})()`);
console.log(`同源 localStorage：${siteData.keys} 个键 / ${siteData.kb} KB`);

/**
 * 页内实测 `exportV2.split()` 的支配成本。
 *
 * `export-v2-service.js` 的 `grid()` 是**整幅深拷贝**：
 *   getGrid().map(row => row.map(cell => cell ? {...cell, rgb:[...cell.rgb]} : null))
 * 任何调用 `exportV2.split()` 的同步监听者，都要按格数付这笔钱。
 * 这里量的是同一段代码在**真浏览器 + 真网格**上的耗时（Node 里量不准：
 * 对象形状更简单、JIT 更热）。
 */
const cloneCost = await evalJs(`(() => {
  const g = window.LibmsWorkspaceBridge.getResult().grid;
  const cells = g.length * (g[0]?.length || 0);
  const t0 = performance.now();
  const c = g.map((row) => row.map((cell) => (cell ? { ...cell, rgb: [...cell.rgb] } : null)));
  const t1 = performance.now();
  window.__c0CloneKeep = c;  // 防止被优化掉
  return { cells, cloneMs: Number((t1 - t0).toFixed(1)) };
})()`);
console.log(`页内实测：整幅深拷贝 ${cloneCost.cloneMs}ms（${cloneCost.cells.toLocaleString("en-US")} 格）`);
console.log("  ↑ 这是 exportV2.split() 在同步监听者里的支配成本\n");

/* ── 逐档复测 ─────────────────────────────────────────────────────── */
const rows = [];
for (const size of SIZES) {
  for (let round = 1; round <= REPEAT; round += 1) {
    await evalJs(`window.__libmsCommitProfile = []; true`);
    await evalJs(`window.__c0Long = []; true`);
    const revBefore = await evalJs(`window.__c0Rev`);
    const t0 = Date.now();
    await evalJs(`window.__c0Gen = window.LibmsWorkspaceBridge.generate({ width: ${size}, height: ${size} }); window.__c0Gen.catch(() => {}); true`);
    const waited = await evalJs(`new Promise((resolve) => {
      const tick = () => {
        if (window.__c0Rev > ${revBefore}) { resolve({ ok: true }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
      setTimeout(() => resolve({ ok: false }), 300000);
    })`, 320000);
    const wall = Date.now() - t0;
    const profile = await evalJs(`({ meta: window.__libmsCommitProfileMeta || null, rows: (window.__libmsCommitProfile || []).slice() })`);
    const pick = (label) => profile.rows.find((r) => r.label === label)?.ms ?? null;
    const lts = await evalJs(`window.__c0Long.slice()`);
    const longest = lts.reduce((m, t) => Math.max(m, t.dur), 0);
    const row = {
      size, round,
      actual: `${profile.meta?.width}×${profile.meta?.height}`,
      cells: profile.meta?.cells ?? null,
      commitTotal: pick("commitTotal"),
      chartUrl: pick("chartUrl"),
      eventDispatch: pick("eventDispatch"),
      materialStats: pick("materialStats"),
      uiUpdate: pick("uiUpdate"),
      gallery: pick("gallery"),
      decodeMs: pick("decodeMs(workerClient)"),
      longestTask: longest,
      wallMs: wall,
      ok: waited?.ok,
    };
    rows.push(row);
    console.log(`── ${size} 档 第 ${round} 轮 ── ${row.actual} · ${(row.cells || 0).toLocaleString("en-US")} 格 · 出图 ${wall}ms`);
    console.log(`   commitTotal ${row.commitTotal} · chartUrl ${row.chartUrl} · eventDispatch ${row.eventDispatch} · 主线程最长 ${row.longestTask}ms`);
    const base = BASELINE[size];
    if (base) {
      const d = (v, b) => (v == null || b == null ? "—" : `${v > b ? "+" : ""}${(v - b).toFixed(1)}`);
      console.log(`   vs B5 基线：commitTotal ${d(row.commitTotal, base.commitTotal)} · chartUrl ${d(row.chartUrl, base.chartUrl)} · eventDispatch ${d(row.eventDispatch, base.eventDispatch)}`);
    }
    await evalJs(`window.__libmsCommitProfile = []; true`);
    await waitQuiet(1500);
  }
}

/* ── 汇总 ─────────────────────────────────────────────────────────── */
console.log("\n════════ 汇总 ════════");
const bySize = new Map();
for (const r of rows) {
  if (!bySize.has(r.size)) bySize.set(r.size, []);
  bySize.get(r.size).push(r);
}
for (const [size, list] of bySize) {
  const avg = (key) => {
    const vals = list.map((r) => r[key]).filter((v) => typeof v === "number");
    return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : null;
  };
  const base = BASELINE[size];
  console.log(`长边 ${size}：commitTotal ${avg("commitTotal")}ms · chartUrl ${avg("chartUrl")} · eventDispatch ${avg("eventDispatch")}`
    + (base ? `   （B5 基线 ${base.commitTotal} / ${base.chartUrl} / ${base.eventDispatch}）` : ""));
}

if (pageErrors.length) {
  console.log(`\n⚠️ 页面未捕获异常 ${pageErrors.length} 条：`);
  for (const e of pageErrors.slice(0, 5)) console.log(`  ${e}`);
}

fs.mkdirSync("/tmp/libms-c0-commit", { recursive: true });
const outFile = path.join(process.env.OUT_DIR || "/tmp/libms-c0-commit", `commit-profile-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify({ fixture: FIXTURE, cloneCost, rows }, null, 2));
console.log(`\n落盘：${outFile}`);

// 必须显式退出：Chrome 子进程与 WebSocket 都是活句柄，不 exit 进程会一直挂着
// （实测：数据早就打完并落盘了，进程还在，后台任务显示「运行中 10 小时」）。
cleanup();
process.exit(0);
