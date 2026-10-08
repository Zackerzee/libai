// 形状、画笔与选区工具：纯函数，无 DOM、无全局状态、无副作用。
// 所有函数消费 / 返回豆格坐标 {x,y} 与标准 selection 对象，方便 UI 层直接复用。
// 颜色差异口径（rgbToLab / srgbToLinear）刻意与 smart-preprocessing/palette-engine.mjs 保持一致，
// 保证全项目色差判定同源。

import { selectionContains, selectionCells } from "./selection-service.js";

const key = (x, y) => `${x},${y}`;

// ---- 颜色：sRGB → 线性 → XYZ(D65) → Lab（与 palette-engine 同常数）----
const D65 = [0.95047, 1, 1.08883];

function srgbToLinear(value) {
  const v = Math.min(1, Math.max(0, Number(value) / 255));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / D65[0];
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / D65[1];
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / D65[2];
  // D65 下 f(t) 在 t≈0.008856 处线性化，避免 cbrt 在极小值为负。
  const f = (value) => (value > 0.008856451679 ? Math.cbrt(value) : 7.787037037 * value + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIE76：Lab 空间欧氏距离。裸 RGB 差在暗部/高饱和处失真，故魔棒统一走 Lab。
function deltaELab(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function dedupeStable(cells) {
  const seen = new Set();
  const out = [];
  for (const c of cells) {
    const k = key(c.x, c.y);
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

// ---- 1. 形状栅格化 ----

// Bresenham 直线，含两端点；顺序稳定（起点→终点），并去重。
export function lineCells(x0, y0, x1, y1) {
  const cells = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return dedupeStable(cells);
}

// 矩形：filled=true 实心，否则仅描边（恰好 1 格宽）。先归一化方向，退化情况单独处理。
export function rectangleCells(x0, y0, x1, y1, { filled = false } = {}) {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  const w = bx - ax + 1;
  const h = by - ay + 1;
  const cells = [];
  if (filled) {
    for (let y = ay; y <= by; y += 1) for (let x = ax; x <= bx; x += 1) cells.push({ x, y });
  } else if (w === 1 && h === 1) {
    cells.push({ x: ax, y: ay });
  } else if (w === 1) {
    for (let y = ay; y <= by; y += 1) cells.push({ x: ax, y });
  } else if (h === 1) {
    for (let x = ax; x <= bx; x += 1) cells.push({ x, y: ay });
  } else {
    // 上边 → 右边（去角）→ 下边（反向）→ 左边（去角），顺序确定、无重复。
    for (let x = ax; x <= bx; x += 1) cells.push({ x, y: ay });
    for (let y = ay + 1; y <= by - 1; y += 1) cells.push({ x: bx, y });
    for (let x = bx; x >= ax; x -= 1) cells.push({ x, y: by });
    for (let y = by - 1; y >= ay + 1; y -= 1) cells.push({ x: ax, y });
  }
  return dedupeStable(cells);
}

// 椭圆：外接框 (x0,y0)-(x1,y1)。filled=true 实心，否则描边（恰好 1 格宽）。
// 实心由隐函数 F = ((x+0.5-cx)/rx)² + ((y+0.5-cy)/ry)² <= 1 判定；描边取实心区域的 4 邻域腐蚀边界。
// cx/rx 由「格边界」推出（cx=(ax+bx+1)/2，rx=(bx-ax+1)/2），并一律按格中心 (x+0.5, y+0.5) 采样。
// 该轮廓关于外接框中心严格对称、天然闭合（无断线），且不像角度取样那样在扁椭圆上留洞。
// 按格中心采样是必需的：若改用整数坐标，包围盒为偶数格时几何中心落在半整数上，每行跨度不再
// 收缩，10×6 的椭圆会整块退化成矩形（本项目曾真实出现过该缺陷）。
// 退化规则（确定性、可测）：
//  - 1×1 框：单格。
//  - 宽或高为 1 的线段：直接取该线段（椭圆退化为线）。
//  - 2×2 框：椭圆太小装不下任何豆格中心，按“满框”4 格处理，保证非空且对称。
//  - 宽高恰为 2 格（2 列 / 2 行）：退化为满宽 / 满高的条带（无内部，描边即整体）。
export function ellipseCells(x0, y0, x1, y1, { filled = false } = {}) {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  const w = bx - ax;
  const h = by - ay;

  if (w === 0 && h === 0) return [{ x: ax, y: ay }];
  if (w === 0) { const c = []; for (let y = ay; y <= by; y += 1) c.push({ x: ax, y }); return c; }
  if (h === 0) { const c = []; for (let x = ax; x <= bx; x += 1) c.push({ x, y: ay }); return c; }
  if (w === 1 && h === 1) {
    const c = [];
    for (let y = ay; y <= by; y += 1) for (let x = ax; x <= bx; x += 1) c.push({ x, y });
    return c;
  }
  if (w === 1 || h === 1) {
    const c = [];
    for (let y = ay; y <= by; y += 1) for (let x = ax; x <= bx; x += 1) c.push({ x, y });
    return c;
  }

  // 豆格是「面」不是「点」：x 号格占据 [x, x+1)，其中心在 x+0.5。
  // 必须按格中心采样 —— 若直接在整数坐标上套隐函数，包围盒为偶数格时几何中心落在半整数上，
  // 每行跨度就不再收缩，10×6 的「椭圆」会整块退化成矩形。这是曾经真实出现的缺陷。
  const cx = (ax + bx + 1) / 2;
  const cy = (ay + by + 1) / 2;
  const rx = (bx - ax + 1) / 2;
  const ry = (by - ay + 1) / 2;
  const inside = (x, y) => {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    return nx * nx + ny * ny <= 1 + 1e-9;
  };
  const filledSet = new Map();
  for (let y = ay; y <= by; y += 1) {
    for (let x = ax; x <= bx; x += 1) {
      if (inside(x, y)) filledSet.set(key(x, y), { x, y });
    }
  }
  if (filled) return [...filledSet.values()];

  // 描边 = 实心区域的 4 邻域腐蚀边界（至少一个 4 邻域在实心外或越界）。
  const stroke = [];
  for (const { x, y } of filledSet.values()) {
    let onEdge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < ax || nx > bx || ny < ay || ny > by || !filledSet.has(key(nx, ny))) { onEdge = true; break; }
    }
    if (onEdge) stroke.push({ x, y });
  }
  return dedupeStable(stroke);
}

// 形状分发：kind 为 "line" | "rect" | "ellipse"。
export function shapeCells(kind, start, end, options = {}) {
  const { x: x0, y: y0 } = start;
  const { x: x1, y: y1 } = end;
  if (kind === "line") return lineCells(x0, y0, x1, y1);
  if (kind === "rect") return rectangleCells(x0, y0, x1, y1, options);
  if (kind === "ellipse") return ellipseCells(x0, y0, x1, y1, options);
  throw new Error(`未知形状: ${kind}`);
}

// ---- 2. 画笔大小（膨胀核）----

// 笔宽语义为“奇数格数”：size<=1 视作 1；偶数向上取到最近奇数（size=2→3）。
// round：圆盘核，半径 r=floor(eff/2)，判定 dx²+dy² <= r*(r+1)：
//   r=1（笔宽 3）时恰好铺满 3×3 而不缺角；更大尺寸仍是圆盘形（含满宽十字）。
// square：满方形核 |dx|<=r && |dy|<=r。
export function brushOffsets(size, shape = "round") {
  const effective = size <= 1 ? 1 : (size % 2 === 1 ? size : size + 1);
  const r = Math.floor(effective / 2);
  const offsets = [];
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      // 归一化为正零，避免 r=0 时产生 -0 影响严格相等比较。
      const ox = dx === 0 ? 0 : dx;
      const oy = dy === 0 ? 0 : dy;
      if (shape === "square") offsets.push([ox, oy]);
      else if (ox * ox + oy * oy <= r * (r + 1)) offsets.push([ox, oy]);
    }
  }
  return offsets;
}

// 用膨胀核把 cells 膨胀为更大集合，去重。中心格（偏移 [0,0]）必然保留。
export function expandBrush(cells, size, shape = "round") {
  const offsets = brushOffsets(size, shape);
  const map = new Map();
  for (const { x, y } of cells) {
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (!map.has(k)) map.set(k, { x: nx, y: ny });
    }
  }
  return [...map.values()];
}

