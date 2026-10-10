// Runtime input helpers; neither preferences nor gesture state belongs in a grid cell.
// Screen-space controls keep a usable target even when bead cells are zoomed out.
export function textFrameControls(box, viewport) {
  if (!box) return null;
  const anchor = viewport.gridToScreen(box.x0, box.y0), cell = viewport.origin().cell;
  const width = box.width * cell, height = box.height * cell;
  return { x: anchor.x, y: anchor.y, width, height,
    move: { x: anchor.x + width / 2, y: anchor.y - 16 },
    resize: { x: anchor.x + width, y: anchor.y + height } };
}
export function hitTextFrameControl(frame, point, radius = 12) {
  if (!frame) return null;
  for (const kind of ['resize', 'move']) {
    if (Math.hypot(point.x - frame[kind].x, point.y - frame[kind].y) <= radius) return kind;
  }
  return null;
}
export function resizedTextScale(scale, start, point, anchor) {
  const initial = Math.max(1, Math.hypot(start.x - anchor.x, start.y - anchor.y));
  return Math.max(20, Math.min(300, Math.round(scale * Math.hypot(point.x - anchor.x, point.y - anchor.y) / initial)));
}
export function touchPair(points) {
  const [a, b] = [...points];
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}
export function hueOf(rgb = [0, 0, 0]) {
  const [r,g,b] = rgb, max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  if (!d) return 360;
  return ((max === r ? (g-b)/d : max === g ? (b-r)/d+2 : (r-g)/d+4)*60+360)%360;
}
export function filterAndSortUsage(entries, { query = '', hue = false } = {}) {
  const needle = query.trim().toLowerCase();
  const result = entries.filter(entry => !needle || String(entry.code).toLowerCase().includes(needle));
  return hue ? result.sort((a,b) => hueOf(a.rgb)-hueOf(b.rgb) || String(a.code).localeCompare(String(b.code), undefined, {numeric:true})) : result;
}
export function readEditorPreference(key, fallback, storage = globalThis.localStorage) {
  try { const value = storage?.getItem(`libms.editor.${key}`); return value === null || value === undefined ? fallback : JSON.parse(value); } catch { return fallback; }
}
export function saveEditorPreference(key, value, storage = globalThis.localStorage) {
  try { storage?.setItem(`libms.editor.${key}`, JSON.stringify(value)); } catch { /* private mode does not disable editing */ }
}
