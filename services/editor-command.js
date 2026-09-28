const cloneColor = (color) => color
  ? { ...color, rgb: Array.isArray(color.rgb) ? [...color.rgb] : color.rgb }
  : null;

const freezeMetadata = ({ kind, type, label, affectedCells = 0, width = null, height = null }) => Object.freeze({
  kind,
  type,
  label,
  affectedCells,
  width,
  height,
});

export function createEditorCommand({
  kind,
  type,
  label,
  affectedCells = 0,
  width = null,
  height = null,
  execute,
  undo,
  redo = execute,
}) {
  if (!kind || !type || !label) throw new Error("编辑命令缺少元数据");
  if (typeof execute !== "function" || typeof undo !== "function" || typeof redo !== "function") {
    throw new Error("编辑命令必须实现 execute / undo / redo");
  }
  const metadata = freezeMetadata({ kind, type, label, affectedCells, width, height });
  return Object.freeze({
    ...metadata,
    metadata,
    execute,
    undo,
    redo,
  });
}

export function createCellCommand(bridge, { type, label, changes, width, height }) {
  const snapshot = changes.map(({ x, y, before, after }) => ({
    x,
    y,
    before: cloneColor(before),
    after: cloneColor(after),
  }));
  const apply = (side) => Boolean(bridge.applyCellChanges(snapshot.map(({ x, y, [side]: color }) => ({
    x,
    y,
    after: cloneColor(color),
  }))));
  return createEditorCommand({
    kind: "cells",
    type,
    label,
    affectedCells: snapshot.length,
    width,
    height,
    execute: () => apply("after"),
    undo: () => apply("before"),
    redo: () => apply("after"),
  });
}

export function createStructureCommand(bridge, { type, label, before, after }) {
  const replace = (snapshot) => typeof bridge.replaceGridStructure === "function"
    && Boolean(bridge.replaceGridStructure({ ...snapshot }));
  return createEditorCommand({
    kind: "structure",
    type,
    label,
    width: after.width,
    height: after.height,
    execute: () => replace(after),
    undo: () => replace(before),
    redo: () => replace(after),
  });
}

export function isEditorCommand(command) {
  return Boolean(command
    && command.metadata
    && typeof command.execute === "function"
    && typeof command.undo === "function"
    && typeof command.redo === "function");
}
