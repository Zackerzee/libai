/**
 * Stage B4 §13.5 —— §15 调优报告**真的**接上生产链路了吗？
 *
 * ── 这个文件守的是什么 ────────────────────────────────────────────────
 * `app.js` 顶部的 `const state = window.libmsStore.compat()` 是 **Proxy**，
 * 不是普通对象（见 `state/store.js` 的 `createCompatState`）：
 *
 *   get(prop) → 只查 `LEGACY_MAP`，未登记的键**永远读回 `undefined`**
 *   set(prop) → 未登记的键落到 Proxy 的载体对象上，之后没人读得到
 *
 * 也就是说 `state.someNewThing = value` 是**合法语法、静默无效**。
 *
 * 2026-10-04 真机实测踩过这个坑：`runAutoTuneV2` 里写的是
 * `state.autoTuneReport = rest`，于是 ——
 *   · 调优器**跑得好好的**（真机插桩记到 3 次调用全部 `decision=standard-is-best`、
 *     每次都拿到网格、无异常）；
 *   · `getAutoTuneReport()` 永远返回 `null`，看起来像「§13 根本没接上生产」。
 * 而 §13 那 175 个单测全绿 —— 因为它们直接构造调优器，**不经过这条兼容层**。
 *
 * 这正是本仓库反复出现的「静默失效」形状：不报错、不抛异常、看起来在工作。
 * 所以这里不只测「这一次修好了」，还把**通用形状**钉住：
 * app.js 里任何 `state.X =` 的写入，X 必须出现在 `LEGACY_MAP` 里。
 * 将来再有人往兼容层上写新字段，这条测试会红，而不是等真机验收才发现。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import storeApi from "../state/store.js";

const { createStore, createCompatState, LEGACY_MAP, LEGACY_KEYS } = storeApi;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/**
 * 只保留代码行：**按行首前缀过滤**。
 * 不用正则剥注释 —— 本仓库的文件里有模板字符串内嵌的 CSS/HTML，
 * 正则剥注释会把真代码一起剥掉（沿用 mode-profile-contract.test.mjs 的约定）。
 */
const codeOnly = (text) => text
  .split("\n")
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n");

const APP = read("app.js");
const APP_CODE = codeOnly(APP);

/**
 * 抓 `state.<name> = ...` 形式的写入（不含 `==` / `===` / `<=` / `>=`）。
 *
 * 负向后顾 `(?<![.\w$])` 保证匹配的是**裸标识符 `state`**，
 * 不会命中 `foo.state.bar = 1` 或 `mystate.x = 1`。
 */
