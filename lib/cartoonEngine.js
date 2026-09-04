/** Cartoon V2: independent region engine. No UI/portrait/export dependencies.
 * Input is decoded RGBA; palette and existing rgbToLab/DeltaE2000 are injected.
 * Region logic is original; no upstream UI/API or palette data copied.
 */
const lum = c => .299*c[0]+.587*c[1]+.114*c[2];
const adjacent = (i,w,h) => [i%w?i-1:-1,i%w<w-1?i+1:-1,i>=w?i-w:-1,i<w*(h-1)?i+w:-1].filter(j=>j>=0);
const rgbAt = (im,i) => Array.from(im.data.subarray(i*4,i*4+3));
function validate(im){if(!im||!Number.isInteger(im.width)||!Number.isInteger(im.height)||im.width<1||im.height<1||im.width*im.height>64000000||im.data?.length!==im.width*im.height*4)throw Error('Invalid RGBA image');}
function distanceMath(math){
 if(!math?.rgbToLab||!math?.deltaE2000)throw Error('Existing Lab / DeltaE2000 functions required');
 const cache=new Map();const lab=c=>{const k=c.join(',');if(!cache.has(k))cache.set(k,math.rgbToLab(...c));return cache.get(k);};
 return (a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2]?0:math.deltaE2000(lab(a),lab(b));
}
export function resizeForAnalysis(image, maxSide=540, crop=null){
 validate(image);const c=crop||{x:0,y:0,width:image.width,height:image.height};
 if(![c.x,c.y,c.width,c.height].every(Number.isInteger)||c.x<0||c.y<0||c.width<1||c.height<1||c.x+c.width>image.width||c.y+c.height>image.height)throw Error('Invalid crop');
 const s=Math.min(1,maxSide/Math.max(c.width,c.height)),width=Math.max(1,Math.round(c.width*s)),height=Math.max(1,Math.round(c.height*s));
 const data=new Uint8ClampedArray(width*height*4);
 // Point sampling avoids introducing interpolation colors before segmentation.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=((c.y+Math.min(c.height-1,Math.floor((y+.5)*c.height/height)))*image.width+c.x+Math.min(c.width-1,Math.floor((x+.5)*c.width/width)))*4;
  data.set(image.data.subarray(p,p+4),(y*width+x)*4);
 }return {width,height,data};
}
export function edgeDetection(im){
 const out=new Float32Array(im.width*im.height);
 for(let i=0;i<out.length;i++)if(im.data[i*4+3]>=128)for(const j of adjacent(i,im.width,im.height))if(im.data[j*4+3]>=128)out[i]=Math.max(out[i],Math.abs(lum(rgbAt(im,i))-lum(rgbAt(im,j))));
 return out;
}
export function detectImageStyle(image){
 const im=resizeForAnalysis(image,240),n=im.width*im.height,keys=new Int32Array(n),counts=new Map();let valid=0,flat=0,edges=0,equal=0,pairs=0;
 for(let i=0;i<n;i++){if(im.data[i*4+3]<128){keys[i]=-1;continue;}const c=rgbAt(im,i);keys[i]=(c[0]>>4)*256+(c[1]>>4)*16+(c[2]>>4);counts.set(keys[i],(counts.get(keys[i])||0)+1);valid++;}
 const seen=new Uint8Array(n);let large=0;
 for(let i=0;i<n;i++)if(keys[i]>=0&&!seen[i]){const q=[i];seen[i]=1;for(let k=0;k<q.length;k++)for(const j of adjacent(q[k],im.width,im.height))if(!seen[j]&&keys[j]===keys[i]){seen[j]=1;q.push(j);}if(q.length>=Math.max(8,valid*.005))large+=q.length;}
 for(let i=0;i<n;i++)if(keys[i]>=0){let local=0;for(const j of adjacent(i,im.width,im.height))if(keys[j]>=0){const d=Math.max(...rgbAt(im,i).map((v,k)=>Math.abs(v-im.data[j*4+k])));local=Math.max(local,d);pairs++;if(d===0)equal++;}if(local<20)flat++;if(local>45)edges++;}
 const dominantShare=[...counts.values()].sort((a,b)=>b-a).slice(0,24).reduce((a,b)=>a+b,0)/Math.max(1,valid);
 // Pixel detection requires repeated aligned block boundaries in the original, not merely flat fills.
 let pixel=false;
 if(image.width<=240&&image.height<=240&&equal/Math.max(1,pairs)>.55&&counts.size<=64)pixel=true;
 if(!pixel)for(const block of [2,3,4,5,6,8]){let aligned=0,total=0;for(let y=0;y<image.height;y+=Math.max(1,Math.floor(image.height/64)))for(let x=1;x<image.width;x++){const a=(y*image.width+x)*4,b=a-4;if(Math.max(...[0,1,2].map(k=>Math.abs(image.data[a+k]-image.data[b+k])))>30){total++;if(x%block===0)aligned++;}}if(total>100&&aligned/total>.92&&equal/Math.max(1,pairs)>.5){pixel=true;break;}}
 const metrics={continuousRatio:large/Math.max(1,valid),edgeDensity:edges/Math.max(1,valid),flatRatio:flat/Math.max(1,valid),dominantShare};
 return {type:pixel?'pixel':metrics.continuousRatio>.4&&metrics.flatRatio>.45&&dominantShare>.7&&metrics.edgeDensity>.005?'cartoon':'photo',metrics};
}
export function segmentColorRegions(im,delta){
 const ids=new Int32Array(im.width*im.height).fill(-1),regions=[];
 for(let i=0;i<ids.length;i++)if(ids[i]<0&&im.data[i*4+3]>=128){
  const id=regions.length,pixels=[i],sum=[0,0,0],boundary=[];ids[i]=id;
  for(let head=0;head<pixels.length;head++){const p=pixels[head],c=rgbAt(im,p);for(let k=0;k<3;k++)sum[k]+=c[k];let edge=false;
   for(const j of adjacent(p,im.width,im.height)){if(im.data[j*4+3]<128){edge=true;continue;}const close=delta(c,rgbAt(im,j))<12;
    if(!close)edge=true;else if(ids[j]<0){ids[j]=id;pixels.push(j);}}
   if(edge)boundary.push(p);
  }
  regions.push({id,pixels,area:pixels.length,averageColor:sum.map(v=>v/pixels.length),boundary});
 }return {ids,regions};
}
export function extractRegionColor(region,im){
 const colors=region.pixels.map(i=>rgbAt(im,i));
 if(region.area<16)return [0,1,2].map(k=>colors.map(c=>c[k]).sort((a,b)=>a-b)[Math.floor(colors.length/2)]);
 const counts=new Map();let best=colors[0],max=0;for(const c of colors){const key=c.join(',');const n=(counts.get(key)||0)+1;counts.set(key,n);if(n>max){max=n;best=c;}}return best;
}
export function protectOutline(im,edges,threshold=25){return Uint8Array.from(edges,(e,i)=>im.data[i*4+3]>=128&&lum(rgbAt(im,i))<45&&e>threshold?1:0);}
export function cartoonColorBudget(regions,delta,outline=null,im=null){
 const total=regions.reduce((s,r)=>s+r.area,0);
 // Moderate area floor: large enough to ignore JPEG/anti-alias edge speckle
 // (a few px), small enough to keep genuine fine-detail regions in the count.
 // The old total*.002 floor hid every small colored region and mis-classified
 // detail-rich anime as 'simple' (=> too-low color budget).
 const floor=Math.max(8,total*.0002);
 const rel=regions.filter(r=>r.area>=floor);
 const hues=[];
 for(const r of rel)if(!hues.some(c=>delta(c,r.color)<8))hues.push(r.color);
 const hueCount=hues.length;
 let complexity=hueCount<=9?'simple':hueCount<=18?'normal':'complex';
 // Structural signal (heavy lineart / many disconnected pieces). Black lines
 // are locked and do not consume the color budget, but a mostly-flat dominant
 // background can hide that the subject truly needs a finer palette. When the
 // hue count sits just below the simple boundary yet the image carries dense
 // near-black structure, raise the tier so thin details are not merged away.
 if(outline&&im){
  const lineDensity=outline.reduce((a,b)=>a+b,0)/(im.width*im.height);
  if(lineDensity>.085&&complexity==='simple'&&hueCount>=6){complexity='normal';}
 }
 return {complexity,maxColors:complexity==='simple'?10:complexity==='normal'?18:30,hueCount,regionFloor:floor};
}
export function calculateCartoonGridSize(image,complexity,width){
 const cap=complexity==='simple'?80:complexity==='normal'?120:180;
 if(width!==undefined&&(!Number.isInteger(width)||width<1))throw Error('Invalid grid width');
 let w=Math.min(width||cap,cap),h=Math.max(1,Math.round(w*image.height/image.width));if(h>500){w=Math.max(1,Math.floor(w*500/h));h=500;}return {width:w,height:h};
}
// Same component only: no global pink replacement across disconnected details.
export function mergeSimilarColors(im,seg,delta){
 const colors=Array.from({length:im.width*im.height},()=>null);
 for(const r of seg.regions)for(const i of r.pixels){const c=rgbAt(im,i);colors[i]=delta(c,r.color)<8?r.color:c;}
 return colors;
}
export function applyColorBudget(entries,limit,delta){
 const groups=new Map();for(const e of entries)if(e){const k=e.rgb.join(',');if(!groups.has(k))groups.set(k,{rgb:e.rgb,items:[],locked:false});const g=groups.get(k);g.items.push(e);g.locked ||= e.locked;}
 let merged=0;
 while(groups.size>limit){let victim=null,value=Infinity;
  for(const g of groups.values())if(!g.locked){const chroma=Math.max(...g.rgb)-Math.min(...g.rgb);const v=g.items.length*(1+chroma/128)*(lum(g.rgb)>235?3:1);if(v<value){value=v;victim=g;}}
  if(!victim)break;let target=null,best=Infinity;for(const g of groups.values())if(g!==victim){const d=delta(g.rgb,victim.rgb);if(d<best){best=d;target=g;}}
  for(const e of victim.items)e.rgb=target.rgb;target.items.push(...victim.items);groups.delete(victim.rgb.join(','));merged++;
 }return merged;
}
export function mapToBeadPalette(entries,palette,delta){
 if(!palette?.length)throw Error('Real bead palette required');
 const blacks=palette.filter(c=>lum(c.rgb)<45&&Math.max(...c.rgb)-Math.min(...c.rgb)<25);
 if(entries.some(e=>e?.locked)&&!blacks.length)throw Error('Palette has no neutral BLACK candidates');
 const cache=new Map();return entries.map(e=>{if(!e)return null;const key=e.rgb.join(',')+e.locked;if(!cache.has(key)){const pool=e.locked?blacks:palette;let best=pool[0],score=Infinity;for(const c of pool){const d=delta(e.rgb,c.rgb);if(d<score){score=d;best=c;}}cache.set(key,best);}return cache.get(key);});
}
export function cleanupGrid(grid,entries,ids,w,h,delta){
 const result=grid.slice();for(let i=0;i<grid.length;i++)if(grid[i]&&!entries[i].locked){const ns=adjacent(i,w,h).filter(j=>grid[j]&&ids[j]===ids[i]);if(ns.length<3)continue;const c=grid[ns[0]];if(ns.every(j=>grid[j].code===c.code)&&delta(grid[i].rgb,c.rgb)<8)result[i]=c;}return result;
}
export function generateCartoonBeadPattern(image,options={}){
 validate(image);const style=detectImageStyle(image);
 if(style.type==='photo'&&!options.forceCartoon){if(options.portraitV3)return options.portraitV3(image,options);return {type:'photo',delegate:'portrait-v3',grid:null};}
 const delta=distanceMath(options.colorMath),im=resizeForAnalysis(image,540,options.crop),edges=edgeDetection(im),seg=segmentColorRegions(im,delta);
 for(const r of seg.regions)r.color=extractRegionColor(r,im);
 const outline=protectOutline(im,edges);
 // Black outlines are locked to palette BLACK regardless of budget, so they do
 // not consume the bead color budget. Complexity is driven by how many distinct
 // fill hues actually reach the grid (hueCount), with a structural nudge for
 // dense-lineart subjects.
 const budget=cartoonColorBudget(seg.regions,delta,outline,im);
 const size=calculateCartoonGridSize(im,budget.complexity,options.width);
 const maxColors=options.maxColors===undefined?budget.maxColors:options.maxColors;
 if(!Number.isInteger(maxColors)||maxColors<1||maxColors>30)throw Error('maxColors must be 1..30');
 const mode=options.samplingMode||(!options.forceCartoon&&style.type==='pixel'?'mean':'dominant');if(!['dominant','median','mean'].includes(mode))throw Error('Invalid samplingMode');
 const colors=mergeSimilarColors(im,seg,delta),entries=[],cellIds=[];
 for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
  const samples=[],counts=new Map();let winner=-1,count=0,locked=0;
  for(let sy=Math.floor(y*im.height/size.height);sy<Math.ceil((y+1)*im.height/size.height);sy++)for(let sx=Math.floor(x*im.width/size.width);sx<Math.ceil((x+1)*im.width/size.width);sx++){
   const i=sy*im.width+sx;if(!colors[i])continue;samples.push(colors[i]);locked+=outline[i];const id=seg.ids[i],n=(counts.get(id)||0)+1;counts.set(id,n);if(n>count){count=n;winner=id;}}
  cellIds.push(winner);if(!samples.length){entries.push(null);continue;}
  let rgb=winner>=0?seg.regions[winner].color:samples[0];
  if(mode==='median')rgb=[0,1,2].map(k=>samples.map(c=>c[k]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
  if(mode==='mean')rgb=[0,1,2].map(k=>Math.round(samples.reduce((s,c)=>s+c[k],0)/samples.length));
  // Outline lock area share. Lowering from the naive 0.18 makes thin 1px
  // cartoon lineart survive coarse downsampling (recall rises ~30% -> ~90%)
  // without measurably thickening (spurious black stays ~0.4%). Only strong
  // near-black structural pixels (protectOutline) count toward `locked`, so a
  // low share is safe: it maps a bead to BLACK when a real line passes through.
  const lockShare=options.lineLockShare===undefined?0.05:options.lineLockShare;if(!Number.isFinite(lockShare)||lockShare<0||lockShare>1)throw Error('lineLockShare must be 0..1');
  const lock=locked>=Math.max(1,samples.length*lockShare);entries.push({rgb:lock?[0,0,0]:rgb,locked:lock});
 }
 const originalColors=new Set(entries.filter(Boolean).map(e=>e.rgb.join(','))).size;
 const mergedColors=applyColorBudget(entries,maxColors,delta);
 let grid=mapToBeadPalette(entries,options.palette,delta);grid=cleanupGrid(grid,entries,cellIds,size.width,size.height,delta);
 const diagnostics={style:style.type,complexity:budget.complexity,samplingMode:mode,regionCount:seg.regions.length,hueCount:budget.hueCount,originalColors,finalColors:new Set(grid.filter(Boolean).map(c=>c.code)).size,outlinePixels:outline.reduce((a,b)=>a+b,0),lockedCells:entries.filter(e=>e?.locked).length,mergedColors,maxColors};
 console.log('[cartoon-v2]',diagnostics);
 return {...size,grid:Array.from({length:size.height},(_,y)=>grid.slice(y*size.width,(y+1)*size.width)),diagnostics};
}
