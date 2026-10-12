import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imagePointAt, referencePointAt } from '../services/reference-color-pick.mjs';

test('actual image points exclude margins and far edge', () => {
  const box = { x: 10, y: 20, width: 100, height: 50 };
  assert.deepEqual(imagePointAt({x:60,y:45},box),{x:.5,y:.5});
  for (const p of [{x:9,y:40},{x:110,y:40},{x:40,y:70},{x:NaN,y:40}]) assert.equal(imagePointAt(p,box),null);
});
test('reference picking respects contain letterbox, cover, pan, zoom, offset and scale', () => {
  const box = {x:100,y:200,width:200,height:200,cell:20};
  assert.equal(referencePointAt({x:150,y:220},400,200,box,{fit:'contain'}),null);
  assert.deepEqual(referencePointAt({x:200,y:300},400,200,box,{fit:'contain'}),{x:.5,y:.5});
  assert.deepEqual(referencePointAt({x:100,y:300},400,200,box,{fit:'cover'}),{x:.25,y:.5});
  assert.deepEqual(referencePointAt({x:240,y:280},400,200,box,{fit:'contain',offsetX:2,offsetY:-1,scale:2}),{x:.5,y:.5});
  assert.equal(referencePointAt({x:301,y:300},400,200,box,{fit:'cover'}),null);
});
test('shortcut preserves normal right-click, actual pixel sampling and selected tool', () => {
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  const start=source.indexOf("well.addEventListener('contextmenu'");
  const end=source.indexOf("well.addEventListener('pointermove'",start);
  const handler=source.slice(start,end);
  assert.match(handler,/event\.shiftKey/);
  assert.match(handler,/sampleOriginalSource\(imagePoint, image\)/);
  assert.match(handler,/gridRevision !== originalContext\.revision/);
  assert.match(handler,/else pickCurrentColor\(paletteIdOf\(color\)\)/);
  assert.doesNotMatch(handler,/setState|applyCellChanges|processImage|activePanel:/);
  assert.match(source,/getImageData\(0,0,1,1\)/);
  assert.match(source,/rgba\[3\] === 0/);
});
