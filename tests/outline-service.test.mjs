import test from "node:test";
import assert from "node:assert/strict";
import { computeExternalEmpty, computeOuterOutline } from "../services/outline-service.js";
import { createEditorService } from "../services/editor-service.js";
const grid=(w,h,filled=[])=>{const g=Array.from({length:h},()=>Array(w).fill(null));for(const c of filled)g[c.y][c.x]={paletteId:c.id||"A"};return g;};
const ids=c=>c.map(p=>`${p.x},${p.y}`).sort();
test("single cell produces deterministic 4/8-neighbor outer outlines",()=>{const g=grid(5,5,[{x:2,y:2}]);assert.equal(computeOuterOutline([{x:2,y:2}],g).outlineCells.length,4);assert.equal(computeOuterOutline([{x:2,y:2}],g,{connectivity:8}).outlineCells.length,8);});
test("thickness expands discrete layers and never includes source",()=>{const g=grid(9,9,[{x:4,y:4}]);for(const n of [1,2,3]){const p=computeOuterOutline([{x:4,y:4}],g,{thickness:n});assert.ok(!ids(p.outlineCells).includes("4,4"));assert.equal(p.outlineCells.length,2*n*(n+1));}});
test("occupied candidates are blocked rather than overwritten",()=>{const g=grid(5,5,[{x:2,y:2},{x:3,y:2,id:"B"}]);const p=computeOuterOutline([{x:2,y:2}],g);assert.equal(p.outlineCells.length,3);assert.deepEqual(ids(p.blockedCells),["3,2"]);});
test("closed holes excluded by default and included on request",()=>{const source=[];for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)if(x===1||x===3||y===1||y===3)source.push({x,y});const g=grid(5,5,source);assert.ok(!ids(computeOuterOutline(source,g).outlineCells).includes("2,2"));assert.ok(ids(computeOuterOutline(source,g,{includeHoles:true}).outlineCells).includes("2,2"));assert.ok(!computeExternalEmpty(source,5,5).has("2,2"));});
test("canvas edge clips without wrap or resize",()=>{const g=grid(3,3,[{x:0,y:0}]);assert.deepEqual(ids(computeOuterOutline([{x:0,y:0}],g).outlineCells),["0,1","1,0"]);});

test("a multicolor silhouette excludes its internal hole for either connectivity",()=>{
  const ring=[];for(let y=1;y<=5;y++)for(let x=1;x<=5;x++)if(x===1||x===5||y===1||y===5)ring.push({x,y,id:x===1?"A":"B"});
  const g=grid(7,7,ring),source=ring.filter(c=>c.id==="A");
  for(const connectivity of [4,8]){
    const plan=computeOuterOutline(source,g,{thickness:3,connectivity});
    assert.ok(plan.outlineCells.every(c=>!(c.x>1&&c.x<5&&c.y>1&&c.y<5)));
    assert.ok(ids(computeOuterOutline(source,g,{connectivity,includeHoles:true}).outlineCells).includes("2,3"));
  }
});

test("thick outlines never traverse an occupied barrier",()=>{
  const wall=Array.from({length:7},(_,y)=>({x:3,y,id:"B"}));
  const source=[{x:2,y:3}],g=grid(7,7,[...source,...wall]);
  for(const includeHoles of [false,true]){
    const plan=computeOuterOutline(source,g,{thickness:3,connectivity:8,includeHoles});
    assert.ok(plan.outlineCells.every(c=>c.x<3));
    assert.ok(plan.blockedCells.length>0);
  }
});

test("diagonally closed ring does not leak into its center",()=>{
  const source=[{x:2,y:1},{x:1,y:2},{x:3,y:2},{x:2,y:3}],g=grid(5,5,source);
  assert.ok(!ids(computeOuterOutline(source,g,{connectivity:8,thickness:3}).outlineCells).includes("2,2"));
  assert.ok(ids(computeOuterOutline(source,g,{connectivity:8,includeHoles:true}).outlineCells).includes("2,2"));
});

