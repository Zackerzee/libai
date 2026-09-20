export const CODE_VISIBILITY_CELL_PX = 14;

export const RENDER_PRESETS = Object.freeze({
  PREVIEW_CLEAN: Object.freeze({ showCodes: false, showGrid: false, showCoordinates: false, showLegend: false, showHeader: false, watermark: false, exportMode: "preview" }),
  ZOOM_DETAIL: Object.freeze({ showCodes: "auto", showGrid: true, showCoordinates: false, showLegend: false, showHeader: false, watermark: false, exportMode: "detail" }),
  PREVIEW_EXPORT: Object.freeze({ showCodes: false, showGrid: false, showCoordinates: false, showLegend: false, showHeader: false, watermark: false, exportMode: "preview-export" }),
  PATTERN_EXPORT: Object.freeze({ showCodes: true, showGrid: true, showCoordinates: true, showLegend: true, showHeader: true, watermark: true, exportMode: "pattern-export" }),
});

export function shouldShowBeadCode(zoom, cellSize) {
  return Number(zoom) * Number(cellSize) >= CODE_VISIBILITY_CELL_PX;
}

const api = { CODE_VISIBILITY_CELL_PX, RENDER_PRESETS, shouldShowBeadCode };
if (typeof window !== "undefined") window.LibmsRenderPolicy = api;

