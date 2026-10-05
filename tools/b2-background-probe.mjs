#!/usr/bin/env node
/**
 * Stage B2 真机探针：背景可靠性 + 预览 + NO-OP。
 *
 * 为什么必须在真机（deploy/ + 生产 CSP）跑：
 *   静态测试能证明 `resolveBackgroundDecision(` 写在源码里、能证明夹具在 Node 里
 *   判成 uncertain，但证明不了下面这些**只有真机才会暴露**的事：
 *     · 上传一张白底图、打开开关之后，**预检条真的出现了**、文案真的是给用户看的那句；
 *     · 点「应用」之后**真的出图了**，而且背景那一片真的是空豆（不是被 palette matcher 填回来）；
 *     · 一张渐变的图，界面**真的**没有把背景啃掉一块；
 *     · 生成期间主线程**真的**没被冻住（B3 的 Worker 还在正常工作）；
 *     · 这一整套在**生产 CSP** 下不发一条违规。
 *
 * 夹具与单测**共用同一份绘制函数**（tests/background-fixtures.mjs）：
 *   单测里的 rgbGrid 和这里上传的 PNG 是同一张图的两种表示 ——
 *   否则「单测全绿」证明不了线上那张图的行为。
 *
 * 用法：
 *   node tools/b2-background-probe.mjs
 *   LIBMS_BASE=http://127.0.0.1:8798 node tools/b2-background-probe.mjs
 *
 * 环境变量：
 *   B2_LONG_EDGE    生成长边，默认 104
 *   B2_KEEP=1       结束后不删截图目录
 *   PROBE_TIMEOUT_MS 全局看门狗，默认 15 分钟
 *   OUT_DIR         截图输出目录
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
const PORT = Number(process.env.CDP_PORT || 9392);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8815);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/background");
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-b2-probe");
const LONG_EDGE = Number(process.env.B2_LONG_EDGE || 104);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const note = (name, detail) => console.log(`INFO  ${name}${detail ? `  ${detail}` : ""}`);

/* ── 夹具：与单测同一份绘制函数，写成 PNG ─────────────────────────── */
fs.mkdirSync(FIXTURE_DIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const fixturePath = (id) => path.join(FIXTURE_DIR, `${id}.png`);
for (const fixture of BACKGROUND_FIXTURES) {
  const file = fixturePath(fixture.id);
  if (fs.existsSync(file)) continue;
  const data = buildFixtureData(FIXTURE_SIZE, FIXTURE_SIZE, fixture.paint);
  fs.writeFileSync(file, encodePng(rasterizeSource(data, 4)));
}
const expectOf = (id) => BACKGROUND_FIXTURES.find((f) => f.id === id)?.expect || "?";
console.log(`夹具：${FIXTURE_DIR}（${BACKGROUND_FIXTURES.length} 张）`);
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
  // 系统代理会拦 127.0.0.1，Chrome 不认 macOS 的 ExceptionsList。
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-b2-${Date.now()}`,
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

/* ── 页内打点：主线程心跳 + Worker 计数 ───────────────────────────── */
const INSTRUMENT = `(() => {
  if (window.__b2Probe) return "already";
  const probe = { heartbeat: { max: 0, last: performance.now() }, workerUrls: [], longtasks: [] };
  window.__b2Probe = probe;
  setInterval(() => {
    const now = performance.now();
    const gap = now - probe.heartbeat.last;
    probe.heartbeat.last = now;
    if (gap > probe.heartbeat.max) probe.heartbeat.max = Math.round(gap);
  }, 50);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.longtasks.push(Math.round(entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  // 必须在**上传之前**装：Worker 是在生成时创建的，装晚了就抓不到。
  const NativeWorker = window.Worker;
  window.Worker = function (url, opts) { probe.workerUrls.push(String(url)); return new NativeWorker(url, opts); };
  window.Worker.prototype = NativeWorker.prototype;
  return "installed";
})()`;

const RESET_PERF = `(() => { const p = window.__b2Probe; p.heartbeat.max = 0; p.heartbeat.last = performance.now(); p.longtasks = []; return true; })()`;

/** 页内查询 / 交互助手。全部走真实 DOM，不碰内部函数。 */
const HELPERS = `(() => {
  const $ = (sel) => document.querySelector(sel);
  const bridge = () => window.LibmsWorkspaceBridge;
  const sw = () => $("#generationPanel input[data-field='backgroundRemoval']");
  window.__b2 = {
    /* §17 开关唯一性 */
    switchShape: () => ({
      removal: document.querySelectorAll("#generationPanel input[data-field='backgroundRemoval']").length,
      auto: document.querySelectorAll("#generationPanel input[data-field='autoBackground']").length,
      label: ($("#generationPanel input[data-field='backgroundRemoval']") || {}).closest?.("label")?.textContent?.trim() || "",
    }),
    switchState: () => Boolean(sw() && sw().checked),
    setSwitch: (on) => {
      const el = sw();
      if (!el) return false;
      if (el.checked !== Boolean(on)) { el.checked = Boolean(on); el.dispatchEvent(new Event("input", { bubbles: true })); }
      return el.checked;
    },
    /* §6 预检条 */
    preview: () => {
      const strip = $("#ws-bg-preview");
      return {
        present: Boolean(strip),
        hidden: strip ? strip.hidden : null,
        status: strip ? strip.dataset.status || "" : "",
        text: ($("#ws-bg-preview-text") || {}).textContent || "",
        applyHidden: ($("#ws-bg-preview-apply") || {}).hidden ?? null,
        keepHidden: ($("#ws-bg-preview-keep") || {}).hidden ?? null,
        dismissHidden: ($("#ws-bg-preview-dismiss") || {}).hidden ?? null,
      };
    },
    /* 布局：预检条是画布区的第 4 个 child，必须自己占一行、且不压到提示行 / 工具坞。
       这类「重叠」静态测试抓不到，只有真机量 box 才能证明。 */
    layout: () => {
      const box = (sel) => { const el = $(sel); if (!el) return null; const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
      const strip = box("#ws-bg-preview"), hint = box(".ws-canvas-hint"), dock = box(".ws-dock");
      const overlaps = (a, b) => Boolean(a && b && a.height > 0 && b.height > 0 && a.top < b.bottom && b.top < a.bottom);
      return { strip, hint, dock,
        stripOverlapsHint: overlaps(strip, hint),
        stripOverlapsDock: overlaps(strip, dock),
        stripAboveHint: Boolean(strip && hint && strip.bottom <= hint.top),
        hintHeight: hint ? hint.height : null,
        template: (() => { const a = $(".ws-canvas-area"); return a ? getComputedStyle(a).gridTemplateRows : null; })() };
    },
    /* 尺寸草稿（用于诊断「尺寸被自动识别覆盖」这类竞态） */
    sizeDraft: () => ({
      number: ($("#ws-size-number") || {}).value ?? null,
      authority: (($("#ws-size-authority") || {}).textContent || "").trim(),
      applyDisabled: ($("#ws-size-apply") || {}).disabled ?? null,
    }),
    clickApply: () => { const b = $("#ws-bg-preview-apply"); if (!b || b.hidden) return false; b.click(); return true; },
    clickKeep: () => { const b = $("#ws-bg-preview-keep"); if (!b || b.hidden) return false; b.click(); return true; },
    clickDismiss: () => { const b = $("#ws-bg-preview-dismiss"); if (!b || b.hidden) return false; b.click(); return true; },
    /* 图纸 */
    grid: () => {
      const r = bridge().getResult();
      let nulls = 0, nonNull = 0;
      for (const row of r.grid) for (const cell of row) { if (cell) nonNull += 1; else nulls += 1; }
      return { width: r.width, height: r.height, nulls, nonNull, total: nulls + nonNull, manualEdited: r.manualEdited };
    },
    cellAt: (x, y) => { const c = bridge().getCell(x, y); return c ? c.code : null; },
    report: () => bridge().getGenerationReport(),
    background: () => (bridge().getGenerationReport() || {}).autoBackground || null,
    generating: () => bridge().isGenerating(),
    /* 其它 */
    // Stage C0 §3：去背景开关与生成尺寸都搬进了右栏「生成」面板（原来挂在「色彩」里）。
    // 这里保留 selectColorTab（色彩面板仍然是色号/用色统计的入口），
    // 另加 selectGenerationTab —— 凡是操作生成参数的步骤都该先切到它。
    selectColorTab: () => { const b = document.querySelector('[data-ws-panel="color"]'); if (b) b.click(); return true; },
    selectGenerationTab: () => { const b = document.querySelector('[data-ws-panel="generation"]'); if (b) b.click(); return true; },
    panelVisibility: (panel) => { const p = document.querySelector('[data-ws-inspector="' + panel + '"]'); if (!p) return null; const r = p.getBoundingClientRect(); return { hidden: p.hidden, width: r.width, height: r.height }; },
    heartbeat: () => ({ max: window.__b2Probe.heartbeat.max, longtasks: window.__b2Probe.longtasks.slice() }),
    workers: () => window.__b2Probe.workerUrls.slice(),
  };
  return "helpers-ready";
})()`;

/* ── 流程小工具 ─────────────────────────────────────────────────── */
let generationCounter = 0;

/** 等「这一轮生成真的结束了」——不看尺寸，只看有没有出图。
 *  硬编码 `width === 104` 会踩坑：源图导入后的**首帧自动生成**会按像素倍数/逻辑启发式
 *  自己定尺寸（例如 192px 的 4 倍像素画 → 48×48），与探针填的 104 无关。 */
const waitGenerated = (ms, label) => waitFor(
  `(() => { const b = window.LibmsWorkspaceBridge; const r = b.getResult();
     return !b.isGenerating() && Boolean(r && r.grid && r.grid.length > 0); })()`, ms, label);

async function uploadAndWait(id) {
  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!inputNode.result?.nodeId) throw new Error("找不到 #file-input");
  await send("DOM.setFileInputFiles", { nodeId: inputNode.result.nodeId, files: [fixturePath(id)] });
  // 上传后会先跑本地内容审查（首次要下 ~4.8MB 模型）。不能靠固定 sleep。
  const ready = await waitFor(
    `(() => { const b = document.querySelector('#ws-size-apply'); return Boolean(b) && !b.disabled; })()`,
    180000, `${id} 源图就绪`);

  // ★ 关键时序：必须等**导入后的首帧自动生成**自己跑完，再去改尺寸。
  // 那条链路是 `ensureMultipleDetection(url).then(=> { pushDraftToBridge(); scheduleAutoGenerate(0); })`，
  // 它会无条件把草稿再提交一次。如果用户（探针）在这之前填了 104，
  // 稍后 settle 的自动识别就会把草稿改回逻辑尺寸 —— 于是「点应用尺寸」这一票被静默作废。
  const firstFrame = await waitGenerated(180000, `${id} 首帧生成`);
  await sleep(300);

  const draftBefore = await evalJson(`window.__b2.sizeDraft()`);
  await evalJs(`(() => {
    const n = document.querySelector('#ws-size-number');
    if (n) { n.value = '${LONG_EDGE}'; n.dispatchEvent(new Event('input', { bubbles: true })); }
    document.querySelector('#ws-size-apply').click();
    return true;
  })()`);
  const settled = await waitFor(
    `(() => { const b = window.LibmsWorkspaceBridge; const r = b.getResult();
       return !b.isGenerating() && r.width === ${LONG_EDGE} && r.grid.length > 0; })()`,
    120000, `${id} 生成完成`);
  await sleep(300);
  const draftAfter = await evalJson(`window.__b2.sizeDraft()`);
  generationCounter += 1;
  const width = await evalJs("window.LibmsWorkspaceBridge.getResult().width");
  note(`尺寸 ${id}`, `导入草稿=${draftBefore.number}（${draftBefore.authority || "无权威标注"}）` +
    ` → 提交后 ${draftAfter.number} · 出图宽 ${width}`);
  return { ready, firstFrame, settled, width, draftBefore, draftAfter };
}

/* ── 主流程 ─────────────────────────────────────────────────────── */
try {
  /* 0. 落地 → 上传第一张 → 挂载 → 生成 */
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  if (!landed) throw new Error("落地页没就绪");

  await evalJs(INSTRUMENT);   // 必须在任何生成之前
  await evalJs(HELPERS);      // 必须在第一次 uploadAndWait 之前（它要读 window.__b2.sizeDraft）
  const first = await uploadAndWait("white-logo");
  check("工作台挂载（带生产 CSP 头）", await evalJs(`document.body.dataset.workspaceState === 'ready'`),
    `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  check("源图就绪（内容审查完成）", first.ready);
  check(`首次生成完成（长边 ${LONG_EDGE}）`, first.settled,
    `实际 ${await evalJs("window.LibmsWorkspaceBridge.getResult().width")}`);
  await evalJs(`window.__b2.selectColorTab()`);
  await sleep(400);
  const g0 = await evalJson(`window.__b2.grid()`);
  note("首张图纸", `${g0.width}×${g0.height} · 空豆 ${g0.nulls} · 有豆 ${g0.nonNull}`);
  await shot("01-workspace");

  /* 1. §17 工作台只有一个去背景开关 */
  const shape = await evalJson(`window.__b2.switchShape()`);
  note("开关形态", `backgroundRemoval=${shape.removal} autoBackground=${shape.auto} 文案「${shape.label}」`);
  check("§17 工作台上只有一个去背景开关（backgroundRemoval）", shape.removal === 1);
  check("§17 重复的「自动留空背景」开关已删除", shape.auto === 0);
  check("§17 开关文案是「去除纯色背景」", /去除纯色背景/.test(shape.label));

  /* 2. §6 打开开关 → 先预检，不静默应用 */
  const beforeToggle = await evalJson(`window.__b2.grid()`);
  await evalJs(`window.__b2.setSwitch(true)`);
  // 注意：必须等到 status 离开 probing。
  // 预检条一出现就断言「有 [应用] 按钮」会踩坑 —— probing 阶段按钮是 hidden 的，
  // 此时点 [应用] 等于点一个隐藏元素，什么都不会发生，随后会误报「应用后没生成」。
  const previewShown = await waitFor(
    `(() => { const p = window.__b2.preview(); return p.present && !p.hidden && p.status !== "probing"; })()`,
    60000, "预检条出现（已出结论）");
  check("§6 打开「去除纯色背景」后出现预检条", previewShown);
  const preview = await evalJson(`window.__b2.preview()`);
  note("预检", `status=${preview.status} · ${preview.text}`);
  check("§6 预检条给出可安全移除的结论与预计格数",
    /检测到可安全移除背景 · 预计移除 \d+ 格 · [\d.]+%/.test(preview.text), preview.text);
  check("§6 预检条提供 [应用] 与 [保留背景] 两个动作",
    preview.applyHidden === false && preview.keepHidden === false && preview.dismissHidden === true);
  const duringPreview = await evalJson(`window.__b2.grid()`);
  check("§6 预检期间**没有**静默重算图纸（空豆数不变）", duringPreview.nulls === beforeToggle.nulls,
    `${duringPreview.nulls} vs ${beforeToggle.nulls}`);
  // 预检条是画布区的第 4 个 child。grid 模板若只声明 3 行，它会掉进隐式行并抢走
  // 固定值那一行 —— 提示行被压扁、文字溢到工具坞下面。量 box 才算验过。
  const layout = await evalJson(`window.__b2.layout()`);
  note("布局", `行轨 ${layout.template} · 预检条 ${layout.strip.top}–${layout.strip.bottom} · ` +
    `提示行 ${layout.hint.top}–${layout.hint.bottom}（${layout.hintHeight}px）`);
  check("§6 预检条不压住操作提示行", layout.stripOverlapsHint === false);
  check("§6 预检条不压住底部工具坞", layout.stripOverlapsDock === false);
  check("§6 提示行保住了设计高度 26px（没被预检条挤扁）", layout.hintHeight >= 26, `${layout.hintHeight}px`);
  await shot("02-preview-reliable");

  /* 3. 点 [应用] → 生成 → 背景真的被清 */
  await evalJs(RESET_PERF);
  if (preview.applyHidden === false) {
    await evalJs(`window.__b2.clickApply()`);
  } else {
    note("跳过 [应用]", "预检未给出可应用结论，按钮仍为隐藏态");
  }
  const applied = preview.applyHidden === false
    ? await waitFor(`!window.__b2.generating() && window.__b2.grid().nulls > 0`, 180000, "应用后生成")
    : false;
  check("§6 点 [应用] 之后真的生成了", applied);
  await sleep(500);
  const g1 = await evalJson(`window.__b2.grid()`);
  const bg1 = await evalJson(`window.__b2.background()`);
  note("应用后", `status=${bg1 && bg1.status} · 空豆 ${g1.nulls}/${g1.total} · metrics=${JSON.stringify(bg1 && bg1.metrics)}`);
  check("§3 §4 白底 Logo 判定为 reliable", bg1 && bg1.status === "reliable");
  check("§8 背景真的被清成了空豆（> 50% 的格）", g1.nulls > g1.total * 0.5, `${g1.nulls}/${g1.total}`);
  check("§8 主体中心仍是豆（没被误删）",
    (await evalJs(`window.__b2.cellAt(${Math.floor(g1.width / 2)}, ${Math.floor(g1.height / 2)})`)) !== null);
  const h1 = await evalJson(`window.__b2.heartbeat()`);
  note("生成期间主线程", `最大心跳间隔 ${h1.max}ms · 长任务 ${h1.longtasks.length} 个`);
  check("§16 生成期间主线程没有被冻住（最大心跳间隔 < 5000ms）", h1.max < 5000, `${h1.max}ms`);
  await shot("03-applied");

  /* 4. §18 uncertain 图：预检说保持原图，点掉之后一格不动 */
  const uncertainCases = ["white-shirt-faint", "gray-gradient", "close-subject"];
  for (const id of uncertainCases) {
    await evalJs(`window.__b2.setSwitch(false)`);
    await sleep(300);
    const up = await uploadAndWait(id);
    check(`§18 ${id} 生成完成`, up.settled);
    const before = await evalJson(`window.__b2.grid()`);
    await evalJs(`window.__b2.setSwitch(true)`);
    const shown = await waitFor(`(() => { const p = window.__b2.preview(); return p.present && !p.hidden && p.status !== "probing"; })()`, 60000, `${id} 预检`);
    const pv = await evalJson(`window.__b2.preview()`);
    note(`${id} 预检`, `status=${pv.status} · ${pv.text}`);
    check(`§18 ${id} 预检条显示保持原图的提示`, shown && /没有检测到可以安全分离的纯色背景，已保持原图。/.test(pv.text), pv.text);
    check(`§18 ${id} 不确定时只提供 [知道了]，不提供 [应用]`,
      pv.applyHidden === true && pv.keepHidden === true && pv.dismissHidden === false);
    await shot(`04-uncertain-${id}`);
    await evalJs(`window.__b2.clickDismiss()`);
    await waitFor(`!window.__b2.generating()`, 180000, `${id} 生成结束`);
    await sleep(400);
    const after = await evalJson(`window.__b2.grid()`);
    const bg = await evalJson(`window.__b2.background()`);
    note(`${id} 结果`, `status=${bg && bg.status} · 空豆 ${after.nulls}/${after.total}`);
    check(`§4 ${id} 结论不是 reliable`, bg && bg.status !== "reliable", bg && bg.status);
    check(`§4 ${id} NO-OP：一格都没有被移除`, after.nulls === 0, `${after.nulls} 格被清空`);
    check(`§4 ${id} 图纸规模不变`, after.total === before.total);
  }

  /* 5. none 类：蓝底 / 透明 PNG */
  for (const id of ["blue-logo-saturated", "transparent-png"]) {
    await evalJs(`window.__b2.setSwitch(false)`);
    await sleep(300);
    const up = await uploadAndWait(id);
    check(`${id} 生成完成`, up.settled);
    await evalJs(`window.__b2.setSwitch(true)`);
    const shown = await waitFor(`(() => { const p = window.__b2.preview(); return p.present && !p.hidden && p.status !== "probing"; })()`, 60000, `${id} 预检`);
    const pv = await evalJson(`window.__b2.preview()`);
    note(`${id} 预检`, `status=${pv.status} · ${pv.text}`);
    check(`§5 ${id} 保持原图提示`, shown && /已保持原图。/.test(pv.text), pv.text);
    await evalJs(`window.__b2.clickDismiss()`);
    await waitFor(`!window.__b2.generating()`, 180000, `${id} 生成结束`);
    await sleep(400);
    const bg = await evalJson(`window.__b2.background()`);
    check(`§5 ${id} 结论是 none（这张图没有纯色背景）`, bg && bg.status === "none", bg && bg.status);
    await shot(`05-none-${id}`);
  }

  /* 6. reliable 且要保住内部同色：白底白衣（有轮廓） */
  await evalJs(`window.__b2.setSwitch(false)`);
  await sleep(300);
  const upShirt = await uploadAndWait("white-shirt-outline");
  check("white-shirt-outline 生成完成", upShirt.settled);
  await evalJs(`window.__b2.setSwitch(true)`);
  await waitFor(`(() => { const p = window.__b2.preview(); return p.present && !p.hidden && p.status !== "probing"; })()`, 60000, "白衣预检");
  await evalJs(`window.__b2.clickApply()`);
  await waitFor(`!window.__b2.generating() && window.__b2.grid().nulls > 0`, 180000, "白衣生成");
  await sleep(500);
  const gShirt = await evalJson(`window.__b2.grid()`);
  const bgShirt = await evalJson(`window.__b2.background()`);
  note("白底白衣", `status=${bgShirt && bgShirt.status} · 空豆 ${gShirt.nulls}/${gShirt.total}`);
  check("§9 白底白衣（有轮廓）判定为 reliable", bgShirt && bgShirt.status === "reliable");
  // 衬衫在图的中央偏下；夹具里衬衫是 (16,14)-(31,39)/48
  const shirtX = Math.round((24 / FIXTURE_SIZE) * gShirt.width);
  const shirtY = Math.round((30 / FIXTURE_SIZE) * gShirt.height);
  const shirtCell = await evalJs(`window.__b2.cellAt(${shirtX}, ${shirtY})`);
  check("§9 轮廓内的白衬衫被保留（内部同色保护）", shirtCell !== null, `(${shirtX},${shirtY}) = ${shirtCell}`);
  const outsideCell = await evalJs(`window.__b2.cellAt(1, 1)`);
  check("§9 外部背景确实被清空（对照，排除「什么都没做」）", outsideCell === null, `(1,1) = ${outsideCell}`);
  await shot("06-shirt");

  /* 7. Worker / CSP / 异常 */
  const workers = await evalJson(`window.__b2.workers()`);
  note("Worker", workers.length ? workers[workers.length - 1] : "（无）");
  check("§16 生成跑在真实 Worker 里（不是主线程）",
    workers.some((u) => /generation\.worker\.mjs/.test(u)), `已捕获 ${workers.length} 次 Worker 创建`);

  const cspHard = cspViolations.filter((t) => /worker|script-src|connect-src/i.test(t));
  check("生产 CSP 未拦背景功能相关资源（无 script/worker/connect 违规）", cspHard.length === 0,
    cspHard.length ? cspHard[0].slice(0, 200) : "");
  const exceptions = consoleMessages.filter((m) => m.type === "exception" && !/EvalError/.test(m.text));
  check("全程没有未捕获异常", exceptions.length === 0, exceptions.slice(0, 2).map((e) => e.text.slice(0, 160)).join(" || "));
  await shot("07-final");
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
