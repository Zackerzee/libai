/** Independent full pindou engine. No V2.5 sampling, cleanup, or budget calls. */
import { resolvePindouAspect } from '../src/algorithms/pindou-full/config.mjs?v=20261014-host-2';
export async function runPindouWorker({source,palette,config,requestId},{isCurrent=()=>true,onStage=()=>{}}={}){
  if(typeof Worker!=='function'||typeof createImageBitmap!=='function')throw new Error('当前浏览器不支持 pindou 后台计算，请使用时里白 V2.5');
  if(!isCurrent()){const e=new Error('旧任务已取消');e.name='StaleGenerationError';throw e;}
  const blob=await fetch(source).then(r=>r.blob()),bitmap=await createImageBitmap(blob);
  config=resolvePindouAspect(config,bitmap.width,bitmap.height);
  if(!isCurrent()){bitmap.close();const e=new Error('旧任务已取消');e.name='StaleGenerationError';throw e;}
  return new Promise((resolve,reject)=>{
    let worker;
    try { worker=new Worker(new URL('./pindou.worker.mjs?v=20261014-native-preview-1',import.meta.url),{type:'module'}); }
    catch(error) { bitmap.close();reject(error);return; }
    let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;clearInterval(watch);worker.terminate();fn(value);};
    const stale=()=>{const e=new Error('旧任务已取消');e.name='StaleGenerationError';finish(reject,e);};
    const watch=setInterval(()=>{if(!isCurrent())stale();},40);
    worker.onmessage=({data})=>{if(!isCurrent()){stale();return;}if(data.stage){onStage(data.stage);return;}if(data.error){const e=new Error(data.error.message);e.name=data.error.name||'Error';finish(reject,e);return;}finish(resolve,data.result);};
    worker.onerror=e=>finish(reject,new Error(e.message||'pindou 后台计算失败'));
    try { worker.postMessage({source:bitmap,palette,config,requestId},[bitmap]); }
    catch(error) { bitmap.close();finish(reject,error); }
  });
}

/** Chunked native-grid construction; compact indices are transferred, not 250k objects. */
function yieldPindouTask() {
  if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
  if (typeof MessageChannel === 'function') return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close();channel.port2.close();resolve(); };
    channel.port2.postMessage(null);
  });
  return new Promise(resolve=>setTimeout(resolve,0));
}
export async function materializePindouResult(result,{isCurrent=()=>true,yieldTask=yieldPindouTask,chunkCells=2048}={}){
  const grid=Array.from({length:result.h},()=>Array(result.w)),originalGrid=Array.from({length:result.h},()=>Array(result.w));
  const clone=c=>c?({...c,rgb:[...c.rgb]}):null;
  for(let p=0;p<result.idx.length;p++){
    if(p%chunkCells===0){if(p)await yieldTask();if(!isCurrent()){const e=new Error('旧任务已取消');e.name='StaleGenerationError';throw e;}}
    const color=result.idx[p]<0?null:result.sub[result.idx[p]],y=Math.floor(p/result.w),x=p%result.w;
    grid[y][x]=clone(color);originalGrid[y][x]=clone(color);
  }
  return{grid,originalGrid,width:result.w,height:result.h,stats:result.sub.map((color,i)=>({...clone(color),count:result.counts[i]})).filter(color=>color.count>0),config:result.config,metrics:result.metrics};
}
