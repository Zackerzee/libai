export function symmetryCells(cells, width, height, options = {}) {
  const {
    horizontal = false, vertical = false,
    axisX = (width - 1) / 2, axisY = (height - 1) / 2,
  } = options || {};
  const out = new Map();
  const add = (x, y) => { const nx = Math.round(x), ny = Math.round(y); if (nx >= 0 && ny >= 0 && nx < width && ny < height) out.set(`${nx},${ny}`, { x: nx, y: ny }); };
  for (const { x, y } of cells) {
    add(x, y);
    if (horizontal) add(2 * axisX - x, y);
    if (vertical) add(x, 2 * axisY - y);
    if (horizontal && vertical) add(2 * axisX - x, 2 * axisY - y);
  }
  return [...out.values()];
}
