/**
 * 阶段 7 · 拼制模式规划 —— 真机取证探针（CDP · 无头 Chrome）
 *
 * 为什么必须有这一条：
 *   阶段 7 是规划阶段，产出的判断全部是「现状是什么」。
 *   而本阶段最关键的判断 —— **拼制能力到底在不在、入口到底通不通** ——
 *   在 node --test 里完全看不出来（没有任何单测覆盖拼装播放器）：
 *     · 读源码只能看到 `$("#ws-making").hidden = true;` 一行，看不到「能力本体是否还活着」；
 *     · 也看不到「台面上的拼制模式」与「被隐藏的拼装播放器」之间的能力落差。
 *   所以必须真机打开、真的点、真的量 box。
 *
 * 断言分组：
 *   A 能力本体 —— 拼装播放器还能不能打开、逐格打点与进度持久化还灵不灵
 *   B 入口可达性 —— 「开始拼」入口是否真的不可达（量 box，不信存在性）+ legacy 登记
 *   C 两套实现 —— 台面上的拼制模式缺了什么（无进度、无持久化、分块口径不同）
 *   D 运行期   —— 无 console 错误
 *
 * 用法：OUT_DIR=<产物目录> node probe-assembly.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9351;
/**
 * 默认打主工作区的实时预览（8811）。
 * 但主工作区可能正被**另一个会话并发改写**（本仓库有既有的多会话协同约定），
 * 那样取证就落在移动靶上。所以支持用 LIBMS_BASE 指向一份**冻结快照**
 * （例如 `git archive <commit>` 展开的目录 + 实时预览服务）。
 */
const BASE = process.env.LIBMS_BASE || "http://127.0.0.1:8811";
const PAGE = `${BASE}/index.html?dev=1`;
/** 进工作台用的工程夹具（fixtures 目录 gitignore，所以快照里也带上了一份）。 */
const FIXTURE = process.env.LIBMS_FIXTURE
  || "/tmp/libms-snap7/tests/fixtures/editor-104x104.libms-project";
const OUT = process.env.OUT_DIR || "/tmp/stage7-assembly";
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const results = [];
const check = (ok, label, extra = "") => {
  results.push({ ok: Boolean(ok), label, extra });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  · ${extra}` : ""}`);
};
const info = (label, extra = "") => console.log(`INFO  ${label}${extra ? `  · ${extra}` : ""}`);

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "chrome-stage7-"))}`,
  "--window-size=1440,900",
  PAGE,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.url.includes(new URL(BASE).port || "8811"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("拿不到 CDP ws 地址");
}

const ws = new WebSocket(await getWsUrl());
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
  }
  if (m.method === "Runtime.exceptionThrown") {
    consoleErrors.push("EXCEPTION " + String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 240));
  }
});
const send = (method, params = {}, timeoutMs = 25000) => new Promise((res, rej) => {
  const mid = ++id;
  const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP ${method} 超时 ${timeoutMs}ms`)); }, timeoutMs);
  pending.set(mid, (m) => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");

const evalJs = async (expression, awaitPromise = false) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(`${ex.text} ${ex.exception?.description || ""}`.slice(0, 400));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 30000, label = "") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await evalJs(expr)) return true; } catch { /* 页面还在挂载 */ }
    await sleep(400);
  }
  console.log(`  [timeout] ${label || expr}`);
  return false;
};
/** 元素「真的可见」：存在 + 非 hidden + 有实际 box。click() 会穿透 display:none。 */
const VISIBLE = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return !el.hasAttribute('hidden') && r.width > 0 && r.height > 0;
})()`;
/** 一次量多个选择器的 box，返回 {sel: {w,h,hidden,display}} */
const measure = (sels) => evalJs(`JSON.stringify(${JSON.stringify(sels)}.map((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, exists: false };
  const r = el.getBoundingClientRect();
  return { sel, exists: true, w: Math.round(r.width), h: Math.round(r.height),
    hidden: el.hasAttribute('hidden'), display: getComputedStyle(el).display,
    visibility: getComputedStyle(el).visibility, legacy: el.dataset.legacyUi || null };
}))`);

const shot = async (name, clip) => {
  const params = { format: "png", captureBeyondViewport: true };
  if (clip) params.clip = clip;
  const r = await send("Page.captureScreenshot", params);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(r.result.data, "base64"));
  return file;
};
const boxOf = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()`);
/** 真实鼠标点击（视口坐标）——落豆走的是和用户一样的那条 pointer 通路。 */
const clickAt = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};
const beadCount = () => evalJs(`window.LibmsWorkspaceBridge.getResult().grid.flat().filter(Boolean).length`);

