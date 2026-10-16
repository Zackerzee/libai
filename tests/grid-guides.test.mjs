import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guideInterval,guideIndices,rulerEntries} from '../ui/grid-guides.mjs';
test('main grid interval is bounded and aligned to canonical origin',()=>{
  assert.equal(guideInterval(1),3);assert.equal(guideInterval(90),50);assert.equal(guideInterval(NaN),5);
  assert.deepEqual(guideIndices(7,22,5),[10,15,20]);
});
test('canvas main grid stays hairline solid and rulers remain compact',()=>{
  const source=readFileSync(new URL('../ui/canvas-renderer.js',import.meta.url),'utf8');
  assert.match(source,/guide\.lineWidth=\.85 \/ b\.dpr/);
  assert.match(source,/guide\.strokeStyle=gridGuideInk/);
  assert.match(source,/guide\.fillRect\(x,y,cell,cell\)/);
  assert.match(source,/if\(cell<4\)return/);
});
test('rulers are one-based with major intervals and adaptive density',()=>{
  const entries=rulerEntries(0,12,12,30,5);
  assert.equal(entries.length,12);assert.equal(entries[0].number,1);assert.equal(entries[4].major,true);
  assert.deepEqual(rulerEntries(0,12,12,9,5).map(n=>n.number),[1,5,12]);
  assert.deepEqual(rulerEntries(6,10,12,30,5).map(n=>n.number),[7,8,9,10]);
});
test('20% rulers retain first and last coordinates without crowded labels',()=>{
  const entries=rulerEntries(0,104,104,4,5);
  assert.equal(entries[0].number,1);assert.equal(entries.at(-1).number,104);
  assert.ok(entries.length>2);
  for(let i=1;i<entries.length;i++)assert.ok((entries[i].index-entries[i-1].index)*4>=26);
});
