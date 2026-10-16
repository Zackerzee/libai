import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateCommand } from '../services/template-command.mjs';
import { createEditorService } from '../services/editor-service.js';
const red = { code: 'A1', paletteId: 'brand:A1', rgb: [255, 0, 0] };
function setup() {
  let state = { grid: [[null, null]], width: 2, height: 1, templateLockedMask: null };
  let busy = false;
  const bridge = { getResult: () => state, getPaletteColors: () => [red], getCell: (x,y) => state.grid[y]?.[x],
    isCellLocked: (x,y) => state.templateLockedMask?.[y]?.[x] === true,
    applyCellChanges(changes) { for (const c of changes) state.grid[c.y][c.x] = c.after; return changes.length; },
    applyTemplateSnapshot(value) { if (busy) return false; state = structuredClone(value); return true; } };
  return { bridge, editor: createEditorService(bridge), read: () => structuredClone(state), busy: value => { busy = value; } };
}
test('apply + lock is exactly one existing history command; undo/redo restore both fields', () => {
  const h = setup(), before = h.read(), after = { ...h.read(), grid: [[red, null]], templateLockedMask: [[true, false]] };
  h.editor.executeCommand(createTemplateCommand(h.bridge, before, after));
  assert.deepEqual(h.editor.historyDepth(), { undo: 1, redo: 0 });
  assert.deepEqual(h.read(), after);
  h.editor.undo(); assert.deepEqual(h.read(), before);
  h.editor.redo(); assert.deepEqual(h.read(), after);
  after.grid[0][0] = null; assert.ok(h.read().grid[0][0]);
});
test('mask-only lock/unlock count as history; no-op is rejected before editing', () => {
  const h = setup(), before = h.read(), after = { ...h.read(), templateLockedMask: [[true,false]] };
  h.editor.executeCommand(createTemplateCommand(h.bridge, before, after, '锁定母版'));
  assert.equal(h.editor.canUndo(), true); h.editor.undo(); assert.deepEqual(h.read(), before);
  assert.throws(() => createTemplateCommand(h.bridge, before, before), /没有可应用/);
  assert.throws(() => createTemplateCommand(h.bridge, before, { ...before, width: 3 }), /不能改变/);
});
test('blocked replay preserves history until generation finishes', () => {
  const h = setup(), before = h.read(), after = { ...h.read(), grid: [[red, null]] };
  h.editor.executeCommand(createTemplateCommand(h.bridge, before, after));
  h.busy(true); assert.equal(h.editor.undo(), false); assert.equal(h.editor.canUndo(), true);
  h.busy(false); assert.equal(h.editor.undo(), true); assert.deepEqual(h.read(), before);
});