// ---- 3. 魔棒（带容差的连通 / 全局同色选择）----

// tolerance 0→0 ΔE、100→约 40 ΔE，线性插值（40 为感知容忍上限）。
function toleranceToDeltaE(tolerance) {
  return Math.min(100, Math.max(0, tolerance)) / 100 * 40;
}

function colorSimilar(a, b, maxDeltaE) {
  const an = a == null;
  const bn = b == null;
  if (an && bn) return true;       // 同为空白视作相似，可整片选中空白
  if (an !== bn) return false;     // 一空一色必不相似
  const la = rgbToLab(a.rgb);
  const lb = rgbToLab(b.rgb);
  return deltaELab(la, lb) <= maxDeltaE;
}

export function magicWandSelection(grid, x, y, {
  tolerance = 0,
  contiguous = true,
  within = null,
  diagonal = false,
} = {}) {
  const height = grid.length;
  if (!height) return null;
  const width = grid[0]?.length || 0;
  if (x < 0 || x >= width || y < 0 || y >= height) return null;

  const target = grid[y][x];
  const maxDeltaE = toleranceToDeltaE(tolerance);
  const offsets = diagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const cells = [];
  if (!contiguous) {
    // 全图模式：扫描每个格，命中相似色即选（仍需在 within 内）。
    for (let yy = 0; yy < height; yy += 1) {
      for (let xx = 0; xx < width; xx += 1) {
        if (within && !selectionContains(within, xx, yy)) continue;
        if (colorSimilar(grid[yy][xx], target, maxDeltaE)) cells.push({ x: xx, y: yy });
      }
    }
  } else {
    // 连通模式：显式队列 BFS（不递归，避免 1000×1000 爆栈）。
    const seen = new Set([key(x, y)]);
    const queue = [{ x, y }];
    for (let i = 0; i < queue.length; i += 1) {
      const cur = queue[i];
      if (!colorSimilar(grid[cur.y][cur.x], target, maxDeltaE)) continue;
      cells.push(cur);
      for (const [dx, dy] of offsets) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nk = key(nx, ny);
        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
        if (within && !selectionContains(within, nx, ny)) continue;
        if (seen.has(nk)) continue;
        if (!colorSimilar(grid[ny][nx], target, maxDeltaE)) continue;
        seen.add(nk);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  if (!cells.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c.x < x0) x0 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.x > x1) x1 = c.x;
    if (c.y > y1) y1 = c.y;
  }
  return {
    kind: "magic-wand",
    x0, y0, x1, y1,
    mask: new Set(cells.map((c) => key(c.x, c.y))),
  };
}

