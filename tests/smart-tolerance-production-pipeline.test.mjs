import test from 'node:test';
import assert from 'node:assert/strict';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';

const palette = [
  { code: 'A', paletteId: 'brand:A', rgb: [120,120,120] },
  { code: 'B', paletteId: 'brand:B', rgb: [121,121,121] },
  { code: 'C', paletteId: 'brand:C', rgb: [230,30,30] },
];
function input(size=12) {
  const data=new Uint8ClampedArray(size*size*4);
  for(let i=0;i<size*size;i++) data.set([...palette[Math.floor((i%size)*3/size)].rgb,255],i*4);
  return {image:{width:size,height:size,data},size:{width:size,height:size},palette,mode:'pixel',maxColors:2};
}
const config=strength=>({enabled:true,strength,policy:'quality-first'});

test('production runner missing/disabled config is cell-for-cell identical across modes',()=>{
  for(const mode of ['auto','pixel','photo','illustration']) {
    const args={...input(),mode};
    assert.deepEqual(runGenerationPipeline({...args,overrides:{smartColorTolerance:{enabled:false,strength:100}}}).grid,
      runGenerationPipeline(args).grid);
  }
});
test('production runner forwards source evidence and applies tolerance only between cleanup/refine and budget',()=>{
  const phases=[];
  const context={sourceRevision:5,crop:{x:1},gridRevision:9};
  const out=runGenerationPipeline({...input(),overrides:{smartColorTolerance:config(80),smartToleranceContext:context},
    onPhase:phase=>phases.push(phase)});
  assert.deepEqual(out.diagnostics.smartToleranceBaseline.context,context);
  assert.ok(phases.indexOf('smart-color-tolerance')>phases.indexOf('smart-cleanup'));
  assert.ok(phases.indexOf('finalize')>phases.indexOf('smart-color-tolerance'));
  assert.equal(out.diagnostics.colorsAfterTolerance,out.diagnostics.smartColorTolerance.colorsAfterTolerance);
  assert.equal(out.diagnostics.colorsAfterBudget,new Set(out.grid.flat().filter(Boolean).map(c=>c.paletteId??c.code)).size);
});
test('baseline captures optional refine output before any budget mutation',()=>{
  const refined=Array.from({length:12},()=>Array.from({length:12},(_,x)=>structuredClone(palette[x%3])));
  const out=runGenerationPipeline({...input(),overrides:{smartColorTolerance:config(0)},
    lab:{id:'test-refine',refineGrid:()=>structuredClone(refined)}});
  assert.deepEqual(out.diagnostics.smartToleranceBaseline.grid,refined);
  assert.equal(out.diagnostics.smartColorTolerance.colorsBefore,3);
  assert.equal(out.diagnostics.smartColorTolerance.colorsAfterTolerance,3);
  assert.equal(out.diagnostics.smartColorTolerance.colorsAfterBudget,2);
});
