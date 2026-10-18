import test from 'node:test';
import assert from 'node:assert/strict';
import {textColorTargetPatch} from '../services/text-color-target.mjs';
import {textLayerValidationMessage} from '../services/text-layer-service.js';
const red={paletteId:'mard:F03',code:'F03',rgb:[255,0,0]};
test('shared palette target stores exact identity for all effect roles and gradient stops',()=>{
  const layer={gradientStops:[{paletteId:'old'}, {paletteId:'other'}]};
  assert.deepEqual(textColorTargetPatch(layer,{role:'text'},red,[red]),{color:'F03',paletteId:'mard:F03',textHex:''});
  for(const role of ['shadow','backplate','border','glow']) {
    const p=textColorTargetPatch(layer,{role},red,[red]);assert.equal(p[role+'PaletteId'],red.paletteId);assert.equal(p[role+'Hex'],'#ff0000');
  }
  const p=textColorTargetPatch(layer,{role:'gradient',index:1},red,[red]);
  assert.equal(p.gradientStops[1].paletteId,red.paletteId);assert.equal(layer.gradientStops[1].paletteId,'other');
});
test('shared picker rejects unavailable, stale, locked and unknown targets',()=>{
  assert.throws(()=>textColorTargetPatch({},{role:'text'},red,[]),/可用/);
  assert.throws(()=>textColorTargetPatch({locked:true},{role:'text'},red,[red]),/解锁/);
  assert.throws(()=>textColorTargetPatch({gradientStops:[]},{role:'gradient',index:0},red,[red]),/已改变/);
  assert.throws(()=>textColorTargetPatch({},{role:'unknown'},red,[red]),/未知/);
});
test('bitmap missing glyph reports clear Chinese fallback guidance',()=>{
  assert.match(textLayerValidationMessage({font:'pixel-5x7',text:'中文'}),/中文请选择/);
  assert.equal(textLayerValidationMessage({font:'pixel-5x7',text:'HELLO'}),'');
  assert.equal(textLayerValidationMessage({font:'system',text:'中文'}),'');
});
