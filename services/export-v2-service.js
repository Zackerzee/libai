import { sanitizeExportFilename, exportFilename } from "./export-filename.js";
import { renderPatternCanvas, PATTERN_QUALITY, usageFromGrid } from "./pattern-export-renderer.js";
import { PNG_PATTERN_QUALITY, pngPatternPixelSize, renderPngPatternCanvas } from "./png-pattern-export-renderer.js?v=20261007-all-export-r16";
import { splitPatternGrid } from "./pattern-split-service.js";
import {posterBackgroundCrop,drawPostageBacking} from './poster-background-crop.mjs?v=20261008-poster-r18';
import { renderBoardOverview, renderBoardSheet } from './board-sheet-export.js?v=20261007-export-unified';
import { POSTER_LAYOUTS, BRAND_PRESETS, analyzeArtworkBackground, posterArtworkBox, defaultPosterConfig, posterFont, signatureDisplayText, renderPosterArtworkCanvas, drawPosterArtwork, preparePosterArtwork, renderAuroraPosterBackground, drawAuroraArtworkDepth, auroraSignatureInk } from "./poster-export-service.js?v=20261007-poster-clarity-r11";
import { buildPixlerProject } from "./pixler-exporter.js";
import { containsCjk, resolvePdfFont, bytesToBinary } from "./pdf-font-provider.js";
import { constructionSheetLayout } from './construction-sheet-layout.js';
import { drawPdfConstructionSheet, pdfConstructionCellSize } from './pdf-construction-sheet.js';

const canvasBlob=(canvas,type="image/png",quality=.94)=>new Promise((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error("图片编码失败")),type,quality));
const download=(blob,name)=>{const a=document.createElement("a"),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);};
const escPdf=(s)=>String(s).replace(/[\\()]/g,"\\$&").replace(/[^\x20-\x7E]/g,"?");
const cellRgb=(cell)=>cell?.rgb||[255,255,255];
export function mirrorExportGrid(grid,mirror="none"){
  if(!['none','horizontal','vertical'].includes(mirror))throw new RangeError('无效导出镜像方向');
  const copy=grid.map(row=>row.map(cell=>cell?{...cell,rgb:[...cell.rgb]}:null));
  return mirror==='horizontal'?copy.map(row=>row.reverse()):mirror==='vertical'?copy.reverse():copy;
}

