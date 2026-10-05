#!/usr/bin/env node
/**
 * Stage C0 §8 / §9 / §10 —— 入口可达性真机探针。
 *
 * ── 它和既有探针的区别 ────────────────────────────────────────────────────
 * 既有探针（b0/b1/b2/b3/b4/master）用 `element.click()` 驱动界面。那对
 * 「算法行为对不对」是正确的驱动方式，但**不能证明用户找得到入口** ——
 * `HTMLElement.click()` 会穿透 `display: none`。
 *
 * 这个探针只用**真判据**：
 *   · 元素真的占面积（宽高 > 0）
 *   · 祖先链上没有 display:none / visibility:hidden
 *   · 有效 opacity > 0
 *   · 滚到最近位置后落在视口内
 *   · **中心点 `elementFromPoint` 命中它自己**（等价于真鼠标的命中测试）
 * 然后还做一次**真 CDP 鼠标点击**做校准：门说「点得中」→ 真点一下 → 状态真的变了。
 * 如果门和真点击对不上，那门就是在自说自话。
 *
 * 判定逻辑在 `tools/ui-reachability-gate.mjs`（纯函数，有单测）；
 * 这里只负责测量与编排。
 *
 * 用法：
 *   LIBMS_BASE=http://127.0.0.1:8797 node tools/ui-reachability-probe.mjs
 *   OUT_DIR=<目录>          截图与 JSON 落这里
 *   LIBMS_BASE 不设时自己起 tools/serve-with-headers.mjs（带生产 CSP 头）
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DECLARATION,
  INSTALL_COLLECT_SOURCE,
  evaluateReachability,
  targetsForPhase,
} from "./ui-reachability-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9401);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8821);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const FIXTURE = process.env.LIBMS_FIXTURE || path.join(ROOT, "tests/fixtures/background/white-logo.png");
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-ui-reachability");
/**
 * 视口（§12 要求四档都验）。
 *
 * `LIBMS_VIEWPORT=1280x800`。**不能只靠 `--window-size`**：headless 下
 * window 尺寸 ≠ viewport 尺寸（窗口装饰/缩放会差几十 px），而 §12 的断点
 * 是按 CSS px 判的（760 / 1280）——差 20px 就会把「刚过断点」的档测错。
 * 所以除了 `--window-size`，还要用 `Emulation.setDeviceMetricsOverride`
 * 把 layout viewport 钉死。
 */
