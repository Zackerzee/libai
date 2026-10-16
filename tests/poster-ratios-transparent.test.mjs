import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {POSTER_LAYOUTS,posterArtworkBox} from '../services/poster-export-service.js';
import {renderPosterCanvas} from '../services/export-v2-service.js';

test('five poster ratios retain safe artwork placement for every size',()=>{
  assert.deepEqual([POSTER_LAYOUTS['3x4'].width,POSTER_LAYOUTS['3x4'].height],[1500,2000]);
  assert.deepEqual([POSTER_LAYOUTS['1x1'].width,POSTER_LAYOUTS['1x1'].height],[1800,1800]);
  for(const ratio of ['3x4','4x3','1x1','16x9','9x16'])for(const artworkSize of ['small','standard','large'])for(const [w,h] of [[1,1],[12,3],[3,12]]){
    const layout=POSTER_LAYOUTS[ratio],box=posterArtworkBox(Array.from({length:h},()=>Array(w).fill(null)),{ratio,artworkSize});
    const legacy=ratio==='3x4'||ratio==='1x1';
    assert.ok(box.x>=(legacy?0:layout.safe)&&box.y>=layout.safe+layout.logoWidth);
    assert.ok(box.x+box.width<=layout.width-(legacy?0:layout.safe));
    assert.ok(box.y+box.height<layout.signatureY-(legacy?20:70));
    assert.ok(Math.abs(box.width/box.height-w/h)<1e-10);
  }
});

test('native poster canvas preserves transparent corners, nulls, canonical RGB and source for five ratios',async()=>{
  const native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'),previous=globalThis.document;
  globalThis.document={createElement(){const canvas=native.createCanvas(1,1);canvas.dataset={};return canvas;}};
  const red={paletteId:'mard:F03',code:'F03',rgb:[247,73,65]},white={paletteId:'mard:H02',code:'H02',rgb:[255,255,255]},grid=[[null,red],[white,null]],before=structuredClone(grid);
  try{
    for(const ratio of ['3x4','4x3','1x1','16x9','9x16'])for(const artworkSize of ['small','standard','large']){
      const layout=POSTER_LAYOUTS[ratio],canvas=await renderPosterCanvas(grid,{ratio,artworkSize,background:'transparent',backing:'none',showLogo:false},{},{width:layout.width}),ctx=canvas.getContext('2d'),box=posterArtworkBox(grid,{ratio,artworkSize});
      assert.deepEqual([canvas.width,canvas.height],[layout.width,layout.height]);
      for(const [x,y] of [[0,0],[canvas.width-1,0],[0,canvas.height-1],[canvas.width-1,canvas.height-1]])assert.equal(ctx.getImageData(x,y,1,1).data[3],0);
      assert.equal(ctx.getImageData(box.x+box.width*.25,box.y+box.height*.25,1,1).data[3],0);
      assert.deepEqual([...ctx.getImageData(box.x+box.width*.75,box.y+box.height*.25,1,1).data],[...red.rgb,255]);
      assert.deepEqual([...ctx.getImageData(box.x+box.width*.25,box.y+box.height*.75,1,1).data],[...white.rgb,255]);
      assert.deepEqual(grid,before);
    }
    for(const solidColor of ['#000000','#ffffff']){
      const canvas=await renderPosterCanvas(grid,{background:'solid',solidColor,backing:'none',showLogo:false},{},{width:1500}),ctx=canvas.getContext('2d'),p=ctx.getImageData(400,1620,700,100).data;
      assert.ok(Array.from({length:p.length/4},(_,i)=>p[i*4]).some(v=>solidColor==='#000000'?v>180:v<80),'signature contrasts with solid background');
    }
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
