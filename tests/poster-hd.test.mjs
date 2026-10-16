import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {renderPosterCanvas} from '../services/export-v2-service.js';
import {drawPosterArtwork,posterFont,posterArtworkBox} from '../services/poster-export-service.js';
const red={code:'F03',rgb:[247,73,65]};
test('poster uses readable signature size and larger default artwork without smoothing',()=>{
  assert.match(posterFont({}),/48px/);
  const box=posterArtworkBox([[red]],{});
  assert.equal(box.width,1100);assert.equal(box.height,1100);
});
test('poster foreground draws canonical grid at integer physical coordinates without image scaling',()=>{
  const calls=[],ctx={save(){},restore(){},setTransform(...args){calls.push(args);},fillRect(...args){calls.push(args);}};
  drawPosterArtwork(ctx,[[red,null,red]],{x:1.2,y:2.3,width:10.1,height:5.4},2);
  assert.deepEqual(calls[0],[1,0,0,1,0,0]);assert.equal(calls.length,3);
  assert.ok(calls.slice(1).flat().every(Number.isInteger));assert.equal(ctx.fillStyle,'rgb(247,73,65)');
});
test('HD posters encode true PNG dimensions, preserve grid and use lightweight preview',async()=>{
  const native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'),previous=globalThis.document;
  globalThis.document={createElement(){const canvas=native.createCanvas(1,1);canvas.dataset={};return canvas;}};
  try{
    const grid=[[null,red],[red,null]],before=structuredClone(grid);
    for(const [ratio,width,height] of [['3x4',3000,4000],['1x1',3600,3600]]){
      const canvas=await renderPosterCanvas(grid,{ratio,background:'solid',showLogo:false});
      const bytes=canvas.toBuffer('image/png');assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);
      assert.deepEqual([...canvas.getContext('2d').getImageData(width*.6,height*.4,1,1).data],[247,73,65,255]);
    }
    const preview=await renderPosterCanvas(grid,{showLogo:false},{},{width:300});assert.deepEqual([preview.width,preview.height],[300,400]);assert.deepEqual(grid,before);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
