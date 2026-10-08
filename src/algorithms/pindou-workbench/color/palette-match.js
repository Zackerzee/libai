/**
 * color/palette-match.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`findClosestBead(rgb, palette)`（app.js:68–80）
 *
 * ```js
 * function findClosestBead(rgb, palette) {
 *   let minDist = Infinity, closest = palette[0];
 *   for (const bead of palette) {
 *     if (bead.special === 'transparent') continue;   // 跳过透明豆
 *     const dist = colorDistance(rgb, hexToRgb(bead.hex));
 *     if (dist < minDist) { minDist = dist; closest = bead; }
 *   }
 *   return closest;
 * }
 * ```
 *
 * 保留的语义：**跳过 transparent 条目**、**严格小于 → 先到先得**（平票靠色板顺序）。
 * 补齐的能力：① 精确色缓存（上游每格都全量扫描）；② 返回位置/索引；
 * ③ 色板为空或全透明时不再静默返回 `palette[0]`，而是返回 `null` 由调用方处置。
 *
 * 第四阶段要求三档并存：
 *   `original-weighted-rgb` —— 上游原版，加权 RGB
 *   `lab`                  —— CIELAB 欧氏距离（即 ΔE76）
 *   `ciede2000`            —— CIEDE2000，与 libms `palette-engine.mjs` 同口径
 *
 * ⚠️ **色板方言纪律（bgs 批次踩过的坑）**
 *   上一批曾把 bgs `preparePalette()` 准备好的色板直接交给 libms 的生产引擎：
 *   bgs 把 **OKLab** 放进 `lab` 字段，而 libms `palette-engine.mjs:135` 直接采信
 *   `lab` 并按 **CIELAB** 语义使用 → 不报错，只是颜色悄悄错（实测 60 色→30 色）。
 *
 *   本模块因此**只借色彩函数，不借 prepared 色板**：
 *   从 `bgs/color-space.mjs` 引入 `rgbToCielab` / `deltaE2000` 两个纯函数，
 *   并在这里自己生成带**显式字段名**的条目（`cieLab` 就是 CIELAB、`oklab` 就是 OKLab），
 *   不存在「一个字段两种含义」的可能。
 */

import { PW_CONFIG, PALETTE_MATCH_MODE } from "../config.js";
import { rgbToCielab, deltaE2000, hexToRgb, rgbToHex, rgbToOklab } from "../../bgs/color-space.mjs";
import { weightedRgbDistance } from "./weighted-rgb.js";

export { PALETTE_MATCH_MODE };

/** 三档模式的元信息（量纲、来源）。 */
export const MATCH_MODE_INFO = Object.freeze({
  [PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB]: Object.freeze({
    label: "加权 RGB（上游原版）",
    unit: "加权欧氏距离",
    range: [0, 765],
    origin: "upstream-port",
    ref: "app.js:61–66",
  }),
  [PALETTE_MATCH_MODE.LAB]: Object.freeze({
    label: "CIELAB ΔE76",
    unit: "ΔE76",
    range: [0, 375],
    origin: "libms-fill",
    ref: "CIELAB D65",
  }),
  [PALETTE_MATCH_MODE.CIEDE2000]: Object.freeze({
    label: "CIEDE2000",
    unit: "ΔE2000",
    range: [0, 100],
    origin: "libms-fill",
    ref: "Sharma 参考实现",
  }),
});

