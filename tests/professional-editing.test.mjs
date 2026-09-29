import test from "node:test";
import assert from "node:assert/strict";
import { createEditorService } from "../services/editor-service.js";
import { cleanPixelPerfectPath, interpolateStrokeSegment } from "../services/pixel-perfect-stroke.js";

const A={paletteId:"brand:A",code:"A",rgb:[20,20,20],hex:"#141414"};
const TWIN={paletteId:"brand:TWIN",code:"T",rgb:[20,20,20],hex:"#141414"};
const B={paletteId:"brand:B",code:"B",rgb:[230,230,230],hex:"#e6e6e6"};

function fixture(rows=["AAAAAA","AAAAAA","AAAAAA"]){
  const colors={A,T:TWIN,B,".":null};
  const grid=rows.map((row)=>[...row].map((value)=>colors[value]));
  let finalizes=0, liveWrites=0;
  const bridge={
    getResult:()=>({grid,width:grid[0].length,height:grid.length,colors:[]}),
    getCell:(x,y)=>grid[y]?.[x]??null,
    getPaletteColors:()=>[A,TWIN,B],
    applyCellChanges(changes,options={}){ if(options.finalize) finalizes+=1; if(options.live) liveWrites+=1; let count=0; for(const {x,y,after} of changes){if((grid[y]?.[x]?.paletteId||null)!==(after?.paletteId||null)){grid[y][x]=after;count+=1;}} return count||Boolean(options.finalize); },
  };
  return {grid,editor:createEditorService(bridge),metrics:()=>({finalizes,liveWrites})};
}

test("stroke interpolation fills fast horizontal drag without gaps",()=>{
  const {grid,editor}=fixture();
  editor.beginStroke("brand:B"); editor.strokeCell(0,0); editor.strokeCell(5,0); editor.endStroke();
  assert.deepEqual(grid[0].map((cell)=>cell.paletteId),Array(6).fill("brand:B"));
});

test("Bresenham interpolation produces a continuous diagonal",()=>{
  assert.deepEqual(interpolateStrokeSegment({x:0,y:0},{x:4,y:2}),[
    {x:0,y:0},{x:1,y:1},{x:2,y:1},{x:3,y:2},{x:4,y:2},
  ]);
});

test("one interpolated pencil stroke is one undo and redo transaction",()=>{
  const {grid,editor,metrics}=fixture();
  editor.beginStroke("brand:B"); editor.strokeCell(0,0); editor.strokeCell(4,0); editor.endStroke();
  assert.deepEqual(editor.historyDepth(),{undo:1,redo:0}); assert.equal(metrics().finalizes,1);
  editor.undo(); assert.equal(grid[0][2].paletteId,"brand:A");
  editor.redo(); assert.equal(grid[0][2].paletteId,"brand:B");
});

test("revisiting a cell stores its original value only once",()=>{
  const {grid,editor}=fixture();
  editor.beginStroke("brand:B"); editor.strokeCell(0,0); editor.strokeCell(3,0); editor.strokeCell(0,0); editor.endStroke();
  assert.equal(editor.getHistory().at(-1).count,4);
  editor.undo(); assert.deepEqual(grid[0].map((cell)=>cell.paletteId),Array(6).fill("brand:A"));
});

test("eraser writes canonical null continuously and undoes in one step",()=>{
  const {grid,editor}=fixture();
  editor.beginStroke(null); editor.strokeCell(0,1); editor.strokeCell(3,1); editor.endStroke();
  assert.deepEqual(grid[1].slice(0,4),[null,null,null,null]); assert.equal(editor.historyDepth().undo,1);
  editor.undo(); assert.equal(grid[1][2].paletteId,"brand:A"); editor.redo(); assert.equal(grid[1][2],null);
});

test("eyedropper inspection returns exact paletteId and never changes grid",()=>{
  const {grid,editor}=fixture(["AT"]), before=grid[0].slice();
  assert.equal(editor.inspectCell(1,0).paletteId,"brand:TWIN");
  assert.deepEqual(grid[0],before);
});

test("fill is four-connected, identity based and leaves disconnected same color alone",()=>{
  const {grid,editor}=fixture(["A.T","..T","AAT"]);
  assert.equal(editor.fillAt(2,0,"brand:B"),true);
  assert.equal(grid[0][2].paletteId,"brand:B"); assert.equal(grid[2][2].paletteId,"brand:B");
  assert.equal(grid[0][0].paletteId,"brand:A","same RGB different paletteId must not connect");
  assert.equal(grid[2][0].paletteId,"brand:A","disconnected same color must remain");
  assert.equal(editor.historyDepth().undo,1); editor.undo(); assert.equal(grid[1][2].paletteId,"brand:TWIN");
});

test("pixel perfect keeps a simple diagonal and removes a one-cell redundant corner",()=>{
  assert.deepEqual(cleanPixelPerfectPath([{x:0,y:0},{x:1,y:1},{x:2,y:2}]),[{x:0,y:0},{x:1,y:1},{x:2,y:2}]);
  assert.deepEqual(cleanPixelPerfectPath([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:2,y:1}]),[{x:0,y:0},{x:1,y:1},{x:2,y:1}]);
});

test("pixel perfect preserves a deliberate extended L corner",()=>{
  const path=[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:2,y:1},{x:2,y:2}];
  assert.deepEqual(cleanPixelPerfectPath(path),path);
});

test("pixel perfect only cleans the current stroke and can be disabled",()=>{
  const raw=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:2,y:1}];
  const cleaned=fixture(["AAAA","AAAA"]); cleaned.editor.beginStroke("brand:B",{pixelPerfect:true,size:1}); raw.forEach(({x,y})=>cleaned.editor.strokeCell(x,y)); cleaned.editor.endStroke();
  assert.equal(cleaned.grid[0][1].paletteId,"brand:A"); assert.equal(cleaned.grid[0][3].paletteId,"brand:A","old grid outside stroke remains untouched");
  const plain=fixture(["AAAA","AAAA"]); plain.editor.beginStroke("brand:B",{pixelPerfect:false,size:1}); raw.forEach(({x,y})=>plain.editor.strokeCell(x,y)); plain.editor.endStroke();
  assert.equal(plain.grid[0][1].paletteId,"brand:B");
});

test("brush larger than one disables pixel perfect and uses square footprint",()=>{
  const {grid,editor}=fixture(["AAAAA","AAAAA","AAAAA"]);
  editor.beginStroke("brand:B",{pixelPerfect:true,size:3,shape:"square"}); editor.strokeCell(2,1); editor.endStroke();
  assert.equal(grid.flat().filter((cell)=>cell.paletteId==="brand:B").length,9);
});
