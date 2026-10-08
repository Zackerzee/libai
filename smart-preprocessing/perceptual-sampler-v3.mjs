import {rgbToLab,deltaE2000} from './palette-engine.mjs';
import {cellBounds} from './sampling-engine-v2.mjs';
import {PERCEPTUAL_SAMPLER_V3_CONFIG} from './algorithm-v3-config.mjs';

const clamp=v=>Math.max(0,Math.min(1,v));
const offsets=[[1,0],[-1,0],[0,1],[0,-1]];
function sourcePixel(source,x,y,cfg,cache){
  if(x<0||y<0||x>=source.width||y>=source.height)return null;
  const pixel=y*source.width+x,i=pixel*4,a=source.data[i+3];if(a<=cfg.alphaThreshold)return null;
  const rgb=[source.data[i],source.data[i+1],source.data[i+2]];let lab;
  if(cache){const j=pixel*3;if(!cache.ready[pixel]){lab=rgbToLab(rgb);cache.values.set(lab,j);cache.ready[pixel]=1;cache.conversions++;}else lab=[cache.values[j],cache.values[j+1],cache.values[j+2]];}
  else lab=rgbToLab(rgb);
  return{x,y,r:rgb[0],g:rgb[1],b:rgb[2],a,lab,L:lab[0],C:Math.hypot(lab[1],lab[2])};
}
function medoid(samples,candidates,cfg,structured,contrast){
  let best=null,bestCost=Infinity,pairs=0;
  for(const candidate of candidates){let cost=0;for(const p of samples){const structural=structured?1+cfg.centerWeight*p.center+cfg.edgeWeight*p.edge+cfg.contrastWeight*contrast+cfg.saliencyWeight*p.saliency:1;cost+=p.weight*structural*deltaE2000(candidate.lab,p.lab);pairs++;}if(cost<bestCost){best=candidate;bestCost=cost;}}
  return{pixel:best,pairs};
}

