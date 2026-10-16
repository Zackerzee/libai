import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
// 切片只取 removeExteriorBackground 函数体本身。
// 注意：结束锚点必须命中「函数之后的第一行」；若 indexOf 找不到锚点会返回 -1，
// slice(start,-1) 就会一路切到文件末尾，把后段的 `const notify = ...` 也带进来，
// 与 new Function 的 'notify' 形参重复声明而报 SyntaxError。
// 原锚点 `$("#ws-poster-backing")` 在源码中已不存在（该字段后来改名 `ws-poster-backing-paper`）。
const start=source.indexOf('const removeExteriorBackground = async () => {');
const end=source.indexOf('  $("#ws-poster-backing-paper")',start);
assert.notEqual(end,-1,'切片结束锚点未命中：workspace.js 结构可能已变，请更新本测试的 end 锚点');
const code=source.slice(start,end);
async function run(accepted,throws=false){
  const original={view:{mode:'blocks',zoom:4,panX:31,panY:-17,showCodes:false},editor:{selection:{kind:'rect',x0:2,y0:2,x1:3,y1:3}},ui:{exportDrawerOpen:true},status:{hasPattern:true}};
  const state=structuredClone(original),background={selection:{kind:'exterior-background',mask:new Set(['0,0'])},color:{code:'H02'},cells:[{x:0,y:0}]};
  let drawerOpen=true,erases=0,draws=0;
  const store={setState(patch){for(const [key,value]of Object.entries(patch))state[key]={...state[key],...value};}};
  const drawer={classList:{contains(){return drawerOpen;},remove(){drawerOpen=false;},toggle(_,value){drawerOpen=value;}}};
  const askConfirmation=async()=>{assert.equal(state.view.mode,'pattern');assert.equal(state.ui.exportDrawerOpen,false);assert.equal(drawerOpen,false);assert.equal(state.editor.selection,background.selection);if(throws)throw Error('test failure');return accepted;};
  const action=new Function('get','notify','endDrag','bridge','findExteriorBackground','store','drawer','renderer','askConfirmation','editorService','refreshPosterPreview',`${code};return removeExteriorBackground;`)(()=>state,()=>{},()=>{},{getResult:()=>({grid:[[{}]]})},()=>background,store,drawer,{requestDraw(){draws++;}},askConfirmation,{eraseSelection(selection){assert.equal(selection,background.selection);erases++;}},()=>{});
  if(throws)await assert.rejects(action(),/test failure/);else await action();
  assert.deepEqual(state.view,original.view);assert.deepEqual(state.editor.selection,original.editor.selection);assert.equal(state.ui.exportDrawerOpen,true);assert.equal(drawerOpen,true);assert.ok(draws>=2);
  assert.equal(erases,accepted&&!throws?1:0);
}
test('exterior preview closes export drawer, shows selection in pattern and restores on cancel',()=>run(false));
test('accepted exterior preview uses one erase and restores original imaging view and drawer',()=>run(true));
test('failed confirmation still restores viewport, selection and drawer',()=>run(false,true));
