import { createEditorCommand } from './editor-command.js';

/** One immutable grid+protection transaction on the existing editor history. */
export function createTemplateCommand(bridge, before, after, label = '应用母版') {
  const first = structuredClone(before), last = structuredClone(after);
  if (first.width !== last.width || first.height !== last.height) throw new Error('母版应用不能改变画布尺寸');
  let affectedCells = 0;
  first.grid.forEach((row, y) => row.forEach((cell, x) => {
    if (JSON.stringify(cell) !== JSON.stringify(last.grid[y][x])
      || Boolean(first.templateLockedMask?.[y]?.[x]) !== Boolean(last.templateLockedMask?.[y]?.[x])) affectedCells++;
  }));
  if (!affectedCells) throw new Error('没有可应用的变化：请检查透明区域、偏移和已有锁定');
  const restore = snapshot => bridge.applyTemplateSnapshot(structuredClone(snapshot));
  return createEditorCommand({ kind: 'cells', type: 'TEMPLATE', label, affectedCells,
    width: first.width, height: first.height,
    execute: () => restore(last), undo: () => restore(first), redo: () => restore(last),
  });
}
