import test from 'node:test';
import assert from 'node:assert/strict';
import {gridGuideInk} from '../ui/grid-guides.mjs';
import {drawCoordinateRulers,createCanvasRenderer} from '../ui/canvas-renderer.js';
test('quiet grid ink adapts to artwork and transparent background',()=>{
  assert.equal(gridGuideInk({rgb:[0,0,0]}),'rgba(255,255,255,0.13)');
  assert.equal(gridGuideInk({hex:'#ffffff'}),'rgba(25,42,57,0.12)');
  assert.equal(gridGuideInk(null,[0,0,0],true),'rgba(255,255,255,0.3)');
});
function draw(cell,origin={x:40,y:40}){
  const boxes=[],labels=[],ctx={save(){},restore(){},fillRect(x,y,w,h){boxes.push({x,y,w,h,color:this.fillStyle});},strokeRect(){},fillText(text,x,y,w){labels.push({text,x,y,w,font:this.font});}};
  drawCoordinateRulers(ctx,{gridToScreen:(x,y)=>({x:origin.x+x*cell,y:origin.y+y*cell})},{width:200,height:200,gridWidth:104,gridHeight:104,cell,dpr:1,interval:5,x0:0,x1:104,y0:0,y1:104});
  return {boxes,labels};
}
test('ruler boxes exactly follow every artwork cell on all four edges',()=>{
  const {boxes,labels}=draw(12);
  assert.equal(boxes.length,416);assert.ok(boxes.every(n=>n.w===12&&n.h===12));
  assert.deepEqual(labels.slice(0,8).map(n=>n.text),['1','1','2','2','3','3','4','4']);
  assert.deepEqual(boxes[0],{x:40,y:28,w:12,h:12,color:'#f0f0f4'});
  assert.equal(boxes[8].color,'#d5d5df');assert.match(labels[8].font,/^700 /);
  assert.ok(labels.every(n=>n.w===10&&parseFloat(n.font.split(' ')[1])>=6));
  assert.equal(labels.filter(n=>n.text==='104').length,4);
});
test('rulers pan with artwork rather than sticking to the viewport',()=>{
  const {boxes}=draw(20,{x:-120,y:-140});
  assert.equal(boxes[0].x,-120);assert.equal(boxes[0].y,-160);
  assert.equal(boxes[208].x,-140);assert.equal(boxes[208].y,-140);
});
test('tiny artwork hides all coordinate boxes and labels rather than forcing unreadable rulers',()=>{
  for(const cell of [.4,.8,8,9.9]){const {boxes,labels}=draw(cell);assert.equal(boxes.length,0);assert.equal(labels.length,0);}
  assert.equal(draw(10).labels.length,416);
});
test('coordinate toggle applies to image, original and pattern renderer paths',()=>{
  const saved=Object.fromEntries(['document','window','ResizeObserver','MutationObserver'].map(k=>[k,globalThis[k]])),canvases=[];
  // 桩要覆盖 createCanvasRenderer 真正用到的东西：除了 devicePixelRatio/location，
  // 还有 window.addEventListener/removeEventListener（字体加载重绘钩子 + destroy）、
  // MutationObserver（跟随 data-theme）、ResizeObserver（容器尺寸）。缺一个就抛 TypeError，
  // 这条「三种渲染路径下坐标开关」的守卫会以「桩不全」而不是「行为变了」的形式红掉。
  globalThis.window={devicePixelRatio:1,location:{hostname:'example.test'},addEventListener(){},removeEventListener(){}};globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.MutationObserver=class{observe(){}disconnect(){}};
  globalThis.document={documentElement:{},createElement(){const labels=[],ctx={setTransform(){},clearRect(){labels.length=0;},fillRect(){},strokeRect(){},save(){},restore(){},fillText(text){labels.push(text);},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},rect(){},clip(){},drawImage(){}};return {dataset:{},style:{},labels,getContext:()=>ctx};}};
  try{
    const view={mode:'blocks',zoom:.6,showCoordinates:true};
    const renderer=createCanvasRenderer({clientWidth:200,clientHeight:200,append:c=>canvases.push(c)},{origin:()=>({x:40,y:40}),gridToScreen:(x,y)=>({x:40+x*20*view.zoom,y:40+y*20*view.zoom})},()=>({width:104,height:104,grid:Array.from({length:104},()=>Array(104).fill({rgb:[12,34,56],code:'A01'}))}),()=>view,()=>({}));
    for(const mode of ['blocks','original','pattern']){view.mode=mode;view.zoom=.6;view.showCoordinates=true;renderer.draw();assert.ok(canvases[2].labels.length>0);view.showCoordinates=false;renderer.draw();assert.equal(canvases[2].labels.length,0);view.showCoordinates=true;view.zoom=.02;renderer.draw();assert.equal(canvases[2].labels.length,0);}
    renderer.destroy();
  }finally{for(const[k,v]of Object.entries(saved))v===undefined?delete globalThis[k]:globalThis[k]=v;}
});
