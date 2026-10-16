import {runPindouPipeline} from '../src/algorithms/pindou-full/pipeline.mjs';
self.onmessage=async ({data})=>{
  try{
    const result=runPindouPipeline(data,{canvasFactory:(w,h)=>new OffscreenCanvas(w,h),onStage:stage=>self.postMessage({stage})});
    const preview = new OffscreenCanvas(result.w, result.h);
    const ctx = preview.getContext('2d');
    const pixels = ctx.createImageData(result.w, result.h);
    for (let i=0;i<result.idx.length;i++) {
      const color=result.idx[i]<0?null:result.sub[result.idx[i]];
      if (color) { pixels.data.set(color.rgb,i*4);pixels.data[i*4+3]=255; }
    }
    ctx.putImageData(pixels,0,0);
    result.previewBlob = await preview.convertToBlob({type:'image/png'});
    data.source.close?.();
    self.postMessage({result},[result.idx.buffer]);
  }catch(error){data.source.close?.();self.postMessage({error:{name:error.name,message:error.message}});}
};
