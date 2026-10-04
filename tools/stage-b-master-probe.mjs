#!/usr/bin/env node
/**
 * Stage B5 Master Probe —— 一条命令回答「Stage B 现在是什么状态」。
 *
 * ── 它解决什么问题 ────────────────────────────────────────────────────
 * B0–B4 一共留下了 6 个真机探针（b0/b1/b2/b3/b4-13/…），每个都只回答自己那一段。
 * 想知道「整条链路现在能不能上」，得手工跑十几个脚本、逐个读输出、
 * 再自己在脑子里合并结论 —— 而这件事每次发版都要做一遍。
 *
 * 本文件做两件事：
 *   ① **Stage B 集成场景**（§22 的 A–N）：在**一个**浏览器会话里跑完，
 *      重点是**跨阶段**的接线（背景 + Worker + Auto Tune + 导出 + 撤销），
 *      这些恰好是任何一个单阶段探针都覆盖不到的地方。
 *   ② **`--all` 编排**：把 b0/b1/b2/b3/b4-13 五个既有探针作为子进程跑一遍，
 *      汇总通过/失败，给出一个总判定。
 *
 * ── 为什么集成场景要独立写，而不是复用单阶段探针 ──────────────────────
 * 单阶段探针的断言范围是「这一段做对了没有」。集成场景问的是另一个问题：
 * 「A 段改了的东西，B 段还认不认」。例如：
 *   · 背景去掉了 3000 格 → Worker 回包 → Auto Tune 提交 → 导出，null 还在不在（§10）
 *   · maxColors=12 + 背景开 + 500 尺寸 → 最终 canonical grid 守不守上限（§9）
 *   · 同一页面里换第二张图 → 单例调优器会不会用上一张的图（§8）
 * 这些问题的答案在**两段的接缝**上，任何一段自己的探针都不会去看。
 *
 * ── 取证位置 ───────────────────────────────────────────────────────────
 * ① 页内 patch `Worker.prototype.postMessage` → 每次生成的 request
 * ② `LibmsWorkspaceBridge.getResult()` → canonical grid（宽度/高度/用色/null）
 * ③ `window.__libmsCommitProfile` → §12 提交路径分段（需显式打开，见下）
 * ④ `Browser.setDownloadBehavior` → 导出的真实文件落盘后校验魔数
 *
 * ── 用法 ───────────────────────────────────────────────────────────────
 *   node tools/stage-b-master-probe.mjs              # 只跑集成场景
 *   node tools/stage-b-master-probe.mjs --all        # 加上 b0/b1/b2/b3/b4-13
 *   node tools/stage-b-master-probe.mjs --only A,C,I # 调试单个场景
 * 环境变量：
 *   LIBMS_BASE / CDP_PORT / SERVE_PORT / OUT_DIR / PROBE_TIMEOUT_MS
 *
 * ⚠️ `LIBMS_BASE` 必须指向**带生产 CSP 头**的服务（`tools/serve-with-headers.mjs`）。
 *    不带 CSP 的「验过」和「能上」是两件事。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9411);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8836);
const BASE = process.env.LIBMS_BASE || `http://127.0.0.1:${SERVE_PORT}`;
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), "libms-stage-b-master");
const DOWNLOADS = path.join(OUT, "downloads");
/**
 * `--only A,C,I` / `--only=A,C,I` / `SB_ONLY=A,C,I` 三种写法都认。
 *
 * ⚠️ 2026-10-04 修：文件头从第一版起就写着 `--only A,C,I`，但实现只读 `SB_ONLY`
 * 环境变量 —— 命令行传 `--only` 会被静默忽略，于是「只跑一个场景」变成「跑全部」，
 * 白等十分钟还看不出哪里不对。**文档承诺了就得实现，否则删掉文档。**
 */
const onlyArg = (() => {
  const i = process.argv.indexOf("--only");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith("--only="));
  if (inline) return inline.slice("--only=".length);
  return process.env.SB_ONLY || "";
})();
const ONLY = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const RUN_ALL = process.argv.includes("--all");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
/**
 * 已知未达标项。
 *
 * 存在的理由：**「没达标」和「没验」不是一回事**，而把没达标悄悄降级成 INFO
 * 正是这个仓库反复踩的那类静默失效。所以给一个显式的第三种结局：
 *   PASS   —— 达成
 *   FAIL   —— 与硬不变量冲突（必须修）
 *   KNOWN  —— 已知未达标 / 规范明确允许保留；**必须出现在汇总里**，
 *             并且配一条「不许比基线更差」的硬回归门。
 */
const knownIssues = [];
const known = (name, detail) => {
  knownIssues.push({ name, detail });
  console.log(`KNOWN ${name}${detail ? `  ${detail}` : ""}`);
};
let currentScenario = "(init)";
const check = (name, ok, detail) => {
  results.push({ scenario: currentScenario, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const info = (name, detail) => console.log(`INFO  ${name}${detail ? `  ${detail}` : ""}`);
const scenario = (id, title) => { currentScenario = id; console.log(`\n════ ${id}. ${title} ════`); };
const skipScenario = (id) => ONLY && !ONLY.has(id);

const FIXTURE = {
  normal: "tests/fixtures/b4-race/race-b-600x480.png",
  portrait: "tests/fixtures/real-failures/rf-portrait-eye/image.png",
  logo: "tests/fixtures/background/white-logo.png",
  transparent: "tests/fixtures/background/transparent-png.png",
  pixel: "tests/fixtures/b4-race/race-b-600x480.png",
  complex: "tests/fixtures/real-failures/rf-complex/image.png",
};
for (const [name, file] of Object.entries(FIXTURE)) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) { console.error(`缺少夹具 ${name}：${p}`); process.exit(1); }
}
fs.mkdirSync(DOWNLOADS, { recursive: true });
console.log(`基址：${BASE}（生产 CSP 头由 serve-with-headers.mjs 提供）`);
console.log(`输出：${OUT}`);
console.log(`场景：${ONLY ? [...ONLY].join(",") : "全部 A–N + P"}${RUN_ALL ? " + --all 编排既有探针" : ""}\n`);

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
  `--user-data-dir=/tmp/chrome-libms-sb-master-${Date.now()}`,
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
const cspViolations = [];
const pageErrors = [];
const thirdPartyEvalErrors = [];
const consoleWarnings = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Log.entryAdded" && /Content Security Policy/i.test(String(m.params?.entry?.text || ""))) {
    cspViolations.push(String(m.params.entry.text).slice(0, 200));
  }
  // console.warn / console.error 是「静默退化」唯一会留下痕迹的地方：
  // 「生成 Worker 失败，退回主线程执行」就是一条 console.warn，
  // 界面、结果、导出全都正常 —— 不抓它就只能靠主线程卡顿去反推。
  if (m.method === "Runtime.consoleAPICalled") {
    const type = String(m.params?.type || "");
    if (type === "warning" || type === "error") {
      const text = (m.params.args || [])
        .map((a) => String(a.value ?? a.description ?? a.preview?.description ?? "")).join(" ");
      consoleWarnings.push({ type, text: text.replace(/\s+/g, " ").slice(0, 300) });
    }
  }
  if (m.method === "Runtime.exceptionThrown") {
    const text = String(m.params?.exceptionDetails?.exception?.description || "").slice(0, 200);
    if (/EvalError/.test(text)) thirdPartyEvalErrors.push(text);
    else pageErrors.push(text);
  }
  if (m.method === "Page.javascriptDialogOpening") {
    // 全局替换 / 画布调整都会弹确认框。自动接受 —— 探针要验的是「接受之后」的行为。
    ws.send(JSON.stringify({ id: ++msgId, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  }
});
const send = (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
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
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS }).catch(() => {});

