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
// Group thin-region fragments into perceptual LINES. Flood-fill segmentation
// shatters one long stroke (goggle frames, whiskers, jewelry) into many small
// fragments wherever an anti-aliased seam crosses it, so per-cell stroke tests
// fire only near fragment centers and the stroke renders dashed. Adjacent
// fragments with matching colors are unioned into components; a component
// counts as a drawn line when its color is uniform (dominant share) and it
// contrasts clearly with the fill it sits on. Anti-alias blends between two
// fills fail the uniformity test because their color drifts along the seam.
export function buildLineComponents(seg,im,delta){
 const cand=seg.regions.filter(r=>r.area>=3&&r.area/Math.max(1,r.boundary.length)<2.2);
 const compOf=new Map();cand.forEach((r,k)=>compOf.set(r.id,k));
 const parent=cand.map((_,k)=>k);
 const find=k=>{while(parent[k]!==k){parent[k]=parent[parent[k]];k=parent[k];}return k;};
 const at=new Int32Array(im.width*im.height).fill(-1);
 for(const r of cand)for(const i of r.pixels)at[i]=r.id;
 // Fragments of one stroke touch diagonally (pixel-art steps) or are split by
 // a 1px anti-alias seam, so union through the 8-neighborhood and bridge any
 // gap pixel that touches two matching fragments. Color guards keep genuinely
 // different lines from merging at crossings.
 const unionIds=(a,b)=>{const ra=find(compOf.get(a)),rb=find(compOf.get(b));if(ra!==rb)parent[rb]=ra;};
 const tryUnion=(a,b)=>{if(a>=0&&b>=0&&a!==b&&delta(seg.regions[a].color,seg.regions[b].color)<10)unionIds(a,b);};
 for(let i=0;i<at.length;i++){const a=at[i];
  if(a>=0){
   const x=i%im.width;
   for(const dy of [-1,0,1])for(const dx of [-1,0,1]){if(!dy&&!dx)continue;const nx=x+dx;if(nx<0||nx>=im.width)continue;const j=i+dy*im.width+dx;if(j<0||j>=at.length)continue;tryUnion(a,at[j]);}
  }else{
   const ids=[];const x=i%im.width;
   for(const dy of [-1,0,1])for(const dx of [-1,0,1]){if(!dy&&!dx)continue;const nx=x+dx;if(nx<0||nx>=im.width)continue;const j=i+dy*im.width+dx;if(j<0||j>=at.length)continue;const b=at[j];if(b>=0&&!ids.includes(b))ids.push(b);}
   for(let k=0;k<ids.length;k++)for(let m=k+1;m<ids.length;m++)tryUnion(ids[k],ids[m]);
  }}
 const groups=new Map();
 for(let k=0;k<cand.length;k++){const root=find(k);if(!groups.has(root))groups.set(root,{ids:new Set(),px:[],buckets:[]});const g=groups.get(root);
  g.px.push(...cand[k].pixels);
  const c=cand[k].color;let b=g.buckets.find(x=>delta(x.color,c)<8);if(!b){b={color:c,area:0};g.buckets.push(b);}b.area+=cand[k].area;}
 const comps=[];
 for(const g of groups.values()){
  if(g.px.length<12)continue;
  let color=null,share=0;for(const b of g.buckets)if(b.area>share){share=b.area;color=b.color;}
  if(share<g.px.length*.6)continue;
  // Substrate = the contacting fill (thin regions excluded so stacked lines
  // do not reject each other). A line must differ clearly from what it sits on.
  const nb=new Map();
  for(const i of g.px)for(const j of adjacent(i,im.width,im.height)){const jd=seg.ids[j];if(jd<0||g.ids.has(jd)||compOf.has(jd))continue;nb.set(jd,(nb.get(jd)||0)+1);}
  let sub=null,subN=0;for(const [jd,n] of nb)if(n>subN){subN=n;sub=seg.regions[jd].color;}
  if(!sub||delta(color,sub)<15)continue;
  comps.push({color,pixels:g.px});
 }
 const compAt=new Int32Array(im.width*im.height).fill(-1);const compColors=[];
 for(const c of comps){const ci=compColors.length;compColors.push(c.color);for(const i of c.pixels)if(compAt[i]<0)compAt[i]=ci;}
 return {compAt,compColors};
}
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
 // An explicit width is authoritative: the host site must not silently clamp
 // user-chosen grid sizes (a 200-wide request used to collapse to 120). Tier
 // caps only steer the automatic choice when no width is given.
 const w=width||cap,h=Math.max(1,Math.round(w*image.height/image.width));
 if(h<=500)return {width:w,height:h};
 return {width:Math.max(1,Math.floor(w*500/h)),height:500};
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
// Detect a content bounding box against a uniform background so the subject
// fills the bead grid instead of dead margins (a square canvas with wide empty
// borders would otherwise waste most of the grid resolution). Returns original
// image coordinates. A row/column counts as content when >0.6% of its pixels
// differ from the border color, which ignores sparse JPEG noise but keeps real
// detail such as captions.
export function detectContentCrop(image,delta){
 const probe=resizeForAnalysis(image,240),w=probe.width,h=probe.height;
 const cornerCounts=new Map();let bg=[255,255,255],bgSeen=0;
 for(const [cx,cy] of [[0,0],[w-1,0],[0,h-1],[w-1,h-1]]){const k=rgbAt(probe,cy*w+cx),key=k.join(',');const n=(cornerCounts.get(key)||0)+1;cornerCounts.set(key,n);if(n>bgSeen){bgSeen=n;bg=k;}}
 let content=0;const rowHit=new Uint8Array(h),colHit=new Uint8Array(w);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=rgbAt(probe,y*w+x);if(delta(c,bg)>=12){rowHit[y]++;colHit[x]++;content++;}}
 if(!content)return null;
 const hit=Math.max(2,Math.round(w*.006)),hitY=Math.max(2,Math.round(h*.006));
 let top=0;while(top<h&&rowHit[top]<hitY)top++;let bottom=h-1;while(bottom>top&&rowHit[bottom]<hitY)bottom--;
 let left=0;while(left<w&&colHit[left]<hit)left++;let right=w-1;while(right>left&&colHit[right]<hit)right--;
 if(bottom-top+1>=h*.995&&right-left+1>=w*.995)return null; // nothing meaningful to trim
 const sx=image.width/w,sy=image.height/h,padX=Math.round(image.width*.01),padY=Math.round(image.height*.01);
 const x0=Math.max(0,Math.floor(left*sx)-padX),y0=Math.max(0,Math.floor(top*sy)-padY);
 const x1=Math.min(image.width,Math.ceil((right+1)*sx)+padX),y1=Math.min(image.height,Math.ceil((bottom+1)*sy)+padY);
 return {x:x0,y:y0,width:x1-x0,height:y1-y0};
}
export function generateCartoonBeadPattern(image,options={}){
 validate(image);const style=detectImageStyle(image);
 if(style.type==='photo'&&!options.forceCartoon){if(options.portraitV3)return options.portraitV3(image,options);return {type:'photo',delegate:'portrait-v3',grid:null};}
 const delta=distanceMath(options.colorMath);
 // Auto-trim uniform margins unless the caller supplied an explicit crop: a
 // square canvas with wide empty borders would waste most of the bead grid on
 // background and starve the subject's details (eyes, thin lines).
 const crop=options.crop||(options.autoTrim===false?null:detectContentCrop(image,delta));
 const im=resizeForAnalysis(image,540,crop),edges=edgeDetection(im),seg=segmentColorRegions(im,delta);
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
 // Lines (goggle frames, whiskers, hair strands) are fragmentated thin regions
 // reassembled by buildLineComponents. A line covering ~20% of a cell already
 // deserves the bead; a second connectivity pass keeps the line unbroken even
 // where it crosses a cell only obliquely (single-pixel coverage).
 const {compAt,compColors}=buildLineComponents(seg,im,delta);
 const colors=mergeSimilarColors(im,seg,delta),entries=[],cellIds=[];
 const nCells=size.width*size.height,cellComp=new Int32Array(nCells).fill(-1),cellLine=new Int32Array(nCells),cellSamples=new Int32Array(nCells);
 for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
  const cell=y*size.width+x,samples=[],counts=new Map(),lines=new Map();let winner=-1,count=0,locked=0;
  for(let sy=Math.floor(y*im.height/size.height);sy<Math.ceil((y+1)*im.height/size.height);sy++)for(let sx=Math.floor(x*im.width/size.width);sx<Math.ceil((x+1)*im.width/size.width);sx++){
   const i=sy*im.width+sx;if(!colors[i])continue;samples.push(colors[i]);locked+=outline[i];const id=seg.ids[i],n=(counts.get(id)||0)+1;counts.set(id,n);if(n>count){count=n;winner=id;}
   const ci=compAt[i];if(ci>=0)lines.set(ci,(lines.get(ci)||0)+1);
  }
  cellIds.push(winner);cellSamples[cell]=samples.length;
  if(!samples.length){entries.push(null);continue;}
  let rgb=winner>=0?seg.regions[winner].color:samples[0];
  if(mode==='median')rgb=[0,1,2].map(k=>samples.map(c=>c[k]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
  if(mode==='mean')rgb=[0,1,2].map(k=>Math.round(samples.reduce((s,c)=>s+c[k],0)/samples.length));
  let lineComp=-1,lineN=0;for(const [ci,n] of lines)if(n>lineN){lineComp=ci;lineN=n;}
  cellComp[cell]=lineComp;cellLine[cell]=lineN;
  if(lineComp>=0&&lineN>=Math.ceil(samples.length*.2)){const lc=compColors[lineComp];if(delta(lc,rgb)>=12)rgb=lc.slice();}
  // Outline lock area share. Lowering from the naive 0.18 makes thin 1px
  // cartoon lineart survive coarse downsampling (recall rises ~30% -> ~90%)
  // without measurably thickening (spurious black stays ~0.4%). Only strong
  // near-black structural pixels (protectOutline) count toward `locked`, so a
  // low share is safe: it maps a bead to BLACK when a real line passes through.
  const lockShare=options.lineLockShare===undefined?0.05:options.lineLockShare;if(!Number.isFinite(lockShare)||lockShare<0||lockShare>1)throw Error('lineLockShare must be 0..1');
  const lock=locked>=Math.max(1,samples.length*lockShare);entries.push({rgb:lock?[0,0,0]:rgb,locked:lock});
 }
 // Connectivity pass: a cell the line crosses obliquely may hold only one
 // line pixel (below the strong threshold). Paint it too when the SAME line
 // continues through a neighboring cell -- this is what keeps frames and
 // whiskers one connected bead chain instead of dashed dots. Isolated
 // single-cell line hits (speckle) have no continuing neighbor and stay fill.
 for(let cell=0;cell<nCells;cell++){
  const e=entries[cell];
  if(!e||e.locked||cellComp[cell]<0)continue;
  if(cellLine[cell]>=Math.ceil(cellSamples[cell]*.2))continue; // strong cells painted above
  let cont=false;
  for(const j of adjacent(cell,size.width,size.height))if(cellComp[j]===cellComp[cell]&&cellLine[j]>=1){cont=true;break;}
  if(cont){const lc=compColors[cellComp[cell]];if(delta(lc,e.rgb)>=12)e.rgb=lc.slice();}
 }
 const originalColors=new Set(entries.filter(Boolean).map(e=>e.rgb.join(','))).size;
 const mergedColors=applyColorBudget(entries,maxColors,delta);
 let grid=mapToBeadPalette(entries,options.palette,delta);grid=cleanupGrid(grid,entries,cellIds,size.width,size.height,delta);
 const diagnostics={style:style.type,complexity:budget.complexity,samplingMode:mode,regionCount:seg.regions.length,hueCount:budget.hueCount,lineComps:compColors.length,crop:crop?`${crop.width}x${crop.height}+${crop.x}+${crop.y}`:'none',originalColors,finalColors:new Set(grid.filter(Boolean).map(c=>c.code)).size,outlinePixels:outline.reduce((a,b)=>a+b,0),lockedCells:entries.filter(e=>e?.locked).length,mergedColors,maxColors};
 console.log('[cartoon-v2]',diagnostics);
 return {...size,grid:Array.from({length:size.height},(_,y)=>grid.slice(y*size.width,(y+1)*size.width)),diagnostics};
}
