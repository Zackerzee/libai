export const REGIONAL_BLOCK_V2_VERSION = "0.1.0-experimental";
export const RegionalBlockConfig = Object.freeze({ growDistance: 0.055, strongEdge: 0.38, flatTexture: 0.28, detailEdge: 0.48, maxIterations: 3, coherenceWeight: 0.12, colorWeight: 1, structuralWeight: 0.22 });
const key = (c) => c?.code || c?.hex || "";
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ns = (i, w, h) => { const x = i % w, y = Math.floor(i / w), out = []; if (x) out.push(i - 1); if (x + 1 < w) out.push(i + 1); if (y) out.push(i - w); if (y + 1 < h) out.push(i + w); return out; };
const rgbFromLab = (lab, oklabToRgb) => oklabToRgb(lab);

export function buildMacroRegions(sourceRgb, width, height, features, rgbToOKLab, config = RegionalBlockConfig) {
  const labs = sourceRgb.map((rgb) => rgb ? rgbToOKLab(rgb) : null); const ids = new Int32Array(labs.length); ids.fill(-1); const regions = [];
  for (let start = 0; start < labs.length; start += 1) {
    if (!labs[start] || ids[start] >= 0) continue;
    const id = regions.length, queue = [start], pixels = []; ids[start] = id; let mean = [...labs[start]];
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head]; pixels.push(i);
      for (const n of ns(i, width, height)) {
        if (!labs[n] || ids[n] >= 0) continue;
        const edge = Math.max(features.sourceEdgeMap[i], features.sourceEdgeMap[n]);
        const texture = Math.max(features.sourceTextureMap[i], features.sourceTextureMap[n]);
        const threshold = config.growDistance * (texture > config.flatTexture ? 0.65 : 1);
        if (edge > config.strongEdge || dist(mean, labs[n]) > threshold) continue;
        ids[n] = id; queue.push(n); mean = mean.map((value, c) => value + (labs[n][c] - value) / queue.length);
      }
    }
    regions.push({ id, pixels, mean, area: pixels.length, variance: pixels.reduce((sum, i) => sum + dist(labs[i], mean) ** 2, 0) / pixels.length,
      texture: pixels.reduce((sum, i) => sum + features.sourceTextureMap[i], 0) / pixels.length,
      edgeDensity: pixels.filter((i) => features.sourceEdgeMap[i] > config.strongEdge).length / pixels.length });
  }
  return { ids, regions, labs };
}

export function allocateRegionalPaletteBudget(region) {
  const complexity = Math.sqrt(region.variance) * 28 + region.texture * 2 + region.edgeDensity * 2 + Math.log2(region.area + 1) * 0.1;
  return Math.max(1, Math.min(5, Math.round(1 + complexity)));
}

function roleOf(l, centers) { if (centers.length === 1) return "BASE"; const k = centers.reduce((best, value, index) => Math.abs(l - value) < Math.abs(l - centers[best]) ? index : best, 0); return k === 0 ? "SHADOW" : k === centers.length - 1 ? "HIGHLIGHT" : "BASE"; }

export function posterizeSource(macro, features, width, height, oklabToRgb) {
  const result = new Array(width * height).fill(null); const roles = new Array(result.length).fill("BASE");
  const centersByRegion = new Map();
  for (const region of macro.regions) {
    const budget = allocateRegionalPaletteBudget(region);
    const sorted = region.pixels.map((i) => macro.labs[i][0]).sort((a, b) => a - b);
    const centers = Array.from({ length: budget }, (_, k) => sorted[Math.min(sorted.length - 1, Math.floor((k + 0.5) * sorted.length / budget))]);
    const representative = centers.map((L) => {
      const group = region.pixels.filter((i) => roleOf(macro.labs[i][0], centers) === roleOf(L, centers));
      return [0, 1, 2].map((channel) => group.length ? group.reduce((sum, i) => sum + macro.labs[i][channel], 0) / group.length : region.mean[channel]);
    });
    centersByRegion.set(region.id, { centers, representative, budget });
    region.pixels.forEach((i) => {
      const position = centers.reduce((best, value, k) => Math.abs(macro.labs[i][0] - value) < Math.abs(macro.labs[i][0] - centers[best]) ? k : best, 0);
      const protectedDetail = features.sourceEdgeMap[i] > RegionalBlockConfig.detailEdge;
      result[i] = protectedDetail ? oklabToRgb(macro.labs[i]) : rgbFromLab(representative[position], oklabToRgb);
      roles[i] = protectedDetail ? "DETAIL" : position === 0 && centers.length > 1 ? "SHADOW" : position === centers.length - 1 && centers.length > 1 ? "HIGHLIGHT" : "BASE";
    });
  }
  return { rgbGrid: result, roles, centersByRegion };
}

