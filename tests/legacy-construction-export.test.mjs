import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {pngPatternPixelSize} from '../services/png-pattern-export-renderer.js';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function renderLegacyConstructionSheet('),source.indexOf('async function downloadLegacyPatternPdf('));
const a4=source.slice(source.indexOf('function createA4PageCanvas('),source.indexOf('\nfunction ',source.indexOf('function createA4PageCanvas(')+10));

test('legacy sheet always carries title, palette, mandatory metadata and coordinates',()=>{
  let captured;
  const context=vm.createContext({constructionSheetRenderer:(grid,options)=>{captured=options;return {grid};},getDownloadCellSize:()=>48,buildGalleryTitle:()=> '测试作品',getMirrorLabel:()=> '镜像图纸',getChartPaletteLabel:()=> 'MARD'});
  vm.runInContext(helper,context);
  context.renderLegacyConstructionSheet([[{code:'B12',rgb:[20,100,30]}]],{showCoordinates:false,constructionSheet:false});
  assert.equal(captured.title,'测试作品 · 镜像');
  assert.equal(captured.paletteLabel,'MARD');
  assert.equal(captured.showCoordinates,true);
  assert.equal(captured.constructionSheet,true);
});

test('A4 uses native pixel sheet fitted within unchanged physical page margins',()=>{
  const grid=Array.from({length:80},()=>Array(60).fill({code:'B12',rgb:[20,100,30]}));
  let renderOptions,draw;
  const context=vm.createContext({buildGalleryTitle:()=> 'A4作品',constructionSheetPixelSize:pngPatternPixelSize,renderLegacyConstructionSheet:(grid,options)=>{renderOptions=options;return pngPatternPixelSize(grid,options.cellSize,{constructionSheet:true,showCoordinates:true});},document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(...args){draw=args;}})})}});
  vm.runInContext(a4,context);
  for(const [pageWidth,pageHeight] of [[2480,3508],[3508,2480]]){
    const page=context.createA4PageCanvas({grid,x0:60,y0:80},{pageWidth,pageHeight,marginPx:118,pageIndex:2,pageCount:4,fullWidth:120,fullHeight:160,mirrorLabel:''});
    assert.equal(page.width,pageWidth);assert.equal(page.height,pageHeight);
    assert.equal(draw.length,3,'no scaled drawImage arguments');
    assert.ok(draw[1]>=118 && draw[2]>=118);
    assert.ok(draw[1]+draw[0].width<=pageWidth-118);
    assert.ok(draw[2]+draw[0].height<=pageHeight-118);
    assert.equal(renderOptions.coordinateX,60);assert.equal(renderOptions.coordinateY,80);
    assert.equal(renderOptions.artworkColumns,120);assert.equal(renderOptions.artworkRows,160);
    assert.equal(renderOptions.pageCount,4);
    assert.match(renderOptions.title,/A4作品.*2\/4/);
  }
});

test('all legacy visual download branches route through sheet renderer except poster',()=>{
  for(const name of ['downloadPreviewImage','downloadPattern','downloadSplitPattern']){
    const start=source.indexOf(`async function ${name}(`);
    const body=source.slice(start,source.indexOf('\nfunction ',start+10));
    assert.match(body,/renderLegacyConstructionSheet/);
    assert.match(body,/await constructionSheetRendererReady/);
  }
  assert.match(source,/renderExportPattern\(settings = \{\}\)[\s\S]*?return renderLegacyConstructionSheet/);
  assert.equal((source.match(/settings.format === "poster"\s*\? renderBeadPattern/g)||[]).length,2);
  assert.match(source,/constructionSheetPixelSize\(tile.grid, cellSize/);
});

test('legacy PDF routes use actual canonical sheet data and real PDF writer',()=>{
  const start=source.indexOf('async function downloadLegacyPatternPdf(');
  const body=source.slice(start,source.indexOf('async function downloadPreviewImage(',start));
  assert.match(body,/const grid = getExportGrid\(\)/);
  assert.doesNotMatch(body,/getExportGridForSettings|mirrorGrid\(/);
  assert.match(body,/buildPatternPdfWithCjk\(grid,/);
  for(const field of ['title:','paletteLabel:','artworkColumns:','artworkRows:','showCoordinates: true']) assert.ok(body.includes(field));
  assert.match(body,/buildPatternDownloadName\("pdf"\)/);
  const advanced=source.slice(source.indexOf('async function exportWithSettings('),source.indexOf('function bindExportSettingsOnce('));
  assert.match(advanced,/settings.format === "pdf"[\s\S]*?await downloadLegacyPatternPdf\(settings\)/);
  assert.doesNotMatch(advanced,/downloadA4PrintPattern/);
  const button=source.slice(source.indexOf('// ===== PDF Export ====='),source.indexOf('function readExportSettings('));
  assert.match(button,/await downloadLegacyPatternPdf\(\)/);
  assert.doesNotMatch(button,/__libms_colorData|doc\.addImage|doc\.text\('C'/);
});

test('legacy editor download renders the current editor grid and actual artwork title',async()=>{
  const start=source.indexOf('async function downloadEditorArtwork(');
  const body=source.slice(start,source.indexOf('function publishEditorArtwork(',start));
  const grid=[[{code:'B12',rgb:[20,100,30]}]];
  let exported,filename;
  const context=vm.createContext({state:{editorGrid:grid,sourceName:'旧名称'},els:{artworkNameInput:{value:'编辑作品.png'},editorPaletteSelect:{value:'mard'}},constructionSheetRendererReady:Promise.resolve(),renderLegacyConstructionSheet:(matrix,options)=>{exported={matrix,options};return {toDataURL:()=> 'data:image/png'};},getPaletteLabelForKey:()=> 'MARD',downloadUrl:(url,name)=>{filename=name;},setStatus(){}});
  vm.runInContext(body,context);
  await context.downloadEditorArtwork();
  assert.equal(exported.matrix,grid);
  assert.equal(exported.options.title,'编辑作品');
  assert.equal(exported.options.paletteLabel,'MARD');
  assert.equal(filename,'编辑作品-editor.png');
  assert.equal(context.state.editorGrid,grid);
  assert.doesNotMatch(body,/createChartCanvas|mirrorGrid|state\.grid\s*=/);
});
