import { BASE_CELL } from "../services/viewport-service.js?v=20260924-text";
import { textFrameControls } from './editor-interaction.mjs?v=20261010-editor-r31';
import { guideInterval, guideIndices, rulerEntries, gridGuideInk } from './grid-guides.mjs?v=20261010-guides-r40';
import { rasterizeTextCached, cellsBox } from "../services/text-layer-service.js?v=20261001-stage-a";
import { resolveScreenRenderPolicy } from "../smart-preprocessing/render-policy.mjs?v=20260928-v3";
import { paletteIdOf } from "../services/palette-identity.js";
import { selectionContains } from '../services/selection-service.js';
export function selectionBoundaryEdges(selection,x,y){
  if(!selectionContains(selection,x,y))return [];
  return [[0,-1,[x,y,x+1,y]],[1,0,[x+1,y,x+1,y+1]],[0,1,[x,y+1,x+1,y+1]],[-1,0,[x,y,x,y+1]]].filter(([dx,dy])=>!selectionContains(selection,x+dx,y+dy)).map(([, ,edge])=>edge);
}
import { symmetryBrushCells } from "../services/symmetry-service.js";
import { referenceLayout } from "../services/reference-layer-service.js";
import { currentInspectionIssue } from "../services/inspection-service.js";

// Diagnostics are not a selection: ordinary editing must not draw every issue.
// Explicitly enabling markers shows all; inspection shows only its current issue.
export function resolveDiagnosticOverlayIssues({ visible = false, issues = [], inspection = null } = {}) {
  if (visible) return issues;
  const current = inspection?.active ? currentInspectionIssue(inspection) : null;
  return current ? [current] : [];
}

