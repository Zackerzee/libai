import test from 'node:test';
import assert from 'node:assert/strict';
import { textPaletteChoices } from '../ui/text-panel.js';
import { composeLockedTextGrid } from '../services/text-layer-service.js';

test('text choices contain only used palette identities, never unused same-RGB brands', () => {
  const a = {paletteId:'a:H01',code:'H01',rgb:[255,255,255]};
  const b = {paletteId:'b:H01',code:'H01',rgb:[255,255,255]};
  const unused = {paletteId:'a:H02',code:'H02',rgb:[0,0,0]};
  assert.deepEqual(textPaletteChoices([a,b,unused],[[a,null],[a,b]]),[a,b]);
  assert.deepEqual(textPaletteChoices([a,b,unused],[[a]]),[a]);
});
test('empty artwork offers no out-of-work color', () => {
  assert.deepEqual(textPaletteChoices([{paletteId:'a:H01',code:'H01'}],[[null]]),[]);
});
test('a 24-color work exposes exactly 24 entries from the 221-color card', () => {
  const palette=Array.from({length:221},(_,i)=>({paletteId:`mard:${i}`,code:`C${i}`,rgb:[i,0,0]}));
  assert.equal(textPaletteChoices(palette,[palette.slice(0,24)]).length,24);
});
test('effect palette identity wins over same-RGB fallback without editing base', () => {
  const a={paletteId:'a:H01',code:'H01',rgb:[255,255,255]},b={paletteId:'b:H01',code:'H01',rgb:[255,255,255]};
  const base=[[null]];
  const output=composeLockedTextGrid(base,[{locked:true,shadowPaletteId:b.paletteId}], [a,b], {rasterize:()=>({paintLayers:[{role:'shadow',color:'#ffffff',cells:[{x:0,y:0}]}]})});
  assert.equal(output[0][0],b);assert.equal(base[0][0],null);
});
