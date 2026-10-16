import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sameColorSelection, connectedSelection, selectionCells } from '../services/selection-service.js';
const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('new same-color and connected picks are not confined to the previous region', () => {
  const grid = [[{code:'A'}, {code:'A'}, {code:'B'}, {code:'B'}]];
  for (const select of [sameColorSelection, connectedSelection]) {
    const old = select(grid, 0, 0);
    assert.deepEqual(selectionCells(select(grid, 2, 0), 4, 1), [{x:2,y:0},{x:3,y:0}]);
    assert.equal(select(grid, 2, 0, old), null);
  }
  assert.match(source, /const within = event\.shiftKey \? get\(\)\.editor\.selection : null/);
  assert.match(source, /selectionUI\?\.within\(\) \? get\(\)\.editor\.selection : null/);
});
test('drawing tools release old masks and ordinary clicks replace region focus', () => {
  assert.match(source, /onToolChange: \(tool\) => \{\s*endDrag\(true\);\s*cellColorPopover\.close\(\);/);
  assert.match(source, /releaseSelection \? \{ selection: null, selectedCell: null, shapePreview: null \}/);
  assert.match(source, /!drag\.moved \? \{ selection: null \} : \{\}/);
  const rightPick = source.slice(source.indexOf('if (event.button === 2 && cell)'), source.indexOf('if (tool === "pan" || spaceDown'));
  assert.doesNotMatch(rightPick, /selection: null/);
  const eyedropper = source.slice(source.indexOf('if (tool === "eyedropper" && cell)'), source.indexOf('if (tool === "bead" && cell)'));
  const pickHelper = source.slice(source.indexOf('const pickCellColor'), source.indexOf('const updateEyedropperDwell'));
  assert.doesNotMatch(eyedropper, /cellColorPopover\.open/);
  assert.match(eyedropper, /pickCellColor\(cell\)/);
  assert.match(pickHelper, /get\(\)\.editor\.tool === "eyedropper" && !get\(\)\.editor\.selection/);
});