const clampChannel = (value) => {
  const v = Math.round(Number(value));
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

/**
 * 规整色板。产出的每个条目都带**显式命名**的色彩字段。
 *
 * @param {Array<{code?:string,id?:string,name?:string,hex?:string,rgb?:number[],transparent?:boolean,special?:string}>} palette
 * @returns {Array<object>}
 */
export function preparePalette(palette) {
  if (!Array.isArray(palette) || !palette.length) {
    throw new Error("pindou-workbench: options.palette 必填，且不能是空数组");
  }
  return palette.map((entry, position) => {
    const rgb = Array.isArray(entry?.rgb) && entry.rgb.length >= 3
      ? [clampChannel(entry.rgb[0]), clampChannel(entry.rgb[1]), clampChannel(entry.rgb[2])]
      : hexToRgb(entry?.hex);
    if (!rgb) {
      throw new Error(`pindou-workbench: 色板第 ${position} 项既没有可用的 rgb 数组也没有 #RRGGBB hex`);
    }
    const code = entry?.code ?? entry?.id ?? `#${position}`;
    return {
      position,
      index: Number.isFinite(Number(entry?.index)) ? Number(entry.index) : position,
      code: String(code),
      name: entry?.name ?? String(code),
      hex: entry?.hex ?? rgbToHex(rgb),
      rgb,
      /** CIELAB（D65）。字段名写全，避免与 OKLab 混淆。 */
      cieLab: rgbToCielab(rgb),
      /** OKLab。仅供诊断，不参与本模块的匹配。 */
      oklab: rgbToOklab(rgb),
      /** 与上游 `special === 'transparent'` 对齐；同时接受 libms 的 `transparent` 布尔。 */
      transparent: entry?.transparent === true || entry?.isTransparent === true || entry?.special === "transparent",
      isGlitter: entry?.special === "glitter",
    };
  });
}

/**
 * 建一个色板匹配器。
 *
 * @param {Array} palette 原始色板（任意形状，会被 `preparePalette` 规整）
 * @param {{mode?:string, skipTransparent?:boolean, useCache?:boolean}} [options]
 * @returns {{
 *   mode:string, entries:Array, candidates:Array, size:number,
 *   match:(rgb:number[]) => ({position:number,index:number,code:string,distance:number,entry:object}|null),
 *   distanceFn:(a:number[],b:number[])=>number,
 *   entryOf:(positionOrIndex:number)=>object|undefined,
 *   positionByIndex:(index:number)=>number|undefined,
 *   positionByCode:(code:string)=>number|undefined,
 *   diagnostics:object
 * }}
 */
export function createPaletteMatcher(palette, options = {}) {
  const mode = Object.values(PALETTE_MATCH_MODE).includes(options.mode)
    ? options.mode
    : PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB;
  const skipTransparent = options.skipTransparent !== false;
  const useCache = options.useCache !== false;

  const entries = preparePalette(palette);
  const candidates = entries.filter((entry) => !(skipTransparent && entry.transparent));

  if (!candidates.length) {
    throw new Error("pindou-workbench: 色板中没有任何可匹配的颜色（全部被 transparent 跳过？）");
  }

  const positionByCodeMap = new Map();
  const positionByIndexMap = new Map();
  for (const entry of entries) {
    if (!positionByCodeMap.has(entry.code)) positionByCodeMap.set(entry.code, entry.position);
    if (!positionByIndexMap.has(entry.index)) positionByIndexMap.set(entry.index, entry.position);
  }

  const measure = buildMeasure(mode);
  const matchCache = useCache ? new Map() : null;

  function match(rgb) {
    const query = [clampChannel(rgb[0]), clampChannel(rgb[1]), clampChannel(rgb[2])];
    const key = (query[0] << 16) | (query[1] << 8) | query[2];
    if (matchCache) {
      const hit = matchCache.get(key);
      if (hit !== undefined) return hit;
    }

    let best = null;
    let bestDistance = Infinity;
    for (const entry of candidates) {
      const distance = measure(query, entry.rgb);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    const result = best === null
      ? null
      : { position: best.position, index: best.index, code: best.code, distance: bestDistance, entry: best };
    if (matchCache) matchCache.set(key, result);
    return result;
  }

  return {
    mode,
    entries,
    candidates,
    size: candidates.length,
    skippedTransparent: entries.length - candidates.length,
    match,
    measure,
    /** k-means 的分配度量；与 `measure` 同一个函数，供第三方量化器按名调用。 */
    distanceFn: measure,
    entryOf: (positionOrIndex) => {
      const byPosition = entries[positionOrIndex];
      if (byPosition) return byPosition;
      const position = positionByIndexMap.get(positionOrIndex);
      return position === undefined ? undefined : entries[position];
    },
    positionByIndex: (index) => positionByIndexMap.get(index),
    positionByCode: (code) => positionByCodeMap.get(code),
    isChromatic: (positionOrIndex) => {
      const entry = entries[positionOrIndex] || entries[positionByIndexMap.get(positionOrIndex)];
      if (!entry) return false;
      const [, a, b] = entry.cieLab;
      return Math.hypot(a, b) > 8;
    },
    diagnostics: {
      mode,
      modeLabel: MATCH_MODE_INFO[mode].label,
      paletteSize: entries.length,
      candidateCount: candidates.length,
      skippedTransparent: entries.length - candidates.length,
      matchCache: useCache,
    },
  };
}

/** 按模式选择度量函数。 */
function buildMeasure(mode) {
  if (mode === PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB) {
    // 上游口径。加权 RGB 本身很便宜，且量纲就是它自己，不需要任何缓存。
    return function upstreamWeightedRgb(a, b) {
      return weightedRgbDistance(a, b);
    };
  }

  // Lab 系度量：把「RGB → CIELAB」按 8bit 量化色记忆，避免 k-means 里重复转换。
  const labCache = new Map();
  const cieLabOf = (rgb) => {
    const r = clampChannel(rgb[0]);
    const g = clampChannel(rgb[1]);
    const b = clampChannel(rgb[2]);
    const key = (r << 16) | (g << 8) | b;
    const hit = labCache.get(key);
    if (hit !== undefined) return hit;
    const value = rgbToCielab([r, g, b]);
    labCache.set(key, value);
    return value;
  };

  if (mode === PALETTE_MATCH_MODE.LAB) {
    return function labDeltaE76(a, b) {
      const la = cieLabOf(a);
      const lb = cieLabOf(b);
      const dl = la[0] - lb[0];
      const da = la[1] - lb[1];
      const db = la[2] - lb[2];
      return Math.sqrt(dl * dl + da * da + db * db);
    };
  }

  return function ciede2000(a, b) {
    return deltaE2000(cieLabOf(a), cieLabOf(b));
  };
}

/** 度量上界，用于把不同模式的 ΔE 归一到同一标尺做并排展示。 */
export function metricRange(mode) {
  return (MATCH_MODE_INFO[mode] || MATCH_MODE_INFO[PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB]).range;
}

export const DEFAULT_PALETTE_MATCH = Object.freeze({
  mode: PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB,
  skipTransparent: true,
  useCache: true,
});


