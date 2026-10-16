import test from 'node:test';
import assert from 'node:assert/strict';
import { findExteriorBackground } from '../services/exterior-background-service.mjs';
import { createEditorService } from '../services/editor-service.js';
const white = { paletteId: 'mard:H2', code: 'H2', rgb: [255,255,255] };
const outline = { paletteId: 'mard:G8', code: 'G8', rgb: [70,30,20] };
const enclosed = () => Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => x === 0 || y === 0 || x === 4 || y === 4 || (x === 2 && y === 2) ? white : outline));
test('exterior flood preserves enclosed same-palette white and does not mutate grid', () => {
  const grid = enclosed(), before = JSON.stringify(grid), found = findExteriorBackground(grid);
  assert.equal(found.cells.length, 16); assert.equal(found.selection.mask.has('2,2'), false);
  assert.equal(JSON.stringify(grid), before);
});
test('same RGB different palette identity is not erased', () => {
  const grid = enclosed(); grid[0][2] = { ...white, paletteId: 'other:H2' };
  const found = findExteriorBackground(grid);
  assert.equal(found.paletteId, white.paletteId); assert.equal(found.cells.length, 15);
  assert.equal(found.selection.mask.has('2,0'), false);
});
test('mostly null border or mixed edge never infers a touching subject as background', () => {
  assert.equal(findExteriorBackground([[null, outline, null], [null, outline, null], [null,null,null]]), null);
  assert.equal(findExteriorBackground([[white,outline],[outline,white]]), null);
});
test('diagonal-only white is not exterior and empty grid is safe', () => {
  const grid = [[white, outline, outline], [outline, white, outline], [outline, outline, outline]];
  // Explicitly dominant border color is selected deterministically, not a guessed RGB white.
  assert.equal(findExteriorBackground(grid).paletteId, outline.paletteId);
  const closed = enclosed(); closed[1][1] = white;
  assert.equal(findExteriorBackground(closed).selection.mask.has('2,2'), false);
  assert.equal(findExteriorBackground([]), null);
  assert.equal(findExteriorBackground([[null,null],[null,null]]), null);
});
test('existing eraseSelection uses one undo and restores all exact cells and usage', () => {
  const grid = enclosed(), before = structuredClone(grid);
  const bridge = { getResult: () => ({ grid, width: 5, height: 5 }), getCell: (x,y) => grid[y][x], getPaletteColors: () => [white,outline], applyCellChanges(changes) { for (const { x,y,after } of changes) grid[y][x] = after; return true; } };
  const editor = createEditorService(bridge), found = findExteriorBackground(grid);
  editor.eraseSelection(found.selection);
  assert.equal(editor.historyDepth().undo, 1); assert.equal(editor.getPaletteUsageCounts().get(white.paletteId), 1);
  editor.undo(); assert.deepEqual(grid, before); assert.equal(editor.getPaletteUsageCounts().get(white.paletteId), 17);
  editor.redo(); assert.equal(grid[0][0], null); assert.equal(grid[2][2].paletteId, white.paletteId);
});
