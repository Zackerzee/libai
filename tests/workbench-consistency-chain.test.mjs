/**
 * Phase 3 工作台一致性：生成 → 保存 → 重导 完整链路。
 *
 * 既有测试（pixler-brand-roundtrip / export-v2）用手搭格子验证格式层；
 * 本文件从**真实引擎输出**出发——含预算合并与 paletteId 身份同步——
 * 走 .pixler 保存再导入，逐格比对颜色与身份。
 * 目标是证明：合并过的格子在工程往返后不丢色、不错身份、不减色数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';
import { buildPixlerProject } from '../services/pixler-exporter.js';
import { importPixlerProject } from '../importers/pixler.mjs';
import { paletteIdOf } from '../services/palette-identity.js';

const PALETTE = [
  { code: 'P1', paletteId: 'mard:P1', rgb: [200, 30, 30], hex: '#C81E1E', name: '红一' },
  { code: 'P2', paletteId: 'mard:P2', rgb: [30, 200, 30], hex: '#1EC81E', name: '绿一' },
  { code: 'P3', paletteId: 'mard:P3', rgb: [30, 30, 200], hex: '#1E1EC8', name: '蓝一' },
  { code: 'P4', paletteId: 'mard:P4', rgb: [200, 200, 30], hex: '#C8C81E', name: '黄一' },
];

function syntheticImage() {
  const w = 8, h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  const quad = (x0, y0, rgb) => {
    for (let y = y0; y < y0 + 4; y += 1) for (let x = x0; x < x0 + 4; x += 1) {
      const at = (y * w + x) * 4;
      data[at] = rgb[0]; data[at + 1] = rgb[1]; data[at + 2] = rgb[2]; data[at + 3] = 255;
    }
  };
  quad(0, 0, PALETTE[0].rgb); quad(4, 0, PALETTE[1].rgb);
  quad(0, 4, PALETTE[2].rgb); quad(4, 4, PALETTE[3].rgb);
  return { width: w, height: h, data };
}

test('生成（含预算合并）→ 保存 → 重导：逐格颜色与身份不变，色数不减', async () => {
  const result = runLocalFusionEngine({
    image: syntheticImage(), size: { width: 8, height: 8 }, palette: PALETTE, maxColors: 2, sampler: 'v2-baseline',
  });
  const grid = result.grid;
  const mergedCells = grid.flat().filter(Boolean).length;
  const beforeIds = new Set(grid.flat().filter(Boolean).map(paletteIdOf));
  assert.ok(beforeIds.size >= 1 && beforeIds.size <= 2, `预算后色数异常：${beforeIds.size}`);

  const { project } = await importPixlerProject(await buildPixlerProject(grid, { title: '链路测试', paletteLabel: 'MARD 291' }));

  // 逐格比对：code、rgb、paletteId 三者都不能变
  let mismatches = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      const before = grid[y][x], after = project.grid[y]?.[x] ?? null;
      if (!before || !after) { if (!!before !== !!after) mismatches += 1; continue; }
      const afterId = project.gridPaletteIds[y]?.[x] ?? null;
      if (before.code !== after || paletteIdOf(before) !== afterId) { mismatches += 1; continue; }
      if (before.rgb.some((v, i) => v !== project.colors.find(c => c.paletteId === afterId)?.rgb?.[i])) mismatches += 1;
    }
  }
  assert.equal(mismatches, 0, `往返后有 ${mismatches} 格颜色或身份丢失`);

  // 色数与身份集合不能因往返增减
  const afterIds = new Set(project.gridPaletteIds.flat().filter(Boolean));
  assert.deepEqual([...afterIds].sort(), [...beforeIds].sort(), '往返后身份集合变化');
  assert.equal(project.stats.usedColors, beforeIds.size, '往返后色数变化');
  assert.ok(mergedCells > 0);
});

test('合并格子的身份在工程里不塌并（同 code 不同身份保持两条）', async () => {
  const result = runLocalFusionEngine({
    image: syntheticImage(), size: { width: 8, height: 8 }, palette: PALETTE, maxColors: 2, sampler: 'v2-baseline',
  });
  const grid = result.grid;
  const byId = new Map();
  for (const cell of grid.flat()) {
    if (!cell) continue;
    const id = paletteIdOf(cell);
    if (!byId.has(id)) byId.set(id, cell);
    // 同一身份下的 code/rgb 必须自洁
    assert.equal(byId.get(id).code, cell.code, `身份 ${id} 下出现多个 code`);
  }
  const { project } = await importPixlerProject(await buildPixlerProject(grid));
  assert.equal(project.colors.filter(c => c.code).length, byId.size, '工程颜色条目数与网格身份数不一致');
  for (const cell of grid.flat()) {
    if (!cell) continue;
    const entry = project.colors.find(c => c.paletteId === paletteIdOf(cell));
    assert.ok(entry, `身份 ${paletteIdOf(cell)} 在工程中缺失`);
    assert.equal(entry.code, cell.code);
    assert.deepEqual(entry.rgb, cell.rgb);
  }
});