function mapPosterizedToBeads(posterized, macro, palette, rgbToOKLab) {
  const paletteLabs = palette.map((color, index) => ({ color, index, lab: rgbToOKLab(color.rgb) })); const matrix = new Array(posterized.rgbGrid.length).fill(null); const localPalettes = new Map();
  for (const region of macro.regions) {
    const { representative, budget } = posterized.centersByRegion.get(region.id);
    const primary = representative.map((lab) => paletteLabs.map((candidate) => ({ ...candidate, d: dist(lab, candidate.lab) })).sort((a, b) => a.d - b.d || a.index - b.index)[0].color);
    const unique = [...new Map(primary.map((color) => [key(color), color])).values()];
    localPalettes.set(region.id, { budget, primaryPalette: unique, secondaryPalette: [], protectedDetailPalette: [] });
    region.pixels.forEach((i) => {
      const lab = rgbToOKLab(posterized.rgbGrid[i]);
      const detail = posterized.roles[i] === "DETAIL";
      const candidateSet = detail ? paletteLabs : unique.map((color) => ({ color, lab: rgbToOKLab(color.rgb) }));
      matrix[i] = candidateSet.map((candidate) => ({ ...candidate, d: dist(lab, candidate.lab) })).sort((a, b) => a.d - b.d || key(a.color).localeCompare(key(b.color)))[0].color;
      if (detail && !unique.some((color) => key(color) === key(matrix[i]))) localPalettes.get(region.id).protectedDetailPalette.push(matrix[i]);
    });
  }
  return { matrix, localPalettes };
}

function localEnergy(i, candidate, matrix, macro, features, rgbToOKLab, config) {
  const sourceError = dist(rgbToOKLab(candidate.rgb), macro.labs[i]);
  let disagreement = 0, structural = 0;
  for (const n of ns(i, features.width, features.height)) {
    if (!matrix[n] || macro.ids[n] !== macro.ids[i]) continue;
    if (key(matrix[n]) === key(candidate)) continue;
    const texture = Math.max(features.sourceTextureMap[i], features.sourceTextureMap[n]);
    const edge = Math.max(features.sourceEdgeMap[i], features.sourceEdgeMap[n]);
    disagreement += config.coherenceWeight * (1 - texture) * (1 - edge);
    if (edge > config.strongEdge) structural += config.structuralWeight * edge;
  }
  return config.colorWeight * sourceError + disagreement + structural;
}

function consolidateBlocks(mapped, macro, features, rgbToOKLab, lockedMask, config) {
  const matrix = mapped.matrix; let changes = 0;
  for (let pass = 0; pass < config.maxIterations; pass += 1) {
    const next = matrix.slice(); let passChanges = 0;
    matrix.forEach((color, i) => {
      if (!color || lockedMask?.[i] || features.sourceEdgeMap[i] > config.detailEdge) return;
      const candidates = mapped.localPalettes.get(macro.ids[i])?.primaryPalette || [];
      const before = localEnergy(i, color, matrix, macro, features, rgbToOKLab, config);
      const best = candidates.map((candidate) => ({ candidate, energy: localEnergy(i, candidate, matrix, macro, features, rgbToOKLab, config) })).sort((a, b) => a.energy - b.energy || key(a.candidate).localeCompare(key(b.candidate)))[0];
      if (best && best.energy + 0.008 < before) { next[i] = best.candidate; passChanges += 1; }
    });
    if (!passChanges) break; next.forEach((color, i) => { matrix[i] = color; }); changes += passChanges;
  }
  return changes;
}

