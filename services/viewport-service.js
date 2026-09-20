export const BASE_CELL = 20;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
export const clampZoom = (zoom) => Math.max(0.25, Math.min(8, Number(zoom) || 1));

export function createViewportService(store, getSize) {
  const state = () => store.getState().view;
  const bounds = () => getSize();
  const origin = () => {
    const { viewportWidth, viewportHeight, gridWidth, gridHeight } = bounds();
    const view = state(), cell = BASE_CELL * view.zoom;
    return { x: viewportWidth / 2 + view.panX - gridWidth * cell / 2,
      y: viewportHeight / 2 + view.panY - gridHeight * cell / 2, cell };
  };
  const gridToScreen = (x, y) => { const o = origin(); return { x: o.x + x * o.cell, y: o.y + y * o.cell }; };
  const screenToGrid = (x, y) => {
    const o = origin(), { gridWidth, gridHeight } = bounds();
    const column = Math.floor((x - o.x) / o.cell), row = Math.floor((y - o.y) / o.cell);
    return column >= 0 && column < gridWidth && row >= 0 && row < gridHeight ? { x: column, y: row } : null;
  };
  // 形状拖拽需要「拖出画布仍继续跟随」，所以这里夹到网格边界而不是返回 null：
  // 否则一拖出边界预览就冻在最后一个格子上，手感很别扭。
  const screenToGridClamped = (x, y) => {
    const o = origin(), { gridWidth, gridHeight } = bounds();
    return { x: Math.max(0, Math.min(gridWidth - 1, Math.floor((x - o.x) / o.cell))),
      y: Math.max(0, Math.min(gridHeight - 1, Math.floor((y - o.y) / o.cell))) };
  };
  const setZoom = (zoom, point = null) => {
    const next = clampZoom(zoom), old = state().zoom;
    if (next === old) return;
    const b = bounds(), anchor = point || { x: b.viewportWidth / 2, y: b.viewportHeight / 2 };
    const before = origin(), gx = (anchor.x - before.x) / before.cell, gy = (anchor.y - before.y) / before.cell;
    const nextCell = BASE_CELL * next;
    store.setState({ view: { zoom: next,
      panX: anchor.x - b.viewportWidth / 2 - (gx - b.gridWidth / 2) * nextCell,
      panY: anchor.y - b.viewportHeight / 2 - (gy - b.gridHeight / 2) * nextCell } });
  };
  return {
    origin, gridToScreen, screenToGrid, screenToGridClamped, setZoom,
    zoomAroundPoint: setZoom,
    zoomIn() { setZoom(ZOOM_STEPS.find((value) => value > state().zoom + 0.001) || 8); },
    zoomOut() { setZoom([...ZOOM_STEPS].reverse().find((value) => value < state().zoom - 0.001) || 0.25); },
    fitToViewport() {
      const b = bounds(); if (!b.gridWidth || !b.gridHeight) return;
      const zoom = clampZoom(Math.min((b.viewportWidth - 64) / (b.gridWidth * BASE_CELL), (b.viewportHeight - 64) / (b.gridHeight * BASE_CELL)));
      store.setState({ view: { zoom, panX: 0, panY: 0 } });
    },
    resetZoom() { store.setState({ view: { zoom: 1, panX: 0, panY: 0 } }); },
    setPan(x, y) { store.setState({ view: { panX: x, panY: y } }); },
    panBy(dx, dy) { store.setState({ view: { panX: state().panX + dx, panY: state().panY + dy } }); },
  };
}

// Logarithmic slider gives precision around 100% without wasting most of the track above 400%.
export const zoomToSlider = (zoom) => Math.round(100 * Math.log(clampZoom(zoom) / 0.25) / Math.log(8 / 0.25));
export const sliderToZoom = (value) => clampZoom(0.25 * Math.pow(8 / 0.25, Number(value) / 100));
