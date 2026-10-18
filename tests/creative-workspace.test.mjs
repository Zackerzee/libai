import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {creativePaletteFingerprint,validateCreativeResult} from '../services/creative-tool-result.mjs';
import {createTextLayer} from '../services/text-layer-service.js';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
function harness(){
  let palette=[{code:'A',paletteId:'brand:A',rgb:[1,2,3]}];
  let current={grid:[[null,null],[null,null]],width:2,height:2,templateLockedMask:null};
  let captured,history,layers=[],accept=true,afterAsk=()=>{},generating=false;
  const start=source.indexOf('  const creativeTools = createCreativeToolsPanel({');
  const code=source.slice(start,source.indexOf('  const creativeEntries =',start));
  const state=[];
  const api=new Function('createCreativeToolsPanel','creativePalette','creativeUiPalette','creativePaletteFingerprint','validateCreativeResult','bridge','askConfirmation','store','createTextLayer','commitTextObjects','currentTextLayers','get','notify','openCreativeText',`
    let gridRevision=1;
    let creativeOpening={revision:1,palette:creativePaletteFingerprint(creativePalette())};
    ${code}
    return {advance:()=>gridRevision++};`)(options=>{captured=options;return {};},()=>palette,()=>[],creativePaletteFingerprint,validateCreativeResult,
    {isGenerating:()=>generating,getResult:()=>current,getTemplateLockMask:()=>current.templateLockedMask,
      applyTemplateSnapshot:value=>{current=structuredClone(value);return true;}},
    async()=>{afterAsk();return accept;},{setState:patch=>state.push(patch)},createTextLayer,
    (type,label,before,after)=>{history={before:structuredClone(before),after:structuredClone(after)};layers=structuredClone(after);return true;},
    ()=>layers,()=>({editor:{activeTextLayerId:null}}),()=>{},()=>{});
  return {confirm:(r,k)=>captured.onConfirm(r,k),current:()=>structuredClone(current),state,advance:api.advance,
    setAccept:v=>accept=v,setGenerating:v=>generating=v,setPalette:v=>palette=v,afterAsk:f=>afterAsk=f,
    layers:()=>structuredClone(layers),undo:()=>{layers=structuredClone(history.before);},redo:()=>{layers=structuredClone(history.after);}};
}
const result={cols:1,rows:1,grid:[['A']]};
test('actual workspace callback imports independent layer and undo/redo never writes base grid',async()=>{
  const h=harness(),before=h.current();await h.confirm(result,'pattern');
  assert.deepEqual(h.current(),before);assert.equal(h.layers()[0].rasterGrid[0][0].paletteId,'brand:A');
  assert.equal(h.state.at(-1).editor.tool,'text');
  h.undo();assert.equal(h.layers().length,0);assert.deepEqual(h.current(),before);h.redo();assert.equal(h.layers().length,1);
});
test('actual callback cancellation and unknown colour never write canvas',async()=>{
  const h=harness(),before=h.current();h.setAccept(false);
  await assert.rejects(h.confirm(result,'pattern'),/已取消/);assert.deepEqual(h.current(),before);
  await assert.rejects(h.confirm({...result,grid:[['UNKNOWN']]},'pattern'),/不存在/);assert.deepEqual(h.current(),before);
});
test('actual callback rejects new image/grid revision during async confirmation',async()=>{
  const h=harness(),before=h.current();h.afterAsk(h.advance);
  await assert.rejects(h.confirm(result,'pattern'),/已改变/);assert.deepEqual(h.current(),before);
});
test('actual callback rejects changed palette identity even for identical RGB and while generating',async()=>{
  const h=harness();h.setPalette([{code:'A',paletteId:'other:A',rgb:[1,2,3]}]);
  await assert.rejects(h.confirm(result,'pattern'),/已改变/);
  const g=harness();g.setGenerating(true);await assert.rejects(g.confirm(result,'pattern'),/生成完成/);
});