test("legacy selection outline honors holes and preserves palette identity, size and undo",()=>{
  const source=[];for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)if(x===1||x===3||y===1||y===3)source.push({x,y});
  const g=grid(5,5,source),before=structuredClone(g),color={paletteId:"brand:H07",code:"H07",rgb:[0,0,0]},selection={x0:1,y0:1,x1:3,y1:3,mask:new Set(ids(source))};
  const editor=createEditorService({getResult:()=>({grid:g,width:5,height:5}),getCell:(x,y)=>g[y]?.[x]||null,getPaletteColors:()=>[color],applyCellChanges(changes){for(const c of changes)g[c.y][c.x]=c.after;return changes.length;}});
  assert.equal(editor.outline(selection,"brand:H07",true,{includeHoles:false}),true);
  assert.equal(g[2][2],null);
  assert.equal(g[0][1].paletteId,"brand:H07");
  assert.equal(g.length,5);assert.ok(g.every(row=>row.length===5));
  assert.equal(editor.undo(),true);assert.deepEqual(g,before);
  assert.equal(editor.outline(selection,"brand:H07",true,{includeHoles:true}),true);
  assert.equal(g[2][2].paletteId,"brand:H07");
  assert.equal(editor.undo(),true);assert.deepEqual(g,before);
});

test("structural preview and application share the same multicolor exterior plan",()=>{
  const ring=[];for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)if(x===1||x===3||y===1||y===3)ring.push({x,y,id:x===1?"A":"B"});
  const g=grid(5,5,ring),before=structuredClone(g),color={paletteId:"brand:H07",code:"H07",rgb:[0,0,0]};
  const editor=createEditorService({getResult:()=>({grid:g,width:5,height:5}),getCell:(x,y)=>g[y]?.[x]||null,getPaletteColors:()=>[color],applyCellChanges(changes){for(const c of changes)g[c.y][c.x]=c.after;return changes.length;}});
  const plan=editor.planOutline({sourceMode:"palette",selectedPaletteId:"A",thickness:3,connectivity:8,includeHoles:false});
  assert.equal(editor.applyOutlinePlan(plan,"brand:H07"),true);
  assert.equal(g[2][2],null);
  for(const {x,y} of ring)assert.deepEqual(g[y][x],before[y][x]);
  assert.equal(g.flat().filter(c=>c?.paletteId==="brand:H07").length,plan.outlineCells.length);
  assert.equal(editor.undo(),true);assert.deepEqual(g,before);
});

test("500-square connected silhouettes retain deterministic bounds without argument overflow",()=>{
  const size=500,color={paletteId:"A"},g=Array.from({length:size},()=>Array(size).fill(color)),source=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)source.push({x,y});
  for(const includeHoles of [false,true]){
    const plan=computeOuterOutline(source,g,{includeHoles});
    assert.deepEqual(plan.bounds,{x0:0,y0:0,x1:499,y1:499});
    assert.equal(plan.sourceCells.length,250000);
    assert.deepEqual(plan.sourceCells[0],{x:0,y:0});
    assert.deepEqual(plan.sourceCells.at(-1),{x:499,y:499});
    assert.deepEqual(plan.candidateCells,[]);
    assert.deepEqual(plan.outlineCells,[]);
    assert.deepEqual(plan.blockedCells,[]);
  }
});

/* ── 「整个作品」来源（= 外轮廓自动描边） ────────────────────────────
 * 另外三种来源都要求用户先指定范围（点色块 / 拉选区 / 选同色），
 * 只有 artwork 是「什么都不用选」——这正是营销页承诺的「自动描边」。 */
const artworkEditor=(g,w,h)=>{const noop=()=>0;return createEditorService({getResult:()=>({grid:g,width:w,height:h}),getCell:(x,y)=>g[y]?.[x]||null,getPaletteColors:()=>[],applyCellChanges:noop});};

test("artwork 给整个作品描外轮廓，且是 planOutline 的默认来源",()=>{
  const g=grid(9,9,[{x:1,y:1,id:"A"},{x:1,y:2,id:"A"},{x:6,y:6,id:"B"},{x:6,y:7,id:"B"}]);
  const editor=artworkEditor(g,9,9);
  const art=editor.planOutline({sourceMode:"artwork"}),artIds=ids(art.outlineCells);
  assert.deepEqual(ids(editor.planOutline({}).outlineCells),artIds,"不传 sourceMode 必须等价于整个作品（默认即自动描边）");
  assert.equal(art.sourceCells.length,4,"剪影含全部非空格，不分颜色");
  assert.ok(artIds.includes("0,1")&&artIds.includes("5,6"),"两个分离色块的外圈都要描到");
  const comp=editor.planOutline({sourceMode:"component",selectedCell:{x:1,y:1}}),compIds=ids(comp.outlineCells);
  assert.ok(compIds.length<artIds.length,"component 只描连通区域，范围严格小于整个作品");
  assert.ok(compIds.every((id)=>artIds.includes(id)),"component 的描边是整个作品描边的子集");
});

