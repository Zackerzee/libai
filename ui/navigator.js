import { BASE_CELL } from "../services/viewport-service.js";

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function navigatorLayout(gridWidth, gridHeight, width, height, padding = 8) {
  if (!gridWidth || !gridHeight || !width || !height) return null;
  const scale = Math.min((width - padding * 2) / gridWidth, (height - padding * 2) / gridHeight);
  const drawWidth = gridWidth * scale, drawHeight = gridHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight, scale };
}

export function visibleGridRect(view, viewportWidth, viewportHeight, gridWidth, gridHeight) {
  const cell = BASE_CELL * view.zoom;
  const originX = viewportWidth / 2 + view.panX - gridWidth * cell / 2;
  const originY = viewportHeight / 2 + view.panY - gridHeight * cell / 2;
  const x0 = clamp((0 - originX) / cell, 0, gridWidth);
  const y0 = clamp((0 - originY) / cell, 0, gridHeight);
  const x1 = clamp((viewportWidth - originX) / cell, 0, gridWidth);
  const y1 = clamp((viewportHeight - originY) / cell, 0, gridHeight);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

export function createNavigatorThumbnailCache(render) {
  let key = null, value = null, renderCount = 0;
  return {
    get(nextKey, ...args) {
      if (nextKey !== key) { key = nextKey; value = render(...args); renderCount += 1; }
      return value;
    },
    invalidate() { key = null; value = null; },
    get renderCount() { return renderCount; },
  };
}

export function Navigator({ host, getResult, getView, getViewportSize, getGridRevision = () => 0, onNavigate }) {
  host.classList.add("ws-navigator");
  host.innerHTML = '<div class="ws-navigator-title">导航器</div><canvas aria-label="图纸导航缩略图"></canvas>';
  const canvas = host.querySelector("canvas");
  let pending = false;
  const thumbnailCache = createNavigatorThumbnailCache((result, layout, width, height, dpr) => {
    const bitmap = document.createElement("canvas");
    bitmap.width = Math.max(1, Math.round(width * dpr));
    bitmap.height = Math.max(1, Math.round(height * dpr));
    const ctx = bitmap.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f7f8f6";
    ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
    const pixel = Math.max(layout.scale, .7);
    (result.grid || []).forEach((row, y) => row.forEach((color, x) => {
      if (!color) return;
      ctx.fillStyle = color.hex || `rgb(${color.rgb.join(",")})`;
      ctx.fillRect(layout.x + x * layout.scale, layout.y + y * layout.scale, pixel, pixel);
    }));
    ctx.strokeStyle = "rgba(33, 48, 58, .28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(layout.x + .5, layout.y + .5, Math.max(0, layout.width - 1), Math.max(0, layout.height - 1));
    return bitmap;
  });

  const draw = () => {
    pending = false;
    const result = getResult(), view = getView();
    host.hidden = !(result?.width && result?.height);
    if (host.hidden) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const layout = navigatorLayout(result?.width, result?.height, width, height);
    if (!layout) return;
    const cacheKey = `${getGridRevision()}:${result.width}x${result.height}:${canvas.width}x${canvas.height}`;
    const thumbnail = thumbnailCache.get(cacheKey, result, layout, width, height, dpr);
    ctx.drawImage(thumbnail, 0, 0, width, height);
    const size = getViewportSize();
    const visible = visibleGridRect(view, size.width, size.height, result.width, result.height);
    ctx.fillStyle = "rgba(232, 115, 37, .11)";
    ctx.strokeStyle = "#e87325";
    ctx.lineWidth = 1.5;
    const vx = layout.x + visible.x * layout.scale, vy = layout.y + visible.y * layout.scale;
    const vw = visible.width * layout.scale, vh = visible.height * layout.scale;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeRect(vx, vy, vw, vh);
  };
  const requestDraw = () => { if (!pending) { pending = true; requestAnimationFrame(draw); } };
  const navigate = (event) => {
    const result = getResult();
    const rect = canvas.getBoundingClientRect();
    const layout = navigatorLayout(result?.width, result?.height, rect.width, rect.height);
    if (!layout) return;
    const x = clamp((event.clientX - rect.left - layout.x) / layout.scale, 0, result.width);
    const y = clamp((event.clientY - rect.top - layout.y) / layout.scale, 0, result.height);
    onNavigate(x, y);
    requestDraw();
  };
  canvas.addEventListener("pointerdown", (event) => { event.stopPropagation(); canvas.setPointerCapture(event.pointerId); navigate(event); });
  canvas.addEventListener("pointermove", (event) => { if (canvas.hasPointerCapture(event.pointerId)) { event.stopPropagation(); navigate(event); } });
  const observer = new ResizeObserver(requestDraw);
  observer.observe(canvas);
  return { requestDraw, draw, invalidateThumbnail: () => thumbnailCache.invalidate(), get thumbnailRenderCount() { return thumbnailCache.renderCount; }, destroy: () => observer.disconnect() };
}