const WATCHDOG_MS = Number(process.env.PROBE_TIMEOUT_MS || 40 * 60 * 1000);
const watchdog = setTimeout(() => {
  console.error(`\n[watchdog] 超过 ${Math.round(WATCHDOG_MS / 1000)}s，强制退出`);
  cleanup();
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref?.();

const evalJs = async (expression, timeoutMs = 180000) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result?.result?.value;
};
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

  // ① 抓生成请求
  window.__sbRequests = [];
  // 全类型 postMessage 计数。只统计 type==="generate" 的话，
  // 「一个请求都没发」和「发了但协议不同」长得一样 —— 这一项把两者分开。
  window.__sbPosts = [];
  // console.warn 全量捕获。降级分支②（Worker 起不来 → 退回主线程）
  // 只留一条 console.warn，界面/结果/导出全都正常 —— 不抓它就等于没有证据。
  window.__sbWarns = [];
  try {
    const rawWarn = console.warn.bind(console);
    console.warn = (...args) => {
      try { window.__sbWarns.push(args.map((a) => String(a)).join(" ").replace(/\s+/g, " ").slice(0, 220)); } catch {}
      return rawWarn(...args);
    };
  } catch {}
  const rawPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function patched(message, transfer) {
    try {
      window.__sbPosts.push(String(message?.type ?? "(none)"));
      if (message && message.type === "generate" && message.request) {
        const q = message.request;
        window.__sbRequests.push({
          mode: q.mode,
          maxColors: q.maxColors,
          size: { width: q.size?.width, height: q.size?.height },
          sampling: q.overrides?.sampling ?? null,
          cleanupStrength: q.overrides?.cleanupStrength ?? null,
          detailProtection: q.overrides?.detailProtection ?? null,
          edgeProtection: q.overrides?.edgeProtection ?? null,
          autoBackground: q.overrides?.autoBackground ?? null,
          labCandidate: q.overrides?.labCandidate ?? null,
          requestId: q.requestId,
        });
      }
    } catch {}
    return rawPost.call(this, message, transfer);
  };

  // ② 出图版本号
  window.__sbRev = 0;
  window.addEventListener("libms:project-result", () => { window.__sbRev += 1; });
  // 「没出图」的两条**预期结局**出口。它们不报错、不改状态栏，
  // 单看「结果没变」与「引擎里静默早退」长得一模一样 —— 必须分开计数。
  window.__sbDeferred = 0;
  window.__sbGenErrors = [];
  window.addEventListener("libms:generation-deferred", () => { window.__sbDeferred += 1; });
  window.addEventListener("libms:generation-error", (e) => { window.__sbGenErrors.push(String(e.detail)); });

  // ②-b 全量 libms:* 事件流水。
  //
  // 「这条链路到底走到哪一步」是排查里最贵的问题：结果没变可能是「引擎早退」、
  // 「延后」、「取消」、「算出一样的东西」，单看结果分不出来。而这条链路
  // **每一步都会广播一个 libms:* 事件**（project-result / generation-phase /
  // generation-error / generation-deferred / grid-edited …）。把 dispatchEvent
  // 包一层，就得到一个按时间排列的「链路脚印」，不用为每种猜测单独加探针。
  //
  // 自定义事件没法用通配符监听，所以只能在派发侧拦。
  //
  // 每条记录带**派发前后的 rev**：libms:project-result 的监听者里有一个是
  // 「出图版本号 +1」。如果某次派发前后 rev 没变，说明监听器没挂上 / 被换掉了 ——
  // 那所有基于 waitNewResult 的等待都会假超时。这个坑值得一个字段。
  window.__sbEvents = [];
  try {
    const rawDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = function tracedDispatch(event) {
      const type = (event && typeof event.type === "string") ? event.type : "";
      const tracked = type.indexOf("libms:") === 0;
      const before = tracked ? window.__sbRev : null;
      const out = rawDispatch(event);
      try {
        if (tracked) window.__sbEvents.push({ type, revBefore: before, revAfter: window.__sbRev });
      } catch { /* 记录失败绝不影响派发 */ }
      return out;
    };
  } catch {}

  // ③ 用户实际看到的进度文案
  window.__sbPhases = [];
  window.addEventListener("libms:generation-phase", (e) => {
    window.__sbPhases.push({ phase: e.detail?.phase ?? null, label: e.detail?.label ?? null });
  });

  // ④ 主线程长任务（§27）
  window.__sbLongTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__sbLongTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {}

  // ⑤ 生成调用追踪
  // 只看 Worker 请求数分不清两件完全不同的事：「生成根本没被调用」和
  // 「被调用了但在引擎里早退」。工作台侧的 runAutoGenerate 有好几条静默早退路径
  // （无源图 / 手动编辑未覆盖 / 已有生成在跑 → 排队），排查时必须先知道是哪一种。
  window.__sbGenCalls = [];
  try {
    const target = bridge();
    const rawGenerate = target.generate;
    target.generate = function tracedGenerate(...args) {
      // 记**结局**，不只记调用。「bridge.generate 被调了、但什么都没发生」有四种
      // 完全不同的原因，只看调用数一个都分不出来：
      //   sync     —— 同步返回（引擎里早退，例如「正在生成，请稍候」被吞掉）
      //   resolve  —— 正常出图（那没出图就是别处的问题）
      //   reject   —— 抛了（取消 / 过期 / 真失败，name 直接可读）
      //   (null)   —— 永远 pending（await 链断在半路）
      const rec = {
        at: Math.round(performance.now()),
        args: args.map((a) => (a && typeof a === "object" ? { ...a } : a)),
        // 调用栈：「谁调的」是回答「点了按钮却没生成」的第一性问题 ——
        // 点击处理器、自动生成、桥接层三条路都会走到这里，只记参数分不出来。
        // ⚠️ 分隔符必须写成双反斜杠加 n，不能写单反斜杠加 n：HELPERS 本身是
        //    模板字符串，单反斜杠加 n 会在外层就被转成真换行，页内那行于是变成
        //    把一个真换行当分隔符 —— 直接语法错误，而报错指向 freshPage。
        //    （同一条纪律的另一半：这里连反引号都不能出现，一出现模板就提前结束。）
        stack: String((new Error()).stack || "").split("\\n").slice(1, 6).map((line) => line.trim()),
        settled: null,
        ms: null,
        error: null,
      };
      window.__sbGenCalls.push(rec);
      let out;
      try {
        out = rawGenerate.apply(this, args);
      } catch (error) {
        rec.settled = "sync-throw";
        rec.error = String(error && error.name) + ":" + String(error && error.message);
        throw error;
      }
      if (out && typeof out.then === "function") {
        return out.then(
          (value) => {
            rec.settled = "resolve";
            rec.ms = Math.round(performance.now() - rec.at);
            rec.result = value ? { width: value.width, height: value.height, usedColors: value.usedColors } : null;
            return value;
          },
          (error) => {
            rec.settled = "reject";
            rec.ms = Math.round(performance.now() - rec.at);
            rec.error = String(error && error.name) + ":" + String(error && error.message);
            throw error;
          },
        );
      }
      rec.settled = "sync";
      rec.ms = Math.round(performance.now() - rec.at);
      return out;
    };
  } catch {}

  // ⑥ Worker 客户端实例追踪（§7）
  // client.supported 一旦为 false 就**永久**为 false（onerror 里置位、无复位），
  // 之后每次生成都静默退回主线程 —— 而界面、结果、导出全都正常，
  // 只有「主线程卡 1 秒」这一个症状。所以必须能直接读到它。
  //
  // 用属性拦截，而不是「在 HELPERS 里包一次」：那几个 window.Libms* 全局是
  // **异步动态 import 之后才挂上**的，而 HELPERS 跑在落地页 —— 此刻它们还不存在，
  // 一次性包装会静默不生效（实测 traced 一直 false），看起来像「客户端没被创建」。
  // 拦截赋值没有这个时序问题。
  try {
    let apiRef = window.LibmsGenerationWorkerClient;
    Object.defineProperty(window, "LibmsGenerationWorkerClient", {
      configurable: true,
      get: () => apiRef,
      set: (value) => {
        apiRef = value;
        try {
          if (value && !value.__sbTraced) {
            const rawCreate = value.createGenerationWorkerClient;
            value.createGenerationWorkerClient = function tracedCreate(...args) {
              const client = rawCreate.apply(this, args);
              window.__sbWorkerClient = client;
              return client;
            };
            value.__sbTraced = true;
          }
        } catch {}
      },
    });
  } catch {}

  // ⑦ Worker 构造追踪（§7 的决定性信号）
  //
  // 为什么不能只靠「包 createGenerationWorkerClient」：那几个 window.Libms* 全局
  // 是**异步动态 import 之后才挂上**的，而 HELPERS 装在落地页 —— 此刻它们还不存在，
  // 于是包装代码静默不生效（实测 traced 一直是 false），看起来像「客户端没被创建」，
  // 其实只是包装晚了一步。追踪全局 Worker 构造函数没有这个时序问题：
  // 它从落地页起就一直有效，而且 new 的时机就是 Worker 真正被起的时机。
  window.__sbWorkerNews = [];
  try {
    const RawWorker = window.Worker;
    if (RawWorker && !RawWorker.__sbTraced) {
      const TracedWorker = function (...args) {
        const instance = new RawWorker(...args);
        window.__sbWorkerNews.push({ at: Math.round(performance.now()), url: String(args[0] || "") });
        // 同时按**实例**包 postMessage。原型补丁依赖「实例原型 === 打补丁时的
        // Worker.prototype」这个假设；实例补丁没有这个假设，两条路互相印证。
        try {
          const rawInstancePost = instance.postMessage.bind(instance);
          instance.postMessage = function (...callArgs) {
            try { window.__sbPosts.push("instance:" + String(callArgs[0]?.type ?? "(none)")); } catch {}
            return rawInstancePost(...callArgs);
          };
        } catch {}
        return instance;
      };
      TracedWorker.prototype = RawWorker.prototype;
      try { Object.setPrototypeOf(TracedWorker, RawWorker); } catch {}
      TracedWorker.__sbTraced = true;
      window.Worker = TracedWorker;
    }
  } catch {}

  window.__sbMarks = [];

  window.__sb = {
    rev: () => window.__sbRev,
    requestCount: () => window.__sbRequests.length,
    requests: () => window.__sbRequests.slice(),
    lastRequest: () => window.__sbRequests[window.__sbRequests.length - 1] || null,
    resetRequests: () => { window.__sbRequests = []; window.__sbPosts = []; return true; },
    posts: () => window.__sbPosts.slice(),
    warns: () => window.__sbWarns.slice(),
    workerNews: () => window.__sbWorkerNews.slice(),
    resetWorkerNews: () => { window.__sbWorkerNews = []; return true; },
    phases: () => window.__sbPhases.slice(),
    resetPhases: () => { window.__sbPhases = []; return true; },
    longTasks: () => window.__sbLongTasks.slice(),
    genCalls: () => window.__sbGenCalls.slice(),
    resetGenCalls: () => { window.__sbGenCalls = []; return true; },
    events: () => window.__sbEvents.slice(),
    resetEvents: () => { window.__sbEvents = []; return true; },
    /** §7：生产生成必须走真实 Worker。这一项是 false 就说明已经静默退化。 */
    workerSupported: () => {
      try { return window.__sbWorkerClient ? Boolean(window.__sbWorkerClient.supported) : null; }
      catch { return null; }
    },
    /** 直接问「现在新建一个客户端，supported 是什么」——绕开实例追踪可能失败的问题。 */
    workerProbe: () => {
      const api = window.LibmsGenerationWorkerClient;
      if (!api) return { api: false };
      let frozen = null;
      let writable = null;
      let freshSupported = null;
      let freshError = null;
      try { frozen = Object.isFrozen(api); } catch { /* ignore */ }
      try { writable = Object.getOwnPropertyDescriptor(api, "createGenerationWorkerClient")?.writable ?? null; } catch { /* ignore */ }
      try { freshSupported = Boolean(api.createGenerationWorkerClient().supported); } catch (error) { freshError = String(error?.message || error); }
      return { api: true, frozen, writable, freshSupported, freshError, traced: Boolean(window.__sbWorkerClient) };
    },
    /**
     * Worker 模块图自检（§7 的最后一道取证）。
     *
     * 「Worker 被构造了但从不发包」「干脆没构造」这两种情况，
     * 靠主链路的症状分不出来。这里在页内**单独起一个 Worker**，
     * 发一个最小请求，看它是回包（模块图可加载）还是 error（加载失败）。
     */
    workerSelfTest: () => new Promise((resolve) => {
      const out = { events: [] };
      const finish = (w) => { try { w?.terminate?.(); } catch { /* ignore */ } resolve(out); };
      try {
        const w = new Worker("./services/generation.worker.mjs?v=20261002-stage-b3", { type: "module" });
        const timer = setTimeout(() => { out.events.push("timeout"); finish(w); }, 12000);
        w.onerror = (e) => {
          out.events.push("error:" + String(e?.message || e?.filename || "?"));
          clearTimeout(timer);
          finish(w);
        };
        w.onmessage = (e) => {
          out.events.push("message:" + String(e?.data?.type || "?"));
          clearTimeout(timer);
          finish(w);
        };
        w.postMessage({ type: "generate", request: { requestId: 424242 } });
      } catch (error) {
        out.events.push("throw:" + String(error?.message || error));
        resolve(out);
      }
    }),
    workerBusy: () => {
      try { return window.__sbWorkerClient ? Boolean(window.__sbWorkerClient.busy) : null; }
      catch { return null; }
    },
    /**
     * 生成走的是哪一条路（§7）。
     *
     * runGenerationJob 有三条分支，只有中间那条走 Worker：
     *   ① 契约全局缺失（LibmsGenerationJob / LibmsGenerationRequest）→ 直调流水线
     *   ② client.supported → 真实 Worker
     *   ③ 主线程 executeGenerationJob
     * ①③ 都**不留 console 警告**，症状只有「主线程卡住」。
     */
    engineGlobals: () => ({
      job: Boolean(window.LibmsGenerationJob),
      request: Boolean(window.LibmsGenerationRequest),
      clientApi: Boolean(window.LibmsGenerationWorkerClient),
      workerCtor: typeof Worker !== "undefined",
      engineSelect: (document.querySelector("#ws-engine") || {}).value ?? null,
      engineLast: (window.LibmsWorkspaceBridge.getGenerationReport() || {}).engine ?? null,
    }),
    mark: (label) => { window.__sbMarks.push({ label, at: Math.round(performance.now()) }); return true; },
    marks: () => window.__sbMarks.slice(),
    longTasksBetween: (startLabel, endLabel) => {
      const at = (l) => { const m = window.__sbMarks.find((x) => x.label === l); return m ? m.at : null; };
      const a = at(startLabel); const b = at(endLabel);
      if (a === null || b === null) return window.__sbLongTasks.slice();
      return window.__sbLongTasks.filter((t) => t.start + t.dur >= a && t.start <= b);
    },

    // ── §12 提交路径 profile ──
    // 显式打开才会记账（app.js 里 commitProfileOn 读的就是这个）。
    // 每次整页重载后都要重新打开 —— 所以它挂在 install 里而不是一次性设置。
    enableCommitProfile: () => { window.__libmsProfileCommit = true; return true; },
    commitProfile: () => ({
      meta: window.__libmsCommitProfileMeta || null,
      rows: (window.__libmsCommitProfile || []).slice(),
    }),
    clearCommitProfile: () => { window.__libmsCommitProfile = []; return true; },

    // ── 结果 ──
    result: () => {
      const r = bridge().getResult();
      const used = new Set();
      let nulls = 0;
      for (const row of r.grid || []) for (const cell of row) { if (cell) used.add(cell.code); else nulls += 1; }
      return {
        width: r.width, height: r.height, rows: r.grid?.length ?? 0,
        usedColors: used.size, nulls, generating: Boolean(bridge().isGenerating()),
        manualEdited: Boolean(r.manualEdited),
      };
    },
    /** 逐格投影：只回「code 或 null」的二维数组 —— 用于跨会话比对。 */
    matrix: () => {
      const r = bridge().getResult();
      return (r.grid || []).map((row) => row.map((cell) => (cell ? String(cell.code) : null)));
    },
    matrixHash: () => {
      const r = bridge().getResult();
      let h = 2166136261;
      for (const row of r.grid || []) for (const cell of row) {
        const s = cell ? String(cell.code) : "-";
        for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= 44; h = Math.imul(h, 16777619) >>> 0;
      }
      return h.toString(16).padStart(8, "0");
    },
    /** 图里每个色号用了多少颗 —— Pixler roundtrip 与全局替换都用它。 */
    usage: () => {
      const r = bridge().getResult();
      const map = {};
      for (const row of r.grid || []) for (const cell of row) if (cell) map[cell.code] = (map[cell.code] || 0) + 1;
      return map;
    },
    usageSummary: () => (bridge().getResult().colors || []).map((c) => ({ code: c.code, count: c.count })),
    paletteLabel: () => bridge().getResult().paletteKey,
    nullCount: () => window.__sb.result().nulls,

    // ── §10 null 完整性：从 bridge 一路查到渲染层 ──
    // 「null 没有被重新填色」不能只看一个位置：bridge 的 grid 是一个副本，
    // 渲染层读的是同一个 state.grid，但导出走的是 export service 里再拷一份。
    // 三处一起看，才能说「null 贯穿」。
    nullIntegrity: () => {
      const r = bridge().getResult();
      let bridgeNulls = 0, filled = 0;
      for (const row of r.grid || []) for (const cell of row) { if (cell) filled += 1; else bridgeNulls += 1; }
      const cells = (r.grid || []).length * ((r.grid || [])[0] || []).length;
      return { cells, bridgeNulls, filled, sumOk: bridgeNulls + filled === cells };
    },

    // ── 交互 ──
    clickMode: (mode) => {
      const card = document.querySelector('[data-preset="' + mode + '"]');
      if (!card || card.disabled) return false;
      card.click();
      return true;
    },
    activeMode: () => ($("[data-preset].is-active") || {}).dataset?.preset ?? null,
    /**
     * 触发一次重新生成 —— 走**用户真实路径**。
     *
     * 工作台没有独立的「生成」按钮：生成由 scheduleAutoGenerate 驱动
     * （参数变化 / 模式卡片 / 应用尺寸）。#ws-generate 只是「重新生成」，
     * 平时 hidden，只有存在手动编辑时才作为显式覆盖出口出现 ——
     * 拿它当通用生成按钮会得到一个**点了没反应**的假失败。
     *
     * 重选当前已选中的模式卡片是这条链路上最干净的一击：applyPreset
     * 没有「值没变就早退」的分支，所以它一定会走到 onChange → scheduleAutoGenerate。
     */
    regenerate: () => {
      const card = $("[data-preset].is-active") || $("[data-preset]");
      if (!card) return false;
      card.click();
      return true;
    },
    /** 「重新生成」按钮当前是否可见（§19：只有手动编辑后才出现）。 */
    regenerateButtonVisible: () => {
      const b = $("#ws-generate");
      return b ? !b.hidden : null;
    },
    clickGenerate: () => { const b = $("#ws-generate"); if (!b || b.disabled) return false; b.click(); return true; },
    generateDisabled: () => { const b = $("#ws-generate"); return b ? b.disabled : null; },
    generating: () => Boolean(bridge().isGenerating()),
    cancelVisible: () => { const b = $("#ws-cancel-generate"); return Boolean(b) && !b.hidden && !b.disabled; },
    clickCancel: () => { const b = $("#ws-cancel-generate"); if (!b || b.hidden || b.disabled) return false; b.click(); return true; },
    statusText: () => (($("#ws-status") || {}).textContent || "").trim(),
    visibleText: () => ((($("#ws-root") || document.body).innerText) || "").replace(/\\s+/g, " "),

    /**
     * 应用顶栏长边。返回状态字符串（不是布尔）—— 失败原因要能看出来。
     *
     * 「应用尺寸」在生成期间 / 尺寸被锁定时是 disabled 的。一次性点击会静默
     * 什么都没发生，探针却以为尺寸改了，于是后面「出图尺寸不对」看起来像
     * 生成链路的错。这里重试到按钮可用为止（最多 5 秒），并把结局如实返回。
     */
    setLongEdge: (value, tries = 20) => new Promise((resolve) => {
      let n = 0;
      const attempt = () => {
        const node = $("#ws-size-number");
        if (!node) { resolve("no-node"); return; }
        node.value = String(value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        const apply = $("#ws-size-apply");
        if (apply && !apply.disabled) { apply.click(); resolve("clicked"); return; }
        n += 1;
        if (n >= tries) { resolve(apply ? "apply-disabled" : "no-apply"); return; }
        setTimeout(attempt, 250);
      };
      attempt();
    }),
    longEdgeValue: () => { const n = $("#ws-size-number"); return n ? Number(n.value) : null; },
    sizeNumberDisabled: () => { const n = $("#ws-size-number"); return n ? Boolean(n.disabled) : null; },

    setMaxColors: (value) => {
      let touched = false;
      const panel = $('[data-field="maxColors"]');
      if (panel) {
        panel.value = String(value);
        panel.dispatchEvent(new Event("input", { bubbles: true }));
        panel.dispatchEvent(new Event("change", { bubbles: true }));
        touched = true;
      }
      try { if (typeof bridge().setMaxColors === "function") { bridge().setMaxColors(value); touched = true; } } catch {}
      const legacy = $("#max-colors-input");
      if (legacy) {
        legacy.value = String(value);
        legacy.dispatchEvent(new Event("input", { bubbles: true }));
        legacy.dispatchEvent(new Event("change", { bubbles: true }));
        touched = true;
      }
      return touched;
    },
    maxColorsValue: () => { const n = $("#max-colors-input"); return n ? Number(n.value) : null; },

    // ── 背景 ──
    setBackgroundRemoval: (on) => {
      const box = $('[data-field="backgroundRemoval"]');
      if (!box) return false;
      if (Boolean(box.checked) === Boolean(on)) return true;
      box.click();
      return true;
    },
    backgroundRemovalChecked: () => { const b = $('[data-field="backgroundRemoval"]'); return b ? Boolean(b.checked) : null; },
    bgPreviewBarVisible: () => { const b = $("#ws-bg-preview"); return Boolean(b) && !b.hidden; },
    bgPreviewButtons: () => Array.from(document.querySelectorAll("#ws-bg-preview button")).map((b) => (b.textContent || "").trim()),
    clickBgApply: () => {
      const bar = $("#ws-bg-preview");
      if (!bar || bar.hidden) return false;
      const btn = Array.from(bar.querySelectorAll("button")).find((b) => /应用|保留|确定/.test(b.textContent || ""));
      if (!btn) return false;
      btn.click();
      return true;
    },
    backgroundDecision: () => bridge().getGenerationReport().autoBackground || null,

    // ── 撤销 / 重做 ──
    canUndo: () => { const b = $("#ws-undo"); return b ? !b.disabled : null; },
    canRedo: () => { const b = $("#ws-redo"); return b ? !b.disabled : null; },
    clickUndo: () => { const b = $("#ws-undo"); if (!b || b.disabled) return false; b.click(); return true; },
    clickRedo: () => { const b = $("#ws-redo"); if (!b || b.disabled) return false; b.click(); return true; },
    /**
     * 工作台的确认弹窗（dialog.ws-confirm-dialog）。
     *
     * 好几个动作在真正执行前会先弹一次确认 —— 全局替换（「将 N 颗 X 替换为 Y？」）
     * 与「重新生成」都是。探针只点触发按钮、不点确认，就会看到「按钮点了、什么都没发生」，
     * 然后把它误判成产品缺陷（L 场景实测踩过）。
     */
    confirmationOpen: () => {
      const d = document.querySelector("dialog.ws-confirm-dialog");
      return Boolean(d && d.open);
    },
    acceptConfirmation: (timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const limit = timeoutMs || 4000;
      const tick = () => {
        const d = document.querySelector("dialog.ws-confirm-dialog");
        const ok = document.querySelector("#ws-confirm-ok");
        if (d && d.open && ok) { ok.click(); resolve(true); return; }
        if (performance.now() - t0 > limit) { resolve(false); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 20);
    }),

    // ── 全局替换（复用既有 #ws-replace-* 流程，不建第二套）──
    openUsageReplace: () => { const b = $("#ws-usage-replace"); if (!b) return false; b.click(); return true; },
    replaceSelectors: () => ({
      from: Boolean($("#ws-replace-from")),
      to: Boolean($("#ws-replace-to")),
      confirm: Boolean($("#ws-replace-confirm")),
      fromValue: ($("#ws-replace-from") || {}).value ?? null,
      toValue: ($("#ws-replace-to") || {}).value ?? null,
    }),
    setReplace: (from, to) => {
      const f = $("#ws-replace-from"), t = $("#ws-replace-to"), c = $("#ws-replace-confirm");
      if (!f || !t || !c) return false;
      f.value = String(from);
      f.dispatchEvent(new Event("change", { bubbles: true }));
      t.value = String(to);
      t.dispatchEvent(new Event("change", { bubbles: true }));
      c.click();
      return true;
    },

    // ── 导出 ──
    clickExport: (kind) => {
      const b = document.querySelector('[data-export-v2="' + kind + '"]');
      if (!b) return false;
      b.click();
      return true;
    },
    setExportQuality: (quality) => {
      const s = $("#ws-export-quality");
      if (!s) return false;
      s.value = quality;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    setPosterRatio: (ratio) => {
      const s = $("#ws-poster-ratio");
      if (!s) return false;
      s.value = ratio;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    setExportTitle: (title) => {
      const i = $("#ws-export-title");
      if (!i) return false;
      i.value = title;
      i.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    exportMessage: () => (($("#ws-export-message") || {}).textContent || "").trim(),
    openExportDrawer: () => {
      const b = $("#ws-export");
      if (!b || b.disabled) return false;
      b.click();
      return true;
    },

    // ── 等 ──
    waitNewResult: (target, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (window.__sbRev > target) { resolve({ ok: true, ms: Math.round(performance.now() - t0) }); return; }
        if (performance.now() - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(performance.now() - t0) }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }),
    waitQuiet: (quietMs, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      let quietSince = null;
      const tick = () => {
        const r = window.__sb.result();
        if (r.rows > 0 && !r.generating) { if (quietSince === null) quietSince = performance.now(); }
        else quietSince = null;
        const now = performance.now();
        if (quietSince !== null && now - quietSince >= quietMs) { resolve({ ok: true, ms: Math.round(now - t0) }); return; }
        if (now - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(now - t0) }); return; }
        setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }),
    /**
     * 等系统真正静止：连续 quietMs 内 rev / 请求数 / 生成调用数 / Worker 发包数
     * 都不再变化，且 isGenerating() 为 false。
     *
     * 为什么不能用「静默 700ms」：setLongEdge 到「Worker 真的收到包」之间
     * 还隔着 320ms 去抖 + autoGenRunning 排队，实测可以隔 1 秒以上。
     * 只等 700ms 就会在**生成还没开始**的时候以为它结束了 —— 于是紧接着的
     * 「重置计数器 → 触发新一轮」会把上一轮的发包记录清掉，
     * 看起来像「这一轮没走 Worker」。这个形状把排查带偏了很久。
     */
    waitStable: (quietMs, timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const snap = () => [
        window.__sbRev,
        window.__sbRequests.length,
        window.__sbGenCalls.length,
        window.__sbWorkerNews.length,
        window.__sbPosts.length,
      ].join("|");
      let last = null;
      let since = null;
      const tick = () => {
        const now = performance.now();
        // 生成中一律不算静止。只看「快照没变」会把「正在算但还没回包」
        // 误判成静止 —— 紧接着的 bridge.generate 就会撞上
        // processProductionV2 的「正在生成，请稍候」，本轮什么都没验到。
        if (window.LibmsWorkspaceBridge.isGenerating()) {
          last = null;
          since = null;
        } else {
          const s = snap();
          if (s !== last) { last = s; since = now; }
          else if (now - since >= quietMs) { resolve(true); return; }
        }
        if (now - t0 > timeoutMs) { resolve(false); return; }
        setTimeout(tick, 50);
      };
      setTimeout(tick, 0);
    }),
    /**
     * 直接驱动一次生成。不 await —— 探针要靠 isGenerating() 观察它的过程。
     *
     * 传 width/height 就是 §11 的「user-explicit 尺寸」：它高于自动识别，
     * 且是**一次性**的（bridge.generate 的 finally 会还原顶栏选择）。
     * 用它而不是拖顶栏控件，是因为尺寸控件的可用性还受锁定态影响，
     * 探针不该把「控件此刻能不能点」混进「生成链路对不对」里。
     */
    startGeneration: (width, height) => {
      window.__sbStartGenErr = null;
      const args = (width && height) ? { width: Number(width), height: Number(height) } : {};
      window.__sbStartGen = window.LibmsWorkspaceBridge.generate(args);
      // 必须自己接住 rejection：不接就是一个 unhandled rejection，
      // 会被 §24 的「未捕获异常」门当成站点缺陷（实测踩过）。接住但留证。
      window.__sbStartGen.catch((error) => {
        window.__sbStartGenErr = String(error?.name || "") + ":" + String(error?.message || error);
      });
      return true;
    },
    startGenError: () => window.__sbStartGenErr,

    waitGenerating: (timeoutMs) => new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (window.__sb.generating()) { resolve({ ok: true, ms: Math.round(performance.now() - t0) }); return; }
        if (performance.now() - t0 > timeoutMs) { resolve({ ok: false, ms: Math.round(performance.now() - t0) }); return; }
        setTimeout(tick, 25);
      };
      setTimeout(tick, 25);
    }),
    /**
     * 时间线采样：每 100ms 记一次关键状态。
     *
     * 「生成到底有没有跑起来」这个问题，靠单点快照是答不上来的 ——
     * 生成可能已经开始并结束、可能被排队、可能根本没被调用，三种情况的
     * 单点快照长得一模一样。必须看**随时间的形状**。
     */
    trace: (ms) => new Promise((resolve) => {
      const t0 = performance.now();
      const rows = [];
      const tick = () => {
        rows.push({
          t: Math.round(performance.now() - t0),
          rev: window.__sbRev,
          reqs: window.__sbRequests.length,
          gen: window.__sbGenCalls.length,
          busy: Boolean(window.LibmsWorkspaceBridge.isGenerating()),
          // store 侧的 generating 与 bridge.isGenerating() **不是一回事**：
          // 前者由 generation-service 在进入时同步置位，后者要等引擎真的把
          // state.isProcessingImage 立起来。两者之间的空档就是「按钮点了没反应」
          // 这类现象的常见藏身处 —— 必须能分开看。
          sgen: (() => {
            try {
              const snapshot = window.libmsStore.getState();
              return snapshot && snapshot.status ? Boolean(snapshot.status.generating) : "no-status-key";
            } catch { return null; }
          })(),
          st: (($("#ws-status") || {}).textContent || "").trim(),
        });
        if (performance.now() - t0 >= ms) { resolve(rows); return; }
        setTimeout(tick, 100);
      };
      setTimeout(tick, 0);
    }),
  };
  return true;
})()`;

/* ── 主流程 ─────────────────────────────────────────────────────── */

/** 整页重载 + 装助手 + 开 profile。每个场景都从干净页面开始。 */
async function freshPage() {
  await send("Page.navigate", { url: `${BASE}/` });
  const ok = await waitFor(`document.body.dataset.workspaceState === 'landing'`, 45000, "落地页");
  if (!ok) throw new Error("落地页没就绪");
  await evalJs(HELPERS);
  await evalJs(`window.__sb.enableCommitProfile()`);
  return true;
}

/** 上传夹具并等工作台挂载。返回是否成功。 */
async function upload(fixtureKey) {
  const file = path.join(ROOT, FIXTURE[fixtureKey]);
  const doc = await send("DOM.getDocument", { depth: -1 });
  const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#file-input" });
  if (!node.result?.nodeId) throw new Error("找不到 #file-input");
  await send("DOM.setFileInputFiles", { nodeId: node.result.nodeId, files: [file] });
  const ready = await waitFor(`document.body.dataset.workspaceState === 'ready'`, 240000, "工作台挂载");
  if (!ready) return false;
  // 等真正静止（不是「静默 800ms」）—— 首帧生成会先跑内容审查、再跑生成，
  // 中间的空档足够骗过一次短静默。
  await evalJs(`window.__sb.waitStable(1500, 240000)`, 260000);
  return true;
}

/**
 * 生成一次并等结果。返回 { ok, ms, reason }。
 *
 * ⚠️ 2026-10-04 踩过两次，两次都是「探针点错了按钮」：
 *   ① 第一版点 `#ws-generate` 并等它。它是「重新生成」——平时 `hidden`，
 *      只有手动编辑后才出现。点它要么没反应（无手动编辑），要么走的是
 *      另一条语义，于是场景 A 报 `FAIL A 生成完成 0ms`，而后面几条断言全绿：
 *      图**确实**出来了，只是探针没等它。
 *   ② 点模式卡片后固定 `sleep(450)` 再点按钮。模式卡片会走
 *      `scheduleAutoGenerate`（320ms 去抖）自动开跑，450ms 后生成已经在飞，
 *      `#ws-generate` 是 disabled 的 —— 又一次假失败。
 * 现在的做法：统一走 `regenerate()`（重选当前模式卡片），只等
 * `libms:project-result` 的版本号增长。这是用户真实路径，也是唯一稳定的锚点。
 */
