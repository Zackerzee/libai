import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderInspectorGrid,sampledGrid,inspectorCellDetail} from '../services/v3-inspector-renderer.mjs';
test('S6 pure fillRects and S7 same grid identity without quantizing or mutation',()=>{
  const grid=[[{code:'B12',rgb:[10,80,30]},null]],before=structuredClone(grid),calls=[];
  const ctx={fillRect(...v){calls.push(['rect',this.fillStyle,...v]);},fillText(...v){calls.push(['text',...v]);}},canvas={getContext:()=>ctx};
  assert.equal(renderInspectorGrid(canvas,grid).grid,grid);assert.deepEqual(calls,[['rect','rgb(10,80,30)',0,0,8,8]]);assert.equal(canvas.width,16);assert.equal(canvas.height,8);
  calls.length=0;assert.equal(renderInspectorGrid(canvas,grid,{construction:true}).grid,grid);assert.ok(calls.some(c=>c[0]==='text'));assert.deepEqual(grid,before);
});
test('sample RGB and cell audit use real snapshot stages and optional actual diagnostic maps',()=>{
  const colors=[[{r:10,g:80,b:30}]],grid=sampledGrid(colors);grid[0][0].code='B12';
  const source={width:1,height:1,data:new Uint8ClampedArray([20,80,30,255])},stages={S1:{source},S2:{colors},S3:{grid},S4:{grid},S6:{grid}};
  const result=inspectorCellDetail(source,stages,{protectionMap:new Float32Array([.5])},0,0);
  assert.deepEqual(result.sourceCenter.rgb,[20,80,30]);assert.equal(result.final.deltaEFromSample,0);assert.deepEqual(result.scores,{protectionMap:.5});assert.equal(result.cleanupRecord,null);
});
test('Pipeline inspector is distinct from sampling comparison and construction shares final grid',async()=>{
  const html=await readFile(new URL('../algorithm-lab.html',import.meta.url),'utf8');assert.match(html,/id="pipeline-run"/);assert.match(html,/inspect:true/);assert.match(html,/S7.*stages\.S6\.grid/);assert.match(html,/不运行 Auto Tune/);
});