function compatStateWrites(source) {
  const names = new Map();
  for (const m of source.matchAll(/(?<![.\w$])state\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
    names.set(m[1], (names.get(m[1]) || 0) + 1);
  }
  return names;
}

/* =========================================================
 * 0. 兼容层的性质：把「为什么」钉在测试里
 * ========================================================= */

test("兼容层性质：写入未登记字段，读回来是 undefined（只写不读）", () => {
  const state = createCompatState(createStore());
  state.autoTuneReport = { decision: "standard-is-best" };
  assert.equal(state.autoTuneReport, undefined,
    "未登记字段必须读不回来 —— 如果这条红了，说明 store 兼容层改了语义，"
    + "auto-tune-report-wiring 的整个前提要重新审");
  // 已登记字段当然是正常读写的（对照组：证明不是「所有写入都失效」）
  state.lastGenerationError = "boom";
  assert.equal(state.lastGenerationError, "boom");
});

/* =========================================================
 * 1. 通用守卫：app.js 不许往兼容层写未登记字段
 * ========================================================= */

test("app.js 里每一个 state.X 写入都必须在 LEGACY_MAP 里登记", () => {
  const writes = compatStateWrites(APP_CODE);
  assert.ok(writes.size > 40, `只扫到 ${writes.size} 个 state 写入，正则大概失效了`);
  const unregistered = [...writes.keys()].filter((name) => !LEGACY_MAP[name]).sort();
  assert.deepEqual(unregistered, [],
    `这些字段写在兼容层上但没登记，读回来永远是 undefined（静默失效）：\n`
    + unregistered.map((n) => `  state.${n}`).join("\n")
    + "\n要么登记进 state/store.js 的 LEGACY_MAP，要么别放 state（诊断数据用模块级变量）");
});

test("LEGACY_MAP 的键就是兼容层能读到的全部键（守卫自身的一致性）", () => {
  for (const key of Object.keys(LEGACY_MAP)) {
    assert.ok(LEGACY_KEYS.includes(key), `LEGACY_MAP 有 ${key} 但 LEGACY_KEYS 没有`);
  }
  assert.equal(LEGACY_KEYS.length, Object.keys(LEGACY_MAP).length);
});

/* =========================================================
 * 2. §15 报告的持有者：模块级变量，且桥接读到它
 * ========================================================= */

test("app.js 用模块级变量持有 §15 报告（不放兼容层 state）", () => {
  assert.match(APP_CODE, /^let autoTuneReport = null;$/m,
    "§15 报告必须由模块级变量持有 —— 放 state 上会被兼容层吃掉");
});

test("getAutoTuneReport 读的是模块级变量，不是 state", () => {
  const m = APP_CODE.match(/getAutoTuneReport:\s*\(\)\s*=>\s*([^,\n]+)/);
  assert.ok(m, "找不到 getAutoTuneReport 的定义");
  assert.match(m[1], /autoTuneReport/);
  assert.doesNotMatch(m[1], /state\./, "桥接不能从兼容层 state 上读报告");
});

test("每一轮生成开头清空上一轮的报告（否则会被读成「这次也这么选」）", () => {
  const start = APP_CODE.indexOf("async function processImageV2(");
  assert.ok(start > 0, "找不到 processImageV2");
  const body = APP_CODE.slice(start, start + 900);
  assert.match(body, /autoTuneReport = null;/,
    "processImageV2 开头必须清空报告，否则上一轮的结论会串到这一轮");
});

test("调优失败时报告写成 { error }，不是留 null", () => {
  assert.match(APP_CODE, /autoTuneReport = \{ error: String\(error\?\.message \|\| error\) \}/,
    "调优失败要留下可读的痕迹，否则「报告为空」既可能是没跑、也可能是跑挂了");
});

/* =========================================================
 * 3. §15 报告的落点与广播
 * ========================================================= */

test("报告落库前剥掉网格（那是一整张网格，不该跟着快照走）", () => {
  assert.match(APP_CODE, /const \{ grid, \.\.\.rest \} = report;\s*\n\s*autoTuneReport = rest;/,
    "报告必须去掉 grid 再持有");
});

test("报告同时走 libms:auto-tune 事件广播（第二条观测通道）", () => {
  assert.match(APP_CODE, /new CustomEvent\("libms:auto-tune", \{ detail: rest \}\)/);
});

test("§16：报告不进工作台可见 UI，也不进 store 快照", () => {
  assert.equal(LEGACY_MAP.autoTuneReport, undefined,
    "报告一旦登记进 store 就会进工程文件快照 —— 里面有每个候选的 metrics，不该序列化");
  assert.doesNotMatch(APP_CODE, /getAutoTuneReport\(\)[^;\n]*textContent/);
  assert.doesNotMatch(APP_CODE, /innerHTML\s*=[^;\n]*autoTuneReport/);
});

test("§16：报告里不含网格字段（探针据此断言「报告不是结果」）", () => {
  // `{ grid, ...rest }` 之后 rest 不含 grid；这条守的是别有人又把 grid 塞回去。
  const start = APP_CODE.indexOf("const { grid, ...rest } = report;");
  const body = APP_CODE.slice(start, start + 400);
  assert.doesNotMatch(body, /rest\.grid\s*=/);
});
