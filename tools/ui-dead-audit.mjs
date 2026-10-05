#!/usr/bin/env node
/**
 * Stage C0 §18 —— Dead UI Audit。
 *
 * ── 它解决什么问题 ────────────────────────────────────────────────────
 * 「这个按钮是不是死的」不能靠读代码回答。代码里有五种东西长得很像：
 *
 *   · **reachable** —— 用户在某条路径上真的能点到（可能在抽屉里、某个面板里、
 *     或者某个折叠菜单里）。读代码很容易漏掉这条路径，从而把活的判成死的。
 *   · **disabled**  —— 看得见、点得动，但当前状态不可用（没有撤销历史时的撤销键、
 *     图纸不需要分板时的「导出板型 ZIP」）。**它不是缺陷**，但和「够不到」必须分开报，
 *     否则报告会被噪音淹掉。
 *   · **covered**   —— 有盒子、滚得到，但中心点被别的层占了（`elementFromPoint`
 *     命中的是别人）。这是最容易被误判成「死」的一类，也是唯一一类值得单独看的。
 *   · **hidden**    —— `display:none` / 0×0 / 祖先隐藏，且没有任何状态能把它露出来。
 *   · **absent**    —— 任何状态下都不存在（`render()` 永远不会产出它）。这才是真死代码。
 *   · **compat**    —— 旧界面遗留，由 `ui/legacy-ui-policy.js` 的登记表明确认领。
 *
 * ── 做法 ──────────────────────────────────────────────────────────────
 * 穷举**界面状态**，每个状态下把候选控件全量过一遍可达性门，取并集：
 *   落地页 / 右栏 7 个面板 / 施工模式 / 「新建·导入」菜单 / 导出抽屉 /
 *   调整图纸尺寸对话框 / 新建空白图纸对话框 / 用豆清单对话框。
 *
 * 候选控件只收**交互元素**（`INTERACTIVE_SELECTOR`）：容器、画布、空占位不进表。
 * 落在 `[data-legacy-ui="compat"]` 里的控件直接归 `compat`，不再逐条分类 ——
 * 它们已经有明确的存在理由和 owner。
 *
 * 分类逻辑是 `classifyDeadUi()`（纯函数，在 `tools/ui-reachability-gate.mjs`，有单测）。
 *
 * 用法：
 *   node tools/ui-dead-audit.mjs
 *   OUT_DIR=<目录>  LIBMS_BASE=<已有服务>  CDP_PORT=9404  SERVE_PORT=8824
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DECLARATION,
  DEAD_UI_CLASSES,
  INSTALL_COLLECT_SOURCE,
  INTERACTIVE_SELECTOR,
  classifyDeadUi,
  evaluateReachability,
} from "./ui-reachability-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9404);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8824);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE = process.env.LIBMS_FIXTURE || path.join(ROOT, "tests/fixtures/background/white-logo.png");
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-ui-dead-audit");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
if (!process.env.LIBMS_BASE) {
  server = spawn(process.execPath, [path.join(ROOT, "tools/serve-with-headers.mjs"), "deploy", String(SERVE_PORT)], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    try { up = (await fetch(`${BASE}/`)).ok; } catch { await sleep(150); }
  }
  if (!up) { console.error(`服务器起不来：${BASE}`); server.kill("SIGKILL"); process.exit(1); }
}
fs.mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-dead-${Date.now()}`,
  "--window-size=1440,900",
  `${BASE}/`,
], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill("SIGKILL"); } catch {} try { server?.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);

async function getWsUrl() {
  for (let i = 0; i < 100; i += 1) {
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
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
});
const send = (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 超时`)); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");

const evalJs = async (expression, timeoutMs = 60000) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "求值失败");
  return r.result?.value;
};
const evalJson = async (e) => JSON.parse(await evalJs(e));
const waitFor = async (expr, ms, label) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await evalJs(expr, 15000)) return true; } catch {}
    await sleep(250);
  }
  console.log(`  [等超时] ${label}`);
  return false;
};

/** 候选控件：只收交互元素；顺带记下它是不是落在 legacy 登记表里。 */
const CANDIDATE_SOURCE = `(() => {
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)})) {
    if (el.closest("template")) continue;
    let key = el.id ? "#" + el.id : "";
    if (!key) {
      const attrs = ["data-action","data-preset","data-export-v2","data-ws-export","data-text-action","data-color-cap","data-tool","data-ws-mode","data-ws-panel","data-step-field","data-field","data-inv-action","data-ws-export-choice"];
      const parts = attrs.filter(a => el.hasAttribute(a)).map(a => "[" + a + "=" + JSON.stringify(el.getAttribute(a)) + "]");
      if (!parts.length) continue;
      key = el.tagName.toLowerCase() + parts.join("");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const legacyHost = el.closest("[data-legacy-ui]");
    out.push({
      key,
      selector: el.id ? "#" + CSS.escape(el.id) : key,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40),
      ariaLabel: el.getAttribute("aria-label") || "",
      legacy: legacyHost ? legacyHost.id : null,
    });
  }
  return JSON.stringify(out);
})()`;

