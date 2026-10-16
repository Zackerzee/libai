import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const renderer = readFileSync(new URL('../ui/canvas-renderer.js', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');

test('reference-only draws at full image opacity at every slider value; normal overlay keeps its value', () => {
  const body = renderer.slice(renderer.indexOf('  const drawReference ='), renderer.indexOf('  const draw ='));
  const draw = new Function('referenceImage','referenceLayout', `${body};return drawReference;`)(
    () => ({naturalWidth:100,naturalHeight:100}), () => ({x:0,y:0,width:100,height:100}));
  for (const opacity of [0,1,20,40,100]) {
    const calls = [], ctx = {save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){calls.push(this.globalAlpha);}};
    const ref = {url:'reference.png',opacity,displayMode:'reference-only'};
    draw(ctx,ref,{x:0,y:0,width:100,height:100}); assert.equal(calls.pop(),1); assert.equal(ref.opacity,opacity);
    draw(ctx,{...ref,displayMode:'normal'},{x:0,y:0,width:100,height:100}); assert.equal(calls.pop(),opacity/100);
  }
});

test('hold compare reveals hidden reference and release restores settings without overwriting opacity', () => {
  const code = workspace.slice(workspace.indexOf('  let compareRestore ='), workspace.indexOf('  const hasCompareArtwork ='));
  const state = {view:{mode:'blocks'},reference:{url:'reference.png',opacity:0,visible:false,displayMode:'grid-only',adjusting:true}};
  const store = {setState(patch){for(const key of Object.keys(patch)) Object.assign(state[key],patch[key]);}};
  const api = new Function('store','get','hasReference','hasSourceImage',`${code};return {beginCompare,endCompare};`)(store,()=>state,()=>true,()=>false);
  api.beginCompare(); api.beginCompare();
  assert.equal(state.view.mode,'pattern'); assert.equal(state.reference.displayMode,'reference-only'); assert.equal(state.reference.visible,true);
  assert.equal(state.reference.adjusting,false); assert.equal(state.reference.opacity,0);
  api.endCompare(); api.endCompare();
  assert.equal(state.view.mode,'blocks'); assert.equal(state.reference.visible,false); assert.equal(state.reference.displayMode,'grid-only');
  assert.equal(state.reference.adjusting,true); assert.equal(state.reference.opacity,0);
});

test('reference-only original picker works without uploaded source and restores previous reference controls', () => {
  const code = workspace.slice(workspace.indexOf('  const originalPickButton ='),workspace.indexOf('  const gridToolbar ='));
  const state = {view:{mode:'pattern'},editor:{tool:'brush'},ui:{activePanel:'color'},reference:{url:'ref.png',opacity:0,visible:false,displayMode:'grid-only',adjusting:true}};
  let click;
  const button={setAttribute(){},addEventListener(type,fn){click=fn;}};
  const store={subscribe(){},setState(patch){for(const k of Object.keys(patch))Object.assign(state[k],patch[k]);}};
  new Function('document','$','bridge','store','get','buildActive','setWorkspaceMode','endDrag',code)(
    {createElement:()=>button},()=>({after(){}}),{getResult:()=>({sourceUrl:''})},store,()=>state,()=>false,()=>{},()=>{});
  assert.equal(button.disabled,false); click();
  assert.equal(state.editor.tool,'reference-eyedropper'); assert.equal(state.reference.displayMode,'reference-only');
  assert.equal(state.reference.visible,true); assert.equal(state.reference.opacity,0);
  click(); assert.equal(state.editor.tool,'brush'); assert.equal(state.reference.displayMode,'grid-only');
  assert.equal(state.reference.visible,false); assert.equal(state.reference.adjusting,true);
});