// ---- 4. 选区操作 ----

// 由 cell 列表算出标准 mask 型 selection；空列表返回 null。等价 selection-service 的 maskedSelection，但导出供 UI 复用。
export function fitSelectionBox(cells, kind = "selection") {
  if (!cells || !cells.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const mask = new Set();
  for (const { x, y } of cells) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    mask.add(key(x, y));
  }
  return { kind, x0, y0, x1, y1, mask };
}

export function selectAll(width, height) {
  if (width <= 0 || height <= 0) return null;
  return { kind: "all", x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
}

// 反选：返回 mask 型 selection。空输入选区 → 全选。
export function invertSelection(selection, width, height) {
  const total = width * height;
  if (!selection || !total) return selectAll(width, height);
  const current = selectionCells(selection, width, height);
  if (!current.length) return selectAll(width, height);

  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!selectionContains(selection, x, y)) cells.push({ x, y });
    }
  }
  if (!cells.length) {
    return { kind: "inverse", x0: 0, y0: 0, x1: width - 1, y1: height - 1, mask: new Set() };
  }
  return fitSelectionBox(cells, "inverse");
}

// 平移并裁剪到画布内，仍返回 selection（保留原 kind）。
export function translateSelection(selection, dx, dy, width, height) {
  if (!selection) return null;
  const cells = selectionCells(selection, width, height)
    .map(({ x, y }) => ({ x: x + dx, y: y + dy }))
    .filter(({ x, y }) => x >= 0 && x < width && y >= 0 && y < height);
  if (!cells.length) return null;
  return fitSelectionBox(cells, selection.kind || "translated");
}
