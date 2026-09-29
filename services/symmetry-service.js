import { expandBrush } from "./shapes-service.js";

export function symmetryCells(cells, width, height, options = {}) {
  const {
    mode = null, horizontal = false, vertical = false,
    axisX = (width - 1) / 2, axisY = (height - 1) / 2,
  } = options || {};
  // mode 使用几何学命名：vertical=关于竖轴镜像，horizontal=关于横轴镜像。
  // 保留旧 horizontal/vertical 布尔值语义，确保旧工程运行态与既有测试可继续工作。
  const mirrorX = mode ? ["vertical", "both"].includes(mode) : horizontal;
  const mirrorY = mode ? ["horizontal", "both"].includes(mode) : vertical;
  const out = new Map();
  const add = (x, y) => { const nx = Math.round(x), ny = Math.round(y); if (nx >= 0 && ny >= 0 && nx < width && ny < height) out.set(`${nx},${ny}`, { x: nx, y: ny }); };
  for (const { x, y } of cells) {
    add(x, y);
    if (mirrorX) add(2 * axisX - x, y);
    if (mirrorY) add(x, 2 * axisY - y);
    if (mirrorX && mirrorY) add(2 * axisX - x, 2 * axisY - y);
  }
  return [...out.values()];
}

// 笔迹与预览共享同一个计划器，固定顺序：中心路径 → 对称展开 → 笔刷 footprint → 边界裁剪。
export function symmetryBrushCells(centers, width, height, { size = 1, shape = "square", symmetry = null } = {}) {
  const mirrored = symmetryCells(centers, width, height, symmetry || {});
  const expanded = size > 1 ? expandBrush(mirrored, size, shape) : mirrored;
  const out = new Map();
  for (const cell of expanded) if (cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height) out.set(`${cell.x},${cell.y}`, cell);
  return [...out.values()];
}
