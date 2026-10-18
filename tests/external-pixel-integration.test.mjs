import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTERNAL_PIXEL_SAMPLERS } from '../smart-preprocessing/local-fusion-sampler.mjs';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';
import { createGenerationRequest, createGenerationResult } from '../services/generation-request.mjs';
import { executeGenerationJob } from '../services/generation-job.mjs';
import { encodeGenerationResult, decodeGenerationResult } from '../services/generation-result-codec.mjs';
import '../services/automatic-palette-policy.js';
import { MARD_FULL_COLORS } from '../smart-preprocessing/palette-data.mjs';

const paletteFor = brand => [
  { code: 'W', paletteId: `${brand}:W`, rgb: [255,255,255] },
  { code: 'R', paletteId: `${brand}:R`, rgb: [230,35,60] },
  { code: 'B', paletteId: `${brand}:B`, rgb: [30,60,200] },
];
function source(alpha = 'half') {
  const width=32,height=24,data=new Uint8ClampedArray(width*height*4);
  const palette=paletteFor('fixture');
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const rgb=palette[Math.floor(y/8)%palette.length].rgb;
    const a=alpha==='none'?0:alpha==='opaque'?255:x<width/2?0:255;
    data.set([...rgb,a],(y*width+x)*4);
  }
  return {width,height,data};
}
function request(sampler,size={width:52,height:52},palette=paletteFor('brand-a'),image=source(),maxColors=3) {
  return createGenerationRequest({requestId:73,image,size,palette,mode:'auto',maxColors,
    overrides:{localFusionEnabled:true,localFusionSampler:sampler}});
}
function legalGrid(grid,palette,size) {
  assert.equal(grid.length,size.height);
  assert.ok(grid.every(row=>row.length===size.width));
  let count=0;
  for(const cell of grid.flat()) {
    if(!cell) continue;
    count++;
    const color=palette.find(p=>p.paletteId===cell.paletteId);
    assert.ok(color,`foreign palette identity ${cell.paletteId}`);
    assert.equal(cell.code,color.code);
    assert.deepEqual(cell.rgb,color.rgb);
  }
  return count;
}