test("artwork 默认不吃内部孔洞，勾选后才吃",()=>{
  const cells=[];for(let y=1;y<=3;y++)for(let x=1;x<=3;x++)if(!(x===2&&y===2))cells.push({x,y,id:"A"});
  const g=grid(5,5,cells),editor=artworkEditor(g,5,5);
  assert.ok(!ids(editor.planOutline({sourceMode:"artwork"}).outlineCells).includes("2,2"),"默认外轮廓不吃内部孔洞");
  assert.ok(ids(editor.planOutline({sourceMode:"artwork",includeHoles:true}).outlineCells).includes("2,2"),"勾选后内部孔洞也描");
});

test("artwork 贴边时外侧没位置，只描放得下的那一侧",()=>{
  const g=grid(4,4,[{x:0,y:0,id:"A"},{x:0,y:1,id:"A"}]);
  const plan=artworkEditor(g,4,4).planOutline({sourceMode:"artwork"});
  assert.deepEqual(ids(plan.outlineCells),["0,2","1,0","1,1"],"左/上贴边不补，右/下正常描");
});

test("artwork 空白图纸产出空计划而不是报错",()=>{
  const g=grid(4,4,[]);
  const plan=artworkEditor(g,4,4).planOutline({sourceMode:"artwork"});
  assert.deepEqual(plan.sourceCells,[]);assert.deepEqual(plan.outlineCells,[]);assert.equal(plan.bounds,null);
});

/* ── overwrite：在作品内部描边必须能把周边的色替换掉 ──────────────────
 * 用户报的问题：在作品里框选一部分要外描边，预览出来一颗都没有（应用按钮灰着）。
 * 根因是候选位置「已有颜色」就一律算阻挡。选区在作品内部时四周必然全是颜色，
 * 于是永远描不到。overwrite 打开后这些位置照描（被描边色替换）。 */
test("overwrite 把被占用的候选位置一起描掉，blockedCells 仍记录覆盖颗数",()=>{
  const g=grid(5,5,[{x:2,y:2,id:"A"},{x:1,y:2,id:"B"},{x:3,y:2,id:"B"},{x:2,y:1,id:"B"},{x:2,y:3,id:"B"}]);
  const source=[{x:2,y:2}];
  const off=computeOuterOutline(source,g);
  assert.equal(off.outlineCells.length,0,"四周全是别的颜色时不覆盖就一颗都描不到");
  assert.deepEqual(ids(off.blockedCells),["1,2","2,1","2,3","3,2"]);
  const on=computeOuterOutline(source,g,{overwrite:true});
  assert.deepEqual(ids(on.outlineCells),["1,2","2,1","2,3","3,2"],"覆盖模式下这四颗就是描边落点");
  assert.deepEqual(ids(on.blockedCells),["1,2","2,1","2,3","3,2"],"blockedCells 仍照常记录，供 UI 显示「覆盖原有 N 颗」");
  const two=computeOuterOutline(source,g,{overwrite:true,thickness:2});
  assert.ok(two.outlineCells.length>on.outlineCells.length,"覆盖层也要继续向外推进，厚度才等于圈数");
});

test("作品内部选区描边：旧语义描不到，开覆盖后把周边色替换掉",()=>{
  const cells=[];for(let y=0;y<3;y++)for(let x=0;x<3;x++)cells.push({x,y,id:"A"});
  const g=grid(5,5,cells),editor=artworkEditor(g,5,5);
  const selection={x0:1,y0:1,x1:1,y1:1,mask:new Set(["1,1"])};
  const off=editor.planOutline({sourceMode:"selection",selection});
  assert.equal(off.outlineCells.length,0,"四周都是别的颜色 → 旧语义一颗都描不到，这正是用户报的「被拒绝」");
  assert.equal(off.blockedCells.length,4);
  const on=editor.planOutline({sourceMode:"selection",selection,overwrite:true});
  assert.deepEqual(ids(on.outlineCells),["0,1","1,0","1,2","2,1"]);
});

test("artwork 来源下 overwrite 不改变结果（候选位置只可能是空格）",()=>{
  const g=grid(9,9,[{x:1,y:1,id:"A"},{x:6,y:6,id:"B"}]),editor=artworkEditor(g,9,9);
  const off=editor.planOutline({sourceMode:"artwork"}),on=editor.planOutline({sourceMode:"artwork",overwrite:true});
  assert.deepEqual(ids(on.outlineCells),ids(off.outlineCells));
  assert.equal(on.blockedCells.length,0);
});