const VIEWPORT = (() => {
  const m = /^(\d+)x(\d+)$/.exec(String(process.env.LIBMS_VIEWPORT || "1440x900").trim());
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1440, height: 900 };
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 起服务器 + Chrome ──────────────────────────────────────────────── */
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
  // 本机系统代理会拦 127.0.0.1；不加这两项页面会落在 chrome-error://chromewebdata/，
  // 所有选择器静默变 null —— 那会伪装成「入口全都不可达」。
  "--no-proxy-server", "--proxy-bypass-list=127.0.0.1;localhost",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/chrome-libms-reach-${Date.now()}`,
  `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
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
const pageErrors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Page.javascriptDialogOpening") {
    ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    return;
  }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 200));
});
const send = (method, params = {}, timeoutMs = 20000) => new Promise((res, rej) => {
  const id = ++msgId;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} 超时`)); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});

await new Promise((r) => ws.addEventListener("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
// 把 layout viewport 钉死到声明值 —— 门的判据里有「落在视口内」，
// 视口只要差几十 px，四档之间的结论就没法对比。
await send("Emulation.setDeviceMetricsOverride", {
  width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false,
});

const evalJs = async (expression, timeoutMs = 60000) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "页面求值失败");
  return r.result?.value;
};
const evalJson = async (expression, timeoutMs = 60000) => JSON.parse(await evalJs(expression, timeoutMs));
const waitFor = async (expr, ms = 60000, label = "") => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await evalJs(expr, 15000)) return true; } catch {}
    await sleep(250);
  }
  console.log(`  [等超时] ${label || expr}`);
  return false;
};
const shot = async (name) => {
  try {
    const s = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.data, "base64"));
  } catch {}
};
/** 真鼠标左键点击（走 CDP 输入层，命中测试与真人一致）。 */
const realClick = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

/* ── 编排 ──────────────────────────────────────────────────────────── */
const results = [];
const check = (name, ok, detail = "", extra = {}) => {
  results.push({ name, ok: Boolean(ok), detail, ...extra });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};

/** 切到右栏某个 Tab（点 tab 按钮本身，按钮的可见性由门单独验）。 */
const activatePanel = async (panel) => {
  if (!panel) return true;
  await evalJs(`(() => { const b = document.querySelector('[data-ws-panel="${panel}"]'); if (b) b.click(); return true; })()`);
  return waitFor(
    `(() => { const p = document.querySelector('[data-ws-inspector="${panel}"]'); if (!p || p.hidden) return false; const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`,
    10000, `右栏「${panel}」可见`);
};

/** 按清单测一条目标。 */
const measure = async (target) => {
  const facts = await evalJson(`JSON.stringify(window.__libmsReach.collect(${JSON.stringify(target.selector)}))`);
  const verdict = evaluateReachability(facts, { declaration: target.declaration || DECLARATION.USER });
  const name = `[${target.group}] ${target.label}`;
  const detail = facts.exists
    ? `${facts.width}×${facts.height} display=${facts.display} opacity=${facts.opacity} 命中=${facts.hitTestTarget || "无"}`
    : "元素不存在";
  check(
    name,
    verdict.pass,
    verdict.pass ? detail : `${verdict.code} · ${verdict.failures.map((f) => f.detail).join(" / ")}`,
    // 原始事实也落盘：FAIL 的时候光看一句 detail 是定不了性的
    // （要区分「产品真的不可达」和「探针量早了」必须看 rect / hitTestTarget）。
    { facts, code: verdict.code, failures: verdict.failures },
  );
  return { target, facts, verdict };
};

try {
  /* ── 0. 落地页 ───────────────────────────────────────────────────── */
  const landed = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  check("落地页就绪", landed, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  await evalJs(INSTALL_COLLECT_SOURCE);

  for (const target of targetsForPhase("landing")) await measure(target);
  await shot("01-landing");

  /* ── 1. 上传 → 生成，进入「所有入口都该可用」的状态 ─────────────── */
  // 顺序很重要：门里有「不被 disabled」这条。在源图就绪之前，
  // 大量控件本来就该是 disabled —— 那时候测出来的 FAIL 是假失败。
  // 所以统一在「已上传 + 已出图」之后测。
  const doc = await send("DOM.getDocument", { depth: -1 });
  const inputNode = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#file-input" });
  await send("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [FIXTURE] });
  const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
  check("工作台挂载（带生产 CSP 头）", ready, `workspaceState=${await evalJs("document.body.dataset.workspaceState")}`);
  const firstPattern = await waitFor(
    `(() => { const b = window.LibmsWorkspaceBridge; const r = b && b.getResult(); return Boolean(r && r.grid && r.grid.length > 0) && !b.isGenerating(); })()`,
    240000, "首帧生成");
  check("首帧生成完成", firstPattern, `长边 ${await evalJs("window.LibmsWorkspaceBridge.getResult().width")}`);
  await evalJs(INSTALL_COLLECT_SOURCE);   // 页面重挂后采集器要重新装
  await sleep(600);

  /* ── 2. 逐条测工作台入口 ─────────────────────────────────────────── */
  let lastPanel = null, drawerOpen = false, openRailMenu = null;
  for (const target of targetsForPhase("workspace")) {
    if (target.panel && target.panel !== lastPanel) {
      const ok = await activatePanel(target.panel);
      lastPanel = target.panel;
      if (!ok) {
        check(`[${target.group}] ${target.label}`, false, `右栏「${target.panel}」面板切不出来 —— 入口所在的容器本身就不可达`);
        continue;
      }
    }
    // 左轨子菜单是 <details>：不展开的话里面的按钮根本不存在，
    // 展开之后还要等布局稳定再量（就地展开会把下面的按钮往下推）。
    if (target.openRailMenu && target.openRailMenu !== openRailMenu) {
      await evalJs(`(() => {
        document.querySelectorAll(".sl-rail-menu").forEach((d) => { d.open = false; });
        const d = [...document.querySelectorAll(".sl-rail-menu")]
          .find((el) => (el.querySelector("summary")?.getAttribute("aria-label") || "") === ${JSON.stringify(target.openRailMenu)});
        if (d) d.open = true;
        return true;
      })()`);
      openRailMenu = target.openRailMenu;
      const menuOpen = await waitFor(
        `(() => {
           const d = [...document.querySelectorAll(".sl-rail-menu")]
             .find((el) => (el.querySelector("summary")?.getAttribute("aria-label") || "") === ${JSON.stringify(target.openRailMenu)});
           return Boolean(d && d.open);
         })()`,
        5000, `左轨「${target.openRailMenu}」子菜单展开`,
      );
      check("[左轨工具] 子菜单可展开", menuOpen, menuOpen ? `「${target.openRailMenu}」` : `「${target.openRailMenu}」展不开`);
      await sleep(250);
    }
    if (target.openDrawer && !drawerOpen) {
      await evalJs(`document.querySelector("#ws-export").click()`);
      // ⚠️ 不能只等 `classList.contains("open")`。
      // 抽屉是 `transform: translateX(101%)` + `visibility: hidden`，
      // `.open` 一挂上就进入 240ms 过渡 —— 在第 0 帧：
      //   · `getComputedStyle(drawer).visibility` 还是 `hidden`（visibility 会继承，
      //     里面的按钮跟着一起 hidden）；
      //   · `transform` 还没走完，按钮的 rect 落在视口右侧外面（x ≈ 1444 @ 1440 宽）。
      // 这时候去量，门会报 TARGET_NOT_USER_REACHABLE —— 那是**探针的竞态**，不是产品缺陷。
      // 所以必须等它真的滑到位。
      drawerOpen = await waitFor(
        `(() => {
           const d = document.querySelector("#ws-export-drawer");
           if (!d) return false;
           if (!d.classList.contains("open")) return false;
           const cs = getComputedStyle(d);
           if (cs.visibility !== "visible") return false;
           const r = d.getBoundingClientRect();
           if (!(r.width > 0 && r.height > 0)) return false;
           // 完全滑进视口：右边不再越界，左边也不在屏幕外
           return r.right <= window.innerWidth + 1 && r.left < window.innerWidth;
         })()`,
        10000, "导出中心打开（滑入动画结束）",
      );
      check("[Export] 导出中心可打开", drawerOpen, drawerOpen ? "" : "点了「导出」抽屉没出来");
      if (!drawerOpen) { check(`[${target.group}] ${target.label}`, false, "抽屉没打开，里面的入口不可达"); continue; }
    }
    await measure(target);
  }
  await shot("02-workspace");

  /* ── 3. 校准：门说「点得中」→ 真点一下，状态必须真的变 ───────────── */
  // 这一段是防止门自说自话：hitTestSelf 只是个布尔值，它必须能预测真实点击的后果。
  // 先把导出抽屉关掉 —— 它 z-index:30 贴在右侧，开着的时候正好盖住右栏 tab 条，
  // 此时点 tab 点不到是**正确**的行为，拿它去校准只会得到一个假的 FAIL。
  if (drawerOpen) {
    await evalJs(`(() => { const c = document.querySelector("#ws-export-close"); if (c) c.click(); return true; })()`);
    await waitFor(
      `(() => { const d = document.querySelector("#ws-export-drawer"); return !d || getComputedStyle(d).visibility === "hidden"; })()`,
      10000, "导出中心关闭",
    );
  }
  await evalJs(`(() => { const b = document.querySelector('[data-ws-panel="project"]'); if (b) b.click(); return true; })()`);
  await sleep(400);
  const beforePanel = await evalJs(`document.querySelector('[data-ws-panel="generation"]').classList.contains("active")`);
  const genFacts = await evalJson(`JSON.stringify(window.__libmsReach.collect('[data-ws-panel="generation"]'))`);
  if (genFacts.exists && genFacts.hitTestSelf) {
    // 用元素中心点做真点击。rect 中心 = 门算 hitTestSelf 用的同一个点。
    // 先 scrollIntoView：tab 条是 `overflow-x: auto`，前面几轮切 tab 可能把它滚偏了，
    // 而 collect() 已经滚过一次 —— 这里要复现同一个点，就必须自己再滚一次。
    const center = await evalJson(`(() => {
      const el = document.querySelector('[data-ws-panel="generation"]');
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`);
    await realClick(center.x, center.y);
    await sleep(500);
    const afterPanel = await evalJs(`document.querySelector('[data-ws-panel="generation"]').classList.contains("active")`);
    check("校准：真鼠标点「生成」Tab 真的切换了面板", afterPanel && !beforePanel,
      `before=${beforePanel} after=${afterPanel} 点击点=(${center.x},${center.y})`,
      { before: beforePanel, after: afterPanel, clickPoint: center, gateFacts: genFacts });
    const panelVisible = await evalJs(`(() => { const p = document.querySelector('[data-ws-inspector="generation"]'); return Boolean(p) && !p.hidden; })()`);
    check("校准：切换后「生成」面板真的显示出来", panelVisible);
    await shot("03-generation-panel-via-real-click");
  } else {
    check("校准：真鼠标点「生成」Tab 真的切换了面板", false, "门的 hitTestSelf 判为不可命中，无法校准", { gateFacts: genFacts });
  }

  /* ── 4. 反向验证：门必须能抓出真的不可达 ─────────────────────────── */
  // 把「生成」面板切走（此时 8 张模式卡就在一个 display:none 的容器里），
  // 门必须报 TARGET_NOT_USER_REACHABLE。抓不出来 = 门是空的。
  await evalJs(`(() => { const b = document.querySelector('[data-ws-panel="check"]'); if (b) b.click(); return true; })()`);
  await sleep(400);
  const hiddenCard = await evalJson(`JSON.stringify(window.__libmsReach.collect('[data-preset="auto"]'))`);
  const hiddenVerdict = evaluateReachability(hiddenCard, { declaration: DECLARATION.USER });
  check("反向验证：面板切走后模式卡被判为不可达", !hiddenVerdict.pass && hiddenVerdict.code === "TARGET_NOT_USER_REACHABLE",
    `code=${hiddenVerdict.code} ${hiddenCard.width}×${hiddenCard.height} ancestorHidden=${hiddenCard.ancestorHidden}`,
    { facts: hiddenCard, code: hiddenVerdict.code });
  // 而同一个元素用 element.click() 照样能触发 —— 这就是「旧判据会假绿」的证据。
  const clickStillWorks = await evalJs(`(() => { const c = document.querySelector('[data-preset="auto"]'); if (!c) return false; c.click(); return document.querySelector('[data-preset="auto"]').classList.contains("is-active"); })()`);
  check("反向验证：同一个隐藏元素 element.click() 照样生效（旧判据的假绿来源）", clickStillWorks,
    "这一条证明「能 click」≠「用户够得到」");

  await evalJs(INSTALL_COLLECT_SOURCE);
} catch (error) {
  check("探针执行", false, String(error?.message || error));
} finally {
  const failed = results.filter((r) => !r.ok);
  const byGroup = {};
  for (const r of results) {
    const group = (r.name.match(/^\[([^\]]+)\]/) || [, "其它"])[1];
    byGroup[group] = byGroup[group] || { pass: 0, fail: 0 };
    byGroup[group][r.ok ? "pass" : "fail"] += 1;
  }
  console.log("\n── 分组 ──");
  for (const [group, count] of Object.entries(byGroup)) console.log(`  ${group.padEnd(18)} ${count.pass} pass / ${count.fail} fail`);
  console.log(`\n${results.length - failed.length}/${results.length} PASS · ${failed.length} FAIL`);
  if (pageErrors.length) console.log(`页面异常 ${pageErrors.length} 条（INFO）：${pageErrors.slice(0, 3).join(" | ")}`);
  fs.writeFileSync(path.join(OUT, "reachability.json"), JSON.stringify({ results, pageErrors, base: BASE, fixture: FIXTURE }, null, 2));
  console.log(`明细：${path.join(OUT, "reachability.json")}`);
  for (const r of failed) console.log(`FAIL  ${r.name}  — ${r.detail}`);
  cleanup();
  process.exit(failed.length ? 1 : 0);
}
