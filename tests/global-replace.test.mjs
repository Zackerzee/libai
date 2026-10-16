/**
 * Stage B1 §15 / §17 / §18：全局替换与相近颜色。
 *
 * 关键不变量：**一次替换 = 一条 Undo**。旧实现里「当前使用色」面板的点击只写
 * highlightedColor、换色走另一条路，两者不同源；现在统计卡 → 全局替换 → 一次撤销，
 * 全程复用 editorService.replaceColor，不建第二套。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEditorService } from "../services/editor-service.js";
import { findSimilarPaletteColors } from "../services/palette-diagnostics.js";

const root = new URL("../", import.meta.url);
const workspaceSource = readFileSync(new URL("ui/workspace.js", root), "utf8");
// 注释里提到 deltaE2000 / rgbToLab 是为了说明"复用了哪个服务"，不该被守卫当成违规。
const codeOnly = (source) => source.split("\n")
  .filter((line) => { const t = line.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); })
  .join("\n");

const A = { code: "A", paletteId: "brand:A", hex: "#141414", rgb: [20, 20, 20] };
const TWIN = { code: "T", paletteId: "brand:TWIN", hex: "#141414", rgb: [20, 20, 20] };
const B = { code: "B", paletteId: "brand:B", hex: "#e6e6e6", rgb: [230, 230, 230] };
const C = { code: "C", paletteId: "brand:C", hex: "#dc2828", rgb: [220, 40, 40] };
const PALETTE = [A, TWIN, B, C];

function fixture() {
  // 4×4：左半 A、右上 TWIN、右下 B，中心留一个 C 用来验证「不误伤」
  const grid = Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => {
    if (x === 3 && y === 3) return { ...C };
    if (x >= 2 && y <= 1) return { ...TWIN };
    return { ...A };
  }));
  const bridge = {
    getResult: () => ({ grid, width: 4, height: 4 }),
    getCell: (x, y) => grid[y]?.[x] ?? null,
    getPaletteColors: () => PALETTE.map((color) => ({ ...color, rgb: [...color.rgb] })),
    applyCellChanges(changes) { for (const { x, y, after } of changes) grid[y][x] = after ? { ...after, rgb: [...after.rgb] } : null; return true; },
  };
  return { grid, editor: createEditorService(bridge) };
}

test("用色条读取缓存中的工程原色，换色板后不显示假灰色或合并同 RGB 身份", () => {
  const grid = [[{ ...A }, { ...TWIN }]];
  const editor = createEditorService({
    getResult: () => ({ grid, width: 2, height: 1 }),
    getPaletteColors: () => [B],
  });
  assert.equal(editor.resolveColor(A.paletteId), null);
  assert.deepEqual(editor.getUsedPaletteColor(A.paletteId), A);
  assert.deepEqual(editor.getUsedPaletteColor(TWIN.paletteId), TWIN);
  assert.equal(editor.getPaletteUsageCounts().size, 2);
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 0 });
  grid[0][0] = { ...C };
  editor.invalidateUsageCounts();
  assert.equal(editor.getUsedPaletteColor(A.paletteId), null);
  assert.deepEqual(editor.getUsedPaletteColor(C.paletteId), C);
});

test("§15 全局替换 = 一条 Undo，且一次 undo 全部还原", () => {
  const { grid, editor } = fixture();
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 0 });
  assert.equal(editor.replaceColor("brand:A", "brand:B"), true);
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 }, "一次替换只能产生一条历史");
  const replaced = grid.flat().filter((cell) => cell?.paletteId === "brand:B").length;
  assert.equal(replaced, 11, "A 有 11 颗（4×4 = 16，减 TWIN 4 颗、C 1 颗）");
  assert.equal(grid[3][3].paletteId, "brand:C", "不相关的颜色不能被误伤");
  assert.equal(editor.undo(), true);
  assert.equal(grid.flat().filter((cell) => cell?.paletteId === "brand:A").length, 11);
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 1 });
});

test("§15 同 RGB 不同 paletteId：替换按身份走，不会把 TWIN 一起换掉", () => {
  const { grid, editor } = fixture();
  assert.equal(editor.replaceColor("brand:A", "brand:B"), true);
  assert.equal(grid.flat().filter((cell) => cell?.paletteId === "brand:TWIN").length, 4, "TWIN 必须原样保留");
});

test("§15 选区替换 = 一条 Undo，且只动选区内", () => {
  const { grid, editor } = fixture();
  const selection = { x0: 0, y0: 0, x1: 1, y1: 3 };
  assert.equal(editor.replaceColor("brand:A", "brand:B", selection), true);
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  assert.equal(grid.flat().filter((cell) => cell?.paletteId === "brand:B").length, 8);
  assert.equal(grid[0][2].paletteId, "brand:TWIN", "选区外的 TWIN 不动");
  assert.equal(grid[0][0].paletteId, "brand:B", "选区内已改");
});

test("§15 替换成自己 / 替换成色板外色号 → 不产生历史（拒绝而不是静默改坏）", () => {
  const { editor } = fixture();
  assert.equal(editor.replaceColor("brand:A", "brand:A"), false);
  assert.equal(editor.replaceColor("brand:A", "brand:NOPE"), false);
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 0 });
});

test("§15 合并多种来源色 = 一条 Undo", () => {
  const { grid, editor } = fixture();
  assert.equal(editor.mergePaletteColors(["brand:A", "brand:TWIN"], "brand:B"), true);
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  assert.equal(grid.flat().filter((cell) => cell?.paletteId === "brand:B").length, 15, "A 11 颗 + TWIN 4 颗");
  assert.equal(grid[3][3].paletteId, "brand:C", "目标色与来源色之外的颜色不受影响");
});

test("§16 相近颜色：带 ΔE 距离、排除自己、按距离升序", () => {
  const similar = findSimilarPaletteColors(PALETTE, "brand:A", { limit: 6 });
  assert.ok(similar.length > 0);
  assert.ok(!similar.some((entry) => entry.paletteId === "brand:A"), "必须排除自己");
  for (const entry of similar) assert.equal(typeof entry.distance, "number", "每条都要带 ΔE");
  for (let i = 1; i < similar.length; i += 1) {
    assert.ok(similar[i - 1].distance <= similar[i].distance, "按 ΔE 升序");
  }
  // TWIN 与 A 完全同 RGB → ΔE = 0，必须排第一
  assert.equal(similar[0].paletteId, "brand:TWIN");
  assert.equal(similar[0].distance, 0);
  // limit 生效
  assert.ok(findSimilarPaletteColors(PALETTE, "brand:A", { limit: 1 }).length <= 1);
});

test("§14 底栏巡检按钮已移除，能力仍复用右栏现有服务（没有第二套替换/相近色实现）", () => {
  // 底栏那五个入口（只看此色/取消高亮/画布选色/全局替换/相近颜色）与右栏「选择颜色」
  // 区块的同名能力重复，已整体删除，只保留右栏这一处入口。
  for (const id of ["ws-usage-only", "ws-usage-clear", "ws-usage-inspect", "ws-usage-replace", "ws-usage-similar"]) {
    assert.doesNotMatch(workspaceSource, new RegExp(`id="${id}"`), `${id} 应从底栏移除`);
  }
  // 全局换色仍走既有的 #ws-replace-from / #ws-replace-to / #ws-replace-confirm
  assert.match(workspaceSource, /\$\("#ws-replace-from"\)\.addEventListener/);
  assert.match(workspaceSource, /\$\("#ws-replace-confirm"\)\.addEventListener/);
  // 真正的替换仍走 editorService.replaceColor
  assert.match(workspaceSource, /editorService\.replaceColor\(from, to, get\(\)\.editor\.selection\)/);
  // 相近颜色复用 findSimilarPaletteColors（右栏 #ws-similar-colors）
  assert.match(workspaceSource, /editorService\.findSimilarPaletteColors\(selectedPaletteId, \{ limit: 6 \}\)/);
  // 同色高亮复用既有渲染层 alpha，不新写渲染
  assert.match(workspaceSource, /buildHighlightOnlyPatch\(currentPaletteId\(\), \{ enabled: event\.target\.checked \}\)/);
  // 不得出现第二套替换实现
  assert.doesNotMatch(codeOnly(workspaceSource), /function replaceColor|const replaceColor/);
  assert.doesNotMatch(codeOnly(workspaceSource), /deltaE2000|rgbToLab/);
});

test("§16 相近色卡片带 ΔE 与图上已有用量（两段信息都要渲染出来）", () => {
  // 底栏清单删除后，ΔE 与用量并进了右栏相近色卡片的 title，信息不丢。
  assert.match(workspaceSource, /ΔE \$\{delta\}/);
  assert.match(workspaceSource, /const used = editorService\.getColorUsage\(color\.paletteId\), delta = Number\(color\.distance \?\? 0\)\.toFixed\(1\)/);
  assert.match(workspaceSource, /data-ws-similar-target="\$\{esc\(color\.paletteId\)\}"/);
});
