/**
 * BGS algorithm module — palette matching.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0).
 * Upstream: `nearestPalettePosition` closure at src/app.js:2069–2100, plus the
 * palette-classification preamble at src/app.js:1932–1948.
 *
 * Modified for libms-studio:
 *
 *  - **The 5-bit bucket LUT is gone** (ALGORITHM_AUDIT.md §K-2). Upstream cached
 *    cartoon/document matches in an `Int16Array(65536)` keyed on `r>>3`, then
 *    matched against the *bucket centre* `bucketR*8+3.5` rather than the true
 *    colour — up to ±4/255 of avoidable colour error, worst at bucket edges, and
 *    `forceNeutralOverride` shared the array via a hard-coded `+32768` offset that
 *    lands exactly on the last valid index. This module caches on the **exact**
 *    packed RGB in a size-capped Map and always matches the true colour, so results
 *    are strictly more accurate and remain deterministic.
 *
 *  - Everything else is faithful: exact-colour short circuit, OKLab top-N
 *    pre-filter, CIEDE2000 final decision, tie-break by ascending palette index.
 */

import { BGS_CONFIG } from './config.mjs';
import {
  rgbToOklab, rgbToCielab, oklabDistance, oklabChroma, deltaE2000,
  isVisiblyChromatic, isDarkChromatic, buildExactIndex, clamp,
} from './color-space.mjs';

const CACHE_CAP = 1 << 17; // 131 072 entries — bounded memory even on 4 MP inputs

/**
 * Build a matcher bound to one palette.
 *
 * @param {Array} palette prepared palette (see `preparePalette`)
 * @param {{protectDark?: boolean, preserveExactColors?: boolean, candidateCount?: number,
 *          whiteCode?: string, blackCode?: string}} options
 */