const scanState = async (label) => {
  const candidates = await evalJson(CANDIDATE_SOURCE);
  const factsByKey = {};
  for (const c of candidates) {
    try {
      factsByKey[c.key] = await evalJson(`JSON.stringify(window.__libmsReach.collect(${JSON.stringify(c.selector)}))`);
    } catch {
      factsByKey[c.key] = { exists: false, error: true };
    }
  }
  const reachable = Object.values(factsByKey).filter((f) => evaluateReachability(f).pass).length;
  console.log(`  ${label.padEnd(22)} 候选 ${String(candidates.length).padStart(3)} · 可达 ${String(reachable).padStart(3)}`);
  return { label, candidates, factsByKey };
};

/** 点击某个按钮（按 id 或按面板内文本）。返回是否找到。 */
const clickById = (id) => evalJs(`(() => { const b = document.querySelector(${JSON.stringify(id)}); if (!b) return false; b.click(); return true; })()`);
const clickByText = (scope, text) => evalJs(`(() => {
  const root = document.querySelector(${JSON.stringify(scope)}) || document;
  const hit = [...root.querySelectorAll("button,a,summary,[role=button]")]
    .find((b) => ((b.textContent || "") + (b.getAttribute("aria-label") || "")).includes(${JSON.stringify(text)}));
  if (!hit) return false;
  hit.click();
  return true;
})()`);

const STATES = [];
const record = async (label) => { STATES.push(await scanState(label)); };
const activatePanel = async (panel) => {
  await evalJs(`(() => { const b = document.querySelector('[data-ws-panel="${panel}"]'); if (b) b.click(); return true; })()`);
  await sleep(350);
};

