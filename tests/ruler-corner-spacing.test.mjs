import test from 'node:test';
import assert from 'node:assert/strict';
import {drawCoordinateRulers} from '../ui/canvas-renderer.js';
test('20% rulers use compact digits and never overlap at four corners',()=>{
  for(const length of [29,52,104,500]){
    const boxes=[],fonts=[],ctx={save(){},restore(){},strokeRect(){},fillRect(x,y,w,h){boxes.push({x,y,w,h});},fillText(){fonts.push(this.font);}};
    drawCoordinateRulers(ctx,{gridToScreen:(x,y)=>({x:40+x*4,y:40+y*4})},{gridWidth:length,gridHeight:length,cell:4,dpr:1,interval:5,x0:0,x1:length,y0:0,y1:length});
    assert.ok(fonts.every(font=>font==='8px system-ui'));
    for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++){
      const p=boxes[a],q=boxes[b];
      assert.ok(!(p.x<q.x+q.w&&p.x+p.w>q.x&&p.y<q.y+q.h&&p.y+p.h>q.y),`overlap at ${length}`);
    }
  }
});
