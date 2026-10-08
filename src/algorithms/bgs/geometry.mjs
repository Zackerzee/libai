/**
 * BGS algorithm module — pure grid geometry and aspect-ratio policy.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0), src/core/geometry.js.
 *
 * Modified for libms-studio — two deliberate behavioural changes:
 *
 *  1. **No silent clamping.** Upstream `gridForLongSide` / `gridFromAspectAnchor`
 *     applied `clamp(value, minSide, maxSide)` to the user's long-side request and
 *     again to the resolved cols/rows. libms has an explicit rule against silently
 *     rewriting user-supplied canvas sizes (see docs/BLANK_BOARD_SIZE_FIX.md): the
 *     clamped result is the only feedback the user gets, so a clamp is
 *     indistinguishable from "the algorithm did something weird".
 *     These functions therefore return the *requested* geometry together with a
 *     `limits` record describing any out-of-range axis. The caller decides whether
 *     to reject, to accept, or to ask the user.
 *
 *  2. **`ratioLimited` is generalized** into `limits`, so callers can tell apart
 *     "minimum side hit", "maximum side hit", and "aspect ratio forced a change".
 */

import { BGS_CONFIG } from './config.mjs';
import { clamp } from './color-space.mjs';

const { minGridSide: MIN_SIDE, maxGridSide: MAX_SIDE } = BGS_CONFIG.limits;

function positiveInt(value, fallback = 1) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : fallback;
}

function buildLimits(cols, rows, requested) {
  const outOfRange = [];
  if (cols < MIN_SIDE) outOfRange.push({ axis: 'cols', value: cols, limit: MIN_SIDE, kind: 'belowMin' });
  if (rows < MIN_SIDE) outOfRange.push({ axis: 'rows', value: rows, limit: MIN_SIDE, kind: 'belowMin' });
  if (cols > MAX_SIDE) outOfRange.push({ axis: 'cols', value: cols, limit: MAX_SIDE, kind: 'aboveMax' });
  if (rows > MAX_SIDE) outOfRange.push({ axis: 'rows', value: rows, limit: MAX_SIDE, kind: 'aboveMax' });
  return {
    ok: outOfRange.length === 0,
    outOfRange,
    minSide: MIN_SIDE,
    maxSide: MAX_SIDE,
    requested: { ...requested },
  };
}

/**
 * Grid for a requested *long side*. "24 cells" means a 24-cell long side, not a
 * 24×24 square: a 5560×3992 source becomes 24×17.
 *
 * @returns {{cols:number, rows:number, minSideAdjusted:boolean, limits:object}}
 */
export function gridForLongSide(sourceWidth, sourceHeight, longSide) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const longest = positiveInt(longSide, 1);

  let cols;
  let rows;
  if (width >= height) {
    cols = longest;
    rows = Math.max(1, Math.round((longest * height) / width));
  } else {
    rows = longest;
    cols = Math.max(1, Math.round((longest * width) / height));
  }
  return {
    cols,
    rows,
    minSideAdjusted: false,
    limits: buildLimits(cols, rows, { longSide }),
  };
}

/**
 * Grid anchored on one explicit axis.
 *
 * @param {'cols'|'rows'} axis
 */
export function gridFromAspectAnchor(sourceWidth, sourceHeight, value, axis = 'cols') {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const anchor = positiveInt(value, 1);

  let cols = axis === 'rows' ? Math.round((anchor * width) / height) : anchor;
  let rows = axis === 'rows' ? anchor : Math.round((anchor * height) / width);
  cols = Math.max(1, cols);
  rows = Math.max(1, rows);

  return {
    cols,
    rows,
    minSideAdjusted: false,
    limits: buildLimits(cols, rows, { axis, value }),
  };
}

/**
 * EXIF orientation detection.
 *
 * Compares |log(decodedAspect / rawAspect)| against the swapped variant and reports
 * which one the decoder actually produced. Upstream returned the flag rather than
 * silently swapping, which is the behaviour we keep.
 */