export function calculateRegionalBlockMetrics(grid, macro) {
  const matrix = grid.flat(), width = grid[0]?.length || 0, height = grid.length; let transitions = 0, filledPairs = 0, components = 0, perimeterRatio = 0; const paletteSizes = [];
  for (const region of macro.regions) {
    const colors = new Set(region.pixels.map((i) => key(matrix[i]))); paletteSizes.push(colors.size);
    const seen = new Set();
    region.pixels.forEach((start) => {
      if (seen.has(start) || !matrix[start]) return; components += 1; const queue = [start]; seen.add(start); let area = 0, perimeter = 0;
      for (let head = 0; head < queue.length; head += 1) {
        const i = queue[head]; area += 1;
        for (const n of ns(i, width, height)) {
          if (macro.ids[n] !== region.id || key(matrix[n]) !== key(matrix[i])) perimeter += 1;
          else if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
      perimeterRatio += perimeter / area;
    });
    region.pixels.forEach((i) => {
      for (const n of [i % width + 1 < width ? i + 1 : -1, i + width < matrix.length ? i + width : -1]) {
        if (n < 0 || macro.ids[n] !== region.id || !matrix[n]) continue; filledPairs += 1; if (key(matrix[i]) !== key(matrix[n])) transitions += 1;
      }
    });
  }
  return { colorCount: new Set(matrix.filter(Boolean).map(key)).size, regionalFragmentationScore: components / Math.max(1, matrix.filter(Boolean).length), averageComponentsPerColorPerRegion: components / Math.max(1, paletteSizes.reduce((a, b) => a + b, 0)), averagePerimeterArea: perimeterRatio / Math.max(1, components), colorTransitionDensity: transitions / Math.max(1, filledPairs), averageRegionalPaletteSize: paletteSizes.reduce((a, b) => a + b, 0) / Math.max(1, paletteSizes.length), macroRegionCount: macro.regions.length };
}

export function generateRegionalBlockV2(sourceRgb, width, height, palette, features, currentGrid, options) {
  const { rgbToOKLab, oklabToRgb, enforceMaxPaletteColors, maxColors, lockedMask } = options;
  const macro = buildMacroRegions(sourceRgb, width, height, features, rgbToOKLab);
  const posterized = posterizeSource(macro, features, width, height, oklabToRgb);
  const mapped = mapPosterizedToBeads(posterized, macro, palette, rgbToOKLab);
  const beforeGrid = Array.from({ length: height }, (_, y) => mapped.matrix.slice(y * width, (y + 1) * width));
  const before = calculateRegionalBlockMetrics(beforeGrid, macro);
  const consolidatedCells = consolidateBlocks(mapped, macro, features, rgbToOKLab, lockedMask, RegionalBlockConfig);
  const current = currentGrid.flat(); mapped.matrix.forEach((color, i) => { if (lockedMask?.[i]) mapped.matrix[i] = current[i]; });
  if (maxColors != null) enforceMaxPaletteColors(mapped.matrix, width, height, { maxColors, cells: sourceRgb.map((rgb) => rgb ? { rgb, oklab: rgbToOKLab(rgb) } : null), regionIds: macro.ids, lockedMask });
  const grid = Array.from({ length: height }, (_, y) => mapped.matrix.slice(y * width, (y + 1) * width));
  return { grid, posterizedRgbGrid: posterized.rgbGrid, beforeGrid, macro, localPalettes: mapped.localPalettes, report: { version: REGIONAL_BLOCK_V2_VERSION, consolidatedCells, before, after: calculateRegionalBlockMetrics(grid, macro), currentOnSameMacro: calculateRegionalBlockMetrics(currentGrid, macro) } };
}

const api = { REGIONAL_BLOCK_V2_VERSION, RegionalBlockConfig, buildMacroRegions, allocateRegionalPaletteBudget, posterizeSource, calculateRegionalBlockMetrics, generateRegionalBlockV2 };
if (typeof window !== "undefined") window.LibmsRegionalBlockV2 = api;
