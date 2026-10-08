import { createStructureCommand } from "./editor-command.js";

export const RESIZE_ANCHORS = Object.freeze([
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
]);

const anchorFactors = Object.freeze({
  "top-left": [0, 0], top: [0.5, 0], "top-right": [1, 0],
  left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
  "bottom-left": [0, 1], bottom: [0.5, 1], "bottom-right": [1, 1],
});

const cloneCell = (cell) => cell
  ? { ...cell, rgb: Array.isArray(cell.rgb) ? [...cell.rgb] : cell.rgb }
  : null;

export const cloneGridSnapshot = ({ grid, width, height }) => ({
  width,
  height,
  grid: Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => cloneCell(grid[y]?.[x] ?? null))),
});

function dimension(value, name) {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded) || rounded < 1) throw new RangeError(`${name} 必须是大于 0 的整数`);
  return rounded;
}

function sourceSize(grid) {
  return { width: grid[0]?.length || 0, height: grid.length };
}

function anchorOffset(oldSize, newSize, factor) {
  return Math.floor((newSize - oldSize) * factor);
}

/** 返回画布缩小时四边会丢失的格数，供确认 UI 精确提示。 */
export function resizeCropInsets(width, height, targetWidth, targetHeight, { anchor = "center" } = {}) {
  const oldWidth = dimension(width, "width"), oldHeight = dimension(height, "height");
  const nextWidth = dimension(targetWidth, "targetWidth"), nextHeight = dimension(targetHeight, "targetHeight");
  const factors = anchorFactors[anchor];
  if (!factors) throw new RangeError(`未知画板锚点：${anchor}`);
  const offsetX = anchorOffset(oldWidth, nextWidth, factors[0]);
  const offsetY = anchorOffset(oldHeight, nextHeight, factors[1]);
  return {
    top: Math.max(0, -offsetY), bottom: Math.max(0, oldHeight - (nextHeight - offsetY)),
    left: Math.max(0, -offsetX), right: Math.max(0, oldWidth - (nextWidth - offsetX)),
  };
}

/**
 * 改变画板尺寸：内容不缩放，只按九宫格锚点扩展或裁切。
 * 新增区域永远是 canonical null。
 */
export function resizeCanvasGrid(grid, targetWidth, targetHeight, { anchor = "center" } = {}) {
  const width = dimension(targetWidth, "width"), height = dimension(targetHeight, "height");
  const factors = anchorFactors[anchor];
  if (!factors) throw new RangeError(`未知画板锚点：${anchor}`);
  const old = sourceSize(grid);
  const offsetX = anchorOffset(old.width, width, factors[0]);
  const offsetY = anchorOffset(old.height, height, factors[1]);
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const sourceX = x - offsetX, sourceY = y - offsetY;
    return cloneCell(grid[sourceY]?.[sourceX] ?? null);
  }));
}

/**
 * 缩放图案本身。以目标格中心映射到最近的源格，绝不插值或合成颜色，
 * 因而 paletteId 始终来自真实源格。
 */
export function scalePatternNearest(grid, targetWidth, targetHeight) {
  const width = dimension(targetWidth, "width"), height = dimension(targetHeight, "height");
  const old = sourceSize(grid);
  if (!old.width || !old.height) return Array.from({ length: height }, () => Array(width).fill(null));
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const sourceX = Math.min(old.width - 1, Math.floor(((x + 0.5) * old.width) / width));
    const sourceY = Math.min(old.height - 1, Math.floor(((y + 0.5) * old.height) / height));
    return cloneCell(grid[sourceY][sourceX]);
  }));
}

/** 将矩形或 mask 选区约束在新画板内；与画板无交集时清空选区。 */
export function clampSelectionToBounds(selection, width, height) {
  if (!selection || width < 1 || height < 1) return null;
  const x0 = Math.min(selection.x0, selection.x1), x1 = Math.max(selection.x0, selection.x1);
  const y0 = Math.min(selection.y0, selection.y1), y1 = Math.max(selection.y0, selection.y1);
  if (x1 < 0 || y1 < 0 || x0 >= width || y0 >= height) return null;
  const bounds = {
    ...selection,
    x0: Math.max(0, x0), y0: Math.max(0, y0),
    x1: Math.min(width - 1, x1), y1: Math.min(height - 1, y1),
  };
  if (!selection.mask) return bounds;
  const mask = new Set([...selection.mask].filter((entry) => {
    const [x, y] = String(entry).split(",").map(Number);
    return x >= 0 && y >= 0 && x < width && y < height;
  }));
  if (!mask.size) return null;
  const cells = [...mask].map((entry) => entry.split(",").map(Number));
  return {
    ...bounds,
    x0: Math.min(...cells.map(([x]) => x)), y0: Math.min(...cells.map(([, y]) => y)),
    x1: Math.max(...cells.map(([x]) => x)), y1: Math.max(...cells.map(([, y]) => y)),
    mask,
  };
}

/**
 * 建立可交给现有 EditorService.executeCommand() 的单条结构命令。
 * before/after 在建命令时即深拷贝，后续选区或网格变化不会污染撤销结果。
 */
export function createGridResizeCommand(bridge, {
  grid,
  width = grid?.[0]?.length || 0,
  height = grid?.length || 0,
  targetWidth,
  targetHeight,
  mode = "canvas",
  anchor = "center",
} = {}) {
  if (!Array.isArray(grid) || width < 1 || height < 1) throw new TypeError("Resize 需要有效 canonical grid");
  const nextWidth = dimension(targetWidth, "targetWidth"), nextHeight = dimension(targetHeight, "targetHeight");
  if (!['canvas', 'pattern'].includes(mode)) throw new RangeError(`未知 Resize 模式：${mode}`);
  const before = cloneGridSnapshot({ grid, width, height });
  const resized = mode === "pattern"
    ? scalePatternNearest(before.grid, nextWidth, nextHeight)
    : resizeCanvasGrid(before.grid, nextWidth, nextHeight, { anchor });
  const after = cloneGridSnapshot({ grid: resized, width: nextWidth, height: nextHeight });
  // replaceGridStructure 的具体桥接实现可能直接接管传入矩阵；每次应用都再克隆，
  // 避免后续绘制污染命令内部的 before/after，保证长链 Undo/Redo 可重复。
  const snapshotBridge = {
    replaceGridStructure: (snapshot) => bridge.replaceGridStructure(cloneGridSnapshot(snapshot)),
  };
  return createStructureCommand(snapshotBridge, {
    type: mode === "pattern" ? "RESIZE_PATTERN" : "RESIZE_CANVAS",
    label: `${mode === "pattern" ? "缩放图案" : "调整画板"}：${width}×${height} → ${nextWidth}×${nextHeight}`,
    before,
    after,
  });
}