export function orientedSourceDimensions(raw, decoded) {
  const rawWidth = Math.max(1, Number(raw?.width) || 1);
  const rawHeight = Math.max(1, Number(raw?.height) || 1);
  const decodedWidth = Math.max(1, Number(decoded?.width) || rawWidth);
  const decodedHeight = Math.max(1, Number(decoded?.height) || rawHeight);
  const decodedAspect = decodedWidth / decodedHeight;
  const normalError = Math.abs(Math.log(decodedAspect / (rawWidth / rawHeight)));
  const swappedError = Math.abs(Math.log(decodedAspect / (rawHeight / rawWidth)));
  return swappedError + 1e-6 < normalError
    ? { width: rawHeight, height: rawWidth, orientationSwapped: true }
    : { width: rawWidth, height: rawHeight, orientationSwapped: false };
}

/**
 * Disclose the cost of a fit choice instead of silently absorbing it.
 *
 * Upstream equivalent: `fitGeometryMetrics` (src/core/geometry.js:82–104).
 * `letterboxFraction` is how much of the target stays blank under `contain`;
 * `cropFraction` is how much of the source is discarded under `cover`.
 */
export function fitGeometryMetrics(sourceWidth, sourceHeight, cols, rows, fitMode = 'contain') {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const c = Math.max(1, positiveInt(cols));
  const r = Math.max(1, positiveInt(rows));

  const sourceAspect = sw / sh;
  const targetAspect = c / r;
  const usedFraction = Math.min(sourceAspect, targetAspect) / Math.max(sourceAspect, targetAspect);

  let contentCols = c;
  let contentRows = r;
  if (sourceAspect > targetAspect) contentRows = c / sourceAspect;
  else contentCols = r * sourceAspect;

  const mismatch = 1 - usedFraction;
  return {
    sourceAspect,
    targetAspect,
    mismatch,
    letterboxFraction: fitMode === 'contain' ? mismatch : 0,
    cropFraction: fitMode === 'cover' ? mismatch : 0,
    contentCols: fitMode === 'contain' ? contentCols : c,
    contentRows: fitMode === 'contain' ? contentRows : r,
  };
}

/**
 * Fit a compact pattern inside a real board, centered, without stretching.
 * Upstream src/core/geometry.js:106–130.
 */
export function fitPatternInsideBoard(sourceWidth, sourceHeight, boardCols, boardRows) {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const bc = Math.max(1, positiveInt(boardCols));
  const br = Math.max(1, positiveInt(boardRows));

  const scale = Math.min(bc / sw, br / sh);
  const cols = Math.min(bc, Math.max(1, Math.round(sw * scale)));
  const rows = Math.min(br, Math.max(1, Math.round(sh * scale)));
  const offsetX = Math.floor((bc - cols) / 2);
  const offsetY = Math.floor((br - rows) / 2);

  return {
    cols,
    rows,
    offsetX,
    offsetY,
    blankLeft: offsetX,
    blankRight: bc - cols - offsetX,
    blankTop: offsetY,
    blankBottom: br - rows - offsetY,
    aspectError: Math.abs(Math.log((cols / rows) / (sw / sh))),
  };
}

/**
 * Resolve the final grid size from options.
 *
 * `preserveAspectRatio: true` (default) derives the missing axis from the source
 * aspect. When both `width` and `height` are given and `preserveAspectRatio` is
 * true, the *smaller* derived change wins — i.e. width is authoritative and height
 * is recomputed, matching how libms's Inspector treats image-mode height as
 * read-only (see MEMORY: "图片模式下高度由原图比例决定").
 */
export function resolveGrid({ sourceWidth, sourceHeight, width, height, preserveAspectRatio = true }) {
  const hasWidth = Number.isFinite(Number(width)) && Number(width) >= 1;
  const hasHeight = Number.isFinite(Number(height)) && Number(height) >= 1;

  if (!hasWidth && !hasHeight) {
    throw new Error('bgs: options.width or options.height is required');
  }
  if (!preserveAspectRatio) {
    return {
      cols: positiveInt(hasWidth ? width : height),
      rows: positiveInt(hasHeight ? height : width),
      derived: 'none',
      limits: buildLimits(
        positiveInt(hasWidth ? width : height),
        positiveInt(hasHeight ? height : width),
        { width, height },
      ),
    };
  }
  if (hasWidth) {
    const grid = gridFromAspectAnchor(sourceWidth, sourceHeight, width, 'cols');
    return { ...grid, derived: 'rowsFromWidth' };
  }
  const grid = gridFromAspectAnchor(sourceWidth, sourceHeight, height, 'rows');
  return { ...grid, derived: 'colsFromHeight' };
}

export { MIN_SIDE, MAX_SIDE, clamp };
