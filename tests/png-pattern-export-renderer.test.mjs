import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PNG_PATTERN_QUALITY,pngPatternPixelSize,renderPngPatternCanvas} from '../services/png-pattern-export-renderer.js';

const red={code:'F03',rgb:[255,0,0]},black={code:'H07',rgb:[0,0,0]};
const grid=[[red,null],[black,red],[null,black]];
function spyDocument(){
  const draws=[];
  const ctx={fillRect(...args){draws.push(['rect',this.fillStyle,...args]);},fillText(...args){draws.push(['text',this.font,this.fillStyle,...args]);},measureText(code){return {width:String(code).length*Number(this.font.match(/ (\d+)px/)[1])*.65};}};
  return {draws,ctx,createElement(type){assert.equal(type,'canvas');return {getContext(kind){assert.equal(kind,'2d');return ctx;}};}};
}
test('PNG quality and dimensions are physical grid multiples without print margins',()=>{
  assert.deepEqual(PNG_PATTERN_QUALITY,{standard:24,hd:48,ultra:64});
  assert.deepEqual(pngPatternPixelSize(grid),{width:96,height:144,cellSize:48});
  assert.deepEqual(pngPatternPixelSize(Array.from({length:78},()=>Array(52).fill(red)),48),{width:2496,height:3744,cellSize:48});
  assert.throws(()=>pngPatternPixelSize(grid,24.5),/正整数/);
});
test('PNG fills cells at final integer coordinates and only codes, never title/footer',()=>{
  const document=spyDocument(),canvas=renderPngPatternCanvas(grid,{document,title:'must not render',subtitle:'must not render'});
  assert.equal(canvas.width,96);assert.equal(canvas.height,144);
  assert.deepEqual(document.draws.slice(0,2),[['rect','rgb(255,0,0)',0,0,48,48],['rect','#fff',48,0,48,48]]);
  const texts=document.draws.filter(draw=>draw[0]==='text');
  assert.equal(texts.length,4);assert.ok(texts.every(draw=>/600 \d+px/.test(draw[1])));
  assert.ok(texts.every(draw=>Number.isInteger(draw[4])&&Number.isInteger(draw[5])));
  assert.deepEqual(texts.map(draw=>draw[3]),['F03','H07','F03','H07']);
});
test('integer grid bands stay within image bounds and export toggles are independent',()=>{
  const document=spyDocument();renderPngPatternCanvas(grid,{document,cellSize:24,showCodes:false});
  const lines=document.draws.slice(6);
  assert.equal(lines.length,7);
  assert.ok(lines.every(([,style,x,y,w,h])=>style==='#23232355'&&[x,y,w,h].every(Number.isInteger)&&x>=0&&y>=0&&x+w<=48&&y+h<=72));
  const noGrid=spyDocument();renderPngPatternCanvas(grid,{document:noGrid,showGrid:false,showCodes:false});
  assert.equal(noGrid.draws.length,6);
});
test('longer codes shrink using final-size metrics and light/dark text contrast is retained',()=>{
  const document=spyDocument();renderPngPatternCanvas([[{...red,code:'LONGCODE'},black]],{document,cellSize:24,showGrid:false});
  const texts=document.draws.filter(draw=>draw[0]==='text');
  assert.ok(Number(texts[0][1].match(/ (\d+)px/)[1])<Number(texts[1][1].match(/ (\d+)px/)[1]));
  assert.equal(texts[1][2],'#F7F7F7');
});

let actualCanvas;
try { actualCanvas=createRequire(import.meta.url)('@napi-rs/canvas'); } catch {
  try { actualCanvas=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'); } catch {}
}
for (const [cells,pixels] of [[104,4992],[78,3744]]) test(`real ${cells}×${cells} @48 PNG IHDR is ${pixels}×${pixels}`,{skip:!actualCanvas&&'optional bundled canvas runtime unavailable'},()=>{
  const source=Array.from({length:cells},()=>Array(cells).fill(red));
  const canvas=renderPngPatternCanvas(source,{document:{createElement(){return actualCanvas.createCanvas(1,1);}}});
  const bytes=canvas.toBuffer('image/png');
  assert.equal(canvas.width,pixels);assert.equal(canvas.height,pixels);
  assert.equal(bytes.subarray(12,16).toString(),'IHDR');
  assert.equal(bytes.readUInt32BE(16),pixels);assert.equal(bytes.readUInt32BE(20),pixels);
});
test('real PNG encoder IHDR reports exact final dimensions at every quality', {skip:!actualCanvas&&'optional bundled canvas runtime unavailable'},()=>{
  for(const cellSize of Object.values(PNG_PATTERN_QUALITY)){
    const document={createElement(){return actualCanvas.createCanvas(1,1);}};
    const canvas=renderPngPatternCanvas(grid,{document,cellSize});
    const bytes=canvas.toBuffer('image/png');
    assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.subarray(12,16).toString(),'IHDR');
    assert.equal(bytes.readUInt32BE(16),2*cellSize);assert.equal(bytes.readUInt32BE(20),3*cellSize);
  }
});
test('real 52×78 HD PNG is 2496×3744 and cell interiors retain exact RGB', {skip:!actualCanvas&&'optional bundled canvas runtime unavailable'},()=>{
  const grid=Array.from({length:78},(_,y)=>Array.from({length:52},(_,x)=>(x+y)%2?black:red));
  const canvas=renderPngPatternCanvas(grid,{document:{createElement(){return actualCanvas.createCanvas(1,1);}},showCodes:false});
  const bytes=canvas.toBuffer('image/png');
  assert.equal(bytes.readUInt32BE(16),2496);assert.equal(bytes.readUInt32BE(20),3744);
  assert.deepEqual([...canvas.getContext('2d').getImageData(10,10,1,1).data],[255,0,0,255]);
  assert.deepEqual([...canvas.getContext('2d').getImageData(58,10,1,1).data],[0,0,0,255]);
});
