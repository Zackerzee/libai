/**
 * Stage B1 §17：低频色巡检。
 *
 * 规格要求：阈值档位 ≤3 / ≤5 / ≤10，**默认 ≤5**，并复用既有 Rare Color Diagnostics。
 *
 * 改动前的实测事实（不是猜的）：
 *   · detectRarePaletteColors 的模块默认 maxCount = 3；
 *   · #ws-rare-threshold 的选项是 3 / 5 / 8，而 select 首项 3 会被浏览器默认选中；
 *   · 读取处写 `Number(...value || 3)`。
 * 于是默认阈值实际是 3 —— 「只用了 4~5 颗」的正常收尾色会被误报成问题色。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectRarePaletteColors } from "../services/palette-diagnostics.js";
import { getPaletteIndex } from "../services/palette-usage.js";
import { createEditorService } from "../services/editor-service.js";

const root = new URL("../", import.meta.url);
const workspaceSource = readFileSync(new URL("ui/workspace.js", root), "utf8");

const color = (code, count) => ({ code, paletteId: `brand:${code}`, hex: "#123456", rgb: [18, 52, 86] });

/** 造一幅「1 颗 / 2 颗 / 5 颗 / 10 颗 / 40 颗」的图，用来分辨各档阈值。 */
function gridWithCounts() {
  const plan = [["ONE", 1], ["TWO", 2], ["FIVE", 5], ["TEN", 10], ["MANY", 40]];
  const cells = [];
  for (const [code, count] of plan) for (let i = 0; i < count; i += 1) cells.push(color(code, count));
  const width = 10;
  const height = Math.ceil(cells.length / width);
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => cells[y * width + x] || null));
  return grid;
}

const indexOf = () => getPaletteIndex(gridWithCounts());

test("§17 阈值语义：count <= 阈值，且按颗数升序（最稀有的排最前）", () => {
  const index = indexOf();
  assert.deepEqual(detectRarePaletteColors(index, { maxCount: 5 }).map((e) => [e.code, e.count]),
    [["ONE", 1], ["TWO", 2], ["FIVE", 5]]);
  assert.deepEqual(detectRarePaletteColors(index, { maxCount: 3 }).map((e) => e.code), ["ONE", "TWO"]);
  assert.deepEqual(detectRarePaletteColors(index, { maxCount: 10 }).map((e) => e.code), ["ONE", "TWO", "FIVE", "TEN"]);
  // 恰好等于阈值要算进来（边界）
  assert.ok(detectRarePaletteColors(index, { maxCount: 5 }).some((e) => e.count === 5));
  assert.ok(!detectRarePaletteColors(index, { maxCount: 5 }).some((e) => e.count === 10));
});

test("§17 模块默认仍是 3（不改公共默认），但 UI 必须显式传 5 —— 两者都要守住", () => {
  // 模块默认：保持向后兼容，不擅自改公共 API
  assert.deepEqual(detectRarePaletteColors(indexOf()).map((e) => e.code), ["ONE", "TWO"]);
  // UI 默认：必须显式给 5，否则就会退回 3 的老毛病
  assert.match(workspaceSource, /detectRarePaletteColors\(\{ maxCount: Number\(\$\("#ws-rare-threshold"\)\.value \|\| 5\) \}\)/);
  assert.doesNotMatch(workspaceSource, /\$\("#ws-rare-threshold"\)\.value \|\| 3\)/);
});

test("§17 UI 档位是 ≤3 / ≤5 / ≤10，且 ≤5 预选中（不靠浏览器默认选第一项）", () => {
  assert.match(workspaceSource, /id="ws-rare-threshold"><option value="3">≤ 3 颗<\/option><option value="5" selected>≤ 5 颗<\/option><option value="10">≤ 10 颗<\/option>/);
  // 旧的 8 档必须消失（规格里没有 ≤8）
  assert.doesNotMatch(workspaceSource, /id="ws-rare-threshold"[\s\S]{0,240}value="8"/);
});

test("§17 巡检结果带 paletteId + cells + 严重度，可直接喂给现有巡检服务", () => {
  const rare = detectRarePaletteColors(indexOf(), { maxCount: 5 });
  for (const entry of rare) {
    assert.equal(typeof entry.paletteId, "string");
    assert.equal(typeof entry.code, "string");
    assert.ok(Array.isArray(entry.cells) && entry.cells.length === entry.count, "cells 数必须等于颗数");
    for (const cell of entry.cells) {
      assert.equal(typeof cell.x, "number");
      assert.equal(typeof cell.y, "number");
    }
  }
  // cells 是副本，改它不该污染索引
  const index = indexOf();
  const first = detectRarePaletteColors(index, { maxCount: 5 })[0];
  first.cells[0].x = 9999;
  assert.notEqual([...index.values()].find((e) => e.paletteId === first.paletteId).cells[0].x, 9999);
});

test("§17 严重度分档：1 颗 = 高，2 颗 = 中，其余 = 低（源码里的分档口径）", () => {
  assert.match(workspaceSource, /severity: entry\.count <= 1 \? "high" : entry\.count <= 2 \? "medium" : "low"/);
  const rare = detectRarePaletteColors(indexOf(), { maxCount: 5 });
  const severityOf = (count) => (count <= 1 ? "high" : count <= 2 ? "medium" : "low");
  assert.deepEqual(rare.map((e) => severityOf(e.count)), ["high", "medium", "low"]);
});

test("§17 复用而不是另起一套：UI 的 rareIssues 由 detectRarePaletteColors 构造", () => {
  assert.match(workspaceSource, /const rare = hasPattern \? editorService\.detectRarePaletteColors\(/);
  assert.match(workspaceSource, /const rareIssues = rare\.map\(/);
  assert.match(workspaceSource, /type: "rare-color"/);
  // 不得在 UI 里重新数一遍每色颗数
  assert.doesNotMatch(workspaceSource, /function countRareColors|const countRareColors/);
});

test("editorService.detectRarePaletteColors 与模块同源（UI 不直连模块）", () => {
  const grid = gridWithCounts();
  const bridge = {
    getResult: () => ({ grid, width: grid[0].length, height: grid.length }),
    getCell: (x, y) => grid[y]?.[x] ?? null,
    getPaletteColors: () => [color("ONE", 1), color("TWO", 2), color("FIVE", 5), color("TEN", 10), color("MANY", 40)],
    applyCellChanges: () => true,
  };
  const editor = createEditorService(bridge);
  assert.deepEqual(editor.detectRarePaletteColors({ maxCount: 5 }).map((e) => e.code), ["ONE", "TWO", "FIVE"]);
  assert.deepEqual(editor.detectRarePaletteColors({ maxCount: 10 }).map((e) => e.code), ["ONE", "TWO", "FIVE", "TEN"]);
  // 与模块直调结果一致
  assert.deepEqual(
    editor.detectRarePaletteColors({ maxCount: 5 }),
    detectRarePaletteColors(getPaletteIndex(grid), { maxCount: 5 }),
  );
});

test("§17 空图纸 / 无低频色时返回空数组，不抛异常", () => {
  assert.deepEqual(detectRarePaletteColors(getPaletteIndex([]), { maxCount: 5 }), []);
  const onlyMany = Array.from({ length: 2 }, () => Array.from({ length: 20 }, () => color("MANY", 40)));
  assert.deepEqual(detectRarePaletteColors(getPaletteIndex(onlyMany), { maxCount: 5 }), []);
  // 阈值 0 只捞「0 颗」——但 0 颗的颜色根本不在索引里，所以也是空
  assert.deepEqual(detectRarePaletteColors(getPaletteIndex(onlyMany), { maxCount: 0 }), []);
});
