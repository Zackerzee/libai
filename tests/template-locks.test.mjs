import test from "node:test";
import assert from "node:assert/strict";
import storeApi from "../state/store.js";
import { createEditorService } from "../services/editor-service.js";
import { createCellCommand, createEditorCommand } from "../services/editor-command.js";

const A = { code: "A", rgb: [1, 2, 3] }, B = { code: "B", rgb: [4, 5, 6] };
const selection = { kind: "rect", x0: 0, y0: 0, x1: 2, y1: 0 };
function fixture() {
  const grid = [[A, A, A]];
  const bridge = {
    getResult: () => ({ grid, width: 3, height: 1 }),
    getCell: (x,y) => grid[y]?.[x] ?? null,
    getPaletteColors: () => [A,B],
    isCellLocked: (x,y) => x === 1 && y === 0,
    applyCellChanges(changes) {
      for (const {x,y,after} of changes) {
        assert.equal(this.isCellLocked(x,y),false,"locked cells must never reach write bridge");
        grid[y][x] = after;
      }
      return changes.length;
    },
    replaceGridStructure() { throw Error("locked structure must not reach bridge"); },
  };
  return { grid, bridge, editor: createEditorService(bridge) };
}

test("store protects locked identity, RGB and dimensions before any write", () => {
  const store = storeApi.createStore();
  store.patchState("patternState", { grid: [[A,A]], width: 2, height: 1, templateLockedMask: [[true,false]] });
  for (const patch of [{width:3},{height:2},{grid:[[B,A]]},{grid:[[{...A,rgb:[9,2,3]},A]]}]) {
    assert.throws(() => store.patchState("patternState",patch),/请先解锁模板/);
    assert.equal(store.get("patternState","grid")[0][0],A);
    assert.equal(store.get("patternState","width"),2);
  }
  assert.throws(() => store.setState("patternState.grid",[[B,A]]),/请先解锁模板/);
  store.patchState("patternState",{grid:[[{...A,rgb:[...A.rgb]},B]]});
  assert.equal(store.get("patternState","grid")[0][1],B);
});

test("explicit mask snapshots restore atomically and validate exact boolean dimensions", () => {
  const store = storeApi.createStore();
  assert.equal(Object.hasOwn(storeApi.DEFAULTS.patternState,"templateLockedMask"),false);
  store.patchState("patternState",{grid:[[A]],width:1,height:1,templateLockedMask:[[true]]});
  for(const mask of [undefined,[[1]],[],[[true,false]]]) assert.throws(()=>store.patchState("patternState",{grid:[[B]],templateLockedMask:mask}),/模板锁定范围/);
  assert.equal(store.get("patternState","grid")[0][0],A);
  store.patchState("patternState",{grid:[[B,B]],width:2,templateLockedMask:[[false,true]]});
  store.patchState("patternState",{grid:[[A]],width:1,templateLockedMask:[[true]]});
  store.setState("patternState.templateLockedMask",null);
  store.setState("patternState.grid",[[B]]);
});

for (const [name, edit] of [
  ["brush",e=>e.applyCells([{x:0,y:0},{x:1,y:0}],"B")],
  ["erase",e=>e.eraseSelection(selection)],
  ["replace",e=>e.replaceColor("A","B")],
  ["merge",e=>e.mergePaletteColors(["A"],"B")],
  ["recolor",e=>e.recolorSelection(selection,"B")],
  ["repair",e=>e.applyRepairChanges([{targetPaletteId:"B",cells:[{x:0,y:0},{x:1,y:0}]}])],
  ["shape",e=>e.applyShape("line",{x:0,y:0},{x:2,y:0},"B")],
  ["fill",e=>e.fillAt(0,0,"B")],
  ["outline plan",e=>e.applyOutlinePlan({outlineCells:[{x:0,y:0},{x:1,y:0}]},"B")],
  ["paste",e=>{e.copySelection(selection);e.eraseCells([{x:0,y:0}]);return e.pasteClipboard(0,0);}],
]) test(`${name} skips template cells and preserves undo/redo`,()=>{
  const {grid,editor}=fixture();
  assert.equal(edit(editor),true);
  assert.equal(grid[0][1],A);
  assert.equal(editor.undo(),true); assert.equal(grid[0][1],A);
  assert.equal(editor.redo(),true); assert.equal(grid[0][1],A);
});

test("locked-only commands never write or enter history and metadata counts accepted cells",()=>{
  const {bridge,editor}=fixture();
  assert.equal(editor.setCellColor(1,0,"B"),false);
  assert.equal(editor.canUndo(),false);
  const command=createCellCommand(bridge,{type:"TEST",label:"测试",width:3,height:1,changes:[{x:0,y:0,before:A,after:B},{x:1,y:0,before:A,after:B}]});
  assert.equal(command.affectedCells,1);
});

test("live strokes skip locks and undo only accepted cells",()=>{
  const {grid,editor}=fixture();
  editor.beginStroke("B"); editor.strokeCell(0,0); editor.strokeCell(2,0);
  assert.equal(editor.endStroke(),true); assert.equal(grid[0][1],A);
  assert.equal(editor.getHistory()[0].count,2);
  editor.undo(); assert.deepEqual(grid,[[A,A,A]]);
  editor.beginStroke("B"); editor.strokeCell(1,0); assert.equal(editor.endStroke(),false);
  editor.beginStroke("B"); editor.strokeCell(0,0); editor.strokeCell(2,0); editor.cancelStroke();
  assert.deepEqual(grid,[[A,A,A]]);
});

test("selection moves and transforms refuse locked sources or destinations atomically",()=>{
  const {grid,editor}=fixture(), single={kind:"rect",x0:0,y0:0,x1:0,y1:0};
  assert.equal(editor.moveSelection(selection,1,0),false);
  assert.equal(editor.moveSelection(single,1,0),false);
  for(const kind of ["move","rotate","flipX","flipY"]) assert.equal(editor.planSelectionTransform(selection,kind,{dx:1}),null);
  assert.equal(editor.planSelectionTransform(single,"move",{dx:1}),null);
  assert.equal(editor.rotate(),false); assert.equal(editor.flip("horizontal"),false);
  assert.deepEqual(grid,[[A,A,A]]); assert.equal(editor.canUndo(),false);
});

test("throwing undo and redo preserve their history command for retry",()=>{
  const {editor}=fixture();
  let failUndo=true, failRedo=true;
  const command=createEditorCommand({kind:"custom",type:"TEMPLATE",label:"模板",affectedCells:2,
    execute:()=>true,
    undo:()=>{if(failUndo)throw Error("undo blocked");return true;},
    redo:()=>{if(failRedo)throw Error("redo blocked");return true;},
  });
  assert.equal(editor.executeCommand(command),true);
  assert.equal(editor.getHistory()[0].count,2);
  assert.throws(()=>editor.undo(),/undo blocked/);
  assert.deepEqual(editor.historyDepth(),{undo:1,redo:0});
  failUndo=false; assert.equal(editor.undo(),true);
  assert.throws(()=>editor.redo(),/redo blocked/);
  assert.deepEqual(editor.historyDepth(),{undo:0,redo:1});
  failRedo=false; assert.equal(editor.redo(),true);
  assert.deepEqual(editor.historyDepth(),{undo:1,redo:0});
});
