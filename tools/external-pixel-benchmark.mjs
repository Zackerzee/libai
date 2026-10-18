/** Node wall-time measurements, not browser main-thread or visual-quality evidence. */
import { performance } from 'node:perf_hooks';
import { samplePixelArtFixer } from '../smart-preprocessing/pixel-art-fixer-sampler.mjs';
import { sampleImageToPixel } from '../smart-preprocessing/image-to-pixel-sampler.mjs';
import { createGenerationRequest } from '../services/generation-request.mjs';
import { executeGenerationJob } from '../services/generation-job.mjs';

const palette=[{code:'W',paletteId:'bench:W',rgb:[255,255,255]},
  {code:'R',paletteId:'bench:R',rgb:[230,35,60]},
  {code:'B',paletteId:'bench:B',rgb:[30,60,200]}];
const width=256,height=256,data=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  const rgb=palette[(Math.floor(x/16)+Math.floor(y/16))%palette.length].rgb;
  data.set([...rgb,x<width/4?0:255],(y*width+x)*4);
}
const image={width,height,data},rows=[];
const strategies=[['fusion-pixel-art-fixer',samplePixelArtFixer],['fusion-image-to-pixel',sampleImageToPixel]];
function measure(fn) {
  const ms=[];
  for(let i=0;i<3;i++) { const start=performance.now(); fn(); ms.push(performance.now()-start); }
  const sorted=[...ms].sort((a,b)=>a-b);
  return {samplesMs:ms.map(v=>+v.toFixed(3)),medianMs:+sorted[1].toFixed(3),maxMs:+sorted[2].toFixed(3)};
}
for(const size of [52,97,104,256]) for(const [sampler,raw] of strategies) {
  const req=createGenerationRequest({requestId:1,image,size:{width:size,height:size},mode:'auto',palette,maxColors:3,
    overrides:{localFusionEnabled:true,localFusionSampler:sampler}});
  const rawTiming=measure(()=>raw(image,size,size));
  const productionTiming=measure(()=>{
    const result=executeGenerationJob(req);
    if(!result.ok) throw new Error(JSON.stringify(result));
    if(result.width!==size||result.height!==size) throw new Error('Unexpected target dimensions');
  });
  rows.push({sampler,size:`${size}x${size}`,raw:rawTiming,production:productionTiming});
}
console.log(JSON.stringify({runtime:process.version,platform:process.platform,source:'synthetic 256x256 checker with transparent quarter',
  repetitions:3,scope:'Node synchronous wall time; includes cold first run; no browser blocking measurement or quality claim',rows},null,2));