export function sampleGridPerceptualV3(source,width,height,options={}){
  if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||!source?.data||!Number.isInteger(source.width)||source.width<1||!Number.isInteger(source.height)||source.height<1||source.data.length!==source.width*source.height*4)throw new TypeError('Valid RGBA source and positive integer grid dimensions required');
  const cfg={...PERCEPTUAL_SAMPLER_V3_CONFIG,...options},size=width*height;
  if(!Number.isInteger(cfg.maxSamples)||cfg.maxSamples<2||!Number.isInteger(cfg.maxCandidates)||cfg.maxCandidates<1)throw new TypeError('Sampling bounds must be positive integers');
  const specularMask=new Float32Array(size),shadowAnchorMask=new Float32Array(size),contrastMap=new Float32Array(size),edgeMap=new Float32Array(size),importanceMap=new Float32Array(size),colors=[];
  // Float64 retains the exact rgbToLab results: cache must not change ties or
  // representative decisions. Never retain source-sized storage between calls.
  const cacheBytes=source.width*source.height*25,cache=cacheBytes<=cfg.maxSourceLabCacheBytes?{values:new Float64Array(source.width*source.height*3),ready:new Uint8Array(source.width*source.height),conversions:0}:null;
  const diagnostics={config:cfg,sourceLabCacheBytes:cache?cacheBytes:0,sourceLabConversions:0,approximation:'deterministic row-major strata weighted by overlap×alpha; bounded candidate medoid, not global exact medoid',sourcePixelReads:0,distanceEvaluations:0,maxRetainedSamples:0,maxRetainedCandidates:0,highlightCells:0,shadowCells:0,structuredCells:0,approximateCells:0};
  for(let gy=0;gy<height;gy++){colors[gy]=[];for(let gx=0;gx<width;gx++){
    const bounds=cellBounds(gx,gy,source.width,source.height,width,height),x0=Math.floor(bounds.x0),x1=Math.min(source.width,Math.ceil(bounds.x1)),y0=Math.floor(bounds.y0),y1=Math.min(source.height,Math.ceil(bounds.y1)),areaPixels=(x1-x0)*(y1-y0),stride=Math.max(1,Math.ceil(areaPixels/cfg.maxSamples)),strata=[];
    let total=0,darkWeight=0,brightWeight=0,connectedBrightWeight=0,min=null,max=null,bright=null,dark=null,ordinal=0;
    const cx=(bounds.x0+bounds.x1)/2,cy=(bounds.y0+bounds.y1)/2;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++,ordinal++){
      diagnostics.sourcePixelReads++;const p=sourcePixel(source,x,y,cfg,cache);if(!p)continue;
      const overlap=(Math.min(bounds.x1,x+1)-Math.max(bounds.x0,x))*(Math.min(bounds.y1,y+1)-Math.max(bounds.y0,y));p.weight=overlap*p.a/255;if(p.weight<=0)continue;total+=p.weight;
      p.center=clamp(1-Math.hypot((x+.5-cx)/(bounds.x1-bounds.x0),(y+.5-cy)/(bounds.y1-bounds.y0)));
      let localEdge=0,connected=0;for(const [dx,dy] of offsets){const n=sourcePixel(source,x+dx,y+dy,cfg,cache);diagnostics.sourcePixelReads++;if(!n)continue;localEdge=Math.max(localEdge,Math.abs(p.L-n.L));if(p.a>=cfg.connectedHighlightMinAlpha&&n.a>=cfg.connectedHighlightMinAlpha&&p.L>=cfg.highlightL&&p.C<=cfg.highlightChroma&&n.L>=cfg.highlightL&&n.C<=cfg.highlightChroma)connected++;}
      p.edge=clamp(localEdge/cfg.maxLightness);p.saliency=clamp(Math.max(p.L,cfg.maxLightness-p.L)/cfg.maxLightness);
      if(!min||p.L<min.L)min=p;if(!max||p.L>max.L)max=p;
      if(p.L<=cfg.shadowL){darkWeight+=p.weight;if(!dark||p.L<dark.L)dark=p;}
      if(p.L>=cfg.highlightL&&p.C<=cfg.highlightChroma){brightWeight+=p.weight;if(connected>=cfg.highlightMinConnectedPixels-1){connectedBrightWeight+=p.weight;if(!bright||p.L>bright.L)bright=p;}}
      const bucket=Math.floor(ordinal/stride);if(!strata[bucket])strata[bucket]={pixel:p,weight:0};strata[bucket].weight+=p.weight;
      // Pick a real high-evidence pixel from each stratum; never invent an RGB.
      if(p.center+p.edge>strata[bucket].pixel.center+strata[bucket].pixel.edge)strata[bucket].pixel=p;
    }
    const idx=gy*width+gx;if(!total){colors[gy][gx]=null;continue;}
    const samples=strata.filter(Boolean).map(s=>({...s.pixel,weight:s.weight})),contrast=max.L-min.L,structured=contrast>=cfg.contrastL,highlight=!!bright&&connectedBrightWeight/total>=cfg.highlightMinCoverage&&contrast>=cfg.highlightMinContrast,shadow=!highlight&&darkWeight/total>=cfg.dominantShadowCoverage;
    const unique=new Map();for(const p of [min,max,bright,dark,...samples])if(p)unique.set(`${p.r},${p.g},${p.b}`,p);
    const all=[...unique.values()],candidates=all.length<=cfg.maxCandidates?all:Array.from({length:cfg.maxCandidates},(_,i)=>all[Math.floor(i*all.length/cfg.maxCandidates)]);
    diagnostics.maxRetainedSamples=Math.max(diagnostics.maxRetainedSamples,samples.length);diagnostics.maxRetainedCandidates=Math.max(diagnostics.maxRetainedCandidates,candidates.length);if(areaPixels>cfg.maxSamples||all.length>cfg.maxCandidates)diagnostics.approximateCells++;
    const result=highlight?{pixel:bright,pairs:0}:shadow?{pixel:dark,pairs:0}:medoid(samples,candidates,cfg,structured,clamp(contrast/cfg.maxLightness));diagnostics.distanceEvaluations+=result.pairs;const p=result.pixel;
    colors[gy][gx]={r:p.r,g:p.g,b:p.b};contrastMap[idx]=clamp(contrast/cfg.maxLightness);edgeMap[idx]=p.edge;specularMask[idx]=highlight?clamp(connectedBrightWeight/total):0;shadowAnchorMask[idx]=shadow?clamp(darkWeight/total):0;
    importanceMap[idx]=1+cfg.importanceContrast*contrastMap[idx]+cfg.importanceEdge*p.edge+cfg.importanceHighlight*(highlight?1:0)+cfg.importanceShadow*(shadow?1:0)+cfg.chromaImportance*clamp(p.C/cfg.maxChroma);
    diagnostics.highlightCells+=highlight?1:0;diagnostics.shadowCells+=shadow?1:0;diagnostics.structuredCells+=structured?1:0;
  }}
  diagnostics.sourceLabConversions=cache?cache.conversions:null;
  return{colors,resolvedMode:'perceptual-v3',specularMask,shadowAnchorMask,contrastMap,edgeMap,importanceMap,diagnostics};
}