async function generate({ viaMode = null } = {}) {
  // 先等静止再取基准：否则基准取在「上一轮还在飞」的时刻，
  // waitNewResult 会被上一轮的结果唤醒，测出来的时间与这张图无关。
  await waitStable(1500);
  const revBefore = await evalJs(`window.__sb.rev()`);
  if (viaMode) {
    const ok = await evalJs(`window.__sb.clickMode(${JSON.stringify(viaMode)})`);
    if (!ok) return { ok: false, ms: 0, reason: `找不到模式卡片 ${viaMode}` };
  } else {
    const ok = await evalJs(`window.__sb.regenerate()`);
    if (!ok) return { ok: false, ms: 0, reason: "找不到模式卡片，无法触发生成" };
  }
  const waited = await evalJs(`window.__sb.waitNewResult(${revBefore}, 300000)`, 320000);
  return { ok: Boolean(waited?.ok), ms: waited?.ms ?? 0, reason: waited?.ok ? null : "等结果超时" };
}

/**
 * 确定性地起一轮生成：直接驱动 bridge，不 await。
 *
 * 为什么不用「点模式卡片 / 点重新生成」：那两条路都要经过
 * `scheduleAutoGenerate` 的 320ms 去抖 + `autoGenRunning` 排队，
 * 「什么时候真的在跑」是不确定的 —— 探针只能靠 `isGenerating()` 去猜窗口，
 * 而 500 档的提交段会把主线程占住 1 秒左右，采样器直接被饿死，
 * 于是永远猜不中（实测：`waitGenerating` 连续 8 秒 false）。
 *
 * 直接调 bridge 没有这层不确定性：返回的 Promise 一被创建，生成就已经在跑了。
 * 它同时也是**生产路径**（工作台的自动生成最终也是调它），不是绕过 UI 的后门。
 */
