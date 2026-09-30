export const PATTERN_QUALITY = Object.freeze({ standard: 16, high: 24, ultra: 32 });

export function relativeLuminance(rgb = [255, 255, 255]) {
  const c = rgb.map((v) => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
export const codeTextColor = (rgb) => relativeLuminance(rgb) < .36 ? "#F7F7F7" : "#232323";

export function fitCodeFont(ctx, code, cellSize, ratio = .38) {
  const maxWidth = cellSize * .78, min = Math.max(6, cellSize * .2);
  let size = cellSize * ratio;
  while (size > min) { ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`; if (ctx.measureText(String(code)).width <= maxWidth) break; size -= .5; }
  return size;
}

export function patternPixelSize(grid, cellSize, header = 132, footer = 120) {
  return { width: (grid[0]?.length || 0) * cellSize, height: grid.length * cellSize + header + footer, artworkWidth: (grid[0]?.length || 0) * cellSize, artworkHeight: grid.length * cellSize, header, footer };
}

export function usageFromGrid(grid) {
  const usage = new Map();
  for (const row of grid) for (const cell of row) if (cell) {
    const id = cell.paletteId || cell.code;
    if (!usage.has(id)) usage.set(id, { paletteId: id, code: cell.code || id, rgb: cell.rgb || [255,255,255], count: 0 });
    usage.get(id).count += 1;
  }
  return [...usage.values()].sort((a,b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function renderPatternCanvas(grid, options = {}) {
  const cellSize = Number(options.cellSize) || PATTERN_QUALITY.ultra;
  const header = options.header === false ? 0 : 132, footer = options.footer === false ? 0 : 120;
  const size = patternPixelSize(grid, cellSize, header, footer);
  const canvas = (options.document || document).createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false; ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  if (header) { ctx.fillStyle="#202124"; ctx.font="700 34px system-ui, sans-serif"; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(options.title || "未命名作品", 24, 42); ctx.fillStyle="#666"; ctx.font="20px system-ui, sans-serif"; ctx.fillText(options.subtitle || "",24,88); }
  const showCodes = options.showCodes !== false, showGrid = options.showGrid !== false, oy = header;
  for (let y=0;y<grid.length;y+=1) for (let x=0;x<(grid[y]?.length||0);x+=1) {
    const cell=grid[y][x], px=x*cellSize, py=oy+y*cellSize;
    ctx.fillStyle=cell ? `rgb(${cell.rgb.join(",")})` : "#fff"; ctx.fillRect(px,py,cellSize,cellSize);
    if (showGrid) { ctx.strokeStyle="#23232355"; ctx.lineWidth=cellSize>=24?1.5:1; ctx.strokeRect(px+.5,py+.5,cellSize,cellSize); }
    if (showCodes && cell?.code) { const fontSize=fitCodeFont(ctx,cell.code,cellSize); ctx.font=`600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle=codeTextColor(cell.rgb); ctx.fillText(cell.code,px+cellSize/2,py+cellSize/2); }
  }
  if (footer) { const usage=usageFromGrid(grid), total=usage.reduce((s,i)=>s+i.count,0); ctx.fillStyle="#666"; ctx.font="18px system-ui, sans-serif"; ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.fillText(`${usage.length} 色 · ${total} 颗${options.paletteLabel?` · ${options.paletteLabel}`:""}`,24,oy+size.artworkHeight+42); }
  return canvas;
}

