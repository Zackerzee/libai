import test from 'node:test';
import assert from 'node:assert/strict';
import {boundAutomaticFusionStrategy,runLocalFusionEngine} from '../services/local-fusion-engine.mjs';
test('automatic large source fallback is reported without overriding requested output dimensions',()=>{
  const initial={sampler:'fusion-pixel-art-fixer',reason:'high-confidence-flat-or-pixel'};
  assert.equal(boundAutomaticFusionStrategy(initial,{width:2000,height:2000}),initial);
  const medium=boundAutomaticFusionStrategy(initial,{width:2001,height:2000});
  assert.equal(medium.sampler,'fusion-image-to-pixel');
  assert.equal(medium.sourceSizeFallback.requested,initial.sampler);
  const large=boundAutomaticFusionStrategy(initial,{width:5000,height:4000});
  assert.equal(large.sampler,'fusion-pindou-dominant');
  assert.equal(large.sourceSizeFallback.sourcePixels,20_000_000);
  assert.equal(boundAutomaticFusionStrategy({sampler:null},{width:5000,height:4000}).sampler,null);
});
test('real auto-classified 2048-square pixel source safely generates requested non-square grid',()=>{
  const width=2048,height=2048,data=new Uint8ClampedArray(width*height*4);
  const palette=[{code:'R',paletteId:'mard:R',rgb:[240,30,30]},{code:'B',paletteId:'mard:B',rgb:[30,30,240]}];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...palette[((x>>4)+(y>>4))%2].rgb,255],(y*width+x)*4);
  const result=runLocalFusionEngine({image:{width,height,data},size:{width:52,height:39},palette});
  assert.equal(result.width,52);assert.equal(result.height,39);
  assert.equal(result.fusion.strategy,'fusion-image-to-pixel');
  assert.equal(result.fusion.sourceSizeFallback.requested,'fusion-pixel-art-fixer');
  assert.ok(result.grid.flat().filter(Boolean).every(cell=>palette.some(p=>p.paletteId===cell.paletteId&&p.code===cell.code&&p.rgb.every((v,i)=>v===cell.rgb[i]))));
});
