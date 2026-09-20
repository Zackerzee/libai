const defaults = {
  project: { id: null, name: "未命名作品" },
  source: { image: null, width: 0, height: 0 },
  canvas: { width: 50, height: 50, lockAspectRatio: false, beadSize: 2.6 },
  palette: { id: "mard-221", maxColors: 0, usedColors: 0 },
  generation: { engine: "v2.5", algorithm: "current", preset: "auto", sampling: "auto", detailProtection: 70, edgeProtection: 70, cleanupStrength: 50, preserveHighlights: true, preserveEyes: true, preserveMicroDetails: true, backgroundRemoval: false, brightness: 0, contrast: 0, saturation: 0 },
  view: { mode: "blocks", zoom: 1, panX: 0, panY: 0, showGrid: false, showCodes: false, codeVisibilityThreshold: 16 },
  reference: { url: "", opacity: 40, fit: "contain", visible: true },
  editor: { tool: "select", hoveredCell: null, selectedCell: null, selectedColor: null, highlightedColor: null, selection: null, paletteCategory: "all", recentColors: [], brushSize: 1, shapeFilled: false, wandTolerance: 12, shapePreview: null, clipboard: null, history: { canUndo: false, canRedo: false } },
  exportSettings: { type: "preview", preview: { showGrid: false, showCodes: false }, pattern: { showGrid: true, showCodes: true, showCoordinates: true } },
  stats: { totalBeads: 0, usedColors: 0, colors: [] },
  ui: { activePanel: "project", inspectorOpen: true, exportDrawerOpen: false },
  status: { generating: false, dirty: false, hasSource: false, hasPattern: false },
};

export function createProjectStore(seed = {}) {
  let state = Object.fromEntries(Object.entries(defaults).map(([name, value]) => [name, { ...value, ...(seed[name] || {}) }]));
  const listeners = new Set();
  return {
    getState: () => state,
    setState(patch) {
      const next = typeof patch === "function" ? patch(state) : patch;
      if (!next || typeof next !== "object") return state;
      state = { ...state, ...Object.fromEntries(Object.entries(next).map(([name, value]) => [name, value && typeof value === "object" && !Array.isArray(value) ? { ...state[name], ...value } : value])) };
      listeners.forEach((listener) => listener(state, next));
      return state;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export const projectStore = createProjectStore();
