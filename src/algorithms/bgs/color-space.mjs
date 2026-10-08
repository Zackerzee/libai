/**
 * BGS algorithm module — color space conversions and perceptual distance.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0), consolidated from two
 * duplicate implementations found in the upstream source:
 *   - inline closures inside `convertPixels()` (src/app.js:1777–1807)
 *   - module-level helpers (src/app.js:638–688)
 *
 * Modified for libms-studio: single source of truth, no closure state, no DOM.
 * All functions are pure.
 *
 * Every function here survives the "pure function" test from ALGORITHM_AUDIT.md §H:
 * inputs are numbers/arrays, outputs are numbers/arrays, no global reads.
 */

import { BGS_CONFIG } from './config.mjs';

const SRGB_THRESHOLD = 0.04045;
const LAB_DELTA = 6 / 29;
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

export function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

/** sRGB channel (0–255) → linear-light (0–1). */
export function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= SRGB_THRESHOLD ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear-light (0–1) → sRGB channel (0–255). */
export function linearToSrgb(value) {
  const c = clamp01(value);
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}

/** Rec.709 luma on gamma-encoded sRGB, rounded to integer 0–255 (upstream behaviour). */
export function luminance255(r, g, b) {
  const { r: kr, g: kg, b: kb } = BGS_CONFIG.luminance;
  return Math.round(kr * r + kg * g + kb * b);
}

/** Alpha-composite a pixel over an opaque white background (upstream's un-premultiply). */
export function compositeOverWhite(r, g, b, alpha) {
  const a = clamp01(alpha);
  return [r * a + 255 * (1 - a), g * a + 255 * (1 - a), b * a + 255 * (1 - a)];
}

/** `#RRGGBB` → [r, g, b]. */
export function hexToRgb(hex) {
  const value = String(hex || '').replace(/^#/, '');
  if (value.length !== 6) return null;
  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed)) return null;
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