try {
  await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  await evalJs(INSTALL_COLLECT_SOURCE);
  await record("landing");

  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#file-input" });
  await send("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [FIXTURE] });
  await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
  await waitFor(`(() => { const b = window.LibmsWorkspaceBridge; const r = b && b.getResult(); return Boolean(r && r.grid && r.grid.length > 0) && !b.isGenerating(); })()`, 240000, "首帧生成");
  await evalJs(INSTALL_COLLECT_SOURCE);
  await sleep(800);

  for (const panel of ["project", "source", "generation", "color", "edit", "check", "material"]) {
    await activatePanel(panel);
    await record(`panel:${panel}`);
  }

  // 施工模式：不在 tab 数组里，只能由左轨按钮激活（§18 的 reachable-but-not-a-tab）
  if (await clickById('[data-ws-mode="build"]') === false) {
    await evalJs(`(() => { const b = document.querySelector('[data-ws-mode="build"]'); if (b) b.click(); return true; })()`);
  }
  await sleep(450);
  await record("mode:build");
  await evalJs(`(() => { const b = document.querySelector('[data-ws-mode="edit"]'); if (b) b.click(); return true; })()`);
  await sleep(350);

  // 「新建 / 导入」折叠菜单
  const menuOpened = await evalJs(`(() => { const d = document.querySelector(".ws-project-menu"); if (!d) return false; d.open = true; return true; })()`);
  if (menuOpened) { await sleep(350); await record("menu:project"); }

  // 新建空白图纸对话框（由菜单里的 #ws-new-blank 打开）
  const blankOpened = await clickById("#ws-new-blank");
  if (blankOpened) {
    await waitFor(`(() => { const d = document.querySelector("#blank-board-modal"); return Boolean(d && d.open); })()`, 5000, "空白图纸对话框");
    await record("dialog:blank-board");
    await evalJs(`(() => { const d = document.querySelector("#blank-board-modal"); if (d && d.open) d.close(); return true; })()`);
    await sleep(300);
  }
  await evalJs(`(() => { const d = document.querySelector(".ws-project-menu"); if (d) d.open = false; return true; })()`);
  await sleep(250);

  // 调整图纸尺寸
  await activatePanel("project");
  if (await clickById("#ws-resize-open")) {
    await waitFor(`(() => { const d = document.querySelector("#ws-resize-dialog"); return Boolean(d && d.open); })()`, 5000, "调整图纸尺寸对话框");
    await record("dialog:resize");
    await evalJs(`(() => { const d = document.querySelector("#ws-resize-dialog"); if (d && d.open) d.close(); return true; })()`);
    await sleep(300);
  }

  // 用豆清单对话框（材料面板里「识别外部图纸」/「手工录入」）
  await activatePanel("material");
  const usageOpened = await clickByText("#inventoryPanel", "识别外部图纸") || await clickByText("#inventoryPanel", "手工录入");
  if (usageOpened) {
    await waitFor(`(() => { const d = document.querySelector("#ws-usage-dialog"); return Boolean(d && d.open); })()`, 5000, "用豆清单对话框");
    await record("dialog:usage");
    await evalJs(`(() => { const d = document.querySelector("#ws-usage-dialog"); if (d && d.open) d.close(); return true; })()`);
    await sleep(300);
  } else {
    console.log("  [跳过] 材料面板里没找到打开用豆清单的按钮");
  }

  // 导出抽屉（等滑入动画结束，理由见 ui-reachability-probe.mjs）
  await clickById("#ws-export");
  const drawerOpen = await waitFor(
    `(() => {
       const d = document.querySelector("#ws-export-drawer");
       if (!d || !d.classList.contains("open")) return false;
       const cs = getComputedStyle(d);
       if (cs.visibility !== "visible") return false;
       const r = d.getBoundingClientRect();
       return r.width > 0 && r.right <= window.innerWidth + 1;
     })()`, 10000, "导出抽屉滑入完成");
  if (drawerOpen) await record("drawer:export");

  /* ── 汇总 ──────────────────────────────────────────────────────── */
  const allKeys = new Map();
  for (const state of STATES) for (const c of state.candidates) if (!allKeys.has(c.key)) allKeys.set(c.key, c);

  const report = [];
  for (const [key, meta] of allKeys) {
    const observations = [];
    for (const state of STATES) {
      const facts = state.factsByKey[key];
      if (facts?.exists) observations.push({ state: state.label, facts });
    }
    if (meta.legacy) {
      report.push({ ...meta, key, klass: "compat", legacyHost: meta.legacy, reachableIn: null, codes: [], best: null });
      continue;
    }
    const { klass, reachableIn, best, codes } = classifyDeadUi(observations);
    report.push({
      ...meta,
      key,
      klass,
      reachableIn,
      codes: [...new Set(codes.filter(Boolean))],
      best: best ? { state: best.state, facts: best.facts } : null,
    });
  }

  const byKlass = {};
  for (const r of report) byKlass[r.klass] = (byKlass[r.klass] || 0) + 1;

  fs.writeFileSync(path.join(OUT, "ui-dead-audit.json"), JSON.stringify({
    states: STATES.map((s) => s.label),
    counts: byKlass,
    report,
  }, null, 2));

  console.log(`\n候选控件 ${report.length} 个`);
  for (const [klass, count] of Object.entries(byKlass).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${klass.padEnd(20)} ${count}`);
  }

  const NEEDS_ATTENTION = [DEAD_UI_CLASSES.COVERED, DEAD_UI_CLASSES.HIDDEN, DEAD_UI_CLASSES.ABSENT];
  for (const klass of NEEDS_ATTENTION) {
    const rows = report.filter((r) => r.klass === klass);
    if (!rows.length) continue;
    console.log(`\n── ${klass}（${rows.length}）──`);
    for (const r of rows) {
      const f = r.best?.facts;
      const where = f ? `${r.best.state} ${f.width}×${f.height} display=${f.display} vis=${f.visibility} disabled=${f.disabled} 命中=${f.hitTestTarget || "无"}` : "从未出现";
      console.log(`  ${r.key.padEnd(44)} ${where}  «${r.text}»`);
    }
  }
  console.log(`\n明细：${path.join(OUT, "ui-dead-audit.json")}`);
} catch (error) {
  console.error("审计异常:", error?.message || error);
} finally {
  cleanup();
  process.exit(0);
}