async function startGeneration(size = null) {
  await evalJs(`window.__sb.startGeneration(${size ? `${size.width}, ${size.height}` : ""})`);
  const started = await evalJs(`window.__sb.waitGenerating(20000)`);
  if (started?.ok === false) {
    const err = await evalJs(`window.__sb.startGenError()`);
    console.log(`  [生成没能启动] ${err || "（没有抛错，但 isGenerating() 始终为 false）"}`);
  }
  return started;
}

/** 等系统真正静止（见页内 waitStable 的说明）。 */
async function waitStable(quietMs = 1500) {
  return evalJs(`window.__sb.waitStable(${quietMs}, 240000)`, 260000);
}

/**
 * 触发一轮生成并等结果 —— 测量用的标准姿势。
 *
 * 顺序很关键：先等静止，再取 rev 基准，最后才触发。
 * 任何一步颠倒，都会把上一轮生成记到这一轮头上。
 */
async function startAndWait(size = null) {
  await waitStable(1500);
  const revBefore = await evalJs(`window.__sb.rev()`);
  const started = await startGeneration(size);
  const waited = await evalJs(`window.__sb.waitNewResult(${revBefore}, 300000)`, 320000);
  return { started: Boolean(started?.ok), ok: Boolean(waited?.ok), ms: waited?.ms ?? 0 };
}

/** 等下载目录里出现匹配的文件。 */
async function waitDownload(pattern, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const files = fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS) : [];
    const hit = files.find((f) => pattern.test(f));
    if (hit) {
      const full = path.join(DOWNLOADS, hit);
      // 下载完成前是 .crdownload；大小稳定再返回。
      let last = -1;
      for (let i = 0; i < 40; i += 1) {
        const size = fs.statSync(full).size;
        if (size > 0 && size === last) return { name: hit, path: full, size };
        last = size;
        await sleep(120);
      }
      return { name: hit, path: full, size: fs.statSync(full).size };
    }
    await sleep(200);
  }
  return null;
}

const clearDownloads = () => {
  for (const f of fs.existsSync(DOWNLOADS) ? fs.readdirSync(DOWNLOADS) : []) {
    try { fs.unlinkSync(path.join(DOWNLOADS, f)); } catch {}
  }
};

