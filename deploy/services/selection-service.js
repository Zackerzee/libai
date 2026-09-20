const key = (x, y) => `${x},${y}`;
const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];

export function selectionContains(selection, x, y) {
  if (!selection) return false;
  if (selection.mask) return selection.mask.has(key(x, y));
  return x >= selection.x0 && x <= selection.x1 && y >= selection.y0 && y <= selection.y1;
}

export function selectionCells(selection, width, height) {
  if (!selection) return [];
  const cells = [];
  for (let y = Math.max(0, selection.y0); y <= Math.min(height - 1, selection.y1); y++)
    for (let x = Math.max(0, selection.x0); x <= Math.min(width - 1, selection.x1); x++)
      if (selectionContains(selection, x, y)) cells.push({ x, y });
  return cells;
}

export function rectangularSelection(ax, ay, bx, by, width, height) {
  return { kind: "rectangle", x0: Math.max(0, Math.min(ax, bx)), y0: Math.max(0, Math.min(ay, by)),
    x1: Math.min(width - 1, Math.max(ax, bx)), y1: Math.min(height - 1, Math.max(ay, by)) };
}

function maskedSelection(kind, cells) {
  if (!cells.length) return null;
  return { kind, x0: Math.min(...cells.map((p) => p.x)), y0: Math.min(...cells.map((p) => p.y)),
    x1: Math.max(...cells.map((p) => p.x)), y1: Math.max(...cells.map((p) => p.y)), mask: new Set(cells.map(({ x, y }) => key(x, y))) };
}

export function sameColorSelection(grid, x, y, within = null) {
  const code = grid[y]?.[x]?.code ?? null, cells = [];
  grid.forEach((row, cy) => row.forEach((color, cx) => {
    if ((color?.code ?? null) === code && (!within || selectionContains(within, cx, cy))) cells.push({ x: cx, y: cy });
  }));
  return maskedSelection("same-color", cells);
}

export function connectedSelection(grid, x, y, within = null) {
  if (!grid[y] || x < 0 || x >= grid[y].length) return null;
  const code = grid[y][x]?.code ?? null, queue = [{ x, y }], seen = new Set([key(x,y)]), cells = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if ((grid[current.y]?.[current.x]?.code ?? null) !== code || (within && !selectionContains(within, current.x, current.y))) continue;
    cells.push(current);
    for (const [dx, dy] of neighbors) {
      const nx = current.x + dx, ny = current.y + dy, id = key(nx,ny);
      if (grid[ny] && nx >= 0 && nx < grid[ny].length && !seen.has(id)) { seen.add(id); queue.push({ x: nx, y: ny }); }
    }
  }
  return maskedSelection("connected", cells);
}

export function outerOutline(selection, width, height, diagonal = false) {
  const offsets = diagonal ? [...neighbors,[1,1],[1,-1],[-1,1],[-1,-1]] : neighbors;
  const unique = new Map();
  for (const { x, y } of selectionCells(selection, width, height)) for (const [dx,dy] of offsets) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height && !selectionContains(selection, nx, ny)) unique.set(key(nx,ny), { x: nx, y: ny });
  }
  return [...unique.values()];
}
