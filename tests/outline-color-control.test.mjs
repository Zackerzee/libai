import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
// 描边只剩一个入口（#ws-outline-preview 的 inline 面板）。旧的那套
// #ws-apply-outline / #ws-outline-diagonal 已在阶段 6 清掉，它当年的
// `value.trim() || currentPaletteId()` 回落正是这条测试要防的东西。
const MARK='    $("#ws-outline-preview").addEventListener';
const start=source.indexOf(MARK);
if(start<0)throw new Error('找不到 #ws-outline-preview 的 click handler —— 描边预览入口被删了？');
const handler=source.slice(start,start+1200).split('\n    });')[0]+'\n    });';

/** 把预览 handler 丢进最小环境执行，回传它对外产生的一切副作用。 */
const runPreview=(nodes)=>{
  const seen={click:null,planned:null,patched:null,drawn:0,notified:null};
  vm.runInNewContext(handler,{
    $:id=>nodes[id],
    notify:(msg)=>{seen.notified=msg;},
    get:()=>({editor:{selectedCell:null,selectedPaletteId:'H02',selection:null}}),
    editorService:{planOutline:(args)=>{seen.planned=args;return {outlineCells:[{x:0,y:0},{x:1,y:0}],candidateCells:[{x:0,y:0},{x:1,y:0},{x:2,y:0}],blockedCells:[{x:2,y:0}]};}},
    store:{setState:(patch)=>{seen.patched=patch;}},
    renderer:{requestDraw:()=>{seen.drawn+=1;}},
  });
  return seen;
};
const panelNodes=(target)=>{
  const nodes={
    '#ws-outline-preview':{addEventListener(_,fn){nodes.__click=fn;}},
    '#ws-outline-target':{value:target},
    '#ws-outline-source':{value:'artwork'},
    '#ws-outline-thickness':{value:'1'},
    '#ws-outline-connectivity':{value:'4'},
    '#ws-outline-holes':{checked:false},
    '#ws-outline-overwrite':{checked:true},
  };
  return nodes;
};

test('quick outline uses chosen outline color, not the old brush color',()=>{
  const nodes=panelNodes('H07');
  const seen=runPreview(nodes);
  nodes.__click();
  assert.equal(seen.planned.sourceMode,'artwork','来源必须来自 #ws-outline-source');
  assert.equal(seen.planned.thickness,1);
  assert.equal(seen.planned.connectivity,4);
  assert.equal(seen.planned.includeHoles,false);
  assert.equal(seen.planned.overwrite,true,'覆盖周边颜色的勾选态必须进计划');
  assert.equal(seen.patched.editor.outlinePreview.overwrite,true,'预览状态要带上 overwrite，摘要才能换成「覆盖原有 N 颗」的读法');
  assert.equal(seen.patched.editor.outlinePreview.targetPaletteId,'H07','描边色用选定的 H07，不是画笔色 H02');
  assert.equal(seen.patched.editor.outlinePreview.cells.length,2);
  assert.equal(seen.patched.editor.outlinePreview.candidateCount,3);
  assert.equal(seen.patched.editor.outlinePreview.blockedCount,1);
  assert.equal(seen.drawn,1,'预览后必须请求重绘，否则画布上看不到候选');
});

test('quick outline refuses to silently fall back to the brush color',()=>{
  const nodes=panelNodes('');
  const seen=runPreview(nodes);
  nodes.__click();
  assert.equal(seen.planned,null,'没选描边色就不该算计划');
  assert.equal(seen.patched,null,'没选描边色就不该写预览状态');
  assert.match(seen.notified,/描边颜色/);
});

test('outline holes checkbox reaches the plan',()=>{
  const nodes=panelNodes('H07');
  nodes['#ws-outline-holes'].checked=true;
  const seen=runPreview(nodes);
  nodes.__click();
  assert.equal(seen.planned.includeHoles,true);
});

test('取消「覆盖周边颜色」后计划回到「只描空白」的旧语义',()=>{
  const nodes=panelNodes('H07');
  nodes['#ws-outline-overwrite'].checked=false;
  const seen=runPreview(nodes);
  nodes.__click();
  assert.equal(seen.planned.overwrite,false);
  assert.equal(seen.patched.editor.outlinePreview.overwrite,false);
});
