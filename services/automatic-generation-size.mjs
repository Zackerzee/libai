import { deriveGenerationSize } from './generation-size.mjs';

export function isCurrentSizeSource(expectedRevision, currentRevision, expectedUrl, currentUrl) {
  return expectedRevision === currentRevision && expectedUrl === currentUrl;
}

/** Trim only fully transparent outer rows/columns. Opaque white and interior holes stay. */
export function transparentContentBounds({ width, height, data } = {}, { includeFull = false } = {}) {
  if (!width || !height || !data) return null;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0 || (!includeFull && x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1)) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Exact alpha scan with bounded scratch allocation, including very large original images. */
export async function transparentImageBounds(image, {
  tileSize = 512, createCanvas = () => document.createElement('canvas'),
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)),
} = {}) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!(width > 0 && height > 0)) return null;
  const side = Math.min(1024, Math.max(1, Math.floor(tileSize) || 512));
  const canvas = createCanvas();
  canvas.width = Math.min(side, width); canvas.height = Math.min(side, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let x0 = width, y0 = height, x1 = -1, y1 = -1, tiles = 0;
  for (let y = 0; y < height; y += side) for (let x = 0; x < width; x += side) {
    const w = Math.min(side, width - x), h = Math.min(side, height - y);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, w, h, 0, 0, w, h);
    const bounds = transparentContentBounds(context.getImageData(0, 0, w, h), { includeFull: true });
    if (bounds) {
      x0 = Math.min(x0, x + bounds.x); y0 = Math.min(y0, y + bounds.y);
      x1 = Math.max(x1, x + bounds.x + bounds.width - 1); y1 = Math.max(y1, y + bounds.y + bounds.height - 1);
    }
    if (++tiles % 16 === 0) await yieldTask();
  }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1)) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Bounded recommendation, not a grid detector: measure visible colour transitions. */
export function measureImageDetail(imageData) {
  const { width = 0, height = 0, data } = imageData || {};
  if (!data || width < 2 || height < 2) return 0;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 256));
  let edges = 0, comparisons = 0;
  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      const p = (y * width + x) * 4;
      for (const q of [p + step * 4, p + step * width * 4]) {
        if (data[p + 3] < 128 || data[q + 3] < 128) continue;
        comparisons += 1;
        if (Math.abs(data[p] - data[q]) + Math.abs(data[p + 1] - data[q + 1]) + Math.abs(data[p + 2] - data[q + 2]) >= 72) edges += 1;
      }
    }
  }
  return comparisons ? edges / comparisons : 0;
}

/** Preserve detected logical pixels up to existing 500-grid limit; otherwise recommend. */
export function recommendAutomaticSize({ width, height, multiple = 1, ratio = height / width, imageData } = {}) {
  if (!(width > 0 && height > 0 && ratio > 0 && Number.isFinite(ratio))) return null;
  if (Number.isInteger(multiple) && multiple > 1 && width % multiple === 0 && height % multiple === 0) {
    const edge = Math.max(width, height) / multiple;
    if (Math.min(width, height) / multiple >= 10 && edge <= 500) {
      return { ...deriveGenerationSize(edge, ratio), authority: 'pixel-multiple', source: `pixel-multiple:${multiple}` };
    }
  }
  const detail = measureImageDetail(imageData);
  const edge = detail >= 0.22 ? 208 : detail >= 0.07 ? 156 : 104;
  return { ...deriveGenerationSize(edge, ratio), authority: 'logical-heuristic', source: `automatic-detail:${edge}` };
}
