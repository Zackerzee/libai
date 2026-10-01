/**
 * Stage B1 §6 / §7 / §8：currentPaletteId 单一真源。
 *
 * 这一组用例要守住三件事：
 *   1. 真源字段真的存在于 store（在 DEFAULTS 与 LEGACY_MAP 里，不是孤儿字段）；
 *   2. 「写」只能通过 current-palette.mjs 的 patch 构造器 —— 有机械守卫扫源码；
 *   3. 曾经的两处「当前颜色」槽位保持**分属不同编辑器**，不被谁"顺手合流"。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import storeApi from "../state/store.js";
// 适配器：取证「工作台写 editor.selectedColor 会落到旧编辑器的对象槽位」必须走它，
// 因为 ui/workspace.js 用的就是这个适配器，而不是裸 store。
import { createProjectStore } from "../state/project-store.js";
import {
  CURRENT_PALETTE_NONE, buildActivateColorPatch, buildClearPalettePatch,
  buildCurrentPalettePatch, buildHighlightOnlyPatch, findPaletteColor,
  isEraseSelection, readCurrentPaletteId, resolvePaletteIdentity,
} from "../services/current-palette.mjs";
import { paletteIdOf } from "../services/palette-identity.js";

const { createStore, createCompatState } = storeApi;
// store.setState 收的是「点路径字符串」，不是对象 —— 合并写要用 patchState。
const fresh = () => { const store = createStore(); return { store, compat: createCompatState(store) }; };

const root = new URL("../", import.meta.url);
const workspaceSource = readFileSync(new URL("ui/workspace.js", root), "utf8");
const storeSource = readFileSync(new URL("state/store.js", root), "utf8");

const PALETTE = [
  { code: "H5", rgb: [17, 17, 17], hex: "#111111", group: "H" },
  { code: "A03", rgb: [238, 238, 238], hex: "#eeeeee", group: "A" },
  { code: "65", rgb: [255, 0, 0], hex: "#ff0000", group: "黄" },
];

// ---------------------------------------------------------------------------
// 1. 真源字段在 store 里
// ---------------------------------------------------------------------------

test("§6 currentPaletteId 是 DEFAULTS 里的正式字段，不是 patchState 现写现建的孤儿", () => {
  const store = createStore();
  const editor = store.getNamespace("editorState");
  assert.ok("currentPaletteId" in editor, "editorState 必须有 currentPaletteId");
  assert.equal(editor.currentPaletteId, null, "默认必须是 null（＝未选色）");
  // 对照：改动前 editorState.selectedColor 就不在 DEFAULTS 里，是孤儿字段
  assert.match(storeSource, /currentPaletteId: null,/);
});

test("§6 currentPaletteId 进了 LEGACY_MAP，兼容层 state.currentPaletteId 可读写", () => {
  const { store, compat } = fresh();
  assert.equal(compat.currentPaletteId, null);
  compat.currentPaletteId = "mard:H5";
  assert.equal(store.get("editorState", "currentPaletteId"), "mard:H5");
  assert.equal(compat.currentPaletteId, "mard:H5");
  assert.deepEqual(store.legacyMap.currentPaletteId, ["editorState", "currentPaletteId"]);
});

test("§6 取证：适配器把工作台的 editor.selectedColor 路由进旧编辑器的对象槽位 —— 这就是必须立真源的原因", () => {
  const { store, compat } = fresh();
  // 旧编辑器（app.js:6187）写的是**完整颜色对象**。
  compat.selectedColor = { code: "A1", rgb: [1, 2, 3], hex: "#010203" };
  assert.deepEqual(store.get("paletteState", "selectedColor"), { code: "A1", rgb: [1, 2, 3], hex: "#010203" });
  // 而 projectStore 适配器的 WRITE.editor 把 `selectedColor` 也送到**同一个**槽位。
  // 于是工作台若按老写法写字符串色号，旧编辑器读 `.code` 就拿到 undefined：
  //   app.js:6087 `!palette.some((c) => c.code === state.selectedColor.code)` → 判定「不在色板里」
  //   app.js:6089 `state.selectedColor = null` → 打开旧编辑器就把工作台刚选的色清空
  const adapter = createProjectStore();
  adapter.setState({ editor: { selectedColor: "H5" } });
  const target = adapter.__target();
  assert.equal(target.get("paletteState", "selectedColor"), "H5", "适配器确实写的是同一个槽位");
  const legacySees = target.get("paletteState", "selectedColor");
  assert.equal(legacySees.code, undefined, "旧编辑器读 .code 拿到 undefined —— 缺陷复现");
  assert.match(storeSource, /不同编辑器/);
});

test("§6 修好之后：走真源的工作台**不再污染**旧编辑器的对象槽位", () => {
  const adapter = createProjectStore();
  // 旧编辑器先选一个色（对象）
  const before = { code: "A1", rgb: [1, 2, 3], hex: "#010203" };
  adapter.__target().patchState("paletteState", { selectedColor: before });
  // 工作台按 B1 的写法选另一个色（patch 构造器，不含 selectedColor）
  adapter.setState({ editor: buildCurrentPalettePatch("H5", PALETTE) });
  const target = adapter.__target();
  assert.equal(target.get("editorState", "currentPaletteId"), "H5", "真源写进去了");
  assert.deepEqual(target.get("paletteState", "selectedColor"), before,
    "旧编辑器的对象槽位必须**一字未动** —— 这才是 B1 §6 的实质修复");
  // 而且真源真的穿过适配器快照（project-store.js 的 snapshot 必须带上 currentPaletteId）
  assert.equal(readCurrentPaletteId(adapter.getState().editor), "H5",
    "真源必须能穿过快照读回来，否则 readCurrentPaletteId 只是在读镜像");
});

test("§6 清空当前色同样不碰旧编辑器的槽位", () => {
  const adapter = createProjectStore();
  const before = { code: "A1", rgb: [1, 2, 3], hex: "#010203" };
  adapter.__target().patchState("paletteState", { selectedColor: before });
  adapter.setState({ editor: buildClearPalettePatch() });
  assert.equal(adapter.__target().get("paletteState", "selectedColor"), before);
  assert.equal(readCurrentPaletteId(adapter.getState().editor), null);
});

// ---------------------------------------------------------------------------
// 2. 读：真源优先，迁移期兜底读镜像
// ---------------------------------------------------------------------------

test("readCurrentPaletteId：真源优先，其次镜像，都没有则 null", () => {
  assert.equal(readCurrentPaletteId({ currentPaletteId: "A1", selectedPaletteId: "B2" }), "A1");
  assert.equal(readCurrentPaletteId({ currentPaletteId: null, selectedPaletteId: "B2" }), "B2", "迁移期兜底读镜像");
  assert.equal(readCurrentPaletteId({ currentPaletteId: "", selectedPaletteId: "B2" }), "B2");
  assert.equal(readCurrentPaletteId({ currentPaletteId: null, selectedPaletteId: null }), CURRENT_PALETTE_NONE);
  assert.equal(readCurrentPaletteId({}), CURRENT_PALETTE_NONE);
  assert.equal(readCurrentPaletteId(null), CURRENT_PALETTE_NONE);
  assert.equal(readCurrentPaletteId(undefined), CURRENT_PALETTE_NONE);
  // 数值型 paletteId 也要能读出来（历史工程里 id 可能是数字）
  assert.equal(readCurrentPaletteId({ currentPaletteId: 7 }), "7");
});

test("§8 未选色就是橡皮擦：null 是规范表示，不引入 \"eraser\" 之类伪色号", () => {
  assert.equal(isEraseSelection({ currentPaletteId: null }), true);
  assert.equal(isEraseSelection({ currentPaletteId: "A1" }), false);
  assert.equal(isEraseSelection({}), true);
  // 源码里不该出现伪色号（只在**代码位置**断言，注释里提到这个词不算）
  const source = readFileSync(new URL("services/current-palette.mjs", root), "utf8");
  assert.doesNotMatch(source, /(?:currentPaletteId|selectedPaletteId|selectedColor)\s*:\s*["']eraser["']/);
  assert.doesNotMatch(source, /PALETTE_ERASER|ERASER_ID/);
});

// ---------------------------------------------------------------------------
// 3. 解析：只查色板，绝不按 RGB 反猜
// ---------------------------------------------------------------------------

test("§7 resolvePaletteIdentity 只认 paletteId/色号，色板里没有就返回 null（不猜）", () => {
  assert.deepEqual(resolvePaletteIdentity("H5", PALETTE), { paletteId: "H5", color: PALETTE[0], code: "H5" });
  assert.deepEqual(resolvePaletteIdentity(null, PALETTE), { paletteId: null, color: null, code: null });
  assert.deepEqual(resolvePaletteIdentity("", PALETTE), { paletteId: null, color: null, code: null });
  // 色板里没有这个 id → 不返回任何"最接近"的颜色
  assert.deepEqual(resolvePaletteIdentity("ZZ9", PALETTE), { paletteId: "ZZ9", color: null, code: null });
  assert.equal(findPaletteColor(PALETTE, "ZZ9"), null);
  assert.equal(findPaletteColor(PALETTE, null), null);
  // 中文系列的数字色号也能命中
  assert.equal(findPaletteColor(PALETTE, "65")?.group, "黄");
});

// ---------------------------------------------------------------------------
// 4. 写：patch 构造器
// ---------------------------------------------------------------------------

test("buildCurrentPalettePatch 只写真源 + 工作台侧镜像（**故意不含 selectedColor**）", () => {
  const patch = buildCurrentPalettePatch("H5", PALETTE);
  assert.deepEqual(patch, { currentPaletteId: "H5", selectedPaletteId: "H5" });
  // selectedColor 是旧编辑器 paletteState 里的对象槽位，工作台写了就是污染。
  assert.ok(!("selectedColor" in patch), "patch 里出现 selectedColor 就是回归");
});

test("buildCurrentPalettePatch 遇到色板外的 id：真源保留 id（镜像同为 id，不留假色号）", () => {
  // 真源存的是 paletteId 本身；色板里查不到时**不伪造**任何色号，
  // 由调用方（UI）负责显示「未选择」或提示换品牌。
  const patch = buildCurrentPalettePatch("ZZ9", PALETTE);
  assert.deepEqual(patch, { currentPaletteId: "ZZ9", selectedPaletteId: "ZZ9" });
  assert.equal(resolvePaletteIdentity("ZZ9", PALETTE).code, null, "解析不出色号就是不伪造");
});

test("§8 buildClearPalettePatch 一次归零四个字段（真源 + 镜像 + 两个高亮），不碰旧编辑器槽位", () => {
  const patch = buildClearPalettePatch();
  assert.deepEqual(patch, {
    currentPaletteId: null, selectedPaletteId: null,
    highlightedPaletteId: null, highlightedColor: null,
  });
  assert.ok(!("selectedColor" in patch), "清空也不得写旧编辑器的槽位");
});

test("§13 buildActivateColorPatch：设当前色并把高亮指到同一 paletteId，同时清掉 code 高亮", () => {
  const patch = buildActivateColorPatch("H5", PALETTE);
  assert.equal(patch.currentPaletteId, "H5");
  assert.equal(patch.highlightedPaletteId, "H5", "高亮用 paletteId（渲染层优先分支）");
  assert.equal(patch.highlightedColor, null, "不能留两套高亮互相盖");
  // highlight:false 时不点亮
  assert.equal(buildActivateColorPatch("H5", PALETTE, { highlight: false }).highlightedPaletteId, null);
  // 未选色时高亮也必须归零
  assert.equal(buildActivateColorPatch(null, PALETTE).highlightedPaletteId, null);
});

test("§13 buildHighlightOnlyPatch 只切高亮，不动当前颜色", () => {
  const on = buildHighlightOnlyPatch("H5");
  assert.deepEqual(Object.keys(on).sort(), ["highlightedColor", "highlightedPaletteId"]);
  assert.equal(on.highlightedPaletteId, "H5");
  assert.equal(on.highlightedColor, null);
  assert.equal(buildHighlightOnlyPatch("H5", { enabled: false }).highlightedPaletteId, null);
  assert.equal(buildHighlightOnlyPatch(null).highlightedPaletteId, null);
});

test("patch 形状可直接喂给 store：写进去之后真源与镜像一致", () => {
  const { store } = fresh();
  store.patchState("editorState", buildCurrentPalettePatch("H5", PALETTE));
  const editor = store.getNamespace("editorState");
  assert.equal(editor.currentPaletteId, "H5");
  assert.equal(editor.selectedPaletteId, "H5");
  assert.equal(readCurrentPaletteId(editor), "H5");
  // 清空
  store.patchState("editorState", buildClearPalettePatch());
  assert.equal(readCurrentPaletteId(store.getNamespace("editorState")), null);
});

test("守卫：workspace.js 里不再有任何 editor.selectedColor 的读或写", () => {
  // 这条守的是**实质修复**：工作台只要还碰 selectedColor，
  // 就会通过适配器污染旧编辑器的对象槽位（见本文件第一条取证用例）。
  const offenders = codeOnly(workspaceSource).split("\n")
    .filter((line) => /(?:state|get\(\)|patch)?\.?editor\??\.selectedColor/.test(line) && !/^\s*\/\//.test(line));
  assert.deepEqual(offenders, [], `工作台仍在读 editor.selectedColor：\n${offenders.join("\n")}`);
  assert.match(workspaceSource, /readCurrentPaletteId\(/, "读当前色必须走真源");
});

// ---------------------------------------------------------------------------
// 5. 机械守卫：写只能走 patch 构造器
// ---------------------------------------------------------------------------

const PALETTE_WRITE_KEYS = ["currentPaletteId", "selectedPaletteId", "selectedColor", "highlightedPaletteId", "highlightedColor"];
// 允许出现这些字段名的上下文：
//   build*Patch(  —— 唯一合法的写入口
//   paint(get(),  —— paint 的 patch 参数只是「刷新哪些区块」的信号，从不写进 state
//   planOutline(  —— 只是函数入参，不是状态写入
const ALLOWED_CONTEXT = /build(?:CurrentPalette|ActivateColor|ClearPalette|HighlightOnly)Patch\(|paint\(get\(\),|planOutline\(/;

function offendingLines(source) {
  return source.split("\n").map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => PALETTE_WRITE_KEYS.some((key) => entry.line.includes(`${key}:`)))
    .filter((entry) => !ALLOWED_CONTEXT.test(entry.line));
}

test("守卫：paint 的 patch 参数从不被写进 state（这条不成立，上面的白名单就不成立）", () => {
  assert.doesNotMatch(workspaceSource, /store\.setState\(\s*patch/);
  assert.doesNotMatch(workspaceSource, /store\.setState\(\s*\{\s*\.\.\.patch/);
});

test("守卫：ui/workspace.js 里这五个字段只能出现在合法上下文里", () => {
  const offenders = offendingLines(workspaceSource);
  assert.deepEqual(offenders, [],
    `发现绕过 patch 构造器的裸写（B1 §6 禁止）：\n${offenders.map((o) => `  L${o.number}: ${o.line}`).join("\n")}`);
});

test("守卫有效性自检：故意插入一行裸写必须被扫出来（否则守卫是假绿灯）", () => {
  const mutated = `${workspaceSource}\n  store.setState({ editor: { selectedPaletteId: "X" } });\n`;
  const offenders = offendingLines(mutated);
  assert.equal(offenders.length, 1, "变异后必须恰好扫出 1 行");
  assert.match(offenders[0].line, /selectedPaletteId/);
});

// 注释里提到 `/^[A-Z]+/` 是为了解释"为什么不能这么干"，不该被守卫当成违规。
// 只扫**代码行**（行首 //、*、/* 的纯注释行剔除）。
const codeOnly = (source) => source.split("\n")
  .filter((line) => { const t = line.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); })
  .join("\n");

test("守卫：不再用 code 前缀猜系列（§3 明令禁止 /^[A-Z]+/ 作为唯一 series 逻辑）", () => {
  assert.doesNotMatch(codeOnly(workspaceSource), /code\.match\(\/\^\[A-Z\]\+\/\)/);
  assert.match(workspaceSource, /listPaletteSeries\(/, "系列必须来自 palette-series 模块");
  assert.match(workspaceSource, /filterPaletteColors\(/, "筛选必须走 palette-series 模块");
});

test("守卫：paletteId 不得由 RGB 反推（§7）—— 源码里没有 RGB 距离匹配色号的写法", () => {
  // 允许出现的是 paletteIdOf(...) 与 resolveColor(...)；不允许手搓 RGB 欧氏距离去认色号
  assert.doesNotMatch(workspaceSource, /rgbDistance|nearestByRgb|guessPaletteIdByRgb/);
  assert.match(workspaceSource, /inspectCell\(/, "单豆检视必须走 editorService.inspectCell");
});
