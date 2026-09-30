const cloneCell = (cell) => cell ? { ...cell, rgb: Array.isArray(cell.rgb) ? [...cell.rgb] : cell.rgb } : null;
const label = (index, total) => String(index).padStart(Math.max(2, String(total).length), "0");

export function splitPatternGrid(grid, tileWidth = 104, tileHeight = 104) {
  const height = grid.length, width = grid[0]?.length || 0;
  const columns = Math.ceil(width / tileWidth), rows = Math.ceil(height / tileHeight), total = columns * rows;
  const tiles = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = column * tileWidth, y = row * tileHeight;
    const w = Math.min(tileWidth, width - x), h = Math.min(tileHeight, height - y);
    const index = tiles.length + 1;
    const cells = Array.from({ length: h }, (_, iy) => grid[y + iy].slice(x, x + w).map(cloneCell));
    tiles.push({ index, number: label(index, total), row: row + 1, column: column + 1, x, y, width: w, height: h, cells, neighbors: {} });
  }
  for (const tile of tiles) {
    const at = (r, c) => tiles.find((item) => item.row === r && item.column === c);
    const map = { up: at(tile.row - 1, tile.column), down: at(tile.row + 1, tile.column), left: at(tile.row, tile.column - 1), right: at(tile.row, tile.column + 1) };
    for (const [direction, neighbor] of Object.entries(map)) if (neighbor) tile.neighbors[direction] = neighbor.number;
  }
  return { width, height, tileWidth, tileHeight, columns, rows, total, needsSplit: width > tileWidth || height > tileHeight, tiles };
}

export function countValidCells(grid) { return grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0); }

