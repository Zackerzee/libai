import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBoardSheet,renderBoardOverview} from '../services/board-sheet-export.js';
import {splitPatternGrid} from '../services/pattern-split-service.js';
const cell={code:'B12',rgb:[22,111,71]},grid=[Array(105).fill(cell)],split=splitPatternGrid(grid);
function fakeDocument(){
  const texts=[];
  const ctx={fillRect(){},strokeRect(){},measureText(v){return {width:String(v).length*6};},fillText(v){texts.push(String(v));}};
  return {texts,createElement(){return {width:0,height:0,getContext(){return ctx;}};}};
}
test('board sheet retains title, full dimensions, actual usage and global edge coordinates',()=>{
  const document=fakeDocument();renderBoardSheet(split.tiles[1],split,{document,title:'作品名',paletteLabel:'MARD 221'});
  assert.ok(document.texts.some(v=>v.includes('作品名')&&v.includes('02/2')));
  for(const value of ['105×1','MARD 221','×1','105','作品尺寸'])assert.ok(document.texts.includes(value),value);
  assert.equal(document.texts.filter(v=>v==='105').length,2);
});
test('board overview keeps full actual material count and coordinates',()=>{
  const document=fakeDocument();renderBoardOverview(grid,split,{document,title:'总览',paletteLabel:'MARD 221'});
  for(const value of ['总览','105×1','×105','105','B12'])assert.ok(document.texts.includes(value),value);
});
