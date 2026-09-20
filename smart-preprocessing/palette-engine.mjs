/**
 * libms.net Professional Palette Engine
 * Stage 3: deterministic Lab/CIEDE2000 matching with context-aware candidates.
 *
 * This module has no runtime dependencies so the existing static app can load it
 * as an optional enhancement. The caller still owns the palette and its codes.
 */

export const PALETTE_ENGINE_VERSION = "3.0.0-stage3";

const D65 = [0.95047, 1, 1.08883];
const DEFAULT_OPTIONS = Object.freeze({
  candidateCount: 7,
  cacheSize: 8192,
  cacheQuantization: 8,
  contextCorrectionWeight: 0.7,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function srgbToLinear(value) {
  const v = clamp(Number(value) / 255, 0, 1);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / D65[0];
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / D65[1];
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / D65[2];
  const f = (value) => (value > 0.008856451679 ? Math.cbrt(value) : 7.787037037 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)].map((value) => (Object.is(value, -0) ? 0 : value));
}

// CIEDE2000, deterministic and dependency-free.
export function deltaE2000(labA, labB) {
  const [l1, a1, b1] = labA;
  const [l2, a2, b2] = labB;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hp = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const angle = Math.atan2(b, a) * 180 / Math.PI;
    return angle >= 0 ? angle : angle + 360;
  };
  const hp1 = hp(ap1, b1);
  const hp2 = hp(ap2, b2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = hp2 - hp1;
  if (cp1 * cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(dh * Math.PI / 360);
  const lBar = (l1 + l2) / 2;
  const cPrimeBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 === 0) hBar = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hBar /= 2;
  else hBar = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  const t = 1 - 0.17 * Math.cos((hBar - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * hBar * Math.PI / 180)
    + 0.32 * Math.cos((3 * hBar + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * hBar - 63) * Math.PI / 180);
  const sl = 1 + 0.015 * (lBar - 50) ** 2 / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cPrimeBar;
  const sh = 1 + 0.015 * cPrimeBar * t;
  const rt = -2 * Math.sqrt(cPrimeBar ** 7 / (cPrimeBar ** 7 + 25 ** 7))
    * Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * Math.PI / 180);
  return Math.sqrt(
    (dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh),
  );
}

export function skinToneScore(rgb) {
  const [r, g, b] = rgb.map((value) => clamp(Number(value), 0, 255));
  const warm = r - b;
  const redLead = r - g;
  const range = Math.max(r, g, b) - Math.min(r, g, b);
  if (r < 55 || g < 25 || b < 15 || warm < 18 || redLead < 4 || range < 8) return 0;
  const hueFit = 1 - clamp(Math.abs((g - b) - 28) / 70, 0, 1);
  const lightFit = 1 - clamp(Math.abs((r + g + b) / 3 - 165) / 180, 0, 1);
  return clamp(hueFit * 0.65 + lightFit * 0.35, 0, 1);
}

export function isSkinTone(rgb) {
  return skinToneScore(rgb) >= 0.5;
}

function colorKey(rgb, context, quantization) {
  const bucket = rgb.map((value) => Math.round(clamp(value, 0, 255) / quantization));
  const region = context?.region || (context?.isBackground ? "background" : "default");
  const importance = Math.round(clamp(Number(context?.importance ?? 0.5), 0, 1) * 4);
  return `${bucket.join(",")}|${region}|${importance}|${context?.protected ? 1 : 0}`;
}

function candidatePenalty(sourceRgb, targetRgb, sourceLab, context, weight) {
  const sourceSkin = Math.max(skinToneScore(sourceRgb), context?.region === "skin" ? 0.8 : 0);
  const targetSkin = skinToneScore(targetRgb);
  const targetLab = rgbToLab(targetRgb);
  const hueDistance = Math.abs(sourceLab[2] - targetLab[2]);
  // Penalize green/cyan substitutions around skin while retaining nearby warm tones.
  const skinPenalty = (1 - targetSkin) * (7 + sourceSkin * 10);
  const huePenalty = clamp(hueDistance / 42, 0, 1) * 3;
  let penalty = (skinPenalty + huePenalty) * weight * sourceSkin;
  if (context?.region === "neutral") {
    const targetChroma = Math.hypot(targetLab[1], targetLab[2]);
    penalty += Math.max(0, targetChroma - 8) * 0.32 * weight;
  }
  if (context?.region === "warm-red") {
    const redLead = targetRgb[0] - Math.max(targetRgb[1], targetRgb[2]);
    penalty += Math.max(0, 18 - redLead) * 0.25 * weight;
  }
  return penalty;
}

export class PaletteEngine {
  constructor(palette, options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.palette = (Array.isArray(palette) ? palette : [])
      .filter((color) => color && color.available !== false && Array.isArray(color.rgb) && color.rgb.length >= 3)
      .map((color, index) => ({
        color,
        index,
        lab: Array.isArray(color.lab) ? color.lab : rgbToLab(color.rgb),
      }));
    this.cache = new Map();
    this.matchCount = 0;
    this.cacheHits = 0;
    this.paletteSignature = this.palette.map(({ color }) => color.code || color.hex || color.rgb.join(",")).join("|");
  }

  match(rgb, context = {}) {
    if (!this.palette.length) return null;
    const sourceRgb = rgb.map((value) => clamp(Number(value), 0, 255));
    const key = colorKey(sourceRgb, context, this.options.cacheQuantization);
    this.matchCount += 1;
    if (this.cache.has(key)) {
      this.cacheHits += 1;
      return this.cache.get(key).color;
    }
    const sourceLab = rgbToLab(sourceRgb);
    const candidates = this.palette
      .map((entry) => ({
        ...entry,
        distance: deltaE2000(sourceLab, entry.lab),
      }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, Math.max(1, this.options.candidateCount));
    const ranked = candidates
      .map((entry) => ({
        ...entry,
        score: entry.distance + candidatePenalty(
          sourceRgb,
          entry.color.rgb,
          sourceLab,
          context,
          this.options.contextCorrectionWeight,
        ),
      }))
      .sort((a, b) => a.score - b.score || a.index - b.index);
    const best = ranked[0];
    if (this.cache.size >= this.options.cacheSize) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, best);
    return best.color;
  }

  statistics(grid) {
    const colors = new Map();
    let total = 0;
    for (const row of grid || []) {
      for (const color of row || []) {
        if (!color) continue;
        total += 1;
        const code = color.code || color.hex;
        const entry = colors.get(code) || { ...color, count: 0 };
        entry.count += 1;
        colors.set(code, entry);
      }
    }
    const list = [...colors.values()].sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)));
    return { totalBeads: total, usedColors: list.length, colors: list };
  }

  reduceGrid(grid, options = {}) {
    const maxColors = Math.max(1, Number(options.maxColors || 0));
    if (!maxColors || maxColors >= new Set((grid || []).flat().filter(Boolean).map((color) => color.code)).size) {
      return { grid, changed: false, merges: [] };
    }
    const counts = new Map();
    for (const row of grid || []) for (const color of row || []) if (color) counts.set(color.code, (counts.get(color.code) || 0) + 1);
    const active = new Map();
    for (const row of grid || []) for (const color of row || []) if (color && !active.has(color.code)) active.set(color.code, color);
    const protectedCodes = new Set(options.protectedCodes || []);
    const width = grid[0]?.length || 0;
    const edgeWeight = new Map();
    const roles = new Map();
    const adjacency = new Map();
    for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < width; x += 1) {
      const code = grid[y]?.[x]?.code; if (!code) continue;
      edgeWeight.set(code, (edgeWeight.get(code) || 0) + Number(options.edgeMap?.[y * width + x] || 0));
      const role = options.semanticMap?.[y * width + x];
      if (role && !roles.has(code)) roles.set(code, role);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        const other = grid[ny]?.[nx]?.code; if (!other || other === code) continue;
        const key = [code, other].sort().join("|"); adjacency.set(key, (adjacency.get(key) || 0) + 1);
      }
    }
    const merges = [];
    while (active.size > maxColors) {
      const source = [...active.keys()]
        .filter((code) => !protectedCodes.has(code))
        .sort((a, b) => ((counts.get(a) || 0) + (edgeWeight.get(a) || 0) * 2.5) - ((counts.get(b) || 0) + (edgeWeight.get(b) || 0) * 2.5) || String(a).localeCompare(String(b)))[0];
      if (!source) break;
      const sourceColor = active.get(source);
      const sourceRole = roles.get(source);
      const sourceL = rgbToLab(sourceColor.rgb)[0];
      const target = [...active.entries()]
        .filter(([code]) => code !== source)
        .map(([code, color]) => {
          const distance = deltaE2000(rgbToLab(sourceColor.rgb), rgbToLab(color.rgb));
          const adjacent = adjacency.get([source, code].sort().join("|")) || 0;
          const rolePenalty = sourceRole && roles.get(code) && sourceRole !== roles.get(code) ? 7 : 0;
          const targetL = rgbToLab(color.rgb)[0];
          const darkPenalty = sourceL < 34 && targetL >= 42 ? (targetL - 34) * (Number(options.darkMergeStrength || 0) / 100) : 0;
          return { code, color, score: distance + rolePenalty + darkPenalty - Math.min(6, adjacent * 0.35) };
        })
        .sort((a, b) => a.score - b.score || String(a.code).localeCompare(String(b.code)))[0];
      if (!target) break;
      for (const row of grid) for (let x = 0; x < row.length; x += 1) if (row[x]?.code === source) row[x] = target.color;
      active.delete(source);
      counts.set(target.code, (counts.get(target.code) || 0) + (counts.get(source) || 0));
      merges.push({ from: source, to: target.code });
    }
    return { grid, changed: merges.length > 0, merges };
  }

  getReport() {
    return {
      version: PALETTE_ENGINE_VERSION,
      algorithm: "sRGB -> XYZ -> Lab -> CIEDE2000",
      candidateCount: this.options.candidateCount,
      cacheEnabled: true,
      cacheSize: this.cache.size,
      cacheHitRate: this.matchCount ? this.cacheHits / this.matchCount : 0,
      contextCorrection: true,
      skinToneProtect: true,
      adaptivePalette: true,
      faceColorProtect: true,
      backgroundMerge: true,
    };
  }
}

export function createPaletteEngine(palette, options = {}) {
  return new PaletteEngine(palette, options);
}

const browserApi = { PALETTE_ENGINE_VERSION, srgbToLinear, rgbToLab, deltaE2000, skinToneScore, isSkinTone, PaletteEngine, createPaletteEngine };
if (typeof window !== "undefined") window.LibmsPaletteEngine = browserApi;