export function createMatcher(palette, options = {}) {
  if (!Array.isArray(palette) || !palette.length) throw new Error('bgs: createMatcher requires a prepared palette');

  const cfg = BGS_CONFIG.matcher;
  const protectDark = options.protectDark !== false;
  const preserveExactColors = options.preserveExactColors !== false;
  const candidateCount = Math.max(1, options.candidateCount ?? cfg.candidateCount);

  const exactIndex = buildExactIndex(palette);
  const chromatic = palette.map((entry) => isVisiblyChromatic(entry.rgb));

  /**
   * O(1) palette-index → array-position lookup. The cell grid stores the palette's
   * own `index` field, which is NOT the array position once transparent entries are
   * filtered out — upstream needed `palettePositionByIndex` for exactly this reason.
   */
  const positionByIndex = new Map();
  palette.forEach((entry, position) => {
    if (!positionByIndex.has(entry.index)) positionByIndex.set(entry.index, position);
  });
  const entryOf = (index) => {
    const position = positionByIndex.get(index);
    return position === undefined ? undefined : palette[position];
  };

  /**
   * Outline anchor: the darkest *neutral* palette colour. Neutral means "not
   * visibly chromatic", which is what keeps deep blue / brown from collapsing to
   * black when a whole cell votes for the outline colour.
   */
  let outlinePosition = chromatic.findIndex((value) => !value);
  if (outlinePosition < 0) outlinePosition = 0;
  for (let i = 0; i < palette.length; i++) {
    if (!chromatic[i] && palette[i].lab[0] < palette[outlinePosition].lab[0]) outlinePosition = i;
  }

  /**
   * White anchor: prefer the declared white code, else the brightest neutral.
   * Upstream hard-codes `'H2'`; libms palettes may use other codes so this is
   * configurable with the same default.
   */
  const whiteCode = options.whiteCode ?? 'H2';
  let whitePosition = palette.findIndex((entry) => entry.code === whiteCode);
  if (whitePosition < 0) {
    whitePosition = chromatic.findIndex((value) => !value);
    if (whitePosition < 0) whitePosition = 0;
    for (let i = 0; i < palette.length; i++) {
      if (!chromatic[i] && palette[i].lab[0] > palette[whitePosition].lab[0]) whitePosition = i;
    }
  }

  const blackCode = options.blackCode ?? 'H7';
  let blackPosition = palette.findIndex((entry) => entry.code === blackCode);
  if (blackPosition < 0) blackPosition = outlinePosition;

  const cache = new Map();
  let cacheOverflow = false;

  /** True when the colour should be confined to neutral palette entries. */
  const shouldForceNeutral = (r, g, b, lab, override) => {
    if (override) return true;
    if (!protectDark) return false;
    return lab[0] < cfg.protectDarkLightnessMax
      && oklabChroma(lab) < cfg.protectDarkChromaMax
      && !isDarkChromatic([r, g, b], lab[0]);
  };

  /**
   * Match one colour against the palette.
   * @returns {{position:number, entry:object, distance:number, neutral:boolean, exact:boolean}}
   */
  const match = (r, g, b, { forceNeutral = false } = {}) => {
    const cr = clamp(Math.round(r), 0, 255);
    const cg = clamp(Math.round(g), 0, 255);
    const cb = clamp(Math.round(b), 0, 255);
    const key = (cr << 16) | (cg << 8) | cb;

    if (preserveExactColors && !forceNeutral) {
      const exact = exactIndex.get(key);
      if (exact !== undefined) {
        const entry = palette[exact];
        return { position: exact, entry, distance: 0, neutral: !chromatic[exact], exact: true };
      }
    }

    const cacheKey = forceNeutral ? key + 0x1000000 : key;
    if (!forceNeutral && cache.has(cacheKey)) {
      const hit = cache.get(cacheKey);
      return { position: hit.position, entry: palette[hit.position], distance: hit.distance, neutral: hit.neutral, exact: false };
    }

    const lab = rgbToOklab([cr, cg, cb]);
    const cieLab = rgbToCielab([cr, cg, cb]);
    const neutral = shouldForceNeutral(cr, cg, cb, lab, forceNeutral);

    // Stage 1 — cheap OKLab neighbourhood, keep the best `candidateCount`.
    const candidates = [];
    for (let i = 0; i < palette.length; i++) {
      if (neutral && chromatic[i]) continue;
      const rough = oklabDistance(lab, palette[i].lab);
      let insertAt = candidates.length;
      while (insertAt > 0) {
        const prev = candidates[insertAt - 1];
        const prevRough = prev.rough;
        if (rough < prevRough - 1e-12
          || (Math.abs(rough - prevRough) < 1e-12 && palette[i].index < palette[prev.position].index)) insertAt--;
        else break;
      }
      if (insertAt < candidateCount) {
        candidates.splice(insertAt, 0, { position: i, rough });
        if (candidates.length > candidateCount) candidates.pop();
      }
    }

    // Stage 2 — full CIEDE2000 on the shortlist only.
    let choice = candidates[0]?.position ?? 0;
    let distance = Infinity;
    for (const candidate of candidates) {
      const i = candidate.position;
      const d = deltaE2000(cieLab, palette[i].cieLab);
      if (d < distance - 1e-12
        || (Math.abs(d - distance) < 1e-12 && palette[i].index < palette[choice].index)) {
        distance = d;
        choice = i;
      }
    }

    if (!cacheOverflow) {
      if (cache.size >= CACHE_CAP) cacheOverflow = true;
      else cache.set(cacheKey, { position: choice, distance, neutral });
    }

    return { position: choice, entry: palette[choice], distance, neutral, exact: false };
  };

  return {
    palette,
    chromatic,
    exactIndex,
    positionByIndex,
    entryOf,
    outlinePosition,
    whitePosition,
    blackPosition,
    match,
    /** Convenience for the sampling stage: match + return the palette position only. */
    matchPosition: (r, g, b, opts) => match(r, g, b, opts).position,
    stats: () => ({ cacheSize: cache.size, cacheOverflow }),
    isChromatic: (position) => chromatic[position],
    isNeutralColour: (position) => !chromatic[position],
    /** Chromatic test addressed by palette `index` rather than array position. */
    isChromaticIndex: (index) => {
      const position = positionByIndex.get(index);
      return position === undefined ? false : chromatic[position];
    },
    labOf: (index) => entryOf(index)?.lab ?? [0, 0, 0],
    cieLabOf: (index) => entryOf(index)?.cieLab ?? [0, 0, 0],
    chromaOf: (index) => oklabChroma(entryOf(index)?.lab ?? [0, 0, 0]),
  };
}

export default { createMatcher };
