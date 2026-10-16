import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeExportFilename, exportFilename } from "../services/export-filename.js";
import { splitPatternGrid, countValidCells } from "../services/pattern-split-service.js";
import { PATTERN_QUALITY, codeTextColor, fitCodeFont, patternPixelSize, usageFromGrid } from "../services/pattern-export-renderer.js";
import { POSTER_LAYOUTS, POSTER_FONT_STYLES, analyzeArtworkBackground, posterArtworkBox, signatureDisplayText, posterFont } from "../services/poster-export-service.js";
import { buildPatternPdfBlob } from "../services/export-v2-service.js";
import { buildPixlerProject } from "../services/pixler-exporter.js";
import { importPixlerProject } from "../importers/pixler.mjs";
import { resizeCanvasGrid } from "../services/grid-resize-service.js";
import { CJK_FONT_URL, containsCjk, resolvePdfFont, resetPdfFontCache } from "../services/pdf-font-provider.js";

const color=(id,rgb=[120,80,60])=>({paletteId:id,code:id,rgb});
const grid=(w,h)=>Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>(x+y)%7?color("A01"):null));

test("export filenames preserve Chinese and replace only unsafe characters",()=>{
  assert.equal(sanitizeExportFilename(" 韩立：《一/二》? "),"韩立：《一-二》-");
  assert.equal(exportFilename("韩立","poster-3x4","png"),"韩立_海报_3x4.png");
  assert.equal(exportFilename("韩立","poster-1x1","png"),"韩立_海报_1x1.png");
  assert.equal(exportFilename("韩立","overview","png"),"韩立_总览.png");
});

for(const [w,h,total,last] of [[104,104,1,[104,104]],[105,104,2,[1,104]],[200,200,4,[96,96]],[220,104,3,[12,104]],[220,220,9,[12,12]]]) test(`104 board split ${w}x${h}`,()=>{
  const source=grid(w,h),split=splitPatternGrid(source);
  assert.equal(split.total,total); assert.deepEqual([split.tiles.at(-1).width,split.tiles.at(-1).height],last);
  assert.equal(split.tiles.reduce((n,t)=>n+countValidCells(t.cells),0),countValidCells(source));
  assert.deepEqual(split.tiles.map(t=>t.index),Array.from({length:total},(_,i)=>i+1));
});

test("split preserves palette identity, nulls and correct neighbors",()=>{
  const a=color("brand:A",[10,20,30]),b=color("brand:B",[10,20,30]),source=[[a,b,null],[null,a,b]];
  const split=splitPatternGrid(source,2,1);
  assert.equal(split.tiles[0].cells[0][0].paletteId,"brand:A"); assert.equal(split.tiles[0].cells[0][1].paletteId,"brand:B");
  assert.equal(split.tiles[1].cells[0][0],null); assert.equal(split.tiles[0].neighbors.right,"02"); assert.equal(split.tiles[0].neighbors.down,"03");
});

test("pattern quality is final-resolution based and ultra 104 artwork is 3328 square",()=>{
  assert.deepEqual(PATTERN_QUALITY,{standard:16,high:24,ultra:32});
  assert.equal(patternPixelSize(grid(104,104),32).artworkWidth,3328); assert.equal(patternPixelSize(grid(104,104),32).artworkHeight,3328);
  assert.equal(codeTextColor([10,20,30]),"#F7F7F7"); assert.equal(codeTextColor([250,240,210]),"#232323");
});

test("long palette codes shrink to remain inside the cell",()=>{
  const ctx={font:"",measureText:(text)=>({width:text.length*12})};
  const size=fitCodeFont(ctx,"MARD123",32);assert.ok(size<32*.38);assert.ok(size>=6);
});

test("PDF uses vector rectangles, lines and text instead of a raster screenshot",async()=>{
  const text=await buildPatternPdfBlob([[color("C12",[20,30,40])]],{title:"Pattern",cellSize:32}).text();
  assert.match(text,/ re f/);assert.match(text,/ re S/);assert.match(text,/\(C12\) Tj/);assert.doesNotMatch(text,/\/Subtype \/Image/);
});

test("usage is keyed by palette identity instead of RGB",()=>{
  const usage=usageFromGrid([[color("x:A"),color("x:B")]]); assert.equal(usage.length,2);
});

test("poster layouts are independent and keep artwork aspect ratio",()=>{
  assert.deepEqual([POSTER_LAYOUTS["3x4"].width,POSTER_LAYOUTS["3x4"].height],[1500,2000]);
  assert.deepEqual([POSTER_LAYOUTS["1x1"].width,POSTER_LAYOUTS["1x1"].height],[1800,1800]);
  const box=posterArtworkBox(grid(200,100),{ratio:"3x4"}); assert.ok(Math.abs(box.width/box.height-2)<1e-9);
});