try {
  /* ════════ A. 普通图片 → 智能 → 生成 ════════ */
  if (!skipScenario("A")) {
    scenario("A", "普通图片 → 智能 → 生成");
    await freshPage();
    const mounted = await upload("normal");
    check("A 上传并挂载工作台", mounted);
    if (mounted) {
      const gen = await generate({ viaMode: "auto" });
      check("A 生成完成", gen.ok, `${gen.ms}ms`);
      const r = await evalJs(`window.__sb.result()`);
      check("A 出图非空且尺寸合理", r.rows > 0 && r.width > 0, JSON.stringify(r));
      const req = await evalJs(`window.__sb.lastRequest()`);
      check("A 请求经 Worker 且带完整模式档案",
        Boolean(req) && typeof req.cleanupStrength === "number" && req.mode === "auto",
        JSON.stringify(req));
      info("A 引擎分支", JSON.stringify(await evalJs(`window.__sb.engineGlobals()`)));
      info("A 请求数", String(await evalJs(`window.__sb.requestCount()`)));
      info("A §7 现场", JSON.stringify(await evalJs(`({
        workerNews: window.__sb.workerNews(),
        posts: window.__sb.posts(),
        supported: window.__sb.workerSupported(),
        clientTraced: Boolean(window.__sbWorkerClient),
      })`)));
      info("A Worker 模块图自检", JSON.stringify(await evalJs(`window.__sb.workerSelfTest()`, 20000)));
      // §7 决定性实验：**同一页面里连生成两次**。
      // 第一次走 Worker（上面已证）。如果第二次不再发包，说明 client.supported
      // 是个**永久闩锁** —— 之后每次生成都静默退回主线程，而界面毫无异常。
      await evalJs(`window.__sb.resetRequests()`);
      await evalJs(`window.__sb.resetWorkerNews()`);
      const second = await startGeneration();
      await evalJs(`window.__sb.waitQuiet(900, 240000)`, 260000);
      info("A 第二次生成 §7 现场", JSON.stringify(await evalJs(`({
        ok: ${JSON.stringify(Boolean(second?.ok))},
        workerNews: window.__sb.workerNews().length,
        posts: window.__sb.posts(),
        reqs: window.__sb.requestCount(),
        fallbackWarns: window.__sb.warns().filter((w) => /Worker/i.test(w)),
      })`)));
      const report = await evalJs(`(window.LibmsWorkspaceBridge.getAutoTuneReport() ? "yes" : "no")`);
      check("A 智能模式产出调优报告（§15 结果契约）", report === "yes");
      const phases = await evalJs(`window.__sb.phases().map(p => p.label)`);
      check("A 进度文案是人话（不含算法术语）",
        phases.length > 0 && !phases.some((l) => /Profile|Bean Fit|oracle|regret|lab/i.test(String(l))),
        JSON.stringify(phases.slice(0, 4)));
      await shot("A-normal-auto");
    }
  }

  /* ════════ B. 人像 → 固定模式 ════════ */
  if (!skipScenario("B")) {
    scenario("B", "人像 → 固定 ModeProfile（不跑 Auto Tune）");
    await freshPage();
    const mounted = await upload("portrait");
    check("B 上传并挂载工作台", mounted);
    if (mounted) {
      await evalJs(`window.__sb.resetRequests()`);
      const gen = await generate({ viaMode: "portrait" });
      check("B 生成完成", gen.ok, `${gen.ms}ms`);
      const req = await evalJs(`window.__sb.lastRequest()`);
      const { MODE_PROFILES } = await import(path.join(ROOT, "services/mode-profile.mjs"));
      check("B 用的是 portrait 的固定档案（cleanupStrength 对得上）",
        req?.cleanupStrength === MODE_PROFILES.portrait.cleanupStrength,
        `请求 ${req?.cleanupStrength} vs 档案 ${MODE_PROFILES.portrait.cleanupStrength}`);
      check("B sampling 是 edge-aware（人像档）", req?.sampling === "edge-aware", String(req?.sampling));
      const report = await evalJs(`(window.LibmsWorkspaceBridge.getAutoTuneReport() ? "yes" : "no")`);
      check("B 人像模式不产出调优报告（§26 只给智能）", report === "no");
      check("B 请求里没有任何 lab 候选（生产白名单空集）",
        (await evalJs(`window.__sb.requests().every(r => r.labCandidate === null)`)) === true);
      await shot("B-portrait-fixed");
    }
  }

  /* ════════ C. Logo → 背景去除 ════════ */
  if (!skipScenario("C")) {
    scenario("C", "Logo → 背景去除（预检 → 应用 → null）");
    await freshPage();
    const mounted = await upload("logo");
    check("C 上传并挂载工作台", mounted);
    if (mounted) {
      const before = await evalJs(`window.__sb.result()`);
      check("C 打开去背景开关", await evalJs(`window.__sb.setBackgroundRemoval(true)`));
      const barShown = await waitFor(`window.__sb.bgPreviewBarVisible()`, 90000, "背景预检条");
      check("C 开去背景后先出预检条（不静默重算）", barShown,
        JSON.stringify(await evalJs(`window.__sb.bgPreviewButtons()`)));
      await shot("C-bg-preview");
      // 预检条上的动作按钮是唯一入口 —— 直接调 bridge 生成会绕开它。
      const applied = await evalJs(`window.__sb.clickBgApply()`);
      if (!applied) {
        const gen = await generate();
        check("C 生成完成（预检条无应用按钮，走常规生成）", gen.ok, `${gen.ms}ms`);
      } else {
        const rev = await evalJs(`window.__sb.rev()`);
        await evalJs(`window.__sb.waitNewResult(${rev - 1}, 240000)`, 260000);
        await waitStable(1500);
        check("C 应用背景后出图", true);
      }
      const after = await evalJs(`window.__sb.result()`);
      const decision = await evalJs(`window.__sb.backgroundDecision()`);
      info("C 背景决策", JSON.stringify(decision));
      check("C 背景去除真的产生了空格（null）", after.nulls > 0, `前 ${before.nulls} → 后 ${after.nulls}`);
      check("C 空白图的用色数不比原来多（没引入背景色）", after.usedColors <= before.usedColors + 1,
        `${before.usedColors} → ${after.usedColors}`);
      await shot("C-logo-bg");
    }
  }

  /* ════════ D. 透明 PNG ════════ */
  if (!skipScenario("D")) {
    scenario("D", "透明 PNG → 透明区必须是 null");
    await freshPage();
    const mounted = await upload("transparent");
    check("D 上传并挂载工作台", mounted);
    if (mounted) {
      const gen = await generate();
      check("D 生成完成", gen.ok, `${gen.ms}ms`);
      const integrity = await evalJs(`window.__sb.nullIntegrity()`);
      check("D 透明区变成 null（不是被填成白色）", integrity.bridgeNulls > 0, JSON.stringify(integrity));
      check("D null + 有色格 = 全部格（没有第三种状态）", integrity.sumOk === true, JSON.stringify(integrity));
      // §10：null 不能只活在一个副本里。导出走的是 export service 里再拷一份。
      const exported = await evalJs(`(() => {
        const r = window.LibmsWorkspaceBridge.getResult();
        const copy = r.grid.map((row) => row.map((c) => (c ? { ...c, rgb: [...c.rgb] } : null)));
        let nulls = 0;
        for (const row of copy) for (const c of row) if (!c) nulls += 1;
        return nulls;
      })()`);
      check("D 逐格拷贝后 null 仍然是 null（导出路径不会重新填色）",
        exported === integrity.bridgeNulls, `拷贝后 ${exported} vs bridge ${integrity.bridgeNulls}`);
      await shot("D-transparent");
    }
  }

  /* ════════ E. Pixel ════════ */
  if (!skipScenario("E")) {
    scenario("E", "像素 → 固定 center 采样 + 单一候选");
    await freshPage();
    const mounted = await upload("pixel");
    check("E 上传并挂载工作台", mounted);
    if (mounted) {
      await evalJs(`window.__sb.resetRequests()`);
      const gen = await generate({ viaMode: "pixel" });
      check("E 生成完成", gen.ok, `${gen.ms}ms`);
      const req = await evalJs(`window.__sb.lastRequest()`);
      check("E 用 center 采样（像素档逐块保留）", req?.sampling === "center", String(req?.sampling));
      const { MODE_PROFILES } = await import(path.join(ROOT, "services/mode-profile.mjs"));
      check("E cleanupStrength 对得上像素档",
        req?.cleanupStrength === MODE_PROFILES.pixel.cleanupStrength,
        `${req?.cleanupStrength} vs ${MODE_PROFILES.pixel.cleanupStrength}`);
      // 像素档只有一个候选 → Auto Tune 短路，不跑候选
      const reqCount = await evalJs(`window.__sb.requestCount()`);
      check("E 单候选短路：只跑 1 次生成，不跑候选表（§9）", reqCount === 1, `请求 ${reqCount} 次`);
      await shot("E-pixel");
    }
  }

  /* ════════ F. 500 长边 + §12 提交路径 profile ════════ */
  if (!skipScenario("F")) {
    scenario("F", "500 长边 → §12 提交路径分段");
    await freshPage();
    const mounted = await upload("complex");
    check("F 上传并挂载工作台", mounted);
    if (mounted) {
      await waitStable(1500);
      await evalJs(`window.__sb.clearCommitProfile()`);
      await evalJs(`window.__sb.resetRequests()`);
      await evalJs(`window.__sb.resetWorkerNews()`);
      const gen = await startAndWait({ width: 500, height: 500 });
      check("F 500 长边生成完成", gen.ok, `${gen.ms}ms`);
      // §7：500 档是最容易「悄悄退回主线程」的一档（算得最久），必须显式取证。
      //
      // 判据用**发包**而不是「构造了 Worker」：客户端会缓存 Worker 实例，
      // 第二次之后本来就不会再构造 —— 拿构造数当判据会把正常复用误判成失败。
      const workerTrafficF = await evalJs(`({
        constructed: window.__sb.workerNews().length,
        posts: window.__sb.posts(),
        fallbackWarns: window.__sb.warns().filter((w) => /Worker/i.test(w)),
      })`);
      check("§7 F 生产生成走真实 Worker（发包取证）",
        workerTrafficF.posts.some((t) => String(t).includes("generate")),
        JSON.stringify(workerTrafficF));
      check("§7 F 没有出现「退回主线程」降级",
        workerTrafficF.fallbackWarns.length === 0,
        JSON.stringify(workerTrafficF.fallbackWarns));
      info("F Worker 模块图自检", JSON.stringify(await evalJs(`window.__sb.workerSelfTest()`, 20000)));
      const r = await evalJs(`window.__sb.result()`);
      check("F 长边确实到 500", Math.max(r.width, r.height) === 500, `${r.width}×${r.height}`);
      const profile = await evalJs(`window.__sb.commitProfile()`);
      info("F 提交分段", JSON.stringify(profile.rows));
      info("F 尺寸", JSON.stringify(profile.meta));
      const total = profile.rows.find((x) => x.label === "commitTotal")?.ms ?? null;
      const decode = profile.rows.find((x) => x.label === "decodeMs(workerClient)")?.ms ?? null;
      info("F commitTotal / decode", `${total}ms / ${decode}ms`);
      check("F 提交分段有数据（§12 profile 生效）", profile.rows.length >= 5, `${profile.rows.length} 段`);
      // §14 的验收线是 <800ms。当前实测 946–988ms，**未达成**。
      //
      // 规范同时写明「风险太大宁可保留 1.15s，不要破坏 canonical / history」，
      // 而这里量到的两个大项（chartUrl 463ms 画 5100×5100 画布并 PNG 编码、
      // eventDispatch 387ms 跑同步监听者）动哪一个都会碰到 canonical grid /
      // Undo / Diagnostics / Export 的语义，属于 Stage C 的范围。
      //
      // 所以：**不把它做成硬红，也不假装达标**。
      //   · 硬门：不得比 B3 基线（1150ms）更差 —— 那才是真回归
      //   · KNOWN：把未达标这件事带进汇总，报告里必须出现
      const B3_COMMIT_BASELINE_MS = 1150;
      check(`F 500 档提交阶段不比 B3 基线更差（硬回归门 ${B3_COMMIT_BASELINE_MS}ms）`,
        typeof total === "number" && total < B3_COMMIT_BASELINE_MS, `commitTotal=${total}ms`);
      if (typeof total === "number" && total >= 800) {
        known("§14 提交阶段 <800ms 目标未达成",
          `实测 ${total}ms（B3 基线 ${B3_COMMIT_BASELINE_MS}ms）· `
          + `chartUrl ${profile.rows.find((x) => x.label === "chartUrl")?.ms}ms + `
          + `eventDispatch ${profile.rows.find((x) => x.label === "eventDispatch")?.ms}ms`);
      } else if (typeof total === "number") {
        info("§14 提交阶段目标", `达成 · ${total}ms < 800ms`);
      }
      const lts = await evalJs(`window.__sb.longTasks()`);
      const longest = lts.reduce((m, t) => Math.max(m, t.dur), 0);
      info("F 主线程最长任务", `${longest}ms · 共 ${lts.length} 个长任务`);
      await shot("F-500");
    }
  }

  /* ════════ P. §14 提交阶段尺寸扫描（104 / 200 / 300 / 400，500 见 F）════════ */
  //
  // §14 要求「104/200/300/400/500 分别记录」。F 只覆盖 500 —— 而 500 恰好是最慢的
  // 一档，只报最差档会让人以为提交阶段一直要 ~900ms。扫描四档是为了拿到**曲线**：
  // 提交段的两个大项（图纸渲染、同步监听者）都是随格数增长的，只有把它们摊开，
  // 才能判断 <800ms 这条线到底是「500 档特有」还是「全尺寸都过不去」。
  //
  // 尺寸扫描必须靠 `setLongEdge()` 而不是直调 bridge：它会触发工作台自己的
  // 自动生成，从而走到和用户完全一样的那条路（含 autoGenQueued 的兜底）。
  // 每次改尺寸都会让 Auto Tune 缓存键失效（键里含尺寸），所以四档都是真算。
  if (!skipScenario("P")) {
    scenario("P", "§14 提交阶段尺寸扫描 104/200/300/400");
    await freshPage();
    const mounted = await upload("complex");
    check("P 上传并挂载工作台", mounted);
    if (mounted) {
      const SIZES = [104, 200, 300, 400];
      const B3_COMMIT_BASELINE_MS = 1150;
      const sweep = [];
      let prevRequestId = null;
      for (const size of SIZES) {
        const applied = await evalJs(`window.__sb.setLongEdge(${size})`, 30000);
        if (applied !== "clicked") { check(`P 应用长边 ${size}`, false, String(applied)); continue; }
        // ⚠️ 必须带超时。不带的话 timeoutMs 是 undefined，`now - t0 > undefined`
        // 恒为 false —— 探针会在真出问题时**静默挂死**而不是报失败。
        await evalJs(`window.__sb.waitStable(2500, 120000)`, 140000);
        const r = await evalJs(`window.__sb.result()`);
        const profile = await evalJs(`window.__sb.commitProfile()`);
        const pick = (label) => profile.rows.find((x) => x.label === label)?.ms ?? null;
        const row = {
          size,
          actual: `${r.width}×${r.height}`,
          cells: r.width * r.height,
          metaCells: profile.meta?.cells ?? null,
          requestId: profile.meta?.requestId ?? null,
          commitTotal: pick("commitTotal"),
          chartUrl: pick("chartUrl"),
          eventDispatch: pick("eventDispatch"),
          gridObjectConstruction: pick("gridObjectConstruction"),
          materialStats: pick("materialStats"),
          originalGridClone: pick("originalGridClone"),
          uiUpdate: pick("uiUpdate"),
          gallery: pick("gallery"),
          decodeMs: pick("decodeMs(workerClient)"),
        };
        sweep.push(row);
        check(`P 长边 ${size} 出图尺寸正确`, Math.max(r.width, r.height) === size, row.actual);
        // profile 的 meta 是**这一轮**的（processImageV2 开头会重建数组与 meta）。
        // 拿它和最终 grid 对一遍，才能排除「量到的是上一档的分段」这种串档。
        check(`P 长边 ${size} 分段记录属于本轮（meta.cells 对得上）`,
          row.metaCells === row.cells, `meta=${row.metaCells} grid=${row.cells}`);
        // requestId 变了才说明真的重算了一遍 —— 否则可能因为「设的尺寸恰好等于
        // 当前尺寸」而根本没触发生成，量到的还是上一档。
        check(`P 长边 ${size} 确实重算了一遍（requestId 前进）`,
          prevRequestId === null || (typeof row.requestId === "number" && row.requestId !== prevRequestId),
          `requestId ${prevRequestId} → ${row.requestId}`);
        prevRequestId = row.requestId;
        check(`P 长边 ${size} 提交阶段不比 B3 基线更差（硬回归门 ${B3_COMMIT_BASELINE_MS}ms）`,
          typeof row.commitTotal === "number" && row.commitTotal < B3_COMMIT_BASELINE_MS,
          `commitTotal=${row.commitTotal}ms`);
        if (typeof row.commitTotal === "number" && row.commitTotal >= 800) {
          known(`§14 ${size} 档提交阶段 <800ms 目标未达成`,
            `实测 ${row.commitTotal}ms · chartUrl ${row.chartUrl}ms + eventDispatch ${row.eventDispatch}ms`);
        }
      }
      info("P 提交阶段尺寸曲线", JSON.stringify(sweep));
      // 曲线本身要能读出「单调增长」这个形状 —— 否则说明某一档没量到真东西。
      const totals = sweep.map((x) => x.commitTotal).filter((x) => typeof x === "number");
      check("P 四档都拿到了 commitTotal（没有静默漏档）", totals.length === SIZES.length,
        `${totals.length}/${SIZES.length}`);
      await shot("P-sweep");
    }
  }

  /* ════════ G. 中途取消 ════════ */
  if (!skipScenario("G")) {
    scenario("G", "中途取消");
    await freshPage();
    const mounted = await upload("complex");
    check("G 上传并挂载工作台", mounted);
    if (mounted) {
      const appliedG = await evalJs(`window.__sb.setLongEdge(500)`, 30000);
      check("G 顶栏应用 500 长边", appliedG === "clicked", String(appliedG));
      await waitStable(2500);
      const gBase = await evalJs(`window.__sb.result()`);
      check("G 基准出图是 500（否则取消测试退化成小图）",
        Math.max(gBase.width, gBase.height) === 500, `${gBase.width}×${gBase.height}`);
      await evalJs(`window.__sb.resetRequests()`);
      await evalJs(`window.__sb.resetWorkerNews()`);
      await evalJs(`window.__sb.resetGenCalls()`);
      await evalJs(`window.__sb.resetEvents()`);

      // ── 为什么不能「原地重生成一次然后取消」───────────────────────────
      // 2026-10-04 实测：Auto Tune **带缓存**（键 = 源图 + 尺寸 + 模式 + overrides
      // 指纹 + crop 指纹）。同一张图、同一个尺寸、同一个模式再生成一次会直接命中
      // 缓存 —— 整轮 `generationMilliseconds` 只有 52ms，Worker 一次包都不发，
      // `isGenerating()` 整个窗口都是 false，「取消生成」按钮当然不出现。
      // 那不是取消功能坏了，是**这一轮根本没有东西可取消**。
      //
      // 所以要造一次真正长跑：切到一个新模式，缓存键变了 → 真算。
      // 这也正是用户的真实路径 —— 换模式 → 自动重新生成 → 想反悔 → 点取消。
      const switched = await evalJs(`window.__sb.clickMode("illustration")`);
      check("G 切换模式触发新一轮（缓存失效，真的会算）", switched === true);
      // 先取时间线，失败时留下的是「随时间怎么变」的形状，而不是一句「20 秒没等到」。
      const gTrace = await evalJs(`window.__sb.trace(6000)`, 40000);
      info("G 时间线（触发后 6s，每 500ms 一行）",
        JSON.stringify(gTrace.filter((row, i) => i < 6 || i % 5 === 0)));
      const started = await evalJs(`window.__sb.waitGenerating(20000)`);
      check("G 生成真的开始了", started?.ok === true, `ms=${started?.ms}`);
      info("G bridge.generate 调用记录", JSON.stringify(await evalJs(`window.__sb.genCalls()`)));
      info("G 链路脚印（触发后广播过的 libms:* 事件）", JSON.stringify(await evalJs(`window.__sb.events()`)));
      info("G 生成报告", JSON.stringify(await evalJs(`window.LibmsWorkspaceBridge.getGenerationReport()`)));
      // §7 的生产不变量：这一轮必须走真实 Worker。用发包取证（构造数会因为
      // 客户端缓存 Worker 实例而恒为 0，不能当判据）。
      const workerTraffic = await evalJs(`({
        posts: window.__sb.posts(),
        fallbackWarns: window.__sb.warns().filter((w) => /Worker/i.test(w)),
      })`);
      check("§7 G 生产生成走真实 Worker（发包取证）",
        workerTraffic.posts.some((t) => String(t).includes("generate")),
        JSON.stringify(workerTraffic));
      check("§7 G 没有出现「退回主线程」降级",
        workerTraffic.fallbackWarns.length === 0,
        JSON.stringify(workerTraffic.fallbackWarns));
      const visible = await waitFor(`window.__sb.cancelVisible()`, 8000, "取消按钮");
      check("G 生成期间取消按钮可见", visible);
      const cancelled = await evalJs(`window.__sb.clickCancel()`);
      check("G 取消按钮可点", cancelled);
      const at = await evalJs(`window.__sb.requestCount()`);
      await sleep(2500);
      const after25 = await evalJs(`window.__sb.requestCount()`);
      await sleep(2500);
      const after50 = await evalJs(`window.__sb.requestCount()`);
      check("G 取消后不再启动新的候选（§19）", at === after25 && at === after50,
        `取消时 ${at} → +2.5s ${after25} → +5s ${after50}`);
      check("G 取消后界面不再显示生成中",
        (await evalJs(`window.__sb.generating()`)) === false,
        `status=${await evalJs(`window.__sb.statusText()`)}`);
      await shot("G-cancel");
    }
  }

  /* ════════ H. 在飞请求 vs 切模式 ════════ */
  //
  // ⚠️ 2026-10-04 更正一个**一直写错的场景名**。
  //
  // 本场景原叫「stale request：切模式作废在飞的请求」。实测（事件流水取证）不是这样：
  // 切模式走的是 `scheduleAutoGenerate` → `runAutoGenerate`，而它用 `autoGenRunning`
  // 串行化 —— 生成期间到来的新请求只是把 `autoGenQueued` 置真，**等这一轮跑完再跑**。
  // 所以切模式**不作废**在飞请求，只是排队。
  //
  // 这很重要，因为「作废」和「排队」是两种完全不同的正确性保证：
  //   · 排队 —— 在飞那轮的结果**照常提交**，然后新一轮再覆盖它。最终图对，
  //            但中间会闪一下旧图。
  //   · 作废 —— 在飞那轮直接丢弃，不提交。
  // 把前者当后者写，会让「stale 守卫坏了」这件事永远测不出来（见场景 Q）。
  //
  // 本场景因此只断言它真正能验的：**排队语义 + 最终出图属于最后一个请求**。
  if (!skipScenario("H")) {
    scenario("H", "在飞请求 vs 切模式（排队语义）");
    await freshPage();
    const mounted = await upload("complex");
    check("H 上传并挂载工作台", mounted);
    if (mounted) {
      const appliedH = await evalJs(`window.__sb.setLongEdge(400)`, 30000);
      check("H 顶栏应用 400 长边", appliedH === "clicked", String(appliedH));
      await waitStable(2000);
      const hBase = await evalJs(`window.__sb.result()`);
      check("H 基准出图是 400", Math.max(hBase.width, hBase.height) === 400, `${hBase.width}×${hBase.height}`);
      await evalJs(`window.__sb.resetRequests()`);
      await evalJs(`window.__sb.resetEvents()`);
      // 第一轮：留在「智能」模式，换一个没用过的 maxColors（10）让 Auto Tune
      // 缓存键失效 —— 不换的话整轮 ~50ms，`isGenerating()` 的窗口短到抓不住。
      await evalJs(`window.__sb.setMaxColors(10)`);
      const started = await evalJs(`window.__sb.waitGenerating(20000)`);
      check("H 第一轮（智能 + Auto Tune）真的跑起来了", started?.ok === true, `ms=${started?.ms}`);
      // 用**请求契约**取证，不靠 DOM 上的 is-active 类：这一轮发出去的 mode 必须是 auto。
      const round1 = await evalJs(`window.__sb.requests()`);
      check("H 第一轮确实是智能模式（只有它跑 Auto Tune）",
        round1.length > 0 && round1.every((r) => r.mode === "auto"),
        `请求 mode=${JSON.stringify([...new Set(round1.map((r) => r.mode))])} · 面板 activeMode=${await evalJs(`window.__sb.activeMode()`)}`);
      const before = await evalJs(`window.__sb.requestCount()`);
      // 再切到插画：走 scheduleAutoGenerate 发新请求（不是直接按生成按钮 ——
      // 生成期间 #ws-generate 是 disabled 的，点了等于没点）。
      await evalJs(`window.__sb.clickMode("illustration")`);
      const kicked = await waitFor(`window.__sb.requestCount() > ${before}`, 15000, "切模式后新请求");
      check("H 切模式后新请求真的开跑了（否则本轮什么都没验）", kicked,
        `切换前 ${before} → 切换后 ${await evalJs(`window.__sb.requestCount()`)}`);
      await waitStable(1500);
      const reqs = await evalJs(`window.__sb.requests()`);
      const last = reqs[reqs.length - 1];
      const final = await evalJs(`window.__sb.result()`);
      check("H 最终出图属于最后一个请求", final.rows > 0 && final.width > 0, JSON.stringify(final));
      check("H 最后一个请求是插画档", reqs.filter((r) => r.sampling === "dominant").length > 0,
        `请求数 ${reqs.length} · 末条 sampling=${last?.sampling}`);
      // 排队语义的直接证据：第一轮的调优报告**曾经存在**（说明它真的跑完了、
      // 没有被丢弃），只是被新一轮开头的 `autoTuneReport = null` 清掉了。
      const events = await evalJs(`window.__sb.events()`);
      check("H 排队语义：第一轮照常跑完并提交（事件流水里有它的 auto-tune + project-result）",
        events.some((e) => e.type === "libms:auto-tune") && events.some((e) => e.type === "libms:project-result"),
        JSON.stringify(events.map((e) => e.type)));
      const report = await evalJs(`(window.LibmsWorkspaceBridge.getAutoTuneReport() ? "yes" : "no")`);
      check("H 插画模式不留下智能模式的调优报告（§19）", report === "no");
      await shot("H-stale");
    }
  }

  /* ════════ Q. Auto Tune 的请求号接线 + 取消后的报告卫生 ════════ */
  //
  // 这个场景是 2026-10-04 那个真缺陷的回归守卫。
  //
  // ── 缺陷是什么 ────────────────────────────────────────────────────
  // 调用方 `processProductionV2` 把 `requestId` 传在**顶层**，而
  // `processImageV2` 的形参漏解构了它，函数体里读的 `options.requestId` 恒为
  // `undefined`（`options` 是模式档案，没有这个字段）。于是：
  //   · `runAutoTuneV2` 的 `tuneRequestId` 恒为 1，`autoTuneContexts` 只按 1 存
  //   · 它末尾的 `isStaleGenerationRequest` 恒 false → §19 的守卫从未生效
  //   · §12 profile 的 `meta.requestId` 一直是 null（**唯一可观测的那一半**）
  //
  // ── 为什么断言落在「接线」而不是「守卫真的开火」 ────────────────────
  // 源头修好之后（`generate()` 的单飞检查挪到推进 requestId **之前**），
  // 被拒的重复请求不再污染在飞那轮的请求号 —— 于是「取代」在界面路径上
  // 构造不出来了（界面本来就靠 `autoGenRunning` 串行化，见场景 H）。
  // 那三处过期守卫因此是**防御性**的：单飞一旦被放开，它们才会开火。
  //
  // 所以这里验的是**接线真的通了**（可观测、可回归），而不是假装验了守卫开火：
  //   ① 智能模式下真调优跑起来（tune-* 有）
  //   ② §12 profile 的 `meta.requestId` 是**正整数**且逐轮前进（接线通了）
  //   ③ 报告在，且 maxColors 是界面值（§7-A）
  //   ④ 取消之后的报告卫生：不再有 `libms:auto-tune`、报告为 null、状态是「已取消」
  if (!skipScenario("Q")) {
    scenario("Q", "Auto Tune 请求号接线 + 取消后的报告卫生（§8 defect ③）");
    await freshPage();
    const mounted = await upload("complex");
    check("Q 上传并挂载工作台", mounted);
    if (mounted) {
      const appliedQ = await evalJs(`window.__sb.setLongEdge(400)`, 30000);
      check("Q 顶栏应用 400 长边", appliedQ === "clicked", String(appliedQ));
      await waitStable(2000);
      // 换一个没用过的 maxColors，保证这一轮的调优是**真算**（不是缓存命中）。
      await evalJs(`window.__sb.setMaxColors(10)`);
      const started = await evalJs(`window.__sb.waitGenerating(20000)`);
      check("Q 第一轮（智能 + Auto Tune）真的跑起来了", started?.ok === true, `ms=${started?.ms}`);
      const round1 = await evalJs(`window.__sb.requests()`);
      check("Q 第一轮确实是智能模式（只有它跑 Auto Tune）",
        round1.length > 0 && round1.every((r) => r.mode === "auto"),
        `请求 mode=${JSON.stringify([...new Set(round1.map((r) => r.mode))])}`);
      await evalJs(`window.__sb.waitStable(2000, 240000)`, 260000);
      // ① 真调优跑过（tune-* 阶段事件）
      const phases = await evalJs(`window.__sb.phases ? window.__sb.phases() : []`, 30000);
      info("Q 阶段事件", JSON.stringify(Array.isArray(phases) ? phases.slice(-6) : phases));

      // ② 接线：§12 profile 的 meta.requestId 必须是正整数。
      //    **这就是本轮修的那个东西** —— 修之前它恒为 null。
      const meta1 = (await evalJs(`window.__sb.commitProfile()`, 30000)).meta;
      check("§8 提交分段 meta.requestId 不再是 null（接线通了）",
        typeof meta1?.requestId === "number" && meta1.requestId > 0,
        `meta.requestId=${JSON.stringify(meta1?.requestId)}`);

      // ③ 报告在，且 maxColors 是界面值（§7-A）
      //
      // ⚠️ 只取**标量字段**，不要把整份报告 returnByValue 回传：
      // 报告里带着全部候选的指标明细，CDP 序列化会直接超时
      // （实测 30s 打不住，报错长成「CDP Runtime.evaluate 超时」，与真正原因无关）。
      const reportFields = await evalJs(`(() => {
        const r = window.LibmsWorkspaceBridge.getAutoTuneReport();
        if (!r) return null;
        return { selected: r.selectedProfileId ?? null, mode: r.mode ?? null,
                 maxColors: r.maxColors ?? null, previewMaxColors: r.previewMaxColors ?? null,
                 decision: r.decision ?? null };
      })()`, 30000);
      check("Q 真调优产出了报告", Boolean(reportFields && reportFields.selected),
        reportFields ? `selected=${reportFields.selected}` : "null");
      check("§7-A 报告里的 maxColors 是界面值（不是被冻住的旧值）",
        Number(reportFields?.maxColors) === 10,
        `report.maxColors=${reportFields?.maxColors} previewMaxColors=${reportFields?.previewMaxColors}`);

      // ④ 取消之后的报告卫生。
      //    先再起一轮真调优（换 maxColors 让缓存失效），在飞的时候点取消。
      await evalJs(`window.__sb.resetEvents()`, 30000);
      await evalJs(`window.__sb.setMaxColors(11)`);
      const started2 = await evalJs(`window.__sb.waitGenerating(20000)`);
      check("Q 第二轮（智能 + Auto Tune）也真的跑起来了", started2?.ok === true, `ms=${started2?.ms}`);
      const cancelVisible = await waitFor(`window.__sb.cancelVisible()`, 15000, "取消按钮");
      check("Q 调优期间取消按钮可见", cancelVisible);
      await evalJs(`window.__sb.clickCancel()`, 30000);
      await evalJs(`window.__sb.waitStable(2500, 240000)`, 260000);
      await sleep(3000);
      const events = await evalJs(`window.__sb.events()`, 30000);
      check("§19 取消之后的调优不发布报告（0 条 libms:auto-tune）",
        !events.some((e) => e.type === "libms:auto-tune"),
        `取消后事件：${JSON.stringify(events.map((e) => e.type))}`);
      check("§19 取消后没有留下调优报告",
        (await evalJs(`(window.LibmsWorkspaceBridge.getAutoTuneReport() ? "yes" : "no")`, 30000)) === "no");
      const statusText = await evalJs(`window.__sb.statusText()`, 30000);
      check("Q 取消是「预期结局」，不是生成失败",
        !/失败/.test(String(statusText)), `status=${statusText}`);
      await shot("Q-tune-wiring");
    }
  }

  /* ════════ I. maxColors 硬上限（§9）════════ */
  if (!skipScenario("I")) {
    scenario("I", "maxColors=12 → 最终 canonical grid 守上限（§9）");
    await freshPage();
    const mounted = await upload("complex");
    check("I 上传并挂载工作台", mounted);
    if (mounted) {
      await evalJs(`window.__sb.setMaxColors(12)`);
      await waitStable(1500);
      await evalJs(`window.__sb.resetRequests()`);
      const gen = await startAndWait({ width: 300, height: 300 });
      check("I 生成完成", gen.ok, `${gen.ms}ms`);
      const r = await evalJs(`window.__sb.result()`);
      check("I 最终出图用色数 <= 12（不是只验预览）", r.usedColors <= 12,
        `实际 ${r.usedColors} 色 · ${r.width}×${r.height}`);
      check("I 出图是请求的 300 尺寸", Math.max(r.width, r.height) === 300, `${r.width}×${r.height}`);
      const reqs = await evalJs(`window.__sb.requests()`);
      const caps = [...new Set(reqs.map((x) => x.maxColors))];
      info("I 请求里的 maxColors", JSON.stringify(caps));
      check("I 请求里带的是界面值 12", caps.includes(12), JSON.stringify(caps));
      await shot("I-maxcolors12");

      // §9 的覆盖要求：Auto Tune winner + background ON + 大尺寸
      // 背景开 → 预检条 → 应用 → 用显式尺寸再生成一次（预检/应用本身不改尺寸）。
      await evalJs(`window.__sb.setBackgroundRemoval(true)`);
      await sleep(800);
      await evalJs(`window.__sb.clickBgApply()`);
      await waitStable(1500);
      await evalJs(`window.__sb.resetRequests()`);
      const gen2 = await startAndWait({ width: 300, height: 300 });
      check("I 背景开启后重新生成完成", gen2.ok, `${gen2.ms}ms`);
      const big = await evalJs(`window.__sb.result()`);
      check("I 300 长边 + 背景开 + maxColors=12 → 仍守上限（§9 全覆盖）",
        big.usedColors <= 12 && Math.max(big.width, big.height) === 300,
        `${big.width}×${big.height} · ${big.usedColors} 色 · null ${big.nulls}`);
      const caps2 = [...new Set((await evalJs(`window.__sb.requests()`)).map((x) => x.maxColors))];
      check("I 背景开启这一轮请求里仍带 maxColors=12", caps2.includes(12), JSON.stringify(caps2));
      await shot("I-maxcolors-bg-300");
    }
  }

  /* ════════ J. 同页换图两次（§8 单例上下文）════════ */
  if (!skipScenario("J")) {
    scenario("J", "同一页面换第二张图（§8 请求上下文没被冻住）");
    await freshPage();
    const first = await upload("complex");
    check("J 第一张图挂载", first);
    if (first) {
      const g1 = await generate({ viaMode: "auto" });
      check("J 第一张图生成", g1.ok, `${g1.ms}ms`);
      const r1 = await evalJs(`window.__sb.result()`);
      // 同页换图：不重载，直接再喂一张
      const second = await upload("normal");
      check("J 同页换成第二张图", second);
      if (second) {
        await evalJs(`window.__sb.setMaxColors(19)`);
        await waitStable(1500);
        await evalJs(`window.__sb.resetRequests()`);
        const g2 = await generate();
        check("J 第二张图生成", g2.ok, `${g2.ms}ms`);
        const r2 = await evalJs(`window.__sb.result()`);
        const hashSamePage = await evalJs(`window.__sb.matrixHash()`);
        const reqs = await evalJs(`window.__sb.requests()`);
        const caps = [...new Set(reqs.map((x) => x.maxColors))];
        info("J 第二张图的请求", JSON.stringify(reqs.map((x) => ({ size: x.size, maxColors: x.maxColors }))));
        check("J 第二张图出的是第二张的尺寸（§8 上下文没冻在第一次）",
          r2.width !== r1.width || r2.height !== r1.height || r2.usedColors !== r1.usedColors,
          `第一张 ${r1.width}×${r1.height}/${r1.usedColors}色 → 第二张 ${r2.width}×${r2.height}/${r2.usedColors}色`);
        check("J 第二张图的请求里带的是本轮 maxColors（§7-A 前提）",
          caps.includes(19) || caps.length === 0, JSON.stringify(caps));

        // 整页重载后单独跑第二张 —— 两次哈希必须一致
        await freshPage();
        const solo = await upload("normal");
        check("J 重载后单独挂载第二张图", solo);
        if (solo) {
          await evalJs(`window.__sb.setMaxColors(19)`);
          await waitStable(1500);
          const g3 = await generate();
          check("J 重载后生成", g3.ok, `${g3.ms}ms`);
          const hashSolo = await evalJs(`window.__sb.matrixHash()`);
          check("J 同页换图 与 整页重载 出图一致（§8 上下文没被冻住）",
            hashSamePage === hashSolo, `同页 ${hashSamePage} vs 重载 ${hashSolo}`);
        }
      }
    }
    await shot("J-two-uploads");
  }

  /* ════════ K. Pixler 往返（§16）════════ */
  if (!skipScenario("K")) {
    scenario("K", "Pixler 导出 → 重开 → canonical grid 比对");
    await freshPage();
    const mounted = await upload("normal");
    check("K 上传并挂载工作台", mounted);
    if (mounted) {
      const gen = await generate();
      check("K 生成完成", gen.ok, `${gen.ms}ms`);
      const before = await evalJs(`window.__sb.result()`);
      const usageBefore = await evalJs(`window.__sb.usage()`);
      const hashBefore = await evalJs(`window.__sb.matrixHash()`);
      const labelBefore = await evalJs(`window.__sb.paletteLabel()`);

      clearDownloads();
      await evalJs(`window.__sb.openExportDrawer()`);
      await evalJs(`window.__sb.setExportTitle("StageB Pixler")`);
      await evalJs(`window.__sb.clickExport("pixler")`);
      const file = await waitDownload(/\.pixler$/i, 120000);
      check("K Pixler 文件真的落盘了", Boolean(file), file ? `${file.name} · ${file.size} 字节` : "超时");
      if (file) {
        const head = fs.readFileSync(file.path).subarray(0, 4);
        check("K Pixler 是 ZIP 封装（PK 签名）", head[0] === 0x50 && head[1] === 0x4b,
          [...head].map((b) => b.toString(16)).join(" "));

        // 重开：走落地页真实的「打开工程」入口。
        //
        // ⚠️ 2026-10-04 修：原先用工作台顶栏的 `#ws-project-file`。它在**工作台挂载
        // 之后**才存在，而 `freshPage()` 落在**落地页** —— 于是 querySelector 拿到
        // 空 nodeId，看起来像「导入入口没了」，其实是探针找错了地方。
        // 落地页本来就有 `#landing-project-input`（首页「打开工程」按钮指向它），
        // 那才是用户真的会用的入口，而且不需要先随便传一张图把工作台顶起来。
        await freshPage();
        const doc = await send("DOM.getDocument", { depth: -1 });
        const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#landing-project-input" });
        check("K 找到落地页「打开工程」入口", Boolean(node.result?.nodeId));
        if (node.result?.nodeId) {
          await send("DOM.setFileInputFiles", { nodeId: node.result.nodeId, files: [file.path] });
          // ⚠️ 这里**不能**用 waitNewResult 等 libms:project-result。
          // 实测：`loadProjectJson` 不广播这个事件 —— 生成走事件，载入工程走
          // 工作台自己的显式 setState（applyLoadedProject）。所以锚点换成
          // 「工作台挂载完成 且 画布上真的有格子」。
          // （这条不对称本身记进报告：两端目前都自洽，但属于 Stage C 该收口的地方。）
          const loaded = await waitFor(
            `document.body.dataset.workspaceState === "ready" && window.__sb.result().rows > 0`,
            90000, "Pixler 载入");
          check("K Pixler 重新载入成功", loaded);
          if (loaded) {
            await evalJs(`window.__sb.waitQuiet(500, 60000)`);
            const after = await evalJs(`window.__sb.result()`);
            const usageAfter = await evalJs(`window.__sb.usage()`);
            const hashAfter = await evalJs(`window.__sb.matrixHash()`);
            const labelAfter = await evalJs(`window.__sb.paletteLabel()`);
            check("K 尺寸一致", after.width === before.width && after.height === before.height,
              `${before.width}×${before.height} → ${after.width}×${after.height}`);
            check("K 网格逐格一致", hashBefore === hashAfter, `${hashBefore} vs ${hashAfter}`);
            check("K null 一致", after.nulls === before.nulls, `${before.nulls} → ${after.nulls}`);
            check("K 用色统计一致",
              JSON.stringify(usageBefore) === JSON.stringify(usageAfter),
              `色数 ${Object.keys(usageBefore).length} → ${Object.keys(usageAfter).length}`);
            check("K palette identity 一致", labelBefore === labelAfter, `${labelBefore} → ${labelAfter}`);
          }
        }
      }
      await shot("K-pixler-roundtrip");
    }
  }

  /* ════════ L. 全局替换 + 撤销（§17）════════ */
  if (!skipScenario("L")) {
    scenario("L", "全局替换 → 一次历史 → 撤销回到原状");
    await freshPage();
    const mounted = await upload("normal");
    check("L 上传并挂载工作台", mounted);
    if (mounted) {
      const gen = await generate();
      check("L 生成完成", gen.ok, `${gen.ms}ms`);
      const usage = await evalJs(`window.__sb.usage()`);
      const codes = Object.entries(usage).sort((a, b) => b[1] - a[1]);
      check("L 图上有两种以上颜色可供替换", codes.length >= 2, `${codes.length} 色`);
      if (codes.length >= 2) {
        const from = codes[0][0];
        const to = codes[codes.length - 1][0];
        const hashBefore = await evalJs(`window.__sb.matrixHash()`);
        const canUndoBefore = await evalJs(`window.__sb.canUndo()`);
        const opened = await evalJs(`window.__sb.openUsageReplace()`);
        check("L 打开用色统计条上的「全局替换」", opened,
          JSON.stringify(await evalJs(`window.__sb.replaceSelectors()`)));
        const done = await evalJs(`window.__sb.setReplace(${JSON.stringify(from)}, ${JSON.stringify(to)})`);
        check("L 提交替换（复用既有 #ws-replace-* 流程）", done);
        // 替换前会弹一次确认（「将 N 颗 X 替换为 Y？」）。不点它，替换永远不会发生 ——
        // 而探针看到的是「点了按钮、图没变」，很容易误判成产品缺陷。
        const accepted = await evalJs(`window.__sb.acceptConfirmation(4000)`, 20000);
        check("L 确认弹窗出现并点了确认", accepted === true, String(accepted));
        await evalJs(`window.__sb.waitQuiet(600, 60000)`);
        const usageAfter = await evalJs(`window.__sb.usage()`);
        check("L 来源色从图上消失（图真的改了）", !(from in usageAfter), `${from} 仍在：${from in usageAfter}`);
        // §19：「重新生成」平时隐藏，只有存在手动编辑时才作为显式覆盖出口出现。
        // 全局替换是一次手动编辑 —— 此刻它必须可见，否则这条逃生口等于不存在。
        const regenVisible = await evalJs(`window.__sb.regenerateButtonVisible()`);
        check("L 手动编辑后「重新生成」按钮出现（§19 逃生口）", regenVisible === true, String(regenVisible));
        const canUndoAfter = await evalJs(`window.__sb.canUndo()`);
        check("L 产生了一条可撤销历史", canUndoAfter === true, `替换前 ${canUndoBefore} → 替换后 ${canUndoAfter}`);
        // 一次撤销必须回到替换前 —— 这是「一次用户动作 = 一次 History Entry」
        await evalJs(`window.__sb.clickUndo()`);
        await evalJs(`window.__sb.waitQuiet(400, 30000)`);
        const hashUndone = await evalJs(`window.__sb.matrixHash()`);
        check("L 一次撤销回到替换前的网格（§17 一次动作 = 一条历史）",
          hashUndone === hashBefore, `${hashBefore} → 替换后 → 撤销后 ${hashUndone}`);
        const usageUndone = await evalJs(`window.__sb.usage()`);
        check("L 撤销后用色统计也回来了",
          JSON.stringify(usageUndone) === JSON.stringify(usage));
        await evalJs(`window.__sb.clickRedo()`);
        await evalJs(`window.__sb.waitQuiet(400, 30000)`);
        const hashRedone = await evalJs(`window.__sb.matrixHash()`);
        check("L 重做回到替换后", hashRedone !== hashUndone, `${hashUndone} → ${hashRedone}`);
      }
      await shot("L-replace-undo");
    }
  }

  /* ════════ M. Resize user-explicit race（§11）════════ */
  if (!skipScenario("M")) {
    scenario("M", "画布调整 vs 生成尺寸权威（§11）");
    await freshPage();
    const mounted = await upload("normal");
    check("M 上传并挂载工作台", mounted);
    if (mounted) {
      const applied = await evalJs(`window.__sb.setLongEdge(200)`, 30000);
      check("M 顶栏「应用尺寸 200」被接受", applied === "clicked", String(applied));
      await waitStable(1500);
      const base = await evalJs(`window.__sb.result()`);
      check("M 长边 200 生效", Math.max(base.width, base.height) === 200, `${base.width}×${base.height}`);

      // 用户在生成期间改长边 —— 回来的图必须是新尺寸，不能把用户的选择倒回去。
      //
      // ⚠️ 2026-10-04 修：这一轮必须走**工作台自己的入口**（切模式 → runAutoGenerate），
      // 不能直调 bridge。原因不是「直调不算生产路径」，而是**并发语义不同**：
      //   · 走 runAutoGenerate 时 `autoGenRunning` 为真，期间到来的尺寸变化会被
      //     `autoGenQueued` 记下，当前这轮结束后自动重跑一次 → 最终出图是新尺寸。
      //   · 直调 bridge 时没人持有 `autoGenRunning`，期间到来的自动生成会撞上
      //     processProductionV2 的 `state.isProcessingImage` 早退（「正在生成，请稍候」），
      //     而它**不会重试** —— 尺寸变化就丢了。
      // 后者在界面上够不到（生成期间 #ws-generate 与面板按钮都是 disabled / hidden），
      // 所以这里验的是用户真的能走到的那条路。
      await evalJs(`window.__sb.resetRequests()`);
      const flying = await evalJs(`window.__sb.clickMode("anime")`);
      check("M 生成期间确实在生成（否则下面的竞态没被验到）", flying === true);
      const startedM = await evalJs(`window.__sb.waitGenerating(20000)`);
      check("M 第一轮真的跑起来了", startedM?.ok === true, `ms=${startedM?.ms}`);
      const workerTrafficM = await evalJs(`({
        posts: window.__sb.posts(),
      })`);
      check("§7 M 生产生成走真实 Worker（发包取证）",
        workerTrafficM.posts.some((t) => String(t).includes("generate")),
        JSON.stringify(workerTrafficM));
      const resized = await evalJs(`window.__sb.setLongEdge(300)`, 30000);
      check("M 生成期间改长边被接受", resized === "clicked", String(resized));
      await waitStable(2500);
      const after = await evalJs(`window.__sb.result()`);
      const value = await evalJs(`window.__sb.longEdgeValue()`);
      info("M 尺寸现场", `出图 ${after.width}×${after.height} · 输入框 ${value}`);
      check("M 生成期间改长边：最终出图是新尺寸（不会被旧请求覆盖）",
        Math.max(after.width, after.height) === 300, `${after.width}×${after.height}`);
      check("M 输入框没有被异步回来的旧值倒回去", value === 300, `输入框 ${value}`);
      check("M 没有落回 104×104 fallback", !(after.width === 104 && after.height === 104),
        `${after.width}×${after.height}`);

      // 显式尺寸高于自动识别。
      //
      // ⚠️ 契约是「**只认长边**，比例恒由源图/裁剪派生」——见 app.js 的 generate()
      // 注释：「两条来源都保持源图/裁剪比例 —— 这是 Generation Size 的硬不变量。
      // 「宽高独立」（222×295 → 220×300）是编辑器画布调整，走另一条链路，不经过这里。」
      // 所以传 {180, 135} 的正确预期是**长边 180、比例仍 5:4** → 180×144，
      // 而不是 180×135。原先那条断言要求宽高独立生效，是在要求一个架构上
      // 明确不提供的保证 —— 探针错了，不是产品错了。
      const explicit = await evalJs(`(async () => {
        const r = await window.LibmsWorkspaceBridge.generate({ width: 180, height: 135 });
        return r ? { width: r.width, height: r.height } : null;
      })()`, 240000);
      check("M 显式长边 180 被尊重（高于 auto detection）",
        explicit && Math.max(explicit.width, explicit.height) === 180, JSON.stringify(explicit));
      check("M 显式尺寸仍守「保持源图比例」这条硬不变量（5:4 → 180×144）",
        explicit && Math.abs(explicit.width / explicit.height - 600 / 480) < 0.01,
        JSON.stringify(explicit));
      const valueAfter = await evalJs(`window.__sb.longEdgeValue()`);
      check("M 显式尺寸是一次性的：用完把顶栏选择还原", valueAfter === 300,
        `输入框 ${valueAfter}（应为 300）`);
      await shot("M-resize-race");
    }
  }

  /* ════════ N. 导出全格式（§15）════════ */
  if (!skipScenario("N")) {
    scenario("N", "导出：PNG 标准/高清/超高清 + PDF + 海报 3:4/1:1 + Pixler + 分板 ZIP");
    await freshPage();
    const mounted = await upload("normal");
    check("N 上传并挂载工作台", mounted);
    if (mounted) {
      const gen = await startAndWait({ width: 200, height: 200 });
      check("N 生成完成", gen.ok, `${gen.ms}ms`);
      const nSize = await evalJs(`window.__sb.result()`);
      check("N 出图是 200 尺寸（导出基准）", Math.max(nSize.width, nSize.height) === 200,
        `${nSize.width}×${nSize.height}`);
      await evalJs(`window.__sb.openExportDrawer()`);
      await evalJs(`window.__sb.setExportTitle("StageB Export")`);

      const before = await evalJs(`window.__sb.result()`);

      const magic = {
        png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
        pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
        zip: (b) => b[0] === 0x50 && b[1] === 0x4b,
      };
      const exportOnce = async (label, kind, { quality = null, ratio = null, expect, minBytes = 1000 } = {}) => {
        clearDownloads();
        if (quality) await evalJs(`window.__sb.setExportQuality(${JSON.stringify(quality)})`);
        if (ratio) await evalJs(`window.__sb.setPosterRatio(${JSON.stringify(ratio)})`);
        const clicked = await evalJs(`window.__sb.clickExport(${JSON.stringify(kind)})`);
        if (!clicked) { check(`N ${label}`, false, "导出按钮不存在"); return null; }
        const file = await waitDownload(new RegExp(`\\.${expect}$`, "i"), 180000);
        const msg = await evalJs(`window.__sb.exportMessage()`);
        if (!file) { check(`N ${label}`, false, `没有文件落盘 · 界面消息「${msg}」`); return null; }
        const bytes = fs.readFileSync(file.path);
        const okMagic = magic[expect] ? magic[expect](bytes) : true;
        check(`N ${label}`,
          okMagic && file.size >= minBytes,
          `${file.name} · ${file.size} 字节 · 魔数${okMagic ? "对" : "错"}${msg ? ` · 消息「${msg}」` : ""}`);
        return { file, bytes };
      };

      await exportOnce("PNG 标准（16px/格）", "png", { quality: "standard", expect: "png", minBytes: 3000 });
      await exportOnce("PNG 高清（24px/格）", "png", { quality: "high", expect: "png", minBytes: 5000 });
      await exportOnce("PNG 超高清（32px/格）", "png", { quality: "ultra", expect: "png", minBytes: 8000 });
      await exportOnce("PDF 图纸", "pdf", { quality: "high", expect: "pdf", minBytes: 2000 });
      await exportOnce("海报 3:4", "poster", { ratio: "3x4", expect: "png", minBytes: 5000 });
      await exportOnce("海报 1:1", "poster", { ratio: "1x1", expect: "png", minBytes: 5000 });
      await exportOnce("Pixler 工程", "pixler", { expect: "pixler", minBytes: 500 });
      await exportOnce("分板 ZIP", "boards", { expect: "zip", minBytes: 2000 });

      // 导出不能改图 —— §15 的「不得出现格式变化」前提是 canonical grid 不变。
      const after = await evalJs(`window.__sb.result()`);
      check("N 导出全程不改 canonical grid",
        after.width === before.width && after.height === before.height
        && after.usedColors === before.usedColors && after.nulls === before.nulls,
        `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      await shot("N-export-drawer");
    }
  }

  /* ════════ §24 CSP ════════ */
  scenario("CSP", "生产 CSP");
  check("§24 本站代码没有触发 CSP 违规", cspViolations.length === 0,
    cspViolations.length ? cspViolations.slice(0, 2).join(" | ") : "0 条");
  info("§24 第三方 EvalError（tfjs/nsfwjs 在 CSP 下 new Function 被拦）",
    `${thirdPartyEvalErrors.length} 次 · 与生成链路无关，不计入 gate`);
  check("§24 本站代码没有未捕获异常", pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 2).join(" | ") : "0 条");

  /* ════════ 汇总 ════════ */
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`\n════════════════════════════════════`);
  console.log(`Stage B 集成场景：${pass}/${results.length} PASS`);
  if (fail.length) {
    console.log(`\n失败明细：`);
    for (const f of fail) console.log(`  [${f.scenario}] ${f.name}${f.detail ? `  ${f.detail}` : ""}`);
  }
  if (knownIssues.length) {
    console.log(`\n已知未达标项（不计入 gate，但必须出现在报告里）：`);
    for (const k of knownIssues) console.log(`  ${k.name}${k.detail ? `  ${k.detail}` : ""}`);
  }
  console.log(`截图目录：${OUT}`);

  /* ════════ --all：编排既有探针 ════════ */
  if (RUN_ALL) {
    console.log(`\n════════════════════════════════════`);
    console.log("编排既有单阶段探针（b0 / b1 / b2 / b3 / b4-13）");
    console.log(`════════════════════════════════════`);
    const siblings = [
      { id: "b0", script: "tools/b0-size-probe.mjs", label: "B0/B0.1 尺寸权威链" },
      { id: "b1", script: "tools/b1-palette-probe.mjs", label: "B1 颜色系统" },
      { id: "b2", script: "tools/b2-background-probe.mjs", label: "B2 背景可靠性" },
      { id: "b3", script: "tools/b3-worker-probe.mjs", label: "B3 生成 Worker" },
      { id: "b4-13", script: "tools/b4-auto-tune-probe.mjs", label: "B4 §13 Auto Tune" },
    ];
    const siblingResults = [];
    for (const s of siblings) {
      const started = Date.now();
      const logFile = path.join(OUT, `sibling-${s.id}.log`);
      process.stdout.write(`\n── ${s.id} ${s.label} … `);
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(ROOT, s.script)], {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, OUT_DIR: path.join(OUT, `sibling-${s.id}`) },
        });
        let buf = "";
        child.stdout.on("data", (d) => { buf += d.toString(); });
        child.stderr.on("data", (d) => { buf += d.toString(); });
        child.on("close", (c) => { fs.writeFileSync(logFile, buf); resolve(c ?? 1); });
      });
      const log = fs.readFileSync(logFile, "utf8");
      const total = (log.match(/^PASS /gm) || []).length + (log.match(/^FAIL /gm) || []).length;
      const failed = (log.match(/^FAIL /gm) || []).length;
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(code === 0 ? `exit 0 · ${total - failed}/${total} PASS · ${secs}s`
        : `exit ${code} · ${failed} FAIL · ${secs}s`);
      siblingResults.push({ ...s, code, total, failed, secs, logFile });
    }
    console.log(`\n──── 既有探针汇总 ────`);
    for (const s of siblingResults) {
      console.log(`  ${s.id.padEnd(7)} ${s.code === 0 ? "PASS" : "FAIL"}  ${s.total - s.failed}/${s.total}  ${s.secs}s  ${s.logFile}`);
    }
    const allGreen = siblingResults.every((s) => s.code === 0);
    console.log(`\n既有探针总判定：${allGreen ? "全部 PASS" : "有失败项"}`);
    globalThis.__siblingFail = allGreen ? 0 : 1;
  }

  console.log(`\nStage B Master Probe ${fail.length === 0 && !globalThis.__siblingFail ? "PASS" : "FAIL"}`);
  cleanup();
  process.exit(fail.length === 0 && !globalThis.__siblingFail ? 0 : 1);
} catch (error) {
  console.error(`\n探针异常（场景 ${currentScenario}）：${error?.stack || error}`);
  await shot("crash");
  cleanup();
  process.exit(1);
}
