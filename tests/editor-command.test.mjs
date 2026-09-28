import test from "node:test";
import assert from "node:assert/strict";
import { createEditorCommand, createCellCommand, isEditorCommand } from "../services/editor-command.js";
import { createEditorService } from "../services/editor-service.js";

const DARK = { code: "H07", hex: "#111111", rgb: [17, 17, 17] };
const LIGHT = { code: "A03", hex: "#eeeeee", rgb: [238, 238, 238] };

function fixture() {
  const grid = [[DARK]];
  const bridge = {
    getResult: () => ({ grid, width: 1, height: 1, colors: [] }),
    getCell: (x, y) => grid[y]?.[x] || null,
    getPaletteColors: () => [DARK, LIGHT],
    applyCellChanges(changes) {
      let changed = 0;
      for (const { x, y, after } of changes) {
        if (grid[y]?.[x]?.code === after?.code) continue;
        grid[y][x] = after;
        changed += 1;
      }
      return changed;
    },
  };
  return { grid, bridge, editor: createEditorService(bridge) };
}

test("cell command exposes immutable metadata and owns execute undo redo", () => {
  const { grid, bridge } = fixture();
  const command = createCellCommand(bridge, {
    type: "TEST_CELL",
    label: "测试单豆",
    width: 1,
    height: 1,
    changes: [{ x: 0, y: 0, before: DARK, after: LIGHT }],
  });
  assert.equal(isEditorCommand(command), true);
  assert.deepEqual(command.metadata, {
    kind: "cells", type: "TEST_CELL", label: "测试单豆", affectedCells: 1, width: 1, height: 1,
  });
  assert.equal(Object.isFrozen(command.metadata), true);
  assert.equal(command.execute(), true); assert.equal(grid[0][0].code, "A03");
  assert.equal(command.undo(), true); assert.equal(grid[0][0].code, "H07");
  assert.equal(command.redo(), true); assert.equal(grid[0][0].code, "A03");
});

test("editor accepts future custom commands through the same history transaction", () => {
  const { editor } = fixture();
  let value = 0;
  const command = createEditorCommand({
    kind: "custom",
    type: "REFERENCE_TRANSFORM",
    label: "参考层变换",
    execute: () => { value = 1; return true; },
    undo: () => { value = 0; return true; },
    redo: () => { value = 1; return true; },
  });
  assert.equal(editor.executeCommand(command), true);
  assert.equal(value, 1);
  assert.deepEqual(editor.getHistory(), [{ type: "REFERENCE_TRANSFORM", label: "参考层变换", count: 0 }]);
  assert.equal(editor.undo(), true); assert.equal(value, 0);
  assert.equal(editor.redo(), true); assert.equal(value, 1);
});

test("custom command history survives undo pruning because it is not tied to canvas dimensions", () => {
  const { editor } = fixture();
  let value = 0;
  const command = (type, next) => createEditorCommand({
    kind: "custom", type, label: type,
    execute: () => { value = next; return true; },
    undo: () => { value = next - 1; return true; },
    redo: () => { value = next; return true; },
  });
  editor.executeCommand(command("FIRST", 1));
  editor.executeCommand(command("SECOND", 2));
  assert.equal(editor.undo(), true);
  assert.equal(editor.undo(), true);
  assert.equal(value, 0);
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 2 });
});

test("a new command clears redo while a failed command is never recorded", () => {
  const { editor } = fixture();
  const command = (type, succeeds) => createEditorCommand({
    kind: "custom", type, label: type,
    execute: () => succeeds,
    undo: () => true,
    redo: () => true,
  });
  assert.equal(editor.executeCommand(command("FIRST", true)), true);
  assert.equal(editor.undo(), true);
  assert.equal(editor.canRedo(), true);
  assert.equal(editor.executeCommand(command("FAILED", false)), false);
  assert.equal(editor.canRedo(), true);
  assert.equal(editor.executeCommand(command("SECOND", true)), true);
  assert.equal(editor.canRedo(), false);
});
