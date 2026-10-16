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
  patternSource = null,
} = {}) {
  if (!Array.isArray(grid) || width < 1 || height < 1) throw new TypeError("Resize 需要有效 canonical grid");
  const nextWidth = dimension(targetWidth, "targetWidth"), nextHeight = dimension(targetHeight, "targetHeight");
  if (!['canvas', 'pattern'].includes(mode)) throw new RangeError(`未知 Resize 模式：${mode}`);
  const before = cloneGridSnapshot({ grid, width, height });
  const resized = mode === "pattern"
    ? scalePatternNearest(patternSource?.grid ?? before.grid, nextWidth, nextHeight)
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

/**
 * 四边「连续整行/整列全空白（canonical null）」的圈数。
 * 只数**外圈**：内部的空白洞是设计的一部分（镂空图案），绝不碰。
 * 全空图纸：top 数到 height 即止，其余三边保持 0，不重复计数。
 */
export function blankBorderInsets(grid) {
  if (!Array.isArray(grid) || !grid.length || !grid[0]?.length) return { top: 0, right: 0, bottom: 0, left: 0 };
  const width = grid[0].length, height = grid.length;
  const rowBlank = (y) => { for (let x = 0; x < width; x++) if (grid[y][x] != null) return false; return true; };
  const colBlank = (x) => { for (let y = 0; y < height; y++) if (grid[y][x] != null) return false; return true; };
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  while (insets.top < height && rowBlank(insets.top)) insets.top++;
  while (insets.bottom < height - insets.top && rowBlank(height - 1 - insets.bottom)) insets.bottom++;
  // 左右只数**列**，但全空图纸时 top 已吃掉所有行 —— 再数左右会把同一批空格
  // 重复归属（四边加起来超过格子总数）。没有剩余行时左右保持 0。
  const remainingRows = height - insets.top - insets.bottom;
  if (remainingRows > 0) {
    while (insets.left < width && colBlank(insets.left)) insets.left++;
    while (insets.right < width - insets.left && colBlank(width - 1 - insets.right)) insets.right++;
  }
  return insets;
}

/**
 * 收缩空白边距：把画布裁到「内容框 + margin 格」。内容本身不缩放、不重算颜色。
 * margin 被各侧已有空白量约束（最多收到内容贴边，不越界、不扩容）。
 * 没有空白可收（或收了也没变化）时返回 null —— 调用方据此禁用按钮。
 */
export function trimBlankBorders(grid, margin = 0) {
  if (!Array.isArray(grid) || !grid.length || !grid[0]?.length) return null;
  const width = grid[0].length, height = grid.length;
  const insets = blankBorderInsets(grid);
  if (!insets.top && !insets.right && !insets.bottom && !insets.left) return null;
  const m = Math.max(0, Math.round(Number(margin) || 0));
  const cx0 = insets.left, cy0 = insets.top, cx1 = width - insets.right, cy1 = height - insets.bottom;
  // 全空图纸（四边把整个网格吃光）：没有内容可保，绝不产出空网格。
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  const x0 = cx0 - Math.min(m, insets.left), y0 = cy0 - Math.min(m, insets.top);
  const x1 = cx1 + Math.min(m, insets.right), y1 = cy1 + Math.min(m, insets.bottom);
  const nextWidth = x1 - x0, nextHeight = y1 - y0;
  if (nextWidth >= width && nextHeight >= height) return null;
  const next = Array.from({ length: nextHeight }, (_, y) =>
    Array.from({ length: nextWidth }, (_, x) => cloneCell(grid[y0 + y]?.[x0 + x] ?? null)));
  return { grid: next, width: nextWidth, height: nextHeight, insets, contentBox: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 } };
}

/** 收缩空白边距的可撤销结构命令（与 createGridResizeCommand 同一套撤销语义）。 */
export function createGridTrimCommand(bridge, { grid, width = grid?.[0]?.length || 0, height = grid?.length || 0, margin = 0 } = {}) {
  if (!Array.isArray(grid) || width < 1 || height < 1) throw new TypeError("Trim 需要有效 canonical grid");
  const trim = trimBlankBorders(grid, margin);
  if (!trim) return null;
  const before = cloneGridSnapshot({ grid, width, height });
  const after = cloneGridSnapshot({ grid: trim.grid, width: trim.width, height: trim.height });
  const snapshotBridge = {
    replaceGridStructure: (snapshot) => bridge.replaceGridStructure(cloneGridSnapshot(snapshot)),
  };
  return createStructureCommand(snapshotBridge, {
    type: "TRIM_BLANKS",
    label: `收缩空白边距：${width}×${height} → ${trim.width}×${trim.height}`,
    before,
    after,
  });
}
