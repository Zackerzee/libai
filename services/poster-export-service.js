import { usageFromGrid } from "./pattern-export-renderer.js";
import { findExteriorBackground } from "./exterior-background-service.mjs";
import { srgbToLinear } from "../smart-preprocessing/palette-engine.mjs";

export const POSTER_LAYOUTS = Object.freeze({
  "3x4": Object.freeze({ width:1500,height:2000,safe:120,logoWidth:104,artCenterY:950,artMaxWidth:1100,artMaxHeight:1200,signatureY:1700,metadataY:1850 }),
  "1x1": Object.freeze({ width:1800,height:1800,safe:120,logoWidth:112,artCenterY:875,artMaxWidth:1040,artMaxHeight:980,signatureY:1510,metadataY:1610 }),
});
export const BRAND_PRESETS = Object.freeze({
  libms: { id:"libms",name:"LIBMS Studio",logo:"./assets/libms-logo.png",signature:"LIBMS Studio" },
  shiliber: { id:"shiliber",name:"时里白造物",logo:"./assets/libms-logo.png",signature:"时里白造物" },
  keqila: { id:"keqila",name:"氪憩鞡丨时里白",logo:"./assets/libms-logo.png",signature:"氪憩鞡丨时里白" },
  custom: { id:"custom",name:"自定义",logo:"./assets/libms-logo.png",signature:"" },
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function analyzeArtworkBackground(grid) {
  const usage=usageFromGrid(grid).filter((x)=>x.count>1&&x.rgb.some((v)=>v>18)&&x.rgb.some((v)=>v<245)).slice(0,4);
  const tones=(usage.length?usage:[{rgb:[188,190,194]}]).map(({rgb})=>rgb.map((v)=>clamp(Math.round(v*.30+255*.70),205,248)));
  return { dominant:usage[0]?.rgb||[188,190,194], tones, css:tones.map((rgb)=>`rgb(${rgb.join(",")})`) };
}
// Background decoration only: draw before the artwork so neither grain nor
// lighting changes the canonical bead RGB in the foreground.
export function renderAuroraPosterBackground(ctx,layout){
  const {width:w,height:h}=layout;ctx.save();
  const base=ctx.createLinearGradient(0,0,w,h);base.addColorStop(0,'#514887');base.addColorStop(.52,'#8b72ac');base.addColorStop(1,'#554980');ctx.fillStyle=base;ctx.fillRect(0,0,w,h);
  for(const [x,y,r,color] of [[.12,.25,.72,'#9ba4f2a6'],[.88,.64,.68,'#ee9ecbbd'],[.52,.42,.54,'#fff0dcaa'],[.30,.90,.47,'#ad87cd73']]){const g=ctx.createRadialGradient(w*x,h*y,0,w*x,h*y,w*r);g.addColorStop(0,color);g.addColorStop(1,'#ffffff00');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}
  let seed=2197;for(let i=0;i<Math.floor(w*h/200);i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed%w;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=seed%h;ctx.fillStyle=i%2?'#ffffff14':'#74648709';ctx.fillRect(x,y,1,1);}
  // Restrained orbital lines and sparse dust remain entirely behind the art.
  ctx.strokeStyle='#fff4ee24';ctx.lineWidth=.8;
  for(const [x,y,rx,ry,angle] of [[.50,.46,.62,.30,-.45],[.53,.52,.69,.36,-.45]]){ctx.beginPath();ctx.ellipse(w*x,h*y,w*rx,h*ry,angle,0,Math.PI*2);ctx.stroke();}
  for(let i=0;i<72;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed%w;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=seed%h;ctx.fillStyle=i%7===0?'#fff8f17a':'#fff8f135';ctx.fillRect(x,y,i%7===0?2:1,i%7===0?2:1);}
  ctx.restore();
}
export function auroraSignatureInk(rgb){
  const luminance=values=>values.map(srgbToLinear).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0),bg=luminance(rgb),choices=[{color:'#fff9f2',rgb:[255,249,242]},{color:'#17111f',rgb:[23,17,31]}];
  return choices.map(choice=>({...choice,contrast:(Math.max(bg,luminance(choice.rgb))+.05)/(Math.min(bg,luminance(choice.rgb))+.05)})).sort((a,b)=>b.contrast-a.contrast)[0];
}
export function drawAuroraArtworkDepth(ctx,art,box,{transparent=false,renderScale=1}={}){
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.globalAlpha=transparent?.06:.03;
  ctx.filter=`blur(${12*renderScale}px)`;ctx.drawImage(art,box.x,box.y+8,box.width,box.height);ctx.restore();
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.shadowColor=transparent?'#34234d24':'#34234d18';ctx.shadowBlur=10*renderScale;ctx.shadowOffsetY=6*renderScale;
  ctx.drawImage(art,box.x,box.y,box.width,box.height);ctx.restore();
}
export function posterArtworkBox(grid, config={}) {
  const l=POSTER_LAYOUTS[config.ratio||"3x4"], factor={small:.79,standard:1,large:1.17}[config.artworkSize||"standard"];
  const gw=grid[0]?.length||1,gh=grid.length||1,scale=Math.min(l.artMaxWidth*factor/gw,l.artMaxHeight*factor/gh);
  const width=gw*scale,height=gh*scale; return { x:(l.width-width)/2,y:l.artCenterY-height/2,width,height,scale };
}
export function defaultPosterConfig(){return{ratio:"3x4",background:"auto",solidColor:"#F1EEE8",removeBackground:false,artworkSize:"standard",backing:"stamp",brand:"libms",showLogo:true,signatureText:"",signaturePrefix:"none",signatureStyle:"minimal",signatureSize:"medium",showTitle:false,showMetadata:false};}

// Poster-only copy: never erase beads in the editable project. Only an exact,
// predominantly neutral white border is safe enough for automatic removal.
export function preparePosterArtwork(grid,{removeBackground=false}={}) {
  const copy=grid.map(row=>row.slice());
  if(!removeBackground)return{grid:copy,status:"preserved"};
  const exterior=findExteriorBackground(grid),occupied=grid.flat().filter(Boolean).length;
  if(!exterior)return{grid:copy,status:grid.some(row=>row.some(cell=>!cell))?"transparent":"ambiguous"};
  const rgb=exterior.color.rgb;
  if(Math.min(...rgb)<235||Math.max(...rgb)-Math.min(...rgb)>12||exterior.cells.length>=occupied)return{grid:copy,status:"ambiguous"};
  for(const {x,y} of exterior.cells)copy[y][x]=null;
  return{grid:copy,status:"removed"};
}

// Artwork is not a printable sheet: empty cells keep their alpha, while real
// white beads remain white. Never infer transparency from RGB or palette code.
export function renderPosterArtworkCanvas(grid,{cellSize=12,createCanvas=()=>document.createElement("canvas")}={}) {
  const canvas=createCanvas();
  canvas.width=(grid[0]?.length||0)*cellSize;
  canvas.height=grid.length*cellSize;
  const ctx=canvas.getContext("2d");
  ctx.imageSmoothingEnabled=false;
  for(let y=0;y<grid.length;y++)for(let x=0;x<grid[y].length;x++){
    const cell=grid[y][x];
    if(!cell)continue;
    ctx.fillStyle=`rgb(${cell.rgb.join(",")})`;
    ctx.fillRect(x*cellSize,y*cellSize,cellSize,cellSize);
  }
  return canvas;
}

export function drawPosterArtwork(ctx,grid,box,renderScale=1){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  const gw=grid[0]?.length||1,gh=grid.length||1;
  for(let y=0;y<grid.length;y++)for(let x=0;x<grid[y].length;x++){
    const cell=grid[y][x];if(!cell)continue;
    const left=Math.round((box.x+x*box.width/gw)*renderScale),top=Math.round((box.y+y*box.height/gh)*renderScale);
    const right=Math.round((box.x+(x+1)*box.width/gw)*renderScale),bottom=Math.round((box.y+(y+1)*box.height/gh)*renderScale);
    ctx.fillStyle=`rgb(${cell.rgb.join(",")})`;ctx.fillRect(left,top,right-left,bottom-top);
  }
  ctx.restore();
}

export const POSTER_FONT_STYLES=Object.freeze({
  minimal:Object.freeze({label:"简约",latin:'system-ui, sans-serif',cjk:'"PingFang SC", "Noto Sans CJK SC", sans-serif',weight:400}),
  artistic:Object.freeze({label:"文艺",latin:'Georgia, serif',cjk:'"Songti SC", "Noto Serif CJK SC", serif',weight:400}),
  handwritten:Object.freeze({label:"手写",latin:'"Bradley Hand", cursive',cjk:'"Kaiti SC", "STKaiti", "Noto Serif CJK SC", serif',weight:400}),
  modern:Object.freeze({label:"现代",latin:'Avenir, "Helvetica Neue", sans-serif',cjk:'"PingFang SC", "Noto Sans CJK SC", sans-serif',weight:500}),
});
export function signatureDisplayText(config,brandSignature="") { const text=config.signatureText||brandSignature,prefix=config.signaturePrefix==="at"?"@":config.signaturePrefix==="copyright"?"© ":"";return `${prefix}${text}`; }
export function posterFont(config){const style=POSTER_FONT_STYLES[config.signatureStyle]||POSTER_FONT_STYLES.minimal;return `${style.weight} ${config.signatureSize==="large"?56:config.signatureSize==="small"?38:48}px ${style.latin}, ${style.cjk}`;}