export function rgbToHex(rgb) {
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`.toUpperCase();
}

/* ─────────────────────────────────────────────────────────────
 * OKLab  (Björn Ottosson). Upstream src/app.js:1780–1786 / 643–658.
 * ───────────────────────────────────────────────────────────── */

export function rgbToOklab(rgb) {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Plain Euclidean distance in OKLab. Used for the cheap pre-filter stage. */
export function oklabDistance(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** OKLab chroma (distance from the neutral axis). */
export function oklabChroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

/* ─────────────────────────────────────────────────────────────
 * CIELAB D65. Upstream src/app.js:1788–1793 / 660–669.
 * ───────────────────────────────────────────────────────────── */

export function rgbToCielab(rgb) {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (value) => (value > LAB_EPSILON ? Math.cbrt(value) : (LAB_KAPPA * value + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export { LAB_DELTA };

/* ─────────────────────────────────────────────────────────────
 * CIEDE2000. Upstream src/app.js:1794–1807 / 671–688.
 * Kept bit-for-bit compatible with upstream so A/B results are comparable.
 * ───────────────────────────────────────────────────────────── */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const POW25_7 = Math.pow(25, 7);

export function deltaE2000(first, second) {
  const l1 = first[0];
  const a1 = first[1];
  const b1 = first[2];
  const l2 = second[0];
  const a2 = second[1];
  const b2 = second[2];

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW25_7)));

  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);

  const hue = (b, a) => {
    const value = Math.atan2(b, a) * DEG;
    return value < 0 ? value + 360 : value;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * RAD) / 2);

  const lBar = (l1 + l2) / 2;
  const cBarp = (c1p + c2p) / 2;
  let hBar = h1p + h2p;
  if (c1p * c2p !== 0) {
    hBar = Math.abs(h1p - h2p) <= 180
      ? (h1p + h2p) / 2
      : (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2);
  }

  const t = 1
    - 0.17 * Math.cos((hBar - 30) * RAD)
    + 0.24 * Math.cos(2 * hBar * RAD)
    + 0.32 * Math.cos((3 * hBar + 6) * RAD)
    - 0.20 * Math.cos((4 * hBar - 63) * RAD);

  const deltaTheta = 30 * Math.exp(-1 * Math.pow((hBar - 275) / 25, 2));
  const cBarp7 = Math.pow(cBarp, 7);
  const rc = 2 * Math.sqrt(cBarp7 / (cBarp7 + POW25_7));

  const sl = 1 + (0.015 * Math.pow(lBar - 50, 2)) / Math.sqrt(20 + Math.pow(lBar - 50, 2));
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(2 * deltaTheta * RAD) * rc;

  const dl = dLp / sl;
  const dc = dCp / sc;
  const dh = dHp / sh;
  return Math.sqrt(Math.max(0, dl * dl + dc * dc + dh * dh + rt * dc * dh));
}

/* ─────────────────────────────────────────────────────────────
 * 可见色相 / 深色判定。Upstream src/app.js:1922–1931.
 * ───────────────────────────────────────────────────────────── */

export function isVisiblyChromatic(rgb) {
  const cfg = BGS_CONFIG.chromatic;
  const maximum = Math.max(rgb[0], rgb[1], rgb[2]);
  const spread = maximum - Math.min(rgb[0], rgb[1], rgb[2]);
  return spread >= cfg.spreadMin && spread / Math.max(1, maximum) >= cfg.spreadRatioMin;
}

/**
 * Deep near-black pixels are often tinted blue/grey by white balance and JPEG
 * compression. This is a *stricter* chromatic test used only for palette
 * classification, so that true deep blue / brown are not flattened to black.
 */
export function isDarkChromatic(rgb, lightness) {
  const cfg = BGS_CONFIG.chromatic;
  const maximum = Math.max(rgb[0], rgb[1], rgb[2]);
  const spread = maximum - Math.min(rgb[0], rgb[1], rgb[2]);
  const relative = spread / Math.max(1, maximum);
  return isVisiblyChromatic(rgb)
    && (lightness < cfg.darkLightnessMax || (spread >= cfg.darkSpreadMin && relative >= cfg.darkSpreadRatioMin));
}

/* ─────────────────────────────────────────────────────────────
 * Otsu threshold. Upstream src/app.js:1898–1918.
 * ───────────────────────────────────────────────────────────── */

/**
 * Otsu's method over a 256-bin histogram.
 *
 * NOTE (libms correction, mirrors the fix already applied in `legend-text-parse.js`):
 * a perfectly bimodal histogram makes the between-class variance plateau, and the
 * upstream loop keeps the *first* maximum, which lands on the valley floor. libms
 * returns the midpoint of the degenerate plateau instead. `flatPlateau` is reported
 * in the result so callers can tell which path was taken.
 */
export function otsuThreshold(histogram, total) {
  if (!total) return null;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let leftWeight = 0;
  let leftSum = 0;
  let maxVariance = -1;
  let bestLow = 0;
  let bestHigh = 0;

  for (let i = 0; i < 255; i++) {
    leftWeight += histogram[i];
    if (!leftWeight) continue;
    const rightWeight = total - leftWeight;
    if (!rightWeight) break;
    leftSum += i * histogram[i];
    const leftMean = leftSum / leftWeight;
    const rightMean = (sum - leftSum) / rightWeight;
    const variance = leftWeight * rightWeight * (leftMean - rightMean) * (leftMean - rightMean);
    if (variance > maxVariance + 1e-9) {
      maxVariance = variance;
      bestLow = i;
      bestHigh = i;
    } else if (maxVariance > 0 && Math.abs(variance - maxVariance) <= 1e-9) {
      bestHigh = i;
    }
  }

  const flatPlateau = bestHigh > bestLow;
  const threshold = flatPlateau ? Math.floor((bestLow + bestHigh) / 2) : bestLow;
  return { threshold, flatPlateau, low: bestLow, high: bestHigh };
}

/* ─────────────────────────────────────────────────────────────
 * 调色板预处理
 * ───────────────────────────────────────────────────────────── */

/**
 * Normalize a caller-supplied palette into the shape the matcher needs.
 *
 * The upstream implementation mutated the palette in place at module load
 * (`PALETTE.forEach(color => { color.rgb = ...; color.lab = ...; color.cieLab = ... })`).
 * Because `convertPixels` only *reads* those three fields, a palette without them
 * silently degrades to `candidate.rough * 100` instead of throwing. This module
 * always derives them here, so that failure mode cannot occur.
 *
 * @param {Array<{code?:string,id?:string,name?:string,hex?:string,rgb?:number[]}>} palette
 * @returns {Array<{position:number,index:number,code:string,name:string,hex:string,rgb:number[],lab:number[],cieLab:number[],transparent:boolean}>}
 */
export function preparePalette(palette) {
  if (!Array.isArray(palette) || !palette.length) {
    throw new Error('bgs: options.palette is required and must be a non-empty array');
  }
  return palette.map((entry, position) => {
    const rgb = Array.isArray(entry?.rgb) && entry.rgb.length >= 3
      ? [clamp(Math.round(entry.rgb[0]), 0, 255), clamp(Math.round(entry.rgb[1]), 0, 255), clamp(Math.round(entry.rgb[2]), 0, 255)]
      : hexToRgb(entry?.hex);
    if (!rgb) {
      throw new Error(`bgs: palette entry #${position} has neither a usable rgb array nor a #RRGGBB hex`);
    }
    // `index` is what upstream writes into the grid; if the caller did not supply
    // one we fall back to the array position.
    const index = Number.isFinite(Number(entry?.index)) ? Number(entry.index) : position;
    const code = entry?.code ?? entry?.id ?? `#${position}`;
    return {
      position,
      index,
      code: String(code),
      name: entry?.name ?? String(code),
      hex: entry?.hex ?? rgbToHex(rgb),
      rgb,
      lab: rgbToOklab(rgb),
      cieLab: rgbToCielab(rgb),
      transparent: entry?.transparent === true || entry?.isTransparent === true,
    };
  });
}

/** Exact `(r<<16)|(g<<8)|b` → palette position. Upstream src/app.js:1934–1935. */
export function buildExactIndex(palette) {
  const map = new Map();
  for (const entry of palette) {
    const key = (entry.rgb[0] << 16) | (entry.rgb[1] << 8) | entry.rgb[2];
    if (!map.has(key)) map.set(key, entry.position);
  }
  return map;
}