try {
  info("取证目标", PAGE);
  /* ── 就绪 ───────────────────────────────────────────────────── */
  // 8811 上有上次留下的 localStorage，实时预览会**自动**重进工作台；
  // 换成新 origin（例如冻结快照的 8812）就没有那份状态，必须自己进。
  // 走文档记载的可靠路径：把 fixture 喂给落地页的 `#landing-project-input`。
  let entered = await waitFor(`document.body.classList.contains('phase2-workspace')`, 20000, "自动进入工作台");
  if (!entered) {
    try {
      const doc = await send("DOM.getDocument", { depth: -1 });
      const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#landing-project-input" });
      if (!q.result?.nodeId) throw new Error("#landing-project-input 不在 DOM 里");
      await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId: q.result.nodeId });
      info("自动进入未发生，已用 fixture 导入", FIXTURE);
      entered = await waitFor(`document.body.classList.contains('phase2-workspace')`, 45000, "fixture 导入后进入工作台");
    } catch (e) { info("fixture 导入失败", String(e.message || e)); }
  }
  check(entered, "① 预览页进入工作台");
  const ready = await waitFor(
    `(() => { const s = window.libmsStore?.getState?.(); return Boolean(s?.statusState?.hasPattern) && Boolean(window.LibmsWorkspaceBridge?.getResult()?.grid?.length); })()`,
    30000, "图纸就绪",
  );
  check(ready, "② 图纸就绪");
  const size = JSON.parse(await evalJs(`JSON.stringify((() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })())`));
  info("图纸尺寸", `${size.w}×${size.h}`);

  /* ── 先落豆 ────────────────────────────────────────────────────
   * 阶段 5 的教训：空白图纸上一个豆都没有 → 「逐色清单」「棋盘格子」「进度」
   * 这三样必然全空，断言会「无法成立」而不是「失败」。所以必须先造出作品。 */
  const beads0 = await beadCount();
  if (beads0 === 0) {
    await evalJs(`(() => { const b = document.querySelector('[data-tool="bead"]'); if (b) b.click(); return true; })()`);
    await sleep(700);
    const canvasBox = JSON.parse(await boxOf(".ws-canvas-well"));
    const cx = canvasBox.x + canvasBox.width / 2, cy = canvasBox.y + canvasBox.height / 2;
    await clickAt(cx, cy);
    await sleep(700);
    for (const [dx, dy] of [[-12, 0], [12, 0], [0, -12], [0, 12], [-12, -12], [12, 12], [-12, 12], [12, -12]]) {
      await clickAt(cx + dx, cy + dy);
      await sleep(70);
    }
    await sleep(700);
  }
  const beadsPainted = await beadCount();
  check(beadsPainted > 0, "③ 已造出作品（空白图纸会让后面三条断言无法成立）", `${beadsPainted} 颗`);

  /* ══ A 能力本体：拼装播放器还活着吗 ═══════════════════════════ */
  const bridgeApi = await evalJs(`typeof window.LibmsWorkspaceBridge.openMaking`);
  check(bridgeApi === "function", "A1 bridge.openMaking 仍是可调用的函数（能力本体没被删）", `typeof = ${bridgeApi}`);

  // 先用「真实入口」的路子：直接调 bridge（等价于点「开始拼」）。
  // 注意：入口按钮不可达（B 组会证明），所以这里走 bridge 是为了回答
  // 「能力本体是否完好」这个问题，而不是在证明它可达。
  await evalJs(`window.LibmsWorkspaceBridge.openMaking(); true`);
  await sleep(800);
  const modalBox = JSON.parse(await measure(["#assembly-modal"]));
  const modalOpen = await evalJs(`Boolean(document.querySelector('#assembly-modal')?.open)`);
  check(modalOpen && modalBox[0].w > 0 && modalBox[0].h > 0,
    "A2 拼装播放器能真的打开（dialog.open + 有实际 box）",
    `open=${modalOpen} box=${modalBox[0].w}×${modalBox[0].h}`);

  const trio = JSON.parse(await measure(["#assembly-progress-label", "#assembly-color-list", "#pixel-board-container"]));
  check(trio.every((m) => m.exists && m.w > 0 && m.h > 0),
    "A3 弹窗三件套都在且有 box（进度读数 / 逐色清单 / 交互棋盘）",
    trio.map((m) => `${m.sel}=${m.w}×${m.h}`).join(" · "));

  const chips = await evalJs(`document.querySelectorAll('#assembly-color-list .assembly-color-chip').length`);
  const usedColors = await evalJs(`window.libmsStore.getState().patternState?.stats?.length ?? (window.LibmsWorkspaceBridge.getResult().grid.flat().filter(Boolean).length ? new Set(window.LibmsWorkspaceBridge.getResult().grid.flat().filter(Boolean).map(c=>c.code)).size : 0)`);
  check(chips > 0, "A4 逐色清单已渲染出可点的色号", `${chips} 个色号（图纸用色 ${usedColors}）`);

  const beadCells = await evalJs(`document.querySelectorAll('#pixel-board-container .bead-cell:not(.is-empty)').length`);
  check(beadCells > 0, "A5 交互棋盘已渲染出非空格子（可逐格打点）", `${beadCells} 格`);

  const labelBefore = await evalJs(`document.querySelector('#assembly-progress-label').textContent.trim()`);
  // 点第一颗非空格子：走它自己绑的 click（等价于用户点一下）
  await evalJs(`(() => { const c = document.querySelector('#pixel-board-container .bead-cell:not(.is-empty)'); if (c) c.click(); return Boolean(c); })()`);
  await sleep(500);
  const labelAfter = await evalJs(`document.querySelector('#assembly-progress-label').textContent.trim()`);
  const storageKeys = await evalJs(`JSON.stringify(Object.keys(localStorage).filter((k) => k.startsWith('libai-maker-assembly-')))`);
  check(labelBefore !== labelAfter && labelAfter.startsWith("1 "),
    "A6 逐格打点生效：进度读数从 0 变 1", `「${labelBefore}」→「${labelAfter}」`);
  check(JSON.parse(storageKeys).length > 0,
    "A7 进度已落 localStorage（进度持久化能力存在）", storageKeys);

  await evalJs(`document.querySelector('#assembly-modal').close(); true`);
  await sleep(400);
  const closed = await evalJs(`document.querySelector('#assembly-modal').open === false`);
  check(closed, "A8 弹窗可正常关闭（不留遮罩）");

  /* ══ B 入口可达性：这个能力从工作台走得到吗 ═══════════════════ */
  const entries = JSON.parse(await measure(["#ws-making", "#assembly-mode-button", "#start-assembly-button", "#start-assembly-panel-button", "#mobile-start-assembly-button"]));
  const reachable = entries.filter((m) => m.exists && m.w > 0 && m.h > 0 && !m.hidden && m.display !== "none" && m.visibility !== "hidden");
  check(reachable.length === 0,
    "B1 拼装播放器的全部已知入口在 v3 工作台里都不可达（量 box，不是看存在性）",
    entries.map((m) => `${m.sel}:${m.exists ? `${m.w}×${m.h}${m.hidden ? "/hidden" : ""}${m.display === "none" ? "/display:none" : ""}` : "不存在"}`).join(" · "));

  // 兜底：全量扫描可见控件，找还有没有「开始拼」这类文案指向它
  const strayEntry = await evalJs(`JSON.stringify([...document.querySelectorAll('button, a, [role="button"]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.hidden && getComputedStyle(el).display !== 'none'; })
    .map((el) => (el.textContent || '').replace(/\\s+/g, '').trim())
    .filter((t) => t.includes('开始拼') || t.includes('拼豆进度')))`);
  check(JSON.parse(strayEntry).length === 0, "B2 没有其它可见控件指向拼装播放器（全量扫描可见按钮文案）", strayEntry);

  const legacyMark = JSON.parse(await measure(["#assembly-modal"]));
  check(legacyMark[0].legacy === "compat",
    "B3 #assembly-modal 被登记为 legacy compat（data-legacy-ui）", `data-legacy-ui=${legacyMark[0].legacy}`);

  // 「施工图预览」在**导出抽屉**里（`#ws-export-drawer`，默认关闭）。
  // 抽屉的真实可见入口是 `#ws-export-now`（「导出作品」，ui/workspace.js:4152→openExportDrawer）。
  // 走真实路径：点它 → 抽屉打开 → 再量 `#ws-output-preview` 的 box。
  const exportEntryVisible = await evalJs(VISIBLE("#ws-export-now"));
  check(exportEntryVisible, "B4a 台面上的导出入口 `#ws-export-now`（「导出作品」）可见");
  await evalJs(`(() => { const b = document.querySelector('#ws-export-now'); if (b) b.click(); return true; })()`);
  await sleep(900);
  const drawerOpen = await evalJs(`document.querySelector('#ws-export-drawer')?.classList.contains('open')`);
  // `#ws-output-preview` 被搬进抽屉的「打印与分板」分栏（ui/workspace.js:4184），
  // 而抽屉默认停在「导出图纸」分栏（:4193 `showOutputTask('pattern')`）→ 该面板带 hidden。
  // 所以不能只开抽屉，必须走真实路径再切分栏，然后才量 box。
  const taskTabs = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-output-task]')].map((b) => b.dataset.outputTask))`);
  await evalJs(`document.querySelector('[data-output-task="print"]')?.click(); true`);
  await sleep(500);
  const printShown = await evalJs(`document.querySelector('[data-output-panel="print"]')?.hidden === false`);
  const surface = await evalJs(VISIBLE("#ws-output-preview"));
  check(drawerOpen && printShown && surface,
    "B4b 开抽屉并切到「打印与分板」后「施工图预览」（→ build 模式）可达（对比 B1：另一套入口全不可达）",
    `drawer.open=${drawerOpen} 分栏=${taskTabs} 打印面板可见=${printShown} preview可见=${surface}`);

  /* ══ C 两套实现：台面上那套缺什么 ═════════════════════════════ */
  await evalJs(`document.querySelector('#ws-output-preview').click(); true`);
  await sleep(700);
  const inBuild = await evalJs(`document.body.classList.contains('ws-output-preview')`);
  check(inBuild, "C1 已进入台面上的拼制模式（body.ws-output-preview）");

  const buildUi = JSON.parse(await evalJs(`JSON.stringify({
    advice: document.querySelector('#ws-block-advice')?.textContent?.trim() || null,
    count: document.querySelector('#ws-block-count')?.textContent?.trim() || null,
    focus: document.querySelector('#ws-build-focus')?.textContent?.trim() || null,
    hasProgressNode: Boolean(document.querySelector('#ws-build-progress, [data-ws-build-progress]')),
  })`));
  info("build 模式面板", JSON.stringify(buildUi));
  check(!/%/.test(buildUi.focus || "") && !buildUi.hasProgressNode,
    "C2 台面上的拼制模式没有进度读数（对比 A6/A7：被隐藏的那套有）",
    `focus=「${buildUi.focus}」· 进度节点=${buildUi.hasProgressNode}`);

  // 分块口径对比：屏幕「最佳建议 N 块」 vs 导出/备料口径（硬编码 104 板）
  const adviceNum = Number((buildUi.advice || "").match(/最佳建议\s*(\d+)/)?.[1] || 0);
  // 直接用真实服务算：同一个 104×104 作品，按 104 板 / 按 52 板 各需几块。
  // 这是 G1-b（材料面板对 52/78 板型少算底板）的**算术证据**，与当前夹具尺寸无关。
  const boardMath = JSON.parse(await evalJs(`(async () => {
    const mod = await import('./services/pattern-split-service.js');
    const g = Array.from({ length: 104 }, () => Array.from({ length: 104 }, () => ({ code: 'H07', rgb: [0, 0, 0] })));
    const at = (n) => { const s = mod.splitPatternGrid(g, n, n); return { cols: s.columns, rows: s.rows, total: s.total, needsSplit: s.needsSplit }; };
    return JSON.stringify({ board104: at(104), board78: at(78), board52: at(52) });
  })()`, true));
  const cur = JSON.parse(await evalJs(`JSON.stringify((() => { const r = window.LibmsWorkspaceBridge.getResult(); return { w: r.width, h: r.height }; })())`));
  info("分块口径", `屏幕建议 ${adviceNum} 块 · 当前作品 ${cur.w}×${cur.h} · 104 板口径 ${Math.ceil(cur.w / 104)}×${Math.ceil(cur.h / 104)} 块`);
  info("同一 104×104 作品的分板算术", JSON.stringify(boardMath));
  check(adviceNum > 0 && boardMath.board104.total === 1 && boardMath.board52.total === 4,
    "C3 两套分块口径各自独立存在；且 104×104 作品在 104 板下算 1 块、在 52 板下算 4 块（G1-b 的算术证据）",
    `屏幕建议 ${adviceNum} · 104板=${boardMath.board104.total} · 78板=${boardMath.board78.total} · 52板=${boardMath.board52.total}`);

  // 持久化对比（G2 取证）：
  //   (a) 退出拼制模式 → 再进入：count 保留（闭包存活）、当前块强制回第 1 块
  //   (b) 整页刷新 → 再进入：count 丢失（build 状态没有任何持久化）
  // 顺带记录一条 G1 的补充证据：`#ws-block-count` 显示的是**期望块数**（build.count），
  // 而 `#ws-build-focus` 显示的是**实际网格**（blockLayout 会把 count 向上取整到 cols×rows ≥ count）。
  await evalJs(`document.querySelector('[data-ws-block="inc"]').click(); true`);
  await sleep(250);
  await evalJs(`document.querySelector('[data-ws-block="inc"]').click(); true`);
  await sleep(250);
  const countBefore = await evalJs(`document.querySelector('#ws-block-count').textContent.trim()`);
  const focusBefore = await evalJs(`document.querySelector('#ws-build-focus').textContent.trim()`);
  info("期望块数 vs 实际块数", `count 读数=${countBefore} · 实际「${focusBefore.split("·")[0]?.trim()}」`);
  // 把当前块推到第 2 块（若可用），以便验证「再进入是否回第 1 块」
  await evalJs(`(() => { const n = document.querySelector('[data-ws-block="next"]'); if (n) n.click(); return Boolean(n); })()`);
  await sleep(300);
  const focusPushed = await evalJs(`document.querySelector('#ws-build-focus').textContent.trim()`);
  await evalJs(`document.querySelector('#ws-build-return').click(); true`);
  await sleep(500);
  await evalJs(`document.querySelector('#ws-output-preview').click(); true`);
  await sleep(700);
  const countAfter = await evalJs(`document.querySelector('#ws-block-count').textContent.trim()`);
  const focusAfter = await evalJs(`document.querySelector('#ws-build-focus').textContent.trim()`);
  info("(a) 退出再进入", `count ${countBefore} → ${countAfter} · 块「${focusPushed.split("·")[0]?.trim()}」→「${focusAfter.split("·")[0]?.trim()}」`);
  check(countAfter === countBefore && /^第\s*1\s*\//.test(focusAfter),
    "C4a 退出再进入：分区数保留（闭包存活），当前块被强制回第 1 块（无进度持久化）",
    `count ${countBefore}→${countAfter} · 当前块「${focusAfter.split("·")[0]?.trim()}」`);

  // (b) 整页刷新：build 状态应当完全丢失
  await send("Page.reload", { ignoreCache: true });
  await sleep(1500);
  let back = await waitFor(`document.body.classList.contains('phase2-workspace')`, 25000, "刷新后重回工作台");
  if (!back) {
    try {
      const doc2 = await send("DOM.getDocument", { depth: -1 });
      const q2 = await send("DOM.querySelector", { nodeId: doc2.result.root.nodeId, selector: "#landing-project-input" });
      if (q2.result?.nodeId) await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId: q2.result.nodeId });
      back = await waitFor(`document.body.classList.contains('phase2-workspace')`, 45000, "刷新后重新导入进入");
    } catch { /* ignore */ }
  }
  await waitFor(`(() => Boolean(window.LibmsWorkspaceBridge?.getResult()?.grid?.length))()`, 30000, "刷新后图纸就绪");
  await evalJs(`document.querySelector('#ws-export-now')?.click(); true`);
  await sleep(800);
  await evalJs(`document.querySelector('[data-output-task="print"]')?.click(); true`);
  await sleep(400);
  await evalJs(`document.querySelector('#ws-output-preview')?.click(); true`);
  await sleep(800);
  const countReload = await evalJs(`document.querySelector('#ws-block-count')?.textContent?.trim() ?? null`);
  const inBuildReload = await evalJs(`document.body.classList.contains('ws-output-preview')`);
  info("(b) 整页刷新后", `count ${countAfter} → ${countReload} · 回到 build 模式=${inBuildReload}`);
  check(inBuildReload && countReload !== null && countReload !== countBefore,
    "C4b 整页刷新后分区数丢失（回落默认 1）—— G2「build 状态不持久化」的直接证据",
    `刷新前 ${countBefore} → 刷新后 ${countReload}`);

  /* ══ 截图（统一放最后：captureBeyondViewport 会打乱视口） ════ */
  await evalJs(`document.querySelector('#ws-build-return')?.click(); true`);
  await sleep(400);
  await evalJs(`window.LibmsWorkspaceBridge.openMaking(); true`);
  await sleep(800);
  await shot("01-assembly-player-works.png");
  await evalJs(`document.querySelector('#assembly-modal').close(); true`);
  await sleep(300);

  /* ══ D 运行期 ═════════════════════════════════════════════════ */
  check(consoleErrors.length === 0, "D1 运行期无 console 错误 / 未捕获异常", consoleErrors.slice(0, 3).join(" | "));
} catch (err) {
  check(false, "探针自身未抛异常", String(err && err.message || err).slice(0, 300));
} finally {
  const summary = { pass: results.filter((r) => r.ok).length, total: results.length, failed, results };
  fs.writeFileSync(path.join(OUT, "probe-result.json"), JSON.stringify(summary, null, 2));
  console.log(`\n===== ${summary.pass}/${summary.total} PASS =====`);
  try { ws.close(); } catch { /* ignore */ }
  chrome.kill();
  process.exit(failed ? 1 : 0);
}
