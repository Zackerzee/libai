/**
 * paletteId 身份一致性（Phase 3 优先修复项）。
 *
 * 缺陷背景（docs/local-fusion-calibration/README.md 实测）：
 * V2.5 输出格子里 code/rgb 已变成目标色，paletteId 却还是来源色的旧值，
 * 例 {code:'F3', rgb:[247,73,65], paletteId:'mard:F2'}。
 * 根因：applyBudgetPlan 合并颜色时同步 code/rgb/hex/name，唯独不同步 paletteId；
 * opt-in 容差路径（smart-tolerance-budget.mjs）有补救，默认路径没有。
 *
 * 本文件是回归防线：身份必须与 code 一致，且不带 paletteId 的色板行为不变。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaletteBudgetPlan, applyBudgetPlan } from '../smart-preprocessing/protected-palette-budget-v2.mjs';
import { paletteIdOf } from '../services/palette-identity.js';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';

test('applyBudgetPlan: 合并后 paletteId 与目标色身份一致', () => {
  const colors = {
    A: { code: 'A', paletteId: 'test:A', rgb: [10, 10, 10], hex: '#0A0A0A' },
    B: { code: 'B', paletteId: 'test:B', rgb: [12, 12, 12], hex: '#0C0C0C' },
    C: { code: 'C', paletteId: 'test:C', rgb: [200, 10, 10], hex: '#C80A0A' },
  };
  const grid = [
    [{ ...colors.A }, { ...colors.A }, { ...colors.C }],
    [{ ...colors.B }, { ...colors.C }, { ...colors.C }],
  ];
  const getColorKey = (cell) => cell.code;
  const plan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey: (k) => colors[k].rgb, maxColors: 2 });
  applyBudgetPlan(grid, getColorKey, plan, (k) => colors[k]);
  for (const cell of grid.flat()) {
    if (!cell) continue;
    assert.equal(paletteIdOf(cell), paletteIdOf(colors[cell.code]),
      `code ${cell.code} 带着陈旧 paletteId ${cell.paletteId}，应为 ${paletteIdOf(colors[cell.code])}`);
  }
});

test('applyBudgetPlan: 目标色无 paletteId 时移除来源色的陈旧身份', () => {
  // A 带身份且与 B/C 都远；B、C 相近且都不带身份 → 合并必然发生在 B/C 之间，
  // 目标色无 paletteId，来源色（若带）的陈旧身份必须被删除而不是残留。
  const colors = {
    A: { code: 'A', paletteId: 'test:A', rgb: [200, 10, 10], hex: '#C80A0A' },
    B: { code: 'B', rgb: [10, 10, 10], hex: '#0A0A0A' },
    C: { code: 'C', rgb: [12, 12, 12], hex: '#0C0C0C' },
  };
  const grid = [
    [{ ...colors.A }, { ...colors.A }, { ...colors.C }],
    [{ ...colors.B }, { ...colors.C }, { ...colors.C }],
  ];
  const getColorKey = (cell) => cell.code;
  const plan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey: (k) => colors[k].rgb, maxColors: 2 });
  applyBudgetPlan(grid, getColorKey, plan, (k) => colors[k]);
  for (const cell of grid.flat()) {
    if (!cell) continue;
    assert.equal(paletteIdOf(cell), paletteIdOf(colors[cell.code]),
      `code ${cell.code} 身份 ${paletteIdOf(cell)} 与色板条目 ${paletteIdOf(colors[cell.code])} 不一致`);
  }
  // 合并确实发生在 B/C 之间：存活格子里不该出现任何 B/C 之外的陈旧 id
  for (const cell of grid.flat()) {
    if (!cell || cell.code === 'A') continue;
    assert.equal(cell.paletteId, undefined, `code ${cell.code} 残留来源色陈旧 paletteId ${cell.paletteId}`);
  }
});

test('默认引擎路径（容差关闭）：预算合并后输出身份与 code 一致', () => {
  const palette = [
    { code: 'P1', paletteId: 'test:P1', rgb: [200, 30, 30], hex: '#C81E1E' },
    { code: 'P2', paletteId: 'test:P2', rgb: [30, 200, 30], hex: '#1EC81E' },
    { code: 'P3', paletteId: 'test:P3', rgb: [30, 30, 200], hex: '#1E1EC8' },
    { code: 'P4', paletteId: 'test:P4', rgb: [200, 200, 30], hex: '#C8C81E' },
  ];
  const w = 8, h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  const quad = (x0, y0, rgb) => {
    for (let y = y0; y < y0 + 4; y += 1) for (let x = x0; x < x0 + 4; x += 1) {
      const at = (y * w + x) * 4;
      data[at] = rgb[0]; data[at + 1] = rgb[1]; data[at + 2] = rgb[2]; data[at + 3] = 255;
    }
  };
  quad(0, 0, palette[0].rgb); quad(4, 0, palette[1].rgb);
  quad(0, 4, palette[2].rgb); quad(4, 4, palette[3].rgb);
  const result = runLocalFusionEngine({ image: { width: w, height: h, data }, size: { width: 8, height: 8 }, palette, maxColors: 2, sampler: 'v2-baseline' });
  const byCode = new Map(palette.map((p) => [p.code, p]));
  const mismatches = [];
  for (const cell of result.grid.flat()) {
    if (!cell) continue;
    const expected = byCode.get(cell.code);
    if (expected?.paletteId && cell.paletteId !== expected.paletteId) {
      mismatches.push(`code ${cell.code} paletteId ${cell.paletteId} ≠ ${expected.paletteId}`);
    }
  }
  assert.equal(mismatches.length, 0, `身份错配 ${mismatches.length} 格，例：${mismatches[0]}`);
});
