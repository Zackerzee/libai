import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationRequest, createGenerationResult } from '../services/generation-request.mjs';
import { executeGenerationJob } from '../services/generation-job.mjs';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';
import { encodeGenerationResult, decodeGenerationResult } from '../services/generation-result-codec.mjs';

const palette = [{ code: 'H02', paletteId: 'mard:H02', rgb: [255,255,255] }, { code: 'F03', paletteId: 'mard:F03', rgb: [240,40,80] }];
function image(transparent = false) {
  const data = new Uint8ClampedArray(24*18*4);
  for (let y=0;y<18;y++) for (let x=0;x<24;x++) data.set([...(x<12?palette[0].rgb:palette[1].rgb),transparent?0:255],(y*24+x)*4);
  return {data,width:24,height:18};
}
function request(overrides={},size={width:24,height:18},source=image()) {
  return structuredClone(createGenerationRequest({requestId:31,image:source,size,mode:'auto',palette,maxColors:2,overrides}));
}
for (const enabled of [undefined,false]) test(`disabled opt-in ${enabled}: full grid and diagnostics equal established pipeline`,()=>{
  const req=request(enabled===undefined?{}:{localFusionEnabled:enabled});
  const result=executeGenerationJob(req);
  const expected=runGenerationPipeline({...req});
  assert.equal(result.ok,true);
  assert.deepEqual(result.grid,createGenerationResult(expected).grid);
  assert.equal(result.diagnostics.localFusion,undefined);
  assert.deepEqual(result.pipeline,expected.pipeline);
});
for (const size of [{width:97,height:97},{width:104,height:78}]) test(`production serializable fusion respects explicit ${size.width}x${size.height} and codec`,()=>{
  const req=request({localFusionEnabled:true},size);
  const result=executeGenerationJob(req);
  const direct=runLocalFusionEngine({...req});
  assert.equal(result.ok,true);
  assert.equal(result.width,size.width); assert.equal(result.height,size.height);
  assert.deepEqual(result.grid,createGenerationResult(direct).grid);
  assert.equal(result.grid.length,size.height);
  assert.ok(result.grid.every(row=>row.length===size.width));
  for(const cell of result.grid.flat().filter(Boolean)) {
    const p=req.palette.find(p=>p.code===cell.code);
    assert.ok(p); assert.deepEqual(cell.rgb,p.rgb);
    if(p.paletteId) assert.equal(cell.paletteId,p.paletteId);
  }
  const restored=decodeGenerationResult(structuredClone(encodeGenerationResult(result)));
  assert.deepEqual(restored.grid,result.grid);
  assert.deepEqual(restored.pipeline.fusion,result.pipeline.fusion);
  assert.equal(result.diagnostics.localFusion.scope,'sampling-only');
});
test('transparent input stays null through unified production and source is immutable',()=>{
  const req=request({localFusionEnabled:true},{width:20,height:15},image(true));
  const before=structuredClone(req);
  const result=executeGenerationJob(req);
  assert.equal(result.ok,true);
  assert.ok(result.grid.flat().every(cell=>cell===null));
  assert.deepEqual(req,before);
});
test('production auto conservatively falls back for multicolor high-frequency input',()=>{
  const source=image();
  let seed=987;
  for(let i=0;i<source.data.length;i+=4) for(let c=0;c<3;c++) { seed=(Math.imul(seed,1664525)+1013904223)>>>0; source.data[i+c]=seed>>>24; }
  const req=request({localFusionEnabled:true},undefined,source);
  const result=executeGenerationJob(req);
  assert.equal(result.ok,true);
  assert.equal(result.pipeline.fusion.strategy,'v2-baseline');
  assert.equal(result.pipeline.fusion.reason,'conservative-v2-fallback');
  const baseline=runGenerationPipeline({...req,overrides:{}});
  assert.deepEqual(result.grid,createGenerationResult(baseline).grid);
});
