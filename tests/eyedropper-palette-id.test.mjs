/**
 * Stage B1 §7：吸管 / 单豆检视读的是 **cell.paletteId**，绝不按 RGB 反猜色号。
 *
 * 为什么这条要单独守：生产网格的格子是 `{code,rgb,hex}`（没有 paletteId 字段，
 * 见 services/generation-result-codec.mjs），所以 paletteIdOf(cell) 会回落到 cell.code。
 * 一旦有人图省事改成"按 rgb 找最接近的色板颜色"，同色不同号（TWIN）会被吞掉，
 * 而且换品牌后所有颜色都会漂移 —— 而且它**不会报错**，只会悄悄给错色号。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPaletteIndex, getPaletteUsageCounts, inspectPaletteCell } from "../services/palette-usage.js";
import { createEditorService } from "../services/editor-service.js";
import { paletteIdOf } from "../services/palette-identity.js";

const root = new URL("../", import.meta.url);
const workspaceSource = readFileSync(new URL("ui/workspace.js", root), "utf8");

// 两个颜色**完全同 RGB、不同 paletteId** —— 按 RGB 认色一定会把它们混成一个。
const DARK_A = { code: "A", paletteId: "brand:A", hex: "#111111", rgb: [17, 17, 17] };
const DARK_TWIN = { code: "A", paletteId: "brand:TWIN", hex: "#111111", rgb: [17, 17, 17] };
const LIGHT_B = { code: "B", paletteId: "brand:B", hex: "#eeeeee", rgb: [238, 238, 238] };

test("inspectPaletteCell：paletteId 直接来自格子身份，不参与任何 RGB 比较", () => {
  const grid = [[DARK_A, DARK_TWIN], [LIGHT_B, null]];
  const counts = getPaletteUsageCounts(grid);
  assert.deepEqual(inspectPaletteCell(grid, 0, 0, counts), { color: DARK_A, paletteId: "brand:A", count: 1 });
  assert.deepEqual(inspectPaletteCell(grid, 1, 0, counts), { color: DARK_TWIN, paletteId: "brand:TWIN", count: 1 });
  assert.deepEqual(inspectPaletteCell(grid, 0, 1, counts), { color: LIGHT_B, paletteId: "brand:B", count: 1 });
  assert.equal(inspectPaletteCell(grid, 1, 1, counts), null, "空格返回 null");
});

test("§7 反例取证：同 RGB 不同 paletteId 必须被区分（按 RGB 认色会把它们合并）", () => {
  const grid = [[DARK_A, DARK_TWIN]];
  const index = getPaletteIndex(grid);
  assert.equal(index.size, 2, "同 RGB 的两个身份必须各自成条");
  assert.deepEqual([...index.keys()].sort(), ["brand:A", "brand:TWIN"]);
  // 若按 RGB 认色，这里只会剩 1 条
  assert.notEqual(paletteIdOf(DARK_A), paletteIdOf(DARK_TWIN));
});

test("§7 反例取证：格子色号与色板里某色同 RGB 时，不得被「纠正」成那个色板的色号", () => {
  // 图纸里是 OLD（不在色板里），色板里 NEW 与它同 RGB
  const gridCell = { code: "OLD", hex: "#111111", rgb: [17, 17, 17] };
  const grid = [[gridCell]];
  const counts = getPaletteUsageCounts(grid);
  const inspected = inspectPaletteCell(grid, 0, 0, counts);
  assert.equal(inspected.paletteId, "OLD", "必须报格子自己的身份");
  assert.notEqual(inspected.paletteId, "NEW");
});

test("§7 editorService.inspectCell 与 palette-usage 同源，不额外引入认色逻辑", () => {
  const grid = [[DARK_A, DARK_TWIN]];
  const bridge = {
    getResult: () => ({ grid, width: 2, height: 1 }),
    getCell: (x, y) => grid[y]?.[x] ?? null,
    getPaletteColors: () => [DARK_A, DARK_TWIN, LIGHT_B],
    applyCellChanges: () => true,
  };
  const editor = createEditorService(bridge);
  assert.deepEqual(editor.inspectCell(0, 0), { color: DARK_A, paletteId: "brand:A", count: 1 });
  assert.deepEqual(editor.inspectCell(1, 0), { color: DARK_TWIN, paletteId: "brand:TWIN", count: 1 });
  // 用量按身份统计，不是按 RGB
  assert.equal(editor.getColorUsage("brand:A"), 1);
  assert.equal(editor.getColorUsage("brand:TWIN"), 1);
});

test("§7 工作台取色路径确实走 inspectCell → paletteId，没有 RGB 距离匹配", () => {
  // 吸管/点选路径：const inspected = cell ? editorService.inspectCell(...) : null;
  assert.match(workspaceSource, /editorService\.inspectCell\(cell\.x, cell\.y\)/);
  assert.match(workspaceSource, /const paletteId = inspected\?\.paletteId \|\| null/);
  // 不得出现按 RGB 找最近色的取色写法
  assert.doesNotMatch(workspaceSource, /nearestColor|nearestPalette|findNearestColor/);
  assert.doesNotMatch(workspaceSource, /reduce\(\(sum, channel, i\) => sum \+ \(channel - rgb\[i\]\) \*\* 2/);
});

test("§7 取色后必须走 patch 构造器把身份写进真源（不能只写一个镜像）", () => {
  assert.match(workspaceSource, /buildActivateColorPatch\(paletteId, paletteColors\(\)\)/);
});

test("用量索引按 paletteId 聚合，空格被跳过（不影响计数）", () => {
  const grid = [[DARK_A, null, DARK_A], [DARK_TWIN, LIGHT_B, null]];
  const counts = getPaletteUsageCounts(grid);
  assert.equal(counts.get("brand:A"), 2);
  assert.equal(counts.get("brand:TWIN"), 1);
  assert.equal(counts.get("brand:B"), 1);
  assert.equal(counts.size, 3, "空格不产生条目");
});
