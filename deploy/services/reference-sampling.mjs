import { referenceLayout } from './reference-layer-service.js';

// point and box must share the renderer's CSS-pixel coordinate system. box.cell
// includes viewport zoom; box.x/y include its pan. Reuse renderer layout exactly.
export function referencePixelAt(point, imageWidth, imageHeight, box, settings = {}) {
  if (!point || !box || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth < 1 || imageHeight < 1) return null;
  if (point.x < box.x || point.y < box.y || point.x >= box.x + box.width || point.y >= box.y + box.height) return null;
  const layout = referenceLayout(imageWidth, imageHeight, box, settings);
  if (!layout || !Number.isFinite(layout.x) || !Number.isFinite(layout.y) || !(layout.width > 0) || !(layout.height > 0)) return null;
  const x = Math.floor((point.x - layout.x) / layout.width * imageWidth);
  const y = Math.floor((point.y - layout.y) / layout.height * imageHeight);
  return x >= 0 && y >= 0 && x < imageWidth && y < imageHeight ? {x,y} : null;
}

// Raw source RGBA, never display opacity or a composited artwork pixel.
// Transparent pixels have no material-color candidate. Partial alpha is retained.
export function sampleReferencePixel(imageData, pixel) {
  const {width,height,data} = imageData || {};
  if (!pixel || !data || !Number.isInteger(pixel.x) || !Number.isInteger(pixel.y) || pixel.x < 0 || pixel.y < 0 || pixel.x >= width || pixel.y >= height) return null;
  const index = (pixel.y * width + pixel.x) * 4;
  if (data.length < index + 4 || data[index + 3] === 0) return null;
  return {rgb: [data[index],data[index + 1],data[index + 2]], alpha: data[index + 3], x: pixel.x, y: pixel.y};
}
