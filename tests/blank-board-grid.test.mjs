import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasRenderer} from '../ui/canvas-renderer.js';
test('empty source-free board draws the grid in default preview mode at 20%',()=>{
  const keys=['document','window','ResizeObserver','MutationObserver'],saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),canvases=[];
  globalThis.window={devicePixelRatio:1,location:{hostname:'example.test'},addEventListener(){},removeEventListener(){}};
  globalThis.ResizeObserver=globalThis.MutationObserver=class{observe(){}disconnect(){}};
  globalThis.document={documentElement:{},createElement(){const ctx={lines:0,strokes:0,setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){this.lines++;},stroke(){this.strokes++;},fillRect(){}};return{dataset:{},style:{},getContext:()=>ctx};}};
  try{
    const renderer=createCanvasRenderer({clientWidth:300,clientHeight:300,append(c){canvases.push(c);}},
      {origin:()=>({x:40,y:40}),gridToScreen:(x,y)=>({x:40+x*4,y:40+y*4})},()=>({grid:Array.from({length:52},()=>Array(52).fill(null)),width:52,height:52,sourceUrl:''}),
      ()=>({mode:'blocks',zoom:.2,showGrid:false,showCoordinates:false,showMajorGrid:true,majorGridInterval:5}),()=>({}));
    renderer.draw();const guide=canvases[2].getContext('2d');
    assert.ok(guide.strokes>1);assert.ok(guide.lines>106);
    renderer.destroy();
  }finally{for(const[k,v]of Object.entries(saved))v===undefined?delete globalThis[k]:globalThis[k]=v;}
});
