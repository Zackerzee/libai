import { rgbToLab } from '../smart-preprocessing/palette-engine.mjs';

export const V3_METRIC_DEFINITION=Object.freeze({percentile:'linear interpolation at (n-1)*p',neutralChroma:12,highlightL:90,darkL:10,hue:'Lab atan2(b,a), neutral C<12; hue boundaries 20/55/100/165/210/285/330 degrees'});
export function percentile(sorted,p){if(!sorted.length)return null;const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);}
export function labHue([L,a,b]){if(Math.hypot(a,b)<12)return 'neutral';const h=(Math.atan2(b,a)*180/Math.PI+360)%360;return h<20||h>=330?'red':h<55?'orange':h<100?'yellow':h<165?'green':h<210?'cyan':h<285?'blue':'purple';}
export function measureV3Colors(colors,{width=0,height=0}={}){
  const luminances=[],sum=[0,0,0],hues=Object.fromEntries(['neutral','red','orange','yellow','green','cyan','blue','purple'].map(h=>[h,0])),usage={};
  let chroma=0,highlights=0,darks=0,min=null,max=null,count=0;
  for(const cell of colors){if(!cell)continue;const lab=rgbToLab(cell.rgb),L=lab[0];count++;luminances.push(L);for(let i=0;i<3;i++)sum[i]+=lab[i];chroma+=Math.hypot(lab[1],lab[2]);hues[labHue(lab)]++;highlights+=L>=90?1:0;darks+=L<=10?1:0;if(!min||L<min.L)min={rgb:[...cell.rgb],code:cell.code||null,L};if(!max||L>max.L)max={rgb:[...cell.rgb],code:cell.code||null,L};const key=cell.code||cell.rgb.join(',');usage[key]=(usage[key]||0)+1;}
  luminances.sort((a,b)=>a-b);const L=Object.fromEntries([['P01',.01],['P05',.05],['P50',.5],['P95',.95],['P99',.99]].map(([k,p])=>[k,percentile(luminances,p)]));
  const ratios=Object.fromEntries(Object.entries(hues).map(([h,n])=>[h,count?n/count:0]));
  return{width,height,filledCells:count,usedColors:Object.keys(usage).length,colorUsage:usage,L,dynamicRange:count?L.P95-L.P05:null,meanLab:count?sum.map(v=>v/count):null,meanChroma:count?chroma/count:null,darkest:min,brightest:max,paletteUsageByHue:hues,hueRatios:ratios,blueRatio:ratios.blue,neutralRatio:ratios.neutral,highlightPixels:highlights,darkPixels:darks,definition:V3_METRIC_DEFINITION};
}
export function measureV3Grid(grid){return measureV3Colors(grid.flat(),{width:grid[0]?.length||0,height:grid.length});}
export function* rasterColors(image){for(let i=0;i<image.data.length;i+=4)if(image.data[i+3]>0)yield{rgb:[image.data[i],image.data[i+1],image.data[i+2]]};}
