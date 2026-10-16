import test from 'node:test';
import assert from 'node:assert/strict';
import '../services/mard-kit-data.js';
import {MARD_FULL_COLORS} from '../smart-preprocessing/palette-data.mjs';
import {paletteKitLabel} from '../ui/palette-brand-cards.mjs';
test('MARD kits have exact unique memberships and preserve canonical color objects',()=>{
  const before=JSON.stringify(MARD_FULL_COLORS);
  assert.deepEqual(LibmsMardKits.options,[24,48,72,96,120,144,221,280,291]);
  for(const n of LibmsMardKits.options){const kit=LibmsMardKits.select(MARD_FULL_COLORS,n);assert.equal(kit.length,n);assert.equal(new Set(kit.map(c=>c.code)).size,n);assert.ok(kit.every(c=>MARD_FULL_COLORS.includes(c)));}
  const kit=LibmsMardKits.select(MARD_FULL_COLORS,24);
  assert.ok(kit.some(c=>c.code==='A4'));assert.ok(!kit.some(c=>c.code==='A1'));
  assert.deepEqual(kit.map(c=>c.code),['A4','A6','A7','B3','B5','B8','C3','C5','C8','D6','D7','D9','E2','E4','F5','G1','G5','G7','H1','H2','H3','H4','H5','H7']);
  assert.equal(JSON.stringify(MARD_FULL_COLORS),before);
  assert.equal(paletteKitLabel('mard-96'),'Kit 96');assert.equal(paletteKitLabel('mard-221'),'Standard 221');assert.equal(paletteKitLabel('mard-291'),'Complete 291');
});
