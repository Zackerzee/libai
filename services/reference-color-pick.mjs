import { referenceLayout } from './reference-layer-service.js?v=20261012-reference-upload-r47';

export function imagePointAt(screen, layout) {
  if (!layout || !Number.isFinite(screen?.x) || !Number.isFinite(screen?.y)
    || !(layout.width > 0) || !(layout.height > 0)
    || screen.x < layout.x || screen.y < layout.y
    || screen.x >= layout.x + layout.width || screen.y >= layout.y + layout.height) return null;
  return { x: (screen.x - layout.x) / layout.width, y: (screen.y - layout.y) / layout.height };
}

/** Read the actual source pixel, not the composited/faded screen or bead cell. */
export function referencePointAt(screen, imageWidth, imageHeight, board, reference) {
  if (!imagePointAt(screen, board)) return null;
  return imagePointAt(screen, referenceLayout(imageWidth, imageHeight, board, reference));
}
