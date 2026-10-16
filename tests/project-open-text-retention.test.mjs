import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
test('workspace opening preserves restored editable text objects while resetting transient focus',()=>{
  const start=source.indexOf('  const applyLoadedProject = (payload) => {');
  const code=source.slice(start,source.indexOf('  $("#ws-project-import")',start));
  const state={editor:{textLayers:[{id:'old'}],activeTextLayerId:'old'}};
  const objects=[{id:'saved-text',text:'第一行\n第二行',locked:true,scale:480,rotation:37,paletteId:'H02'}];
  let cleared=0;
  const open=new Function('bridge','editorService','store','buildClearPalettePatch','syncResizeInputs','viewport',`${code};return applyLoadedProject;`)(
    {loadProjectJson(payload){state.editor.textLayers=structuredClone(payload.textObjects||[]);}},
    {clearHistory(){cleared++;}}, {setState(patch){for(const [key,value]of Object.entries(patch))state[key]={...state[key],...value};}},()=>({}),()=>{}, {fitToViewport(){}});
  open({textObjects:objects});assert.deepEqual(state.editor.textLayers,objects);assert.equal(state.editor.activeTextLayerId,null);assert.equal(cleared,1);
  open({});assert.deepEqual(state.editor.textLayers,[],'legacy files must not keep old project text');
});
