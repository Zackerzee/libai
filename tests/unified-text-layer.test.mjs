import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextLayer, rasterizeText, rasterizeTextCached, composeLockedTextGrid } from '../services/text-layer-service.js';

const a = { paletteId: 'mard:A', code: 'A', rgb: [255,0,0], hex: '#ff0000' };
const b = { paletteId: 'mard:B', code: 'B', rgb: [0,0,255], hex: '#0000ff' };
const bitmap = changes => createTextLayer({ text:'AB', font:'pixel-5x7', x:30, y:30, ...changes });

test('editable bitmap text renders without a canvas and regenerates for changed content', () => {
  const first = rasterizeText(bitmap({text:'A'}),64,64), second = rasterizeText(bitmap({text:'B'}),64,64);
  assert.ok(first.cells.length);
  assert.notDeepEqual(first.cells, second.cells);
});
test('bitmap vertical, newline, spacing, scale and rotation transform the same editable layer', () => {
  const original = rasterizeText(bitmap(),100,100);
  assert.ok(rasterizeText(bitmap({writingMode:'vertical'}),100,100).height > original.height);
  assert.ok(rasterizeText(bitmap({spacing:3}),100,100).width > original.width);
  assert.ok(rasterizeText(bitmap({text:'A\nB'}),100,100).height > original.height);
  assert.ok(rasterizeText(bitmap({scale:200}),100,100).cells.length > original.cells.length);
  assert.notDeepEqual(rasterizeText(bitmap({rotation:90}),100,100).cells, original.cells);
});
test('bitmap text shares all existing plate effects', () => {
  const result = rasterizeText(bitmap({backplateEnabled:true,shadowEnabled:true,glowEnabled:true,borderStyle:'solid'}),64,64);
  assert.deepEqual(result.paintLayers.map(g=>g.role), ['backplate','glow','shadow','border','text']);
});
test('gradient uses legal stop identities and cached changes are independent', () => {
  const layer = bitmap({ colorMode:'gradient', gradientStops:[a,b] });
  const result = rasterizeTextCached(layer,64,64);
  assert.deepEqual(result.paintLayers.map(g=>g.paletteId), [a.paletteId,b.paletteId]);
  assert.ok(result.paintLayers.every(g=>g.cells.length));
  assert.notStrictEqual(rasterizeTextCached({...layer,gradientDirection:'vertical'},64,64), result);
  assert.strictEqual(rasterizeTextCached(layer,64,64), result);
});
test('imported grid remains independent, null-transparent and exact on locked export', () => {
  const grid = [[a,null],[null,b]], before = structuredClone(grid);
  const layer = createTextLayer({rasterGrid:grid,x:1,y:1,locked:true});
  const base = [[null,a],[a,null]];
  const output = composeLockedTextGrid(base,[layer],[a,b]);
  assert.deepEqual(output,[[a,a],[a,b]]);
  assert.deepEqual(base,[[null,a],[a,null]]);
  assert.deepEqual(grid,before);
});
test('code-only imported colors resolve within current palette; missing identities never recolor', () => {
  const layer = createTextLayer({rasterGrid:[[{code:'B',rgb:[0,0,255]}]],x:.5,y:.5,locked:true,paletteId:a.paletteId});
  assert.strictEqual(composeLockedTextGrid([[null]],[layer],[a,b])[0][0],b);
  assert.strictEqual(composeLockedTextGrid([[null]],[{...layer,rasterGrid:[[{paletteId:'missing',code:'A',rgb:[255,0,0]}]]}],[a,b])[0][0],null);
});

test('large enlarged imported layer is bounded by the visible canvas and preserves source identity', () => {
  const rasterGrid = Array.from({length:500}, () => Array(500).fill(a));
  const layer = createTextLayer({rasterGrid,x:16,y:16,scale:2000,rotation:37});
  const result = rasterizeText(layer,32,32);
  assert.equal(result.cells.length,32*32);
  assert.equal(new Set(result.cells.map(c=>`${c.x},${c.y}`)).size,32*32);
  assert.equal(result.paintLayers.length,1);
  assert.equal(result.paintLayers[0].paletteId,a.paletteId);
  assert.ok(result.cells.every(c=>c.x>=0 && c.x<32 && c.y>=0 && c.y<32));
});