test("poster signature prefix and four typography styles are deterministic",()=>{
  assert.equal(signatureDisplayText({signatureText:"时里白",signaturePrefix:"none"}),"时里白");
  assert.equal(signatureDisplayText({signatureText:"时里白",signaturePrefix:"at"}),"@时里白");
  assert.equal(signatureDisplayText({signatureText:"时里白",signaturePrefix:"copyright"}),"© 时里白");
  assert.deepEqual(Object.keys(POSTER_FONT_STYLES),["minimal","artistic","handwritten","modern"]);
  for(const style of Object.keys(POSTER_FONT_STYLES)){const font=posterFont({signatureStyle:style,signatureSize:"medium"});assert.match(font,/48px/);assert.match(font,/PingFang|Songti|Kaiti|Noto/);}
});

test("PDF rejects Chinese title explicitly instead of corrupting it into question marks",()=>{
  assert.throws(()=>buildPatternPdfBlob([[color("C12")]],{title:"时里白"}),/PDF 中文字体资源尚未接入/);
});
test("PDF font provider keeps ASCII built-in and lazy-loads CJK",async()=>{
  assert.equal(containsCjk("LIBMS C12"),false);assert.equal(containsCjk("LIBMS 韩立"),true);
  let calls=0;const fetchFn=async(url)=>{calls++;assert.equal(url,CJK_FONT_URL);return{ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};};
  resetPdfFontCache();const ascii=await resolvePdfFont("Pattern",{fetchFn});assert.equal(ascii.fontId,"Helvetica");assert.equal(calls,0);
  const cjk=await resolvePdfFont("韩立测试图",{fetchFn});assert.equal(cjk.supportsCJK,true);assert.equal(calls,1);
  await resolvePdfFont("中英 Mixed",{fetchFn});assert.equal(calls,1,"font bytes are cached after the first PDF-only load");
});
test("PDF font provider reports an explicit load failure",async()=>{
  resetPdfFontCache();await assert.rejects(resolvePdfFont("中文",{fetchFn:async()=>({ok:false,status:404})}),/PDF 中文字体加载失败/);
});

test("V3 export control is not intercepted by the legacy preview modal",async()=>{
  const [app,workspace]=await Promise.all([
    readFile(new URL("../app.js",import.meta.url),"utf8"),
    readFile(new URL("../ui/workspace.js",import.meta.url),"utf8"),
  ]);
  assert.doesNotMatch(app,/previewStage\.addEventListener\(["']click["']/);
  assert.doesNotMatch(workspace,/id="ws-export"[^>]*onclick=/);
  assert.match(workspace,/exportButton\.addEventListener\(["']click["']/);
});

test("automatic background is lighter and desaturated toward white",()=>{
  const source=[[color("A",[80,40,20]),color("A",[80,40,20]),color("A",[80,40,20])]];
  const bg=analyzeArtworkBackground(source); assert.ok(bg.tones[0].every((v,i)=>v>bg.dominant[i]));
  assert.ok(Math.max(...bg.tones[0])-Math.min(...bg.tones[0]) < Math.max(...bg.dominant)-Math.min(...bg.dominant));
});

test("Pixler export round-trips dimensions, nulls and real palette codes",async()=>{
  const a={...color("mard:A01",[80,40,20]),code:"A01"},source=[[a,null],[a,a]],data=await buildPixlerProject(source,{title:"韩立"});
  const {project}=await importPixlerProject(data);
  assert.equal(project.projectName,"韩立");assert.deepEqual(project.canvas,{width:2,height:2});
  assert.equal(project.grid[0][1],null);assert.equal(project.grid[0][0],"A01");
});

test("imported 222x295 resize chain remains Pixler round-trip safe",async()=>{
  const a={...color("mard:A01",[80,40,20]),code:"A01"};
  let source=Array.from({length:295},()=>Array(222).fill(null));source[147][111]=a;
  source=resizeCanvasGrid(source,220,300,{anchor:"center"});
  source=resizeCanvasGrid(source,104,104,{anchor:"center"});
  source=resizeCanvasGrid(source,222,295,{anchor:"center"});
  const data=await buildPixlerProject(source,{title:"Resize Roundtrip"}),{project}=await importPixlerProject(data);
  assert.deepEqual(project.canvas,{width:222,height:295});
  assert.equal(project.grid.flat().filter(Boolean).length,1);
  assert.equal(project.grid.flat().find(Boolean),"A01");
});
