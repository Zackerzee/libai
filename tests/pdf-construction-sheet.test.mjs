import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { drawPdfConstructionSheet, pdfConstructionCellSize } from '../services/pdf-construction-sheet.js';
import { constructionSheetLayout } from '../services/construction-sheet-layout.js';
const cell={paletteId:'mard:B12',code:'B12',rgb:[22,111,71]};
for(const side of [104,600,1000])test(`PDF ${side}-cell sheet fits jsPDF page limits uniformly`,()=>{
  const grid=Array.from({length:side},()=>Array(side).fill(cell)),size=pdfConstructionCellSize(grid,{cellSize:24}),layout=constructionSheetLayout(grid,size);
  assert.ok(layout.width<=14000&&layout.height<=14000);
  if(side===104)assert.equal(size,24);else assert.ok(size<24);
  assert.equal(layout.cellSize,size);assert.equal(layout.usage[0].count,side*side);
});
function recorder(){const calls=[];const doc={calls,fontSize:12};for(const method of ['setFillColor','rect','setFont','setTextColor','text','setDrawColor','setLineWidth','line'])doc[method]=(...args)=>calls.push([method,...args]);doc.setFontSize=size=>{doc.fontSize=size;calls.push(['setFontSize',size]);};doc.getTextWidth=text=>String(text).length*doc.fontSize*.55;return doc;}
test('PDF uses shared construction title, brand, usage and four-sided rulers',()=>{
  const doc=recorder(),layout=drawPdfConstructionSheet(doc,[[cell,null],[cell,cell]],{title:'测试作品 镜像',paletteLabel:'MARD 221',cellSize:24});
  const texts=doc.calls.filter(c=>c[0]==='text').map(c=>c[1]);
  for(const text of ['测试作品 镜像','MARD 221','2×2','作品尺寸','拼豆数量','颜色数量','豆色品牌','图纸页数','×3','B12'])assert.ok(texts.includes(text),text);
  assert.equal(texts.filter(v=>v==='2').length,4);
  assert.equal(layout.usage[0].count,3);
  assert.ok(doc.calls.filter(c=>c[0]==='setFillColor').some(c=>c.slice(1).join(',')==='239,29,36'),'original red ring');
  assert.equal(doc.calls.filter(c=>c[0]==='line').length,6);
  assert.ok(doc.calls.some(c=>c[0]==='setFont'&&c[1]==='SourceHanSansSC'));
});
test('PDF retains optional codes/grid/rulers and palette grid without mutation',()=>{
  const grid=[[cell]],before=JSON.stringify(grid),doc=recorder();drawPdfConstructionSheet(doc,grid,{title:'Example',showCodes:false,showGrid:false,showCoordinates:false});
  assert.equal(doc.calls.filter(c=>c[0]==='line').length,0);
  assert.equal(doc.calls.filter(c=>c[0]==='text'&&c[1]==='B12').length,1,'legend remains even without per-cell codes');
  assert.equal(JSON.stringify(grid),before);
});
test('PDF download always uses full vector construction renderer and permits coordinates',async()=>{
  const source=await readFile(new URL('../services/export-v2-service.js',import.meta.url),'utf8');
  const pdf=source.match(/async pdf\(options=\{\}\)\{([^\n]+)/)[1];
  assert.match(pdf,/await buildPatternPdfWithCjk/);assert.match(pdf,/paletteLabel:getPaletteLabel\(\)/);assert.match(pdf,/showCoordinates:options.showCoordinates!==false/);assert.doesNotMatch(pdf,/throw new Error/);
});