test('external integration exposes exactly the two audited explicit strategies',()=>{
  assert.deepEqual(EXTERNAL_PIXEL_SAMPLERS,['fusion-pixel-art-fixer','fusion-image-to-pixel']);
});
for(const sampler of EXTERNAL_PIXEL_SAMPLERS) {
  for(const size of [{width:52,height:52},{width:97,height:97},{width:104,height:78},{width:78,height:104}]) {
    test(`${sampler}: requested ${size.width}x${size.height}, legal identities, direct/job parity, clone codec`,()=>{
      const req=request(sampler,size),before=structuredClone(req);
      const direct=runLocalFusionEngine({...req,sampler});
      const job=executeGenerationJob(structuredClone(req));
      assert.equal(job.ok,true,job.error?.message);
      assert.equal(job.width,size.width); assert.equal(job.height,size.height);
      assert.deepEqual(job.grid,createGenerationResult(direct).grid);
      assert.equal(job.pipeline.fusion.strategy,sampler);
      const count=legalGrid(job.grid,req.palette,size);
      assert.ok(count>0&&count<size.width*size.height,'transparent half is retained');
      assert.equal(job.grid[Math.floor(size.height/2)][0],null);
      assert.ok(job.grid[Math.floor(size.height/2)][size.width-1]);
      const restored=decodeGenerationResult(structuredClone(encodeGenerationResult(job)));
      assert.deepEqual(restored.grid,job.grid);
      assert.deepEqual(req,before,'generation must not mutate RGBA, palette, or request');
    });
  }
  test(`${sampler}: deterministic across repeated executions`,()=>{
    const req=request(sampler,{width:20,height:15});
    assert.deepEqual(executeGenerationJob(req).grid,executeGenerationJob(req).grid);
  });
  test(`${sampler}: all-transparent RGBA cannot acquire a color`,()=>{
    const req=request(sampler,{width:20,height:15},paletteFor('brand-a'),source('none'));
    const result=executeGenerationJob(req);
    assert.equal(result.ok,true);
    assert.ok(result.grid.flat().every(cell=>cell===null));
  });
  test(`${sampler}: current available subset only, including hard budget identity`,()=>{
    const available=paletteFor('brand-a').slice(1);
    const req=request(sampler,{width:26,height:20},available,source('opaque'),1);
    const result=executeGenerationJob(req);
    assert.equal(result.ok,true);
    assert.ok(legalGrid(result.grid,available,req.size)>0);
    assert.equal(new Set(result.grid.flat().filter(Boolean).map(c=>c.paletteId)).size,1);
  });
  test(`${sampler}: identical RGB/code in another brand never leaks previous brand identity`,()=>{
    for(const brand of ['mard-test','perler-test','mard-test']) {
      const req=request(sampler,{width:20,height:15},paletteFor(brand),source('opaque'));
      const result=executeGenerationJob(req);
      assert.equal(result.ok,true);
      assert.ok(legalGrid(result.grid,req.palette,req.size)>0);
    }
  });
  test(`${sampler}: simultaneous brands with identical RGB/code retain a complete legal identity`,()=>{
    const palette=[...paletteFor('brand-a'),...paletteFor('brand-b')];
    const req=request(sampler,{width:20,height:15},palette,source('opaque'));
    const result=executeGenerationJob(req);
    assert.equal(result.ok,true);
    assert.ok(legalGrid(result.grid,req.palette,req.size)>0);
  });
  test(`${sampler}: production automatic MARD policy excludes H01 while opaque near-white stays H02 and alpha stays null`,()=>{
    const catalog=['H1','H2','H7'].map(code=>{
      const color=MARD_FULL_COLORS.find(c=>c.code===code);
      assert.ok(color,`actual MARD catalog contains ${code}`);
      const displayCode=code.replace(/^H(\d)$/,'H0$1');
      return {...color,code:displayCode,paletteId:`mard:${displayCode}`,brand:'MARD'};
    });
    const before=structuredClone(catalog);
    const available=globalThis.LibmsAutomaticPalettePolicy.automaticPaletteColors(catalog,'mard');
    assert.deepEqual(available.map(c=>c.code),['H02','H07']);
    const width=20,height=10,data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) data.set([...catalog[0].rgb,x<10?0:255],(y*width+x)*4);
    const req=request(sampler,{width,height},available,{width,height,data});
    const result=executeGenerationJob(req);
    assert.equal(result.ok,true);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      if(x<10) assert.equal(result.grid[y][x],null);
      else { assert.equal(result.grid[y][x]?.code,'H02'); assert.equal(result.grid[y][x]?.paletteId,'mard:H02'); }
    }
    assert.deepEqual(catalog,before,'automatic filtering never mutates manual catalog');
  });
  test(`${sampler}: production policy preserves COCO H01 as an opaque legal color`,()=>{
    const color={code:'H01',paletteId:'coco:H01',brand:'COCO',rgb:[205,232,255]};
    const available=globalThis.LibmsAutomaticPalettePolicy.automaticPaletteColors([color],'coco');
    assert.deepEqual(available,[color]);
    const width=20,height=10,data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<data.length;i+=4) data.set([...color.rgb,255],i);
    const req=request(sampler,{width,height},available,{width,height,data},1);
    const result=executeGenerationJob(req);
    assert.equal(result.ok,true);
    assert.equal(legalGrid(result.grid,available,req.size),width*height);
    assert.ok(result.grid.flat().every(c=>c.code==='H01'&&c.paletteId==='coco:H01'));
  });
}
test('explicit v2-baseline is byte-for-byte grid equivalent to the established pipeline',()=>{
  const req=request('v2-baseline',{width:26,height:20});
  assert.deepEqual(runLocalFusionEngine({...req,sampler:'v2-baseline'}).grid,runGenerationPipeline({...req,overrides:{}}).grid);
});
