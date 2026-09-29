import test from "node:test";
import assert from "node:assert/strict";
import { createRepairSuggestion, createRepairPreview, createRepairQueue, deriveRepairSuggestions, resolveRepairConflicts, stableIssueKey } from "../services/repair-suggestion.js";
import { createEditorService } from "../services/editor-service.js";

const A={paletteId:"brand:A",code:"A",rgb:[20,20,20],hex:"#141414"};
const TWIN={paletteId:"brand:TWIN",code:"TWIN",rgb:[20,20,20],hex:"#141414"};
const B={paletteId:"brand:B",code:"B",rgb:[210,210,210],hex:"#d2d2d2"};
const C={paletteId:"brand:C",code:"C",rgb:[220,40,40],hex:"#dc2828"};
const palette=[A,TWIN,B,C];
const issue=(overrides={})=>({
  id:"edge:volatile",type:"edge-contamination",paletteId:"brand:A",cells:[{x:0,y:0}],severity:"high",label:"A · 1颗",
  meta:{suggestedPaletteId:"brand:B",dominantNeighborCount:7,neighborCount:8,dominantNeighborRatio:.875,componentSize:1,sameNeighborCount:0,colorDistance:35},
  ...overrides,
});

test("edge contamination becomes a dominant-neighbor high-confidence suggestion",()=>{
  const suggestion=createRepairSuggestion(issue(),palette);
  assert.equal(suggestion.targetPaletteId,"brand:B");
  assert.equal(suggestion.reason,"dominant-neighbor");
  assert.equal(suggestion.confidenceLevel,"high");
  assert.match(suggestion.reasonText,/7 \/ 8/);
});

test("suggestion fallback is a real palette color and stays low confidence",()=>{
  const suggestion=createRepairSuggestion(issue({type:"tiny-region",severity:"low",meta:{componentSize:2}}),palette);
  assert.ok(palette.some((color)=>color.paletteId===suggestion.targetPaletteId));
  assert.equal(suggestion.reason,"similar-palette");
  assert.equal(suggestion.confidenceLevel,"low");
  assert.notEqual(suggestion.targetPaletteId,"brand:A");
});

test("preview is detached runtime data and never mutates grid",()=>{
  const grid=[[A,B]], before=grid.map((row)=>row.slice());
  const preview=createRepairPreview(createRepairSuggestion(issue(),palette));
  assert.deepEqual(preview.cells,[{x:0,y:0}]);
  preview.cells[0].x=9;
  assert.deepEqual(grid,before);
});

test("stable ignore identity survives diagnostic id changes and filters the issue",()=>{
  const first=issue(), recalculated=issue({id:"edge:new-id"});
  assert.equal(stableIssueKey(first),stableIssueKey(recalculated));
  const ignored=new Set([stableIssueKey(first)]);
  assert.deepEqual(deriveRepairSuggestions([recalculated],palette,ignored),[]);
});

test("same-cell same-target suggestions dedupe by centralized priority",()=>{
  const edge=createRepairSuggestion(issue(),palette);
  const isolated=createRepairSuggestion(issue({id:"iso",type:"isolated-pixel"}),palette);
  const plan=resolveRepairConflicts([isolated,edge]);
  assert.equal(plan.changes.length,1); assert.equal(plan.conflicts.length,0);
  assert.equal(plan.changes[0].suggestionId,edge.id);
});

test("same-cell different targets are conflicts excluded from auto apply",()=>{
  const one=createRepairSuggestion(issue(),palette);
  const two=createRepairSuggestion(issue({id:"other",meta:{...issue().meta,suggestedPaletteId:"brand:C"}}),palette);
  const plan=resolveRepairConflicts([one,two]);
  assert.equal(plan.changes.length,0); assert.equal(plan.conflicts.length,1);
  assert.deepEqual(plan.conflicts[0].targetPaletteIds,["brand:B","brand:C"]);
});

test("repair queue includes only high confidence in its automatic plan",()=>{
  const high=createRepairSuggestion(issue(),palette);
  const low=createRepairSuggestion(issue({id:"tiny",type:"tiny-region",severity:"low",cells:[{x:1,y:0}],meta:{componentSize:2}}),palette);
  const queue=createRepairQueue([high,low]);
  assert.deepEqual(queue.counts,{high:1,medium:0,low:1});
  assert.equal(queue.highPlan.changes.length,1);
});

function editorFixture(){
  const grid=[[A,A,TWIN],[A,C,A]];
  const bridge={
    getResult:()=>({grid,width:3,height:2,colors:[]}),
    getCell:(x,y)=>grid[y]?.[x]||null,
    getPaletteColors:()=>palette,
    applyCellChanges(changes){let count=0; for(const {x,y,after} of changes){if(grid[y][x]?.paletteId!==after?.paletteId){grid[y][x]=after;count++;}} return count;},
  };
  return {grid,editor:createEditorService(bridge)};
}

test("single repair changes exact cells only and undo redo restore one command",()=>{
  const {grid,editor}=editorFixture();
  assert.equal(editor.applyRepairChanges([{sourcePaletteId:"brand:A",targetPaletteId:"brand:B",cells:[{x:0,y:0}]}]),true);
  assert.equal(grid[0][0].paletteId,"brand:B");
  assert.equal(grid[0][1].paletteId,"brand:A","same palette outside issue remains unchanged");
  assert.equal(grid[0][2].paletteId,"brand:TWIN","same RGB different palette identity remains unchanged");
  assert.deepEqual(editor.historyDepth(),{undo:1,redo:0});
  assert.equal(editor.undo(),true); assert.equal(grid[0][0].paletteId,"brand:A");
  assert.equal(editor.redo(),true); assert.equal(grid[0][0].paletteId,"brand:B");
});

test("batch repair is one history entry and one undo restores every cell",()=>{
  const {grid,editor}=editorFixture();
  const repairs=[
    {sourcePaletteId:"brand:A",targetPaletteId:"brand:B",cells:[{x:0,y:0},{x:1,y:0}]},
    {sourcePaletteId:"brand:C",targetPaletteId:"brand:B",cells:[{x:1,y:1}]},
  ];
  assert.equal(editor.applyRepairChanges(repairs,"批量修复"),true);
  assert.deepEqual(editor.historyDepth(),{undo:1,redo:0});
  assert.equal(grid[0][0].paletteId,"brand:B"); assert.equal(grid[1][1].paletteId,"brand:B");
  editor.undo();
  assert.equal(grid[0][0].paletteId,"brand:A"); assert.equal(grid[0][1].paletteId,"brand:A"); assert.equal(grid[1][1].paletteId,"brand:C");
  editor.redo(); assert.equal(grid[1][1].paletteId,"brand:B");
});

test("repair skips a stale cell whose source palette identity changed",()=>{
  const {grid,editor}=editorFixture();
  assert.equal(editor.applyRepairChanges([{sourcePaletteId:"brand:C",targetPaletteId:"brand:B",cells:[{x:0,y:0}]}]),false);
  assert.equal(grid[0][0].paletteId,"brand:A");
  assert.deepEqual(editor.historyDepth(),{undo:0,redo:0});
});
