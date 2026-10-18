const fail = message => { throw new TypeError(message); };
const copy = value => structuredClone(value);
function dimensions(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 1000) || width * height > 250000) fail('创意图纸尺寸无效或超出限制');
}
function paletteEntries(palette) {
  if (!Array.isArray(palette) || !palette.length) fail('当前色卡为空');
  return palette.map(color => {
    if (!color || typeof color.code !== 'string' || !color.code.trim() || !Array.isArray(color.rgb) || color.rgb.length !== 3 || !color.rgb.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) fail('当前色卡数据无效');
    return color;
  });
}
export function creativePaletteFingerprint(palette) {
  return JSON.stringify(paletteEntries(palette).map(c => JSON.stringify([c.paletteId ?? null, c.code, c.rgb])).sort());
}
export function validateCreativeResult(result, palette) {
  if (!result || typeof result !== 'object') fail('创意工具没有返回有效结果');
  const { cols: width, rows: height, grid } = result;
  dimensions(width, height);
  if (!Array.isArray(grid) || grid.length !== height || Array.from(grid).some(row => !Array.isArray(row) || row.length !== width)) fail('创意图纸网格与尺寸不一致');
  const colors = new Map();
  for (const color of paletteEntries(palette)) {
    if (colors.has(color.code)) fail('当前色卡存在重复色号，无法确定颜色身份');
    colors.set(color.code, color);
  }
  let coloredCount = 0;
  const mapped = grid.map(row => Array.from(row, code => {
    if (code === null) return null;
    if (typeof code !== 'string' || !colors.has(code)) fail('创意图纸包含当前色卡中不存在的色号');
    coloredCount++;
    return copy(colors.get(code));
  }));
  if (!coloredCount) fail('创意图纸没有可导入的颜色格子');
  return { grid: mapped, width, height, coloredCount };
}
export function planCreativeGrid(result, palette, current, kind) {
  const imported = validateCreativeResult(result, palette);
  if (!['text', 'pattern'].includes(kind)) fail('未知的创意工具类型');
  const locked = current?.templateLockedMask;
  if (kind === 'pattern') {
    if (locked?.some(row => row?.some(Boolean))) fail('请先解除母版锁定，再替换图纸');
    return { grid: imported.grid, width: imported.width, height: imported.height, templateLockedMask: null };
  }
  const existingWidth = current?.width || 0, existingHeight = current?.height || 0;
  if (existingWidth || existingHeight) {
    dimensions(existingWidth, existingHeight);
    if (!Array.isArray(current.grid) || current.grid.length !== existingHeight || Array.from(current.grid).some(row => !Array.isArray(row) || row.length !== existingWidth)) fail('当前作品网格与尺寸不一致');
  }
  const width = Math.max(existingWidth, imported.width), height = Math.max(existingHeight, imported.height);
  dimensions(width, height);
  const grid = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => copy(current?.grid?.[y]?.[x] ?? null)));
  const templateLockedMask = locked == null ? null : Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => Boolean(locked[y]?.[x])));
  const offsetX = Math.floor((width - imported.width) / 2), offsetY = Math.floor((height - imported.height) / 2);
  imported.grid.forEach((row, y) => row.forEach((cell, x) => {
    if (cell !== null && !templateLockedMask?.[y + offsetY]?.[x + offsetX]) grid[y + offsetY][x + offsetX] = cell;
  }));
  return { grid, width, height, templateLockedMask };
}
