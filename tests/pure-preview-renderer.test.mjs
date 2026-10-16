import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasRenderer } from '../ui/canvas-renderer.js';

test('成像直接绘制最终颜色、透明空格，并隔离编辑与参考覆盖层', () => {
  const saved = Object.fromEntries(['document','window','ResizeObserver','MutationObserver'].map(k => [k,globalThis[k]]));
  const canvases = [];
  // 桩要覆盖 createCanvasRenderer 真正用到的东西：devicePixelRatio 之外还有
  // window.addEventListener/removeEventListener（libms:text-font-loaded 重绘钩子 + destroy）、
  // MutationObserver（跟随 data-theme 重绘）、ResizeObserver（容器尺寸变化重绘）。
  // 缺一个就会在构造期抛 TypeError，整条 blocks 路径的守卫直接失效。
  globalThis.window = { devicePixelRatio: 2, addEventListener(){}, removeEventListener(){} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = { documentElement: {}, createElement() {
    const calls = [];
    // 2d 上下文桩：只记录 fillRect（断言据此判断「哪一层画了豆格」），其余方法给空实现即可。
    // 少一个方法就会在 draw() 里抛 TypeError，守卫会以「桩不全」而不是「行为变了」的形式红掉。
    const ctx = {
      setTransform(){}, clearRect(){}, fillRect(...args){calls.push({args,color:this.fillStyle,alpha:this.globalAlpha});},
      save(){}, restore(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, strokeRect(){},
      arc(){}, fill(){}, fillText(){}, rect(){}, clip(){}, drawImage(){},
    };
    return { dataset:{}, style:{}, calls, getContext:()=>ctx };
  } };
  try {
    const grid = [[{rgb:[12,34,56],code:'A01'},null],[{rgb:[78,90,123],code:'B01'},{rgb:[5,6,7],code:'C01'}]];
    const renderer = createCanvasRenderer({clientWidth:100,clientHeight:100,append:c=>canvases.push(c)},
      {origin:()=>({x:0,y:0})},()=>({width:2,height:2,grid}),
      ()=>({mode:'blocks',zoom:1,showGrid:true,showCodes:true}),
      ()=>({selectedCell:{x:0,y:0},selection:{x:0,y:0,width:2,height:2}}),
      ()=>({visible:true,url:'unused',displayMode:'reference-only'}),()=>null,
      ()=>[{cells:[{x:0,y:0}]}]);
    renderer.draw();
    // 层序是 base → reference → grid/codes/overlay/highlight（参考图叠在豆格之上，
    // 否则透明度条调不出「参考图明显 ⇒ 作品不明显」）。所以豆格在 canvases[0]，
    // 而 blocks 分支在画参考图之前就 return —— 参考图层必须是空的（这正是 blocks
    // 不能当常驻视图的原因，见 ui/workspace.js 里两处 view:{mode:"pattern"}）。
    assert.deepEqual(canvases[0].calls.map(c=>c.color),['rgb(12,34,56)','rgb(78,90,123)','rgb(5,6,7)']);
    assert.ok(canvases[0].calls.every(c=>c.alpha===1));
    for (const index of [1,2,3,4,5]) assert.equal(canvases[index].calls.length,0,`层 ${index} 不该有绘制`);
    assert.equal(renderer.getBufferSize().width,200);
    renderer.destroy();
  } finally { for(const [k,v] of Object.entries(saved)) v===undefined?delete globalThis[k]:globalThis[k]=v; }
});