export const codeForegroundColor = (rgb) => {
  if (!rgb) return "#17212b";
  const linear = rgb.map((n) => { const v = n / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] < 0.23 ? "#ffffff" : "#17212b";
};

// reference 必须排在 base 之下：底图垫在豆格下方，空豆处才透得出来。
const LAYER_NAMES = ["reference", "base", "grid", "codes", "overlay"];

export function drawCoordinateRulers(guide,viewport,{width,height,gridWidth,gridHeight,cell,dpr,interval,x0,x1,y0,y1}) {
  if(cell<10)return;
  const step=guideInterval(interval),origin=viewport.gridToScreen(0,0),far=viewport.gridToScreen(gridWidth,gridHeight);
  const digits=String(Math.max(gridWidth,gridHeight)).length;
  if(cell-2<digits*.55*4.5)return;
  const label=(entry,x,y)=>{
    guide.fillStyle=entry.major?'#d5d5df':'#f0f0f4';guide.fillRect(x,y,cell,cell);
    guide.strokeStyle='rgba(60,59,73,.15)';guide.lineWidth=.5/dpr;guide.strokeRect(x,y,cell,cell);
    const font=Math.min(32,Math.max(6,cell*(entry.major?.52:.4)),(cell-2)/(digits*.55));
    guide.font=`${entry.major?700:400} ${font}px system-ui`;guide.textAlign='center';guide.textBaseline='middle';guide.fillStyle='#55545e';
    guide.fillText(String(entry.number),x+cell/2,y+cell/2,cell-2);
  };
  guide.save();
  for(const entry of rulerEntries(x0,x1,gridWidth,cell,step)){const x=viewport.gridToScreen(entry.index,0).x;label(entry,x,origin.y-cell);label(entry,x,far.y);}
  for(const entry of rulerEntries(y0,y1,gridHeight,cell,step)){const y=viewport.gridToScreen(0,entry.index).y;label(entry,origin.x-cell,y);label(entry,far.x,y);}
  guide.restore();
}

export function createCanvasRenderer(container, viewport, getResult, getView, getEditor, getReference = () => null, resolveColor = () => null, getDiagnostics = () => [], getRepairPreview = () => null) {
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
  const drawReference = (ctx, settings, box) => {
    const image = referenceImage(settings.url || "");
    if (!image) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (Number(settings.opacity) || 0) / 100));
    ctx.imageSmoothingEnabled=settings.smoothing!=="pixelated";
    ctx.beginPath();ctx.rect(box.x,box.y,box.width,box.height);ctx.clip();
    const layout=referenceLayout(image.naturalWidth,image.naturalHeight,box,settings);if(layout)ctx.drawImage(image,layout.x,layout.y,layout.width,layout.height);
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
    const backgroundCss=typeof getComputedStyle==='function'?getComputedStyle(container).backgroundColor:'';
    const backgroundParts=backgroundCss.match(/[\d.]+/g)?.map(Number);
    const background=backgroundParts&&backgroundParts[3]!==0?backgroundParts.slice(0,3):[245,245,248];
    const displayPolicy = resolveScreenRenderPolicy({
      mode: view.mode, showCodes: view.showCodes, showGrid: view.showGrid,
      zoom: view.zoom, baseCell: BASE_CELL,
      codeThreshold: view.codeVisibilityThreshold, gridThreshold: 5,
    });
    if (view.mode === "original") {
      if (source) ctx[L.base].drawImage(source, o.x, o.y, gridWidth * cell, gridHeight * cell);
      if(view.showCoordinates)drawCoordinateRulers(ctx[L.grid],viewport,{...b,gridWidth,gridHeight,cell,interval:view.majorGridInterval,x0:Math.max(0,Math.floor(-o.x/cell)),x1:Math.min(gridWidth,Math.ceil((b.width-o.x)/cell)),y0:Math.max(0,Math.floor(-o.y/cell)),y1:Math.min(gridHeight,Math.ceil((b.height-o.y)/cell))});
      return;
    }
    // Final-grid image preview is independent of editing/inspection overlays.
    if (view.mode === "blocks") {
      const base = ctx[L.base];
      base.globalAlpha = 1;
      const left = Math.max(0, Math.floor(-o.x / cell)), right = Math.min(gridWidth, Math.ceil((b.width - o.x) / cell));
      const top = Math.max(0, Math.floor(-o.y / cell)), bottom = Math.min(gridHeight, Math.ceil((b.height - o.y) / cell));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const color = result.grid[y]?.[x];
        if (!color) continue;
        base.fillStyle = color.rgb ? `rgb(${color.rgb.join(",")})` : color.hex;
        base.fillRect(o.x + x * cell, o.y + y * cell, Math.ceil(cell), Math.ceil(cell));
      }
      if(view.showCoordinates)drawCoordinateRulers(ctx[L.grid],viewport,{...b,gridWidth,gridHeight,cell,interval:view.majorGridInterval,x0:left,x1:right,y0:top,y1:bottom});
      return;
    }
    if (ref?.displayMode!=="grid-only"&&ref?.visible !== false && ref?.url) {
      drawReference(ctx[L.reference], ref, { x: o.x, y: o.y, width: gridWidth * cell, height: gridHeight * cell, cell });
    }
    if(ref?.displayMode==="reference-only"&&ref?.visible!==false&&ref?.url)return;
    const x0 = Math.max(0, Math.floor(-o.x / cell)), x1 = Math.min(gridWidth, Math.ceil((b.width - o.x) / cell));
    const y0 = Math.max(0, Math.floor(-o.y / cell)), y1 = Math.min(gridHeight, Math.ceil((b.height - o.y) / cell));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const selectedForPreview=editor.selection?selectionContains(editor.selection,x,y):editor.previewSelectedCell?.x===x&&editor.previewSelectedCell?.y===y;
      const color = editor.colorHoverPreview&&selectedForPreview?editor.colorHoverPreview:result.grid[y]?.[x];
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
        ctx[L.grid].strokeStyle = gridGuideInk(view.mode==='beads'?null:color,background); ctx[L.grid].lineWidth = .75 / b.dpr;
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
    if(view.mode!=='blocks'&&(view.showMajorGrid||view.showCoordinates)){
      const guide=ctx[L.grid],step=guideInterval(view.majorGridInterval),origin=viewport.gridToScreen(0,0),far=viewport.gridToScreen(gridWidth,gridHeight);
      guide.save();
      if(view.showMajorGrid&&cell>=4){
        guide.lineWidth=1 / b.dpr;
        const segment=(x,y,vertical)=>{const p=viewport.gridToScreen(x,y);guide.beginPath();guide.strokeStyle=gridGuideInk(view.mode==='beads'?null:result.grid[Math.min(y,gridHeight-1)]?.[Math.min(x,gridWidth-1)],background,true);guide.moveTo(p.x,p.y);guide.lineTo(p.x+(vertical?0:cell),p.y+(vertical?cell:0));guide.stroke();};
        for(const x of guideIndices(x0,x1,step))for(let y=y0;y<y1;y++)segment(x,y,true);
        for(const y of guideIndices(y0,y1,step))for(let x=x0;x<x1;x++)segment(x,y,false);
      }
      if(view.showCoordinates){
        drawCoordinateRulers(guide,viewport,{...b,gridWidth,gridHeight,cell,interval:step,x0,x1,y0,y1});
      }
      guide.restore();
    }
    const outline = (cellPos, selected) => {
      if (!cellPos) return;
      const p = viewport.gridToScreen(cellPos.x, cellPos.y);
      ctx[L.overlay].strokeStyle = selected ? "#e87325" : "rgba(232,115,37,.55)";
      ctx[L.overlay].lineWidth = selected ? 2 : 1;
      ctx[L.overlay].strokeRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
    };
    if (editor.hoveredCell && ["brush","eraser"].includes(editor.tool)) {
      const overlay=ctx[L.overlay];
      overlay.save(); overlay.fillStyle=editor.tool==="eraser"?"rgba(220,68,55,.12)":"rgba(232,115,37,.14)";
      overlay.strokeStyle=editor.tool==="eraser"?"rgba(220,68,55,.78)":"rgba(232,115,37,.72)"; overlay.lineWidth=1;
      const axisX=Number.isFinite(editor.symmetryAxisX)?editor.symmetryAxisX:(gridWidth-1)/2;
      const axisY=Number.isFinite(editor.symmetryAxisY)?editor.symmetryAxisY:(gridHeight-1)/2;
      const previewCells=symmetryBrushCells([editor.hoveredCell],gridWidth,gridHeight,{size:editor.brushSize,shape:editor.brushShape||"square",symmetry:{mode:editor.symmetryMode||"none",axisX,axisY}});
      for(const {x,y} of previewCells){
        const p=viewport.gridToScreen(x,y); overlay.fillRect(p.x,p.y,cell,cell); overlay.strokeRect(p.x+.5,p.y+.5,Math.max(0,cell-1),Math.max(0,cell-1));
      }
      overlay.restore();
    } else outline(editor.hoveredCell, false);
    outline(editor.selectedCell, true);
    const diagnosticIssues = getDiagnostics() || [];
    if (diagnosticIssues.length) {
      const overlay = ctx[L.overlay]; overlay.save();
      for (const issue of diagnosticIssues) for (const diagnosticCell of issue.cells || []) {
        if (diagnosticCell.x < x0 || diagnosticCell.x >= x1 || diagnosticCell.y < y0 || diagnosticCell.y >= y1) continue;
        const p = viewport.gridToScreen(diagnosticCell.x, diagnosticCell.y);
        if (issue.type === "isolated-pixel") {
          overlay.fillStyle = "rgba(220, 68, 55, .72)";
          overlay.beginPath(); overlay.arc(p.x + cell * .78, p.y + cell * .22, Math.max(2,Math.min(5,cell*.13)),0,Math.PI*2); overlay.fill();
        } else if (issue.type === "edge-contamination") {
          overlay.strokeStyle = "rgba(220, 68, 55, .88)"; overlay.lineWidth = Math.max(1,Math.min(2,cell*.08));
          overlay.strokeRect(p.x + 1.5,p.y + 1.5,Math.max(0,cell-3),Math.max(0,cell-3));
        } else if (issue.type === "tiny-region") {
          overlay.strokeStyle = "rgba(138, 83, 181, .72)"; overlay.lineWidth = 1;
          overlay.setLineDash([Math.max(2,cell*.18),Math.max(2,cell*.12)]); overlay.strokeRect(p.x + 2,p.y + 2,Math.max(0,cell-4),Math.max(0,cell-4)); overlay.setLineDash([]);
        }
      }
      overlay.restore();
    }
    const repairPreview = getRepairPreview();
    if (repairPreview?.cells?.length) {
      const previewColor = resolveColor(repairPreview.targetPaletteId);
      if (previewColor) {
        const overlay = ctx[L.overlay]; overlay.save();
        overlay.globalAlpha = .72;
        overlay.fillStyle = previewColor.hex || `rgb(${previewColor.rgb.join(",")})`;
        overlay.strokeStyle = "rgba(255,255,255,.95)";
        overlay.lineWidth = Math.max(1, Math.min(2, cell * .08));
        for (const previewCell of repairPreview.cells) {
          if (previewCell.x < x0 || previewCell.x >= x1 || previewCell.y < y0 || previewCell.y >= y1) continue;
          const p = viewport.gridToScreen(previewCell.x, previewCell.y);
          overlay.fillRect(p.x, p.y, cell, cell);
          overlay.strokeRect(p.x + 1, p.y + 1, Math.max(0, cell - 2), Math.max(0, cell - 2));
        }
        overlay.restore();
      }
    }
    if (editor.outlinePreview?.cells?.length) {
      const previewColor=resolveColor(editor.outlinePreview.targetPaletteId);
      if(previewColor){const overlay=ctx[L.overlay];overlay.save();overlay.globalAlpha=.68;overlay.fillStyle=previewColor.hex||`rgb(${previewColor.rgb.join(",")})`;overlay.strokeStyle="rgba(255,255,255,.9)";overlay.lineWidth=1;
        for(const c of editor.outlinePreview.cells){if(c.x<x0||c.x>=x1||c.y<y0||c.y>=y1)continue;const p=viewport.gridToScreen(c.x,c.y);overlay.fillRect(p.x,p.y,cell,cell);overlay.strokeRect(p.x+.5,p.y+.5,Math.max(0,cell-1),Math.max(0,cell-1));}overlay.restore();}
    }
    const symmetryMode = editor.symmetryMode || "none";
    if (editor.symmetryGuideVisible !== false && symmetryMode !== "none") {
      const overlay = ctx[L.overlay];
      overlay.save();
      overlay.strokeStyle = "rgba(194, 70, 133, .82)";
      overlay.lineWidth = 1.5;
      overlay.setLineDash([7, 5]);
      if (["vertical","both"].includes(symmetryMode)) {
        const modelAxisX = Number.isFinite(editor.symmetryAxisX) ? editor.symmetryAxisX : (gridWidth - 1) / 2;
        const axisX = o.x + (modelAxisX + .5) * cell;
        overlay.beginPath(); overlay.moveTo(axisX, o.y); overlay.lineTo(axisX, o.y + gridHeight * cell); overlay.stroke();
      }
      if (["horizontal","both"].includes(symmetryMode)) {
        const modelAxisY = Number.isFinite(editor.symmetryAxisY) ? editor.symmetryAxisY : (gridHeight - 1) / 2;
        const axisY = o.y + (modelAxisY + .5) * cell;
        overlay.beginPath(); overlay.moveTo(o.x, axisY); overlay.lineTo(o.x + gridWidth * cell, axisY); overlay.stroke();
      }
      overlay.restore();
    }
    if (editor.selection) {
      const overlay=ctx[L.overlay];overlay.save();overlay.beginPath();
      if(editor.selection.kind==='lasso'){
        overlay.fillStyle='rgba(116,93,216,.22)';
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(selectionContains(editor.selection,x,y)){
          const p=viewport.gridToScreen(x,y);overlay.fillRect(p.x,p.y,cell,cell);
        }
      }
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(const [ax,ay,bx,by]of selectionBoundaryEdges(editor.selection,x,y)){
        const a=viewport.gridToScreen(ax,ay),b=viewport.gridToScreen(bx,by);overlay.moveTo(a.x,a.y);overlay.lineTo(b.x,b.y);
      }
      overlay.lineWidth=1;overlay.strokeStyle='#ffffff';overlay.stroke();
      overlay.lineWidth=1;overlay.strokeStyle='#242032';overlay.setLineDash([5,5]);overlay.lineDashOffset=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:-(performance.now()/300)%10;overlay.stroke();overlay.restore();
      if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches&&!selectionAnimationTimer)selectionAnimationTimer=setTimeout(()=>{selectionAnimationTimer=null;requestDraw();},100);
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
          const frame = textFrameControls(box, viewport), overlay = ctx[L.overlay];
          overlay.fillStyle = '#7560cf';
          overlay.fillRect(frame.resize.x - 6, frame.resize.y - 6, 12, 12);
          overlay.strokeStyle = '#fff'; overlay.lineWidth = 1;
          overlay.strokeRect(frame.resize.x - 6, frame.resize.y - 6, 12, 12);
          overlay.beginPath(); overlay.arc(frame.move.x, frame.move.y, 10, 0, Math.PI * 2); overlay.fill();
          overlay.fillStyle = '#fff'; overlay.font = '14px system-ui'; overlay.textAlign = 'center'; overlay.textBaseline = 'middle';
          overlay.fillText('✥', frame.move.x, frame.move.y);
        }
      }
    }
    if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      document.body.dataset.canvasDrawMs = (performance.now() - startedAt).toFixed(2);
      document.body.dataset.canvasVisibleCells = String(Math.max(0, x1 - x0) * Math.max(0, y1 - y0));
    }
  };
  let selectionAnimationTimer=null;
  const requestDraw = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } };
  const observer = new ResizeObserver(requestDraw); observer.observe(container);
  return { layers, requestDraw, draw, getBufferSize: () => ({ width: layers[0].width, height: layers[0].height }), destroy: () => {observer.disconnect();clearTimeout(selectionAnimationTimer);} };
}
