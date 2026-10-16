import C from './color.mjs';
import Q from './quantize.mjs';
import { normalizePindouConfig } from './config.mjs';
import { createPindouSource } from './source.mjs';

/** Pinned upstream compute() math; host effects replaced by returned result. */
export function runPindouPipeline({source,palette,config={}}, {canvasFactory,onStage}={}) {
 const opts=normalizePindouConfig(config), gw=opts.gridW, gh=opts.gridH;
 const start=performance.now(), metrics={};
 const stage=(name,fn)=>{const t=performance.now();const value=fn();metrics[name]=performance.now()-t;onStage?.(name,metrics[name]);return value;};
 if(!Array.isArray(palette)||!palette.length)throw new RangeError('No available palette colors');
 // Upstream deduplicates code. Mixed brands require unique internal aliases only;
 // actual objects and their identity are retained in returned sub.
 const codes=new Set(), occupied=new Set(palette.map(col=>String(col?.code))), aliases=new Map();
 const pal=palette.map((col,i)=>{
  if(!col?.code||!Array.isArray(col.rgb)||col.rgb.length!==3)throw new TypeError('Invalid palette entry');
  const copy={...col,lab:C.rgbToLab(...col.rgb,[0,0,0]),hex:col.hex||C.rgbToHex(...col.rgb)};
  const key=String(col.code);
  if(codes.has(key)){let alias='__pindou_identity_'+i;while(occupied.has(alias))alias+='_' ;copy.code=alias;occupied.add(alias);}else copy.code=key;
  codes.add(key);aliases.set(copy,col);return copy;
 });
 const geometry=createPindouSource(source,opts,canvasFactory);
 const fit=stage('fitSource',()=>geometry.fitSource(gw,gh));
 if(opts.bgRemove)stage('removeBg',()=>geometry.removeBg(fit.data,opts.bgColor,opts.bgTol));
 let grid=stage('sampling',()=>Q.downsample(fit.data,fit.w,fit.h,gw,gh,opts.sampleMode,opts.texture/100));
 grid=stage('mosaic',()=>Q.mosaic(grid,gw,gh,opts.mosaic));
 stage('adjust',()=>Q.adjust(grid,opts));
 if(opts.sharpen>0)grid=stage('sharpen',()=>Q.sharpen(grid,gw,gh,opts.sharpen));
 const want=Math.min(opts.colors,pal.length);
 let sub=stage('quantize',()=>{
  if(opts.algo==='direct'){
   const first=Q.remap(grid,gw,gh,pal,{dither:'none',alphaTh:opts.alphaTh});
   const use=new Float64Array(pal.length);for(let i=0;i<first.length;i++)if(first[i]>=0)use[first[i]]++;
   const ranked=[];for(let j=0;j<pal.length;j++)if(use[j]>0)ranked.push([j,use[j]]);
   ranked.sort((a,b)=>b[1]-a[1]);return ranked.slice(0,want).map(r=>pal[r[0]]);
  }
  const s=Q.collectLab(grid,gw,gh,opts.alphaTh,24000);
  if(s.n===0)return [];
  const res=opts.algo==='mediancut'?Q.medianCut(s.lab,s.n,want):Q.kmeans(s.lab,s.n,want,26,20240815);
  return Q.centersToPalette(res.centers,res.k,res.weights,pal,true).map(ix=>pal[ix]);
 });
 if(!sub.length && opts.algo!=='direct')return {w:gw,h:gh,idx:new Int32Array(gw*gh).fill(-1),sub:[],counts:[],total:0,config:opts,metrics:{...metrics,totalMs:performance.now()-start,intermediatePixels:fit.w*fit.h},empty:true};
 if(!sub.length)sub=[pal[0]];
 sub=stage('refinePalette',()=>Q.refinePalette(grid,gw,gh,pal,sub,want,opts.alphaTh));
 const idx=stage('remap',()=>Q.remap(grid,gw,gh,sub,{dither:opts.dither,amount:opts.ditherAmt/100,alphaTh:opts.alphaTh}));
 const counts=new Array(sub.length).fill(0);let total=0;
 for(let n=0;n<idx.length;n++)if(idx[n]>=0){counts[idx[n]]++;total++;}
 const map=new Int32Array(sub.length).fill(-1),sub2=[],counts2=[];
 for(let n=0;n<sub.length;n++)if(counts[n]>0){map[n]=sub2.length;sub2.push(aliases.get(sub[n]));counts2.push(counts[n]);}
 for(let n=0;n<idx.length;n++)if(idx[n]>=0)idx[n]=map[idx[n]];
 return {w:gw,h:gh,idx,sub:sub2,counts:counts2,total,config:opts,metrics:{...metrics,totalMs:performance.now()-start,intermediatePixels:fit.w*fit.h},empty:total===0};
}
export default runPindouPipeline;
