import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationRequest } from '../services/generation-request.mjs';
import { executeGenerationJob } from '../services/generation-job.mjs';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';
import { LOCAL_FUSION_SAMPLERS } from '../smart-preprocessing/local-fusion-sampler.mjs';

const data = new Uint8ClampedArray(16*12*4);
for (let i=0;i<16*12;i++) data.set([i%2?240:20,40,80,255],i*4);
const image = {data,width:16,height:12};
const palette = [{code:'A',rgb:[240,40,80]},{code:'B',rgb:[20,40,80]}];
const comparable = grid => grid.map(row=>row.map(cell=>cell?{code:cell.code,rgb:cell.rgb}:null));
for(const sampler of LOCAL_FUSION_SAMPLERS) test(`${sampler} survives the existing serializable job boundary`,()=>{
  const request=createGenerationRequest({requestId:17,image,size:{width:10,height:10},mode:'auto',palette,overrides:{localFusionSampler:sampler}});
  const copied=structuredClone(request);
  const result=executeGenerationJob(copied);
  assert.equal(result.ok,true);
  assert.equal(result.requestId,17);
  const direct=runGenerationPipeline({image,size:request.size,mode:'auto',palette,overrides:request.overrides});
  assert.deepEqual(comparable(result.grid),comparable(direct.grid));
});
test('unknown fusion name returns an explicit job error rather than baseline fallback',()=>{
  for(const name of ['fusion-pindou-unknown','nearest',42]) {
    const request=createGenerationRequest({requestId:18,image,size:{width:10,height:10},mode:'auto',palette,overrides:{localFusionSampler:name}});
    const result=executeGenerationJob(request);
    assert.equal(result.ok,false);
    assert.match(result.message,/融合采样/);
  }
});
