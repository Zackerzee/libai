// Pure template APIs. Coordinates are integer cells; null alone means transparent.
// Templates preserve archived RGB, code and paletteId without color matching.
const MAX_SIDE = 2048, MAX_CELLS = 1048576;
const fail = (message) => { throw new TypeError(message); };
const copy = (value) => structuredClone(value);
function dimensions(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_SIDE) || width * height > MAX_CELLS) fail('模板尺寸无效或超出限制');
}
function color(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || typeof value.code !== 'string' || !value.code.trim() || !Array.isArray(value.rgb) || value.rgb.length !== 3 || !value.rgb.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) fail('模板颜色数据无效');
  if (value.paletteId !== undefined && (typeof value.paletteId !== 'string' || !value.paletteId.trim())) fail('色卡身份无效');
  const hex = '#' + value.rgb.map(n => n.toString(16).padStart(2, '0')).join('');
  if (value.hex !== undefined && (typeof value.hex !== 'string' || value.hex.toLowerCase() !== hex)) fail('颜色的 HEX 与 RGB 不一致');
  return { ...copy(value), rgb: [...value.rgb], hex };
}
function gridCopy(grid, width = grid?.[0]?.length, height = grid?.length) {
  dimensions(width, height);
  if (!Array.isArray(grid) || grid.length !== height || grid.some(row => !Array.isArray(row) || row.length !== width)) fail('网格与声明的尺寸不一致');
  return grid.map(row => row.map(color));
}
function paletteKey(value) {
  if (typeof value !== 'string' || !value.trim()) fail('缺少色卡标识');
  return value;
}
function compatible(template, options) {
  if (options.paletteKey !== undefined && options.paletteKey !== template.paletteKey) fail('模板色卡与当前画布不一致');
  if (options.palette !== undefined) {
    if (!Array.isArray(options.palette)) fail('当前画布色卡无效');
    const palette = options.palette.map(color);
    for (const cell of template.grid.flat()) {
      if (!cell) continue;
      const candidates = palette.filter(entry => entry && entry.code === cell.code && entry.rgb.every((n, i) => n === cell.rgb[i]));
      // Old archives may lack identity. Accept only a unique exact color in an
      // explicitly identical palette, retaining the archived cell unchanged.
      const matches = cell.paletteId === undefined
        ? options.paletteKey === template.paletteKey && candidates.length === 1
        : candidates.some(entry => entry.paletteId === cell.paletteId);
      if (!matches) fail('模板包含当前色卡中不存在或身份不一致的颜色');
    }
  }
  return template;
}
/** Parse template v1, archived libms-project v1, or legacy gridData. Optional
 * palette/paletteKey validate exact destination compatibility, never remap.
 * An archived color without paletteId may match one exact code/RGB candidate
 * only when both palette keys are explicit and equal. */
