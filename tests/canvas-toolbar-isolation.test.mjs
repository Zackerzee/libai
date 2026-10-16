import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
const tools=['brush','eraser','fill','eyedropper','line','rect','ellipse','select','pan'];

function toolbarHarness(tool='brush') {
  const start=source.indexOf("  wrap.addEventListener('click', event => {\n    const button = event.target.closest('button[data-tool]')");
  assert.ok(start>=0,'must delegate only actual tool buttons');
  const code=source.slice(start,source.indexOf("  wrap.addEventListener('click',event=>{const menu=",start));
  let handler,settings=0,sync=0;
  const result=new Function('wrap','get','SHAPE_TOOLS','hideInlineSizeSettings','hideInlineOutlineSettings','syncToolOptions',
    `let openToolMenu=null,toolParametersOpen=false;${code};return ()=>({openToolMenu,toolParametersOpen});`)(
      {addEventListener(type,fn){handler=fn;}},()=>({editor:{tool}}),{line:true,rect:true,ellipse:true},()=>settings++,()=>settings++,()=>sync++);
  return {click:target=>handler({target}),state:()=>({...result(),settings,sync})};
}
test('canvas data-tool metadata never toggles toolbar height for any active tool',()=>{
  for(const tool of tools){
    const h=toolbarHarness(tool);
    const well={dataset:{tool},closest:()=>null};
    const canvas={closest:selector=>selector==='[data-tool]'?well:null};
    for(let i=0;i<4;i++)h.click(canvas);
    assert.deepEqual(h.state(),{openToolMenu:null,toolParametersOpen:false,settings:0,sync:0},tool);
  }
});
test('explicit main tool clicks toggle parameters, parameter choices keep the row open',()=>{
  const h=toolbarHarness();
  const b={dataset:{tool:'brush'},closest:()=>null};
  const target={closest:selector=>selector==='button[data-tool]'?b:null};
  h.click(target);assert.equal(h.state().toolParametersOpen,true);
  h.click(target);assert.equal(h.state().toolParametersOpen,false);
  b.closest=()=>({});h.click(target);assert.equal(h.state().toolParametersOpen,true);
});
test('current brush colour does not select, scroll or highlight a usage-strip card',()=>{
  const start=source.indexOf('  function renderUsageIfStale() {');
  const code=source.slice(start,source.indexOf('  // ── Stage C0 §2',start));
  let highlighted=null,rendered=0;
  const check=new Function('get','currentPaletteId','renderUsageStrip',`let usageSelected=null,usageRenderedRevision=1,gridRevision=1;${code};return ()=>{renderUsageIfStale();return usageSelected;};`)(
    ()=>({editor:{currentPaletteId:'RED',highlightedPaletteId:highlighted}}),()=>{throw new Error('brush colour must not drive usage focus');},()=>rendered++);
  assert.equal(check(),null);assert.equal(rendered,0);
  highlighted='BLUE';assert.equal(check(),'BLUE');assert.equal(rendered,1);
  highlighted=null;assert.equal(check(),null);assert.equal(rendered,2);
});
test('drawing completion never inspects an old selected cell or rewrites brush colour',()=>{
  const start=source.indexOf('  window.addEventListener("libms:grid-edited", (event) => {');
  const end=source.indexOf('  window.addEventListener("libms:legacy-editor-saved"',start);
  const code=source.slice(start,end);
  for(const tool of ['brush','eraser','fill','line','rect','ellipse','heart','diamond','star','text']){
    let handler,reads=0,writes=0;
    new Function('window','editorService','syncLegacy','get','inspectionState','store','updateHistory','queueMicrotask','activateInspectionCurrent',
      `let gridRevision=0,repairPreview=null;${code}`)(
      {addEventListener(type,fn){handler=fn;}},{invalidateUsageCounts(){},inspectCell(){reads++;}},()=>{},()=>({editor:{tool,selectedCell:{x:1,y:1}}}),{active:false},{setState(){writes++;}},()=>{},()=>{},()=>{});
    handler({detail:{}});assert.equal(reads,0,tool);assert.equal(writes,0,tool);
  }
});