export function buildPatternPdfBlob(grid,{title="未命名作品",cellSize=12,showCodes=true,showGrid=true}={}){
  if(/[^\x20-\x7E]/.test(title)) throw new Error("PDF 中文字体资源尚未接入：当前合法 Fusion Pixel 资源为 WOFF2 分片，不能直接嵌入本 PDF writer；请使用英文标题或等待字体 provider 接入。");
  const width=(grid[0]?.length||0)*cellSize,height=grid.length*cellSize+50,commands=["q"];
  for(let y=0;y<grid.length;y++)for(let x=0;x<grid[y].length;x++){const c=grid[y][x],rgb=cellRgb(c).map(v=>(v/255).toFixed(3));const px=x*cellSize,py=height-50-(y+1)*cellSize;commands.push(`${rgb.join(" ")} rg ${px} ${py} ${cellSize} ${cellSize} re f`);if(showGrid)commands.push(`0.25 G 0.35 w ${px} ${py} ${cellSize} ${cellSize} re S`);if(showCodes&&c?.code){const dark=(.2126*c.rgb[0]+.7152*c.rgb[1]+.0722*c.rgb[2])<128;commands.push(`${dark?"0.97 0.97 0.97":"0.14 0.14 0.14"} rg BT /F1 ${Math.max(5,cellSize*.28)} Tf ${px+cellSize*.18} ${py+cellSize*.42} Td (${escPdf(c.code)}) Tj ET`);}}
  commands.push(`0.12 0.12 0.12 rg BT /F1 22 Tf 20 ${height-32} Td (${escPdf(title)}) Tj ET Q`);const stream=commands.join("\n"),objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`];let out="%PDF-1.4\n",offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(out.length);out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(v=>String(v).padStart(10,"0")+" 00000 n \n").join("")}trailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new Blob([out],{type:"application/pdf"});
}
export async function buildPatternPdfWithCjk(grid,options={}){
  const settings={...options,cellSize:pdfConstructionCellSize(grid,options)},layout=constructionSheetLayout(grid,settings.cellSize,settings);
  const [{jsPDF},font]=await Promise.all([import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm"),resolvePdfFont(`${settings.title||''}作品尺寸拼豆数量颜色数量豆色品牌图纸页数`)]);
  const {width,height}=layout,doc=new jsPDF({unit:"pt",format:[width,height],orientation:width>height?"landscape":"portrait",compress:true});
  doc.addFileToVFS("SourceHanSansSC-VF.ttf",bytesToBinary(font.fontData));doc.addFont("SourceHanSansSC-VF.ttf",font.fontId,"normal");
  drawPdfConstructionSheet(doc,grid,settings,font.fontId);return doc.output("blob");
}
async function image(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});}
export async function renderPosterCanvas(grid,config={},meta={},target={}){
  const cfg={...defaultPosterConfig(),...config},layout=POSTER_LAYOUTS[cfg.ratio],renderScale=target.width?target.width/layout.width:2,canvas=document.createElement("canvas");canvas.width=Math.round(layout.width*renderScale);canvas.height=Math.round(layout.height*renderScale);const ctx=canvas.getContext("2d");ctx.scale(renderScale,renderScale);const bg=analyzeArtworkBackground(grid);const gradient=ctx.createRadialGradient(layout.width*.52,layout.height*.42,20,layout.width*.5,layout.height*.5,layout.width*.8);gradient.addColorStop(0,cfg.background==="solid"?cfg.solidColor:bg.css[0]);gradient.addColorStop(1,cfg.background==="solid"?cfg.solidColor:(bg.css[1]||"#f3f1ee"));ctx.fillStyle=gradient;ctx.fillRect(0,0,layout.width,layout.height);
  const prepared=preparePosterArtwork(grid,cfg),art=renderPosterArtworkCanvas(prepared.grid);
  canvas.dataset.backgroundStatus=prepared.status;
  if(cfg.background==="aurora")renderAuroraPosterBackground(ctx,layout);
  if(cfg.background==="artwork"){
    const blur=65,crop=posterBackgroundCrop(prepared.grid,layout.width/layout.height);
    if(crop){const unit=art.width/(prepared.grid[0]?.length||1);ctx.save();ctx.filter=`blur(${blur*renderScale}px)`;ctx.imageSmoothingEnabled=true;ctx.drawImage(art,crop.x*unit,crop.y*unit,crop.width*unit,crop.height*unit,-blur*3,-blur*3,layout.width+blur*6,layout.height+blur*6);ctx.restore();}
  }
  const box=posterArtworkBox(grid,cfg),pad=['none','stamp'].includes(cfg.backing)?0:box.width*(cfg.backing==="narrow"?.03:.06);if(cfg.backing==='stamp')drawPostageBacking(ctx,box);if(pad){ctx.save();ctx.shadowColor="#00000018";ctx.shadowBlur=36;ctx.fillStyle="#FAFAF7";ctx.fillRect(box.x-pad,box.y-pad,box.width+pad*2,box.height+pad*2);ctx.restore();}
  if(cfg.background==="aurora")drawAuroraArtworkDepth(ctx,art,box,{transparent:prepared.grid.some(row=>row.some(cell=>!cell)),renderScale});
  drawPosterArtwork(ctx,prepared.grid,box,renderScale);
  const brand=BRAND_PRESETS[cfg.brand]||BRAND_PRESETS.libms;if(cfg.showLogo)try{const logo=await image(brand.logo);const w=layout.logoWidth,h=w*(logo.naturalHeight/logo.naturalWidth);ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(logo,(layout.width-w)/2,layout.safe,w,h);ctx.restore();}catch{}
let auroraInk=null;if(cfg.background==="aurora"){let rgb=[85,73,128];try{rgb=[...ctx.getImageData(Math.floor(layout.width*.5*renderScale),Math.floor((layout.signatureY-16)*renderScale),1,1).data].slice(0,3);}catch{}auroraInk=auroraSignatureInk(rgb).color;}ctx.textAlign="center";ctx.fillStyle=auroraInk||"#232323";ctx.font=posterFont(cfg);ctx.save();if(cfg.background==="artwork"){ctx.globalAlpha=.45;ctx.fillStyle="#ffffff";}ctx.fillText(signatureDisplayText(cfg,brand.signature),layout.width/2,layout.signatureY,layout.width-2*layout.safe);ctx.restore();if(cfg.showTitle){ctx.font='500 40px system-ui, "PingFang SC", "Noto Sans CJK SC", sans-serif';ctx.fillText(meta.title||"未命名作品",layout.width/2,layout.signatureY+72,layout.width-2*layout.safe);}if(cfg.showMetadata){ctx.font='500 30px system-ui, "PingFang SC", "Noto Sans CJK SC", sans-serif';ctx.fillStyle=auroraInk||"#232323";ctx.fillText(`${meta.paletteLabel||"MARD 221"} · ${grid[0]?.length||0}×${grid.length} · ${usageFromGrid(grid).length}色 · ${usageFromGrid(grid).reduce((s,i)=>s+i.count,0)}颗`,layout.width/2,layout.metadataY,layout.width-2*layout.safe);}canvas.dataset.layoutWidth=String(layout.width);canvas.dataset.layoutHeight=String(layout.height);return canvas;
}

export function createExportV2Service({getGrid,getTitle,getPaletteLabel,onPngDiagnostic=diagnostic=>console.info("[PNG export]",diagnostic)}){
  const grid=()=>getGrid().map(row=>row.map(cell=>cell?{...cell,rgb:[...cell.rgb]}:null));
  const title=()=>sanitizeExportFilename(getTitle());const subtitle=(g)=>`${getPaletteLabel()} · ${g[0]?.length||0} × ${g.length} 格 · ${usageFromGrid(g).length} 色 · ${usageFromGrid(g).reduce((s,i)=>s+i.count,0)} 颗`;
  return {
    estimate(quality="hd",options={}){return pngPatternPixelSize(grid(),PNG_PATTERN_QUALITY[quality]||PNG_PATTERN_QUALITY.hd,{...options,constructionSheet:true,showCoordinates:options.showCoordinates!==false});},
    async png(options={}){
      const g=mirrorExportGrid(grid(),options.mirror||"none"),cellSize=PNG_PATTERN_QUALITY[options.quality]||PNG_PATTERN_QUALITY.hd;
      const settings={...options,cellSize,constructionSheet:true,title:getTitle()||'未命名作品',paletteLabel:getPaletteLabel(),showCodes:options.showCodes!==false,showGrid:options.showGrid!==false,showCoordinates:options.showCoordinates!==false};
      const canvas=renderPngPatternCanvas(g,settings);
      const blob=await canvasBlob(canvas,"image/png");
      const size=pngPatternPixelSize(g,cellSize,settings);
      onPngDiagnostic({gridWidth:g[0]?.length||0,gridHeight:g.length,cellSize,exportWidth:size.width,exportHeight:size.height,"canvas.width":canvas.width,"canvas.height":canvas.height,DPR:globalThis.devicePixelRatio||1,fileSize:blob.size});
      download(blob,exportFilename(title(),"pattern","png"));return canvas;
    },
    async pdf(options={}){const g=mirrorExportGrid(grid(),options.mirror||"none"),settings={...options,title:getTitle()||'未命名作品',paletteLabel:getPaletteLabel(),cellSize:PATTERN_QUALITY[options.quality==="hd"?"high":options.quality||"high"]||24,showCodes:options.showCodes!==false,showGrid:options.showGrid!==false,showCoordinates:options.showCoordinates!==false},blob=await buildPatternPdfWithCjk(g,settings);download(blob,exportFilename(title(),"pattern","pdf"));return blob;},
    async pixler(){const data=await buildPixlerProject(grid(),{title:title(),paletteLabel:getPaletteLabel()}),blob=new Blob([data],{type:"application/zip"});download(blob,exportFilename(title(),"pattern","pixler"));return blob;},
    async poster(config={}){const g=grid(),cfg={...defaultPosterConfig(),...config},canvas=await renderPosterCanvas(g,cfg,{title:title(),paletteLabel:getPaletteLabel()});download(await canvasBlob(canvas),exportFilename(title(),`poster-${cfg.ratio}`,"png"));return canvas;},
    async previewPoster(config={},target={width:300}){const g=grid();return renderPosterCanvas(g,{...defaultPosterConfig(),...config},{title:title(),paletteLabel:getPaletteLabel()},target);},
    split:()=>splitPatternGrid(grid(),104,104),
    async boards(options={}){
      const g=mirrorExportGrid(grid(),options.mirror||"none"),split=splitPatternGrid(g,104,104);
      if(!split.needsSplit)throw new Error("当前作品无需分板");
      const files={},settings={...options,title:getTitle()||'未命名作品',paletteLabel:getPaletteLabel()};
      const overview=renderBoardOverview(g,split,{...settings,title:`${settings.title} · 分板总览`});
      files[exportFilename(title(),"overview","png")]=new Uint8Array(await (await canvasBlob(overview)).arrayBuffer());
      for(const tile of split.tiles){const canvas=renderBoardSheet(tile,split,settings);files[`${title()}_${tile.number}.png`]=new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer());}
      const mod=await import("../vendor/fflate.js"),api=globalThis.fflate||mod.default||mod,zipBytes=api.zipSync(files,{level:1});
      const blob=new Blob([zipBytes],{type:"application/zip"});download(blob,`${title()}.zip`);return{blob,split};
    },
  };
}
