import { paletteIdOf } from './palette-identity.js';

// Exact palette identity, four-connected exterior only. Enclosed white is artwork.
export function findExteriorBackground(grid) {
  const height = grid.length, width = grid[0]?.length || 0;
  const border = [], seenBorder = new Set(), counts = new Map();
  const addBorder = (x, y) => {
    const key = `${x},${y}`;
    if (seenBorder.has(key)) return;
    seenBorder.add(key); border.push({ x, y });
    const id = paletteIdOf(grid[y]?.[x]);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  };
  if (!width || !height) return null;
  for (let x = 0; x < width; x++) { addBorder(x, 0); addBorder(x, height - 1); }
  for (let y = 0; y < height; y++) { addBorder(0, y); addBorder(width - 1, y); }
  const paletteId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  // A mostly transparent or ambiguous edge is not a background. Never infer
  // a touching subject as background from the remaining non-empty cells.
  if (!paletteId || counts.get(paletteId) <= border.length / 2) return null;
  const queue = border.filter(({ x, y }) => paletteIdOf(grid[y][x]) === paletteId), seen = new Set(queue.map(({ x, y }) => `${x},${y}`));
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(key) || paletteIdOf(grid[ny]?.[nx]) !== paletteId) continue;
      seen.add(key); queue.push({ x: nx, y: ny });
    }
  }
  return { paletteId, color: grid[queue[0].y][queue[0].x], cells: queue,
    selection: { kind: 'exterior-background', x0: 0, y0: 0, x1: width - 1, y1: height - 1, mask: seen } };
}
