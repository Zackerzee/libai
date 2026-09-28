import { BASE_CELL } from "../services/viewport-service.js?v=20260924-text";
import { rasterizeTextCached, cellsBox } from "../services/text-layer-service.js?v=20260924-text";
import { resolveScreenRenderPolicy } from "../smart-preprocessing/render-policy.mjs?v=20260928-v3";
import { paletteIdOf } from "../services/palette-identity.js";

export const codeForegroundColor = (rgb) => {
  if (!rgb) return "#17212b";
  const linear = rgb.map((n) => { const v = n / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] < 0.23 ? "#ffffff" : "#17212b";
};

// reference 必须排在 base 之下：底图垫在豆格下方，空豆处才透得出来。
const LAYER_NAMES = ["reference", "base", "grid", "codes", "overlay"];

export function createCanvasRenderer(container, viewport, getResult, getView, getEditor, getReference = () => null, resolveColor = () => null) {
  const layers = LAYER_NAMES.map((name) => {
    const canvas = document.createElement("canvas"); canvas.className = `ws-layer ws-layer-${name}`;
    canvas.dataset.layer = name; container.append(canvas); return canvas;
  });
  const L = Object.fromEntries(LAYER_NAMES.map((name, index) => [name, index]));
  let source = null, sourceUrl = "", reference = null, referenceUrl = "", scheduled = false;
  const size = () => {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    for (const canvas of layers) {
      const bw = Math.round(width * dpr), bh = Math.round(height * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    return { width, height, dpr };
  };
  const context = (canvas, dpr, width, height) => {
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height); return ctx;
  };
  const sourceImage = (url) => {
    if (url === sourceUrl) return;
    sourceUrl = url; source = null;
    if (!url) return;
    const image = new Image(); image.onload = () => { if (sourceUrl === url) { source = image; requestDraw(); } }; image.src = url;
  };
  const referenceImage = (url) => {
    if (url === referenceUrl) return reference;
    referenceUrl = url; reference = null;
    if (!url) return null;
    const image = new Image(); image.onload = () => { if (referenceUrl === url) { reference = image; requestDraw(); } }; image.src = url;
    return null;
  };
  // 适应 = 保持比例居中铺满；拉伸 = 直接铺满整块画布，允许变形。
  const drawReference = (ctx, settings, box) => {
    const image = referenceImage(settings.url || "");
    if (!image) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (Number(settings.opacity) || 0) / 100));
    if (settings.fit === "stretch") {
      ctx.drawImage(image, box.x, box.y, box.width, box.height);
    } else {
      const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
    }
    ctx.restore();
  };
  const draw = () => {
    scheduled = false;
    const startedAt = performance.now();
    const b = size(), result = getResult(), view = getView(), editor = getEditor(), ref = getReference();
    sourceImage(result?.sourceUrl || "");
    const ctx = layers.map((layer) => context(layer, b.dpr, b.width, b.height));
    if (!result?.grid?.length) return;
    const cell = BASE_CELL * view.zoom, o = viewport.origin(), gridWidth = result.width, gridHeight = result.height;
    const displayPolicy = resolveScreenRenderPolicy({
      mode: view.mode, showCodes: view.showCodes, showGrid: view.showGrid,
      zoom: view.zoom, baseCell: BASE_CELL,
      codeThreshold: view.codeVisibilityThreshold, gridThreshold: 5,
    });
    if (view.mode === "original") {
      if (source) ctx[L.base].drawImage(source, o.x, o.y, gridWidth * cell, gridHeight * cell);
      return;
    }
    if (ref?.visible !== false && ref?.url) {
      drawReference(ctx[L.reference], ref, { x: o.x, y: o.y, width: gridWidth * cell, height: gridHeight * cell });
    }
    const x0 = Math.max(0, Math.floor(-o.x / cell)), x1 = Math.min(gridWidth, Math.ceil((b.width - o.x) / cell));
    const y0 = Math.max(0, Math.floor(-o.y / cell)), y1 = Math.min(gridHeight, Math.ceil((b.height - o.y) / cell));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const color = result.grid[y]?.[x];
      const sx = o.x + x * cell, sy = o.y + y * cell;
      if (color) {
        const hex = color.hex || `rgb(${color.rgb.join(",")})`;
        const highlighted = editor.highlightedPaletteId || editor.highlightedColor;
        ctx[L.base].globalAlpha = highlighted && paletteIdOf(color) !== highlighted ? 0.2 : 1;
        ctx[L.base].fillStyle = hex;
        if (view.mode === "beads") {
          ctx[L.base].beginPath(); ctx[L.base].arc(sx + cell / 2, sy + cell / 2, cell * 0.43, 0, Math.PI * 2); ctx[L.base].fill();
          if (cell >= 14) { ctx[L.base].globalAlpha *= 0.14; ctx[L.base].fillStyle = "#ffffff"; ctx[L.base].beginPath(); ctx[L.base].arc(sx + cell * 0.40, sy + cell * 0.37, cell * 0.15, 0, Math.PI * 2); ctx[L.base].fill(); }
        } else ctx[L.base].fillRect(sx, sy, Math.ceil(cell + 0.25), Math.ceil(cell + 0.25));
      } else if (cell >= 12) { ctx[L.base].fillStyle = "rgba(226,235,240,.28)"; ctx[L.base].fillRect(sx + 2, sy + 2, cell - 4, cell - 4); }
      ctx[L.base].globalAlpha = 1;
      if (displayPolicy.showGrid) {
        ctx[L.grid].strokeStyle = "rgba(25,42,57,.22)"; ctx[L.grid].lineWidth = 1 / b.dpr;
        ctx[L.grid].strokeRect(sx + 0.5 / b.dpr, sy + 0.5 / b.dpr, cell, cell);
      }
      if (color && displayPolicy.showCodes) {
        const fontSize = Math.min(34, Math.max(8, cell * 0.43));
        ctx[L.codes].font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx[L.codes].textAlign = "center"; ctx[L.codes].textBaseline = "middle";
        ctx[L.codes].fillStyle = codeForegroundColor(color.rgb);
        ctx[L.codes].fillText(color.code, sx + cell / 2, sy + cell / 2, cell - 3);
      }
    }
    const outline = (cellPos, selected) => {
      if (!cellPos) return;
      const p = viewport.gridToScreen(cellPos.x, cellPos.y);
      ctx[L.overlay].strokeStyle = selected ? "#e87325" : "rgba(232,115,37,.55)";
      ctx[L.overlay].lineWidth = selected ? 2 : 1;
      ctx[L.overlay].strokeRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
    };
    outline(editor.hoveredCell, false); outline(editor.selectedCell, true);
    if (editor.symmetryHorizontal || editor.symmetryVertical) {
      const overlay = ctx[L.overlay];
      overlay.save();
      overlay.strokeStyle = "rgba(194, 70, 133, .82)";
      overlay.lineWidth = 1.5;
      overlay.setLineDash([7, 5]);
      if (editor.symmetryHorizontal) {
        const axisX = o.x + gridWidth * cell / 2;
        overlay.beginPath(); overlay.moveTo(axisX, o.y); overlay.lineTo(axisX, o.y + gridHeight * cell); overlay.stroke();
      }
      if (editor.symmetryVertical) {
        const axisY = o.y + gridHeight * cell / 2;
        overlay.beginPath(); overlay.moveTo(o.x, axisY); overlay.lineTo(o.x + gridWidth * cell, axisY); overlay.stroke();
      }
      overlay.restore();
    }
    if (editor.selection) {
      if (editor.selection.mask) {
        ctx[L.overlay].fillStyle = "rgba(232,115,37,.22)"; ctx[L.overlay].strokeStyle = "#e87325"; ctx[L.overlay].lineWidth = 1;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (editor.selection.mask.has(`${x},${y}`)) {
          const p = viewport.gridToScreen(x,y); ctx[L.overlay].fillRect(p.x,p.y,cell,cell); ctx[L.overlay].strokeRect(p.x,p.y,cell,cell);
        }
      } else {
        const p = viewport.gridToScreen(editor.selection.x0, editor.selection.y0);
        ctx[L.overlay].strokeStyle = "#e87325"; ctx[L.overlay].lineWidth = 2; ctx[L.overlay].setLineDash([5, 3]);
        ctx[L.overlay].strokeRect(p.x, p.y, (editor.selection.x1 - editor.selection.x0 + 1) * cell, (editor.selection.y1 - editor.selection.y0 + 1) * cell);
        ctx[L.overlay].setLineDash([]);
      }
    }
    if (editor.shapePreview?.cells?.length) {
      // 形状预览只画在 overlay 层，不写进 state.grid：所以拖动过程中撤销栈干干净净，
      // 松手才产生一步历史。半透明填充让用户看得见底下的豆子，不会被预览挡住。
      const { cells, hex } = editor.shapePreview;
      ctx[L.overlay].globalAlpha = 0.62;
      ctx[L.overlay].fillStyle = hex || "#e87325";
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const { x, y } of cells) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        const p = viewport.gridToScreen(x, y);
        ctx[L.overlay].fillRect(p.x, p.y, cell, cell);
      }
      ctx[L.overlay].globalAlpha = 1;
      if (hex && minX <= maxX) {
        const anchor = viewport.gridToScreen(minX, minY);
        ctx[L.overlay].strokeStyle = "#e87325"; ctx[L.overlay].lineWidth = 1.5;
        ctx[L.overlay].setLineDash([4, 3]);
        ctx[L.overlay].strokeRect(anchor.x, anchor.y, (maxX - minX + 1) * cell, (maxY - minY + 1) * cell);
        ctx[L.overlay].setLineDash([]);
      }
    }
    // 浮动文字图层。只画在 overlay 层、不写进 grid：所以拖动/调参过程中撤销栈是干净的，
    // 点「向下合并」才产生一步历史。用与合并完全相同的栅格化结果来画，
    // 保证「看到的格子」就是「合下去的格子」。
    if (editor.textLayers?.length) {
      for (const layer of editor.textLayers) {
        const { cells } = rasterizeTextCached(layer, gridWidth, gridHeight);
        if (!cells.length) continue;
        const hex = resolveColor(layer.color)?.hex || layer.color || "#e87325";
        const isActive = layer.id === editor.activeTextLayerId;
        ctx[L.overlay].globalAlpha = isActive ? 0.82 : 0.5;
        ctx[L.overlay].fillStyle = hex;
        for (const { x, y } of cells) {
          if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
          const p = viewport.gridToScreen(x, y);
          ctx[L.overlay].fillRect(p.x, p.y, cell, cell);
        }
        ctx[L.overlay].globalAlpha = 1;
        const box = cellsBox(cells);
        if (box && isActive) {
          const anchor = viewport.gridToScreen(box.x0, box.y0);
          ctx[L.overlay].strokeStyle = "#e87325";
          ctx[L.overlay].lineWidth = 1.5;
          ctx[L.overlay].setLineDash([4, 3]);
          ctx[L.overlay].strokeRect(anchor.x, anchor.y, box.width * cell, box.height * cell);
          ctx[L.overlay].setLineDash([]);
        }
      }
    }
    if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      document.body.dataset.canvasDrawMs = (performance.now() - startedAt).toFixed(2);
      document.body.dataset.canvasVisibleCells = String(Math.max(0, x1 - x0) * Math.max(0, y1 - y0));
    }
  };
  const requestDraw = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } };
  const observer = new ResizeObserver(requestDraw); observer.observe(container);
  return { layers, requestDraw, draw, getBufferSize: () => ({ width: layers[0].width, height: layers[0].height }), destroy: () => observer.disconnect() };
}
