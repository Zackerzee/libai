import test from 'node:test';
import assert from 'node:assert/strict';
import { sameColorSelection, connectedSelection, selectionCells } from '../services/selection-service.js';

for (const select of [sameColorSelection, connectedSelection]) {
  test(`${select.name} separates brands sharing H01 and matches stable identities`, () => {
    const mard = { code: 'H01', paletteId: 'mard:H01' };
    const hama = { code: 'H01', paletteId: 'hama:H01' };
    const grid = [[mard, { ...mard, code: 'H1' }, hama]];
    assert.deepEqual(selectionCells(select(grid, 0, 0), 3, 1), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    assert.deepEqual(selectionCells(select(grid, 2, 0), 3, 1), [{ x: 2, y: 0 }]);
  });

  test(`${select.name} retains legacy code and blank selection`, () => {
    const grid = [[{ code: 'H01' }, { code: 'H01' }, null, null]];
    assert.equal(selectionCells(select(grid, 0, 0), 4, 1).length, 2);
    assert.equal(selectionCells(select(grid, 2, 0), 4, 1).length, 2);
  });

  test(`${select.name} supports a 400 by 400 uniform grid without argument overflow`, () => {
    const grid = Array.from({ length: 400 }, () => Array(400).fill({ code: 'H01' }));
    const selection = select(grid, 0, 0);
    assert.equal(selection.mask.size, 160000);
    assert.deepEqual([selection.x0, selection.y0, selection.x1, selection.y1], [0, 0, 399, 399]);
  });
}
