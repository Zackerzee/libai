export const BASE_CELL = 20;
// 缩放下限必须低到「整幅图纸能落进窗口」。
// 180 豆 × 20px = 3600px，画布区宽 ~900px 时需要的适配缩放约 0.23——比原先的 0.25 还小，
// 于是 25% 的下限直接把「适配窗口」卡死：fitToViewport() 算出来 0.23 又被 clamp 回 0.25，
// 结果大图纸永远有一截露在窗口外。降到 2% 后，500 豆（10000px）在 250px 宽的窗口里也能完整显示。
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;
export const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
// 注意别写成 `Number(zoom) || 1`：0 是合法输入（滑块最左端），
// 用 `||` 会被当成「无效值」替换成 1，滑块拖到底反而跳到 100%。
export const clampZoom = (zoom) => {
  const value = Number(zoom);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(value) ? value : 1));
};

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
  // 连续格坐标（可含小数）。文字图层拖动要的是这个：取整交给栅格化那一步，
  // 手感才顺；不夹边界也不返回 null —— 拖出画布时文字应该继续跟着鼠标走。
  const screenToGridFloat = (x, y) => { const o = origin(); return { x: (x - o.x) / o.cell, y: (y - o.y) / o.cell }; };
  const focusCell = (x, y, options = {}) => {
    const b = bounds();
    if (!b.gridWidth || !b.gridHeight || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const column = Math.max(0, Math.min(b.gridWidth - 1, Math.floor(x)));
    const row = Math.max(0, Math.min(b.gridHeight - 1, Math.floor(y)));
    const o = origin();
    const centerX = o.x + (column + .5) * o.cell;
    const centerY = o.y + (row + .5) * o.cell;
    const marginRatio = Math.max(0, Math.min(.45, Number(options.margin ?? .15)));
    const marginX = Math.min(b.viewportWidth * marginRatio, Math.max(0, (b.viewportWidth - o.cell) / 2));
    const marginY = Math.min(b.viewportHeight * marginRatio, Math.max(0, (b.viewportHeight - o.cell) / 2));
    const safe = {
      left: marginX + o.cell / 2,
      right: b.viewportWidth - marginX - o.cell / 2,
      top: marginY + o.cell / 2,
      bottom: b.viewportHeight - marginY - o.cell / 2,
    };
    const alreadySafe = centerX >= safe.left && centerX <= safe.right && centerY >= safe.top && centerY <= safe.bottom;
    if (alreadySafe && !options.center) return false;
    const targetX = options.center ? b.viewportWidth / 2 : Math.max(safe.left, Math.min(safe.right, centerX));
    const targetY = options.center ? b.viewportHeight / 2 : Math.max(safe.top, Math.min(safe.bottom, centerY));
    if (Math.abs(targetX - centerX) < .01 && Math.abs(targetY - centerY) < .01) return false;
    store.setState({ view: {
      panX: state().panX + targetX - centerX,
      panY: state().panY + targetY - centerY,
    } });
    return true;
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
    origin, gridToScreen, screenToGrid, screenToGridClamped, screenToGridFloat, setZoom, focusCell,
    zoomAroundPoint: setZoom,
    zoomIn() { setZoom(ZOOM_STEPS.find((value) => value > state().zoom + 0.001) || MAX_ZOOM); },
    zoomOut() { setZoom([...ZOOM_STEPS].reverse().find((value) => value < state().zoom - 0.001) || MIN_ZOOM); },
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

// 对数滑块：2%–800% 跨度 400 倍，线性刻度会把 90% 的轨道浪费在 100% 以上，
// 低倍段（恰恰是「看整幅」最常用的区间）挤成几个像素，根本点不准。
export const zoomToSlider = (zoom) => Math.round(100 * Math.log(clampZoom(zoom) / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM));
export const sliderToZoom = (value) => clampZoom(MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, Number(value) / 100));
