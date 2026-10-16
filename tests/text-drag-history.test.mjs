import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createEditorCommand} from '../services/editor-command.js';

const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
function gesture(type, changed=true){
  const before=[{id:'t1',text:'文字',scale:100,x:2,y:3}];
  const after=structuredClone(before);if(changed){if(type==='text-resize')after[0].scale=180;else after[0].x=8;}
  const state={editor:{textLayers:after,activeTextLayerId:'t1'},status:{dirty:false}},commands=[];
  const context={structuredClone,createEditorCommand,get:()=>state,sourceDrag:null,cropController:{end(){}},requestSourceDraw(){},
    drag:{type,id:'t1',before,beforeActive:'t1'},well:{style:{cursor:'grabbing'},classList:{remove(){}}},renderer:{requestDraw(){}},
    store:{setState:patch=>{for(const [key,value] of Object.entries(patch))Object.assign(state[key],value);}},
    editorService:{executeCommand:command=>{commands.push(command);return command.execute();}}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function currentTextLayers()'),source.indexOf('  function patchTextObject(')),context);
  vm.runInContext(source.slice(source.indexOf('  const endDrag ='),source.indexOf('  // 历史操作先取消')),context);
  return{state,commands,context,before,after,end:cancel=>vm.runInContext(`endDrag(${Boolean(cancel)})`,context)};
}
for(const type of ['text-move','text-resize']){
  test(`${type} commits exactly one undoable object command`,()=>{
    const h=gesture(type);h.end(false);
    assert.equal(h.commands.length,1);assert.equal(h.commands[0].type,type==='text-resize'?'TEXT_UPDATE':'TEXT_MOVE');
    assert.deepEqual(h.state.editor.textLayers,h.after);assert.equal(h.context.well.style.cursor,'');
    h.commands[0].undo();assert.deepEqual(h.state.editor.textLayers,h.before);
    h.commands[0].redo();assert.deepEqual(h.state.editor.textLayers,h.after);
  });
  test(`${type} cancellation restores exact layers and creates no history`,()=>{
    const h=gesture(type);h.end(true);assert.equal(h.commands.length,0);assert.deepEqual(h.state.editor.textLayers,h.before);assert.equal(h.context.well.style.cursor,'');
  });
  test(`${type} unchanged gesture creates no command`,()=>{const h=gesture(type,false);h.end(false);assert.equal(h.commands.length,0);});
}
