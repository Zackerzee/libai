import test from 'node:test';
import assert from 'node:assert/strict';
import {posterBackgroundCrop,drawPostageBacking} from '../services/poster-background-crop.mjs';
const blue={rgb:[10,120,240]},white={rgb:[255,255,255]};
test('irregular background crop excludes white and transparent exterior without mutation',()=>{
  const grid=Array.from({length:12},(_,y)=>Array.from({length:12},(_,x)=>(x-6)**2+(y-6)**2<25?blue:(x%2?white:null))),before=JSON.stringify(grid);
  const crop=posterBackgroundCrop(grid);assert.ok(crop);assert.ok(Math.abs(crop.width/crop.height-.75)<1e-9);
  for(let y=Math.floor(crop.y);y<Math.ceil(crop.y+crop.height);y++)for(let x=Math.floor(crop.x);x<Math.ceil(crop.x+crop.width);x++)assert.equal(grid[y][x],blue);
  assert.equal(JSON.stringify(grid),before);
});
test('no coloured content safely returns no crop',()=>{assert.equal(posterBackgroundCrop([[white,null]]),null);});
test('stamp backing draws cream body and square edge teeth',()=>{const calls=[],ctx={save(){},restore(){},fillRect(...v){calls.push(v);}};drawPostageBacking(ctx,{x:50,y:60,width:100,height:100});assert.ok(calls.length>20);assert.equal(ctx.fillStyle,'#fffbe9');});
