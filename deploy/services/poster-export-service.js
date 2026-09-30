import { usageFromGrid } from "./pattern-export-renderer.js";

export const POSTER_LAYOUTS = Object.freeze({
  "3x4": Object.freeze({ width:1500,height:2000,safe:90,logoWidth:240,artCenterY:900,artMaxWidth:870,artMaxHeight:900,signatureY:1660,metadataY:1780 }),
  "1x1": Object.freeze({ width:1800,height:1800,safe:108,logoWidth:250,artCenterY:835,artMaxWidth:1040,artMaxHeight:980,signatureY:1500,metadataY:1600 }),
});
export const BRAND_PRESETS = Object.freeze({
  libms: { id:"libms",name:"libms Studio",logo:"./libai-logo-pixel.svg",signature:"libms Studio" },
  shiliber: { id:"shiliber",name:"时里白造物",logo:"./libai-logo-pixel.svg",signature:"时里白造物" },
  custom: { id:"custom",name:"自定义",logo:"./libai-logo-pixel.svg",signature:"" },
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function analyzeArtworkBackground(grid) {
  const usage=usageFromGrid(grid).filter((x)=>x.count>1&&x.rgb.some((v)=>v>18)&&x.rgb.some((v)=>v<245)).slice(0,4);
  const tones=(usage.length?usage:[{rgb:[188,190,194]}]).map(({rgb})=>rgb.map((v)=>clamp(Math.round(v*.30+255*.70),205,248)));
  return { dominant:usage[0]?.rgb||[188,190,194], tones, css:tones.map((rgb)=>`rgb(${rgb.join(",")})`) };
}
export function posterArtworkBox(grid, config={}) {
  const l=POSTER_LAYOUTS[config.ratio||"3x4"], factor={small:.79,standard:1,large:1.17}[config.artworkSize||"standard"];
  const gw=grid[0]?.length||1,gh=grid.length||1,scale=Math.min(l.artMaxWidth*factor/gw,l.artMaxHeight*factor/gh);
  const width=gw*scale,height=gh*scale; return { x:(l.width-width)/2,y:l.artCenterY-height/2,width,height,scale };
}
export function defaultPosterConfig(){return{ratio:"3x4",background:"auto",solidColor:"#F1EEE8",artworkSize:"standard",backing:"standard",brand:"libms",showLogo:true,signatureText:"",signaturePrefix:"none",signatureStyle:"minimal",signatureSize:"medium",showTitle:false,showMetadata:false};}

