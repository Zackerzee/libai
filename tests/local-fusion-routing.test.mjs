import test from 'node:test';
import assert from 'node:assert/strict';
import { B4_BENCH_CLASSES, buildBenchGrid, rasterize } from './b4-bench-fixtures.mjs';
import { analyzeRoutingEvidence, runGenerationPipeline } from '../services/generation-pipeline.mjs';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';

const palette=[{code:'black',rgb:[0,0,0]},{code:'white',rgb:[255,255,255]},{code:'red',rgb:[220,40,40]}];
function imageFor(id) { return rasterize(buildBenchGrid(B4_BENCH_CLASSES.find(row=>row.id===id))); }
test('actual classifier pixel evidence selects native sampling, not fabricated routing',()=>{
 const image=imageFor('A');
 const evidence=analyzeRoutingEvidence(image);
 assert.equal(evidence.routing.mode,'pixel');
 assert.ok(evidence.routing.confidence>=0.75);
 const result=runLocalFusionEngine({image,size:{width:10,height:10},palette});
 assert.equal(result.fusion.strategy,'fusion-pindou-dominant');
 assert.deepEqual(result.fusion.evidence.routing,result.pipeline.analysis.routing);
});
test('actual hard-logo rule below fusion confidence gate remains V2 baseline',()=>{
 const image=imageFor('E');
 const evidence=analyzeRoutingEvidence(image);
 assert.equal(evidence.routing.mode,'logo');
 assert.match(evidence.routing.reason,/hard-rule/);
 assert.ok(evidence.routing.confidence<0.75);
 const request={image,size:{width:10,height:10},palette};
 const result=runLocalFusionEngine(request);
 assert.equal(result.fusion.strategy,'v2-baseline');
 assert.deepEqual(result.grid,runGenerationPipeline(request).grid);
});
test('explicit strategies reuse pipeline evidence for reporting',()=>{
 const result=runLocalFusionEngine({image:imageFor('E'),size:{width:10,height:10},palette,sampler:'v2-baseline'});
 assert.equal(result.fusion.evidence,result.pipeline.analysis);
});