export function parseTemplateJson(source, options = {}) {
  let data;
  try { data = typeof source === 'string' ? JSON.parse(source) : copy(source); } catch { fail('模板不是合法的 JSON 数据'); }
  if (!data || typeof data !== 'object') fail('模板不是合法的 JSON 数据');
  let grid, width, height, key, name;
  if (data.format === 'libms-template' && data.version === 1) {
    ({ grid, width, height, paletteKey: key, name } = data);
  } else if (data.format === 'libms-project' && data.version === 1) {
    ({ width, height } = data.canvas || {}); key = data.palette?.key; name = data.projectName;
    dimensions(width, height);
    if (!Array.isArray(data.colors)) fail('工程缺少已保存的颜色数据');
    const colors = data.colors.map(color);
    if (!Array.isArray(data.grid) || data.grid.length !== height || data.grid.some(row => !Array.isArray(row) || row.length !== width)) fail('网格与声明的尺寸不一致');
    if (data.gridPaletteIds !== undefined && (!Array.isArray(data.gridPaletteIds) || data.gridPaletteIds.length !== height || data.gridPaletteIds.some(row => !Array.isArray(row) || row.length !== width))) fail('色卡身份矩阵与网格尺寸不一致');
    grid = data.grid.map((row, y) => row.map((code, x) => {
      const id = data.gridPaletteIds?.[y]?.[x];
      if (code === null) { if (id != null) fail('透明格不能包含色卡身份'); return null; }
      if (typeof code !== 'string' || (id != null && typeof id !== 'string')) fail('网格颜色引用无效');
      const matches = colors.filter(c => c && c.code === code && (id == null || c.paletteId === id));
      if (!matches.length || matches.some(c => JSON.stringify(c) !== JSON.stringify(matches[0]))) fail('工程颜色不存在或无法唯一确定');
      return matches[0];
    }));
  } else if (data.type === 'libai-maker-project') {
    key = data.paletteKey; name = data.name || data.sourceName;
    if (typeof data.gridData !== 'string' || !data.gridData) fail('旧版工程缺少网格数据');
    grid = data.gridData.split(';').map(row => row.split(',').map(token => {
      if (token === '.') return null;
      const parts = token.split('|');
      if (parts.length < 2 || parts.length > 3 || !/^#[0-9a-f]{6}$/i.test(parts[1])) fail('旧版工程颜色数据无效');
      return color({ code: parts[0], hex: parts[1], rgb: [1, 3, 5].map(i => parseInt(parts[1].slice(i, i + 2), 16)), ...(parts[2] ? { paletteId: parts[2] } : {}) });
    }));
    width = grid[0]?.length; height = grid.length;
    if ((data.width !== undefined && data.width !== width) || (data.height !== undefined && data.height !== height)) fail('旧版工程尺寸与网格不一致');
  } else fail('不支持此模板格式或版本');
  return compatible({ format: 'libms-template', version: 1, name: typeof name === 'string' ? name : '', width, height, paletteKey: paletteKey(key), grid: gridCopy(grid, width, height) }, options);
}
function maskHas(mask, x, y) {
  return mask instanceof Set ? mask.has(`${x},${y}`) : Boolean(mask?.[y]?.[x]);
}
/** Capture canvas, opaque cells, locked cells, or cropped selection. Selection
 * uses the editor's {x0,y0,x1,y1,mask?: Set<'x,y'>} contract. */
export function createTemplateFromGrid({ grid, paletteKey: key, name = '', selection, lockedMask, scope = 'canvas' }) {
  const cloned = gridCopy(grid), height = cloned.length, width = cloned[0].length;
  if (!['canvas', 'selection', 'opaque', 'locked'].includes(scope)) fail('模板保存范围无效');
  let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1;
  if (scope === 'selection') {
    if (!selection || !['x0', 'y0', 'x1', 'y1'].every(k => Number.isInteger(selection[k]))) fail('缺少有效选区');
    x0 = Math.max(0, selection.x0); y0 = Math.max(0, selection.y0); x1 = Math.min(width - 1, selection.x1); y1 = Math.min(height - 1, selection.y1);
    if (x1 < x0 || y1 < y0) fail('选区为空');
  }
  const captured = cloned.slice(y0, y1 + 1).map((row, dy) => row.slice(x0, x1 + 1).map((cell, dx) => {
    const x = x0 + dx, y = y0 + dy;
    if (scope === 'locked' && !maskHas(lockedMask, x, y)) return null;
    if (scope === 'selection' && selection.mask && !maskHas(selection.mask, x, y)) return null;
    return cell;
  }));
  return parseTemplateJson({ format: 'libms-template', version: 1, name, width: x1 - x0 + 1, height: y1 - y0 + 1, paletteKey: key, grid: captured });
}
/** Overlay clipped to target dimensions; skip null and destination locks.
 * Target is {grid,paletteKey,palette?} (or a grid for palette-agnostic callers).
 * changes counts changed cells; mask is the target-sized occupied source
 * footprint, including identical cells but excluding destination locks. */
export function overlayTemplate(target, source, { offsetX = 0, offsetY = 0, lockedMask } = {}) {
  if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) fail('模板偏移必须为整数格');
  const grid = gridCopy(Array.isArray(target) ? target : target?.grid);
  const template = parseTemplateJson(source, Array.isArray(target) ? {} : target);
  const mask = grid.map(row => row.map(() => false)); let changes = 0;
  template.grid.forEach((row, y) => row.forEach((cell, x) => {
    const dx = x + offsetX, dy = y + offsetY;
    if (!cell || !grid[dy] || dx < 0 || dx >= grid[dy].length || maskHas(lockedMask, dx, dy)) return;
    mask[dy][dx] = true;
    const previous = grid[dy][dx];
    if (previous && previous.code === cell.code && previous.paletteId === cell.paletteId && previous.rgb.every((n, i) => n === cell.rgb[i])) return;
    grid[dy][dx] = copy(cell); changes++;
  }));
  return { grid, changes, mask };
}
