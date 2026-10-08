export const REGION_AWARE_VERSION = "1.3.0-contour-aware";
export const LEGACY_NEAREST = "legacy_nearest";
export const REGION_AWARE = "region_aware";
export const RegionAwareConfig = Object.freeze({ simplificationStrength: 60, detailProtection: "standard", regionGrowThreshold: 0.075, mergeThreshold: 0.34, edgeWeight: 0.30, colorWeight: 0.45, varianceWeight: 0.20, spatialWeight: 0.05, smallIslandSize: 3, paletteComplexityWeight: 0.8, fragmentationWeight: 0.7, regionConsistencyWeight: 0.8, structuralContinuityWeight: 0.65, candidatePaletteK: 5 });
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const keyOf = (c) => c?.code || c?.hex || "";
const colorLab = (color) => rgbToOKLab(color.rgb);

export function rgbToOKLab(rgb) {
  const linear = rgb.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const l = 0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2];
  const m = 0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2];
  const s = 0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2];
  const l3 = Math.cbrt(l); const m3 = Math.cbrt(m); const s3 = Math.cbrt(s);
  return [0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3, 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3, 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3];
}
export const oklabDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function oklabToRgb(lab) {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]; const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]; const s_ = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2];
  const l = l_ ** 3; const m = m_ ** 3; const s = s_ ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return linear.map((value) => Math.round(clamp(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055), 0, 255)));
}

export function presetForGridSize(width, height, overrides = {}) {
  const side = Math.max(width, height); const scale = side <= 52 ? 1.25 : side <= 78 ? 1.12 : side <= 104 ? 1 : 0.78;
  const strength = clamp(Number(overrides.simplificationStrength ?? RegionAwareConfig.simplificationStrength) / 100);
  const strengthScale = 0.72 + strength * 0.48;
  return { ...RegionAwareConfig, regionGrowThreshold: RegionAwareConfig.regionGrowThreshold * scale * strengthScale, mergeThreshold: RegionAwareConfig.mergeThreshold * scale * strengthScale, smallIslandSize: side <= 52 ? 2 : side <= 104 ? 3 : 4, ...overrides };
}

export function buildGridEdgeMap(cells, width, height, config = RegionAwareConfig) {
  const map = new Float32Array(width * height);
  for (let y = 1; y + 1 < height; y += 1) for (let x = 1; x + 1 < width; x += 1) {
    const i = y * width + x; const l = cells[i - 1]?.oklab; const r = cells[i + 1]?.oklab; const u = cells[i - width]?.oklab; const d = cells[i + width]?.oklab;
    if (!l || !r || !u || !d) { map[i] = 1; continue; }
    const lum = Math.hypot(r[0] - l[0], d[0] - u[0]);
    const chroma = Math.hypot(r[1] - l[1], r[2] - l[2], d[1] - u[1], d[2] - u[2]);
    map[i] = clamp(lum * 2.8 * 0.6 + chroma * 3.2 * 0.4);
  }
  return map;
}

function neighborsOf(index, width, height) {
  const x = index % width; const y = Math.floor(index / width); const result = [];
  if (y > 0) result.push(index - width); if (x > 0) result.push(index - 1);
  if (x + 1 < width) result.push(index + 1); if (y + 1 < height) result.push(index + width);
  return result;
}

export function buildBoundaryRings(cells, width, height, maxRing = 2) {
  const rings = new Int8Array(cells.length); rings.fill(-1); const queue = []; const externalEmpty = new Uint8Array(cells.length); const emptyQueue = [];
  const pushEmpty = (index) => { if (index >= 0 && index < cells.length && !cells[index] && !externalEmpty[index]) { externalEmpty[index] = 1; emptyQueue.push(index); } };
  for (let x = 0; x < width; x += 1) { pushEmpty(x); pushEmpty((height - 1) * width + x); }
  for (let y = 1; y + 1 < height; y += 1) { pushEmpty(y * width); pushEmpty(y * width + width - 1); }
  for (let head = 0; head < emptyQueue.length; head += 1) for (const n of neighborsOf(emptyQueue[head], width, height)) pushEmpty(n);
  cells.forEach((cell, index) => {
    if (!cell) return;
    const x = index % width; const y = Math.floor(index / width);
    if (x === 0 || y === 0 || x + 1 === width || y + 1 === height || neighborsOf(index, width, height).some((n) => externalEmpty[n])) { rings[index] = 0; queue.push(index); }
  });
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]; if (rings[index] >= maxRing) continue;
    for (const neighbor of neighborsOf(index, width, height)) if (cells[neighbor] && rings[neighbor] < 0) { rings[neighbor] = rings[index] + 1; queue.push(neighbor); }
  }
  return rings;
}

function buildBoundaryComponents(cells, rings, width, height) {
  const seen = new Uint8Array(cells.length); const components = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || rings[start] !== 0 || seen[start]) continue;
    const pixels = []; const queue = [start]; seen[start] = 1;
    for (let head = 0; head < queue.length; head += 1) { const i = queue[head]; pixels.push(i); for (const n of neighborsOf(i, width, height)) if (cells[n] && rings[n] === 0 && !seen[n]) { seen[n] = 1; queue.push(n); } }
    components.push(pixels);
  }
  return components;
}

export function contourBandWidthForGrid(width, height) {
  const side = Math.max(width, height);
  return side <= 78 ? 2 : side <= 130 ? 3 : Math.min(6, Math.max(3, Math.round(side / 52)));
}

function eightNeighbors(index, width, height) {
  const x = index % width; const y = Math.floor(index / width); const result = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    if (!dx && !dy) continue; const nx = x + dx; const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) result.push(ny * width + nx);
  }
  return result;
}

function orderContour(component, width, height) {
  const remaining = new Set(component); const start = component.slice().sort((a, b) => Math.floor(a / width) - Math.floor(b / width) || a % width - b % width)[0];
  const sequence = [start]; remaining.delete(start); let previous = -1; let current = start;
  while (remaining.size) {
    let candidates = eightNeighbors(current, width, height).filter((index) => remaining.has(index));
    if (!candidates.length) {
      const cx = current % width; const cy = Math.floor(current / width);
      candidates = [...remaining].sort((a, b) => Math.hypot(a % width - cx, Math.floor(a / width) - cy) - Math.hypot(b % width - cx, Math.floor(b / width) - cy) || a - b).slice(0, 1);
    }
    const px = previous < 0 ? current % width - 1 : previous % width; const py = previous < 0 ? Math.floor(current / width) : Math.floor(previous / width);
    const dx = current % width - px; const dy = Math.floor(current / width) - py;
    candidates.sort((a, b) => {
      const turnA = Math.abs(Math.atan2((Math.floor(a / width) - Math.floor(current / width)) * dx - (a % width - current % width) * dy, (a % width - current % width) * dx + (Math.floor(a / width) - Math.floor(current / width)) * dy));
      const turnB = Math.abs(Math.atan2((Math.floor(b / width) - Math.floor(current / width)) * dx - (b % width - current % width) * dy, (b % width - current % width) * dx + (Math.floor(b / width) - Math.floor(current / width)) * dy));
      return turnA - turnB || a - b;
    });
    previous = current; current = candidates[0]; sequence.push(current); remaining.delete(current);
  }
  return sequence;
}

function weightedMedian(values) {
  const sorted = values.slice().sort((a, b) => a.value - b.value); const total = sorted.reduce((sum, item) => sum + item.weight, 0); let cumulative = 0;
  for (const item of sorted) { cumulative += item.weight; if (cumulative >= total / 2) return item.value; }
  return sorted.at(-1)?.value || 0;
}

function interiorReferenceFor(index, cells, rings, width, height, bandWidth) {
  const x = index % width; const y = Math.floor(index / width); let outwardX = 0; let outwardY = 0;
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    if (!dx && !dy) continue; const nx = x + dx; const ny = y + dy; const outside = nx < 0 || ny < 0 || nx >= width || ny >= height || !cells[ny * width + nx];
    if (outside) { outwardX += dx; outwardY += dy; }
  }
  const length = Math.hypot(outwardX, outwardY); const samples = [];
  if (length > 0) {
    const inwardX = -outwardX / length; const inwardY = -outwardY / length;
    [0.5, 0.3, 0.2].slice(0, bandWidth).forEach((weight, offset) => {
      const step = offset + 1; const sx = Math.round(x + inwardX * step); const sy = Math.round(y + inwardY * step); const sample = cells[sy * width + sx];
      if (sample && sx >= 0 && sy >= 0 && sx < width && sy < height) samples.push({ lab: sample.originalOklab || sample.oklab, weight, index: sy * width + sx });
    });
  }
  if (!samples.length) {
    const nearby = eightNeighbors(index, width, height).filter((n) => cells[n] && rings[n] > 0).sort((a, b) => rings[a] - rings[b] || a - b).slice(0, 6);
    nearby.forEach((n, position) => samples.push({ lab: cells[n].originalOklab || cells[n].oklab, weight: 1 / (position + 1), index: n }));
  }
  if (!samples.length) return { lab: cells[index].originalOklab || cells[index].oklab, sampleIndices: [index] };
  return { lab: [0, 1, 2].map((channel) => weightedMedian(samples.map((sample) => ({ value: sample.lab[channel], weight: sample.weight })))), sampleIndices: samples.map((sample) => sample.index) };
}

function hueFamilyIndex(family) { return family === "neutral" ? -1 : Number(family.slice(1)); }
function adjacentFamily(a, b) {
  if (a === b) return true; const ai = hueFamilyIndex(a); const bi = hueFamilyIndex(b); if (ai < 0 || bi < 0) return false;
  return Math.min(Math.abs(ai - bi), 12 - Math.abs(ai - bi)) <= 1;
}

function encodeRuns(sequence, familyForIndex) {
  const runs = [];
  sequence.forEach((index) => { const family = familyForIndex(index); const last = runs.at(-1); if (last?.family === family) last.indices.push(index); else runs.push({ family, indices: [index] }); });
  if (runs.length > 1 && runs[0].family === runs.at(-1).family) { runs[0].indices.unshift(...runs.pop().indices); }
  return runs;
}

function contourMetrics(sequences, matrix, allowedFamilies) {
  let numberOfContourRuns = 0; let shortContourRuns = 0; let contourOutlierCount = 0; const colors = new Set();
  sequences.forEach((sequence) => {
    const runs = encodeRuns(sequence, (i) => keyOf(matrix[i])); numberOfContourRuns += runs.length; shortContourRuns += runs.filter((run) => run.indices.length <= 2).length;
    sequence.forEach((i) => { if (matrix[i]) colors.add(keyOf(matrix[i])); if (!allowedFamilies[i]?.has(hueFamily(colorLab(matrix[i])))) contourOutlierCount += 1; });
  });
  return { contourPaletteCount: colors.size, contourOutlierCount, numberOfContourRuns, shortContourRuns, contourFragmentation: sequences.length ? numberOfContourRuns / sequences.reduce((sum, sequence) => sum + sequence.length, 0) : 0 };
}

export function quantizeOuterContour(cells, paletteLab, width, height, rings, options = {}) {
  const components = buildBoundaryComponents(cells, rings, width, height); const sequences = components.map((component) => orderContour(component, width, height));
  const matrix = options.matrix; const lockedMask = new Uint8Array(cells.length); const allowedFamilies = new Array(cells.length); const interiorReferences = new Array(cells.length); const segments = []; const runsBefore = [];
  for (const sequence of sequences) {
    const references = new Map(sequence.map((i) => [i, interiorReferenceFor(i, cells, rings, width, height, options.bandWidth || 3)]));
    references.forEach((reference, i) => { interiorReferences[i] = reference; });
    const [dominant, dominantCount] = dominantFamily(sequence, Object.fromEntries([...references].map(([i, reference]) => [i, reference.lab])));
    const rawRuns = encodeRuns(sequence, (i) => hueFamily(references.get(i).lab)); runsBefore.push(...rawRuns.map((run) => ({ family: run.family, length: run.indices.length })));
    const accepted = rawRuns.map((run) => {
      const sourceSupport = run.indices.filter((i) => hueFamily(cells[i].originalOklab || cells[i].oklab) === run.family).length / run.indices.length;
      const strongEvidence = run.indices.length >= 3 && sourceSupport >= 0.67;
      return { ...run, sourceSupport, allowedFamily: run.family === dominant || strongEvidence ? run.family : dominant, strongEvidence };
    });
    for (const segment of accepted) {
      segments.push(segment); const referenceLabs = segment.indices.map((i) => references.get(i).lab); const lightness = referenceLabs.map((lab) => lab[0]).sort((a, b) => a - b);
      const mean = [0, 1, 2].map((c) => referenceLabs.reduce((sum, lab) => sum + lab[c], 0) / referenceLabs.length);
      const variance = referenceLabs.reduce((sum, lab) => sum + oklabDistance(lab, mean) ** 2, 0) / referenceLabs.length;
      const budget = variance < 0.0008 ? 2 : variance < 0.003 ? 3 : 4;
      const centers = Array.from({ length: Math.min(budget, Math.max(1, new Set(lightness.map((v) => v.toFixed(3))).size)) }, (_, k) => lightness[Math.min(lightness.length - 1, Math.floor((k + 0.5) / budget * lightness.length))]);
      const familyCandidates = paletteLab.filter((candidate) => adjacentFamily(hueFamily(candidate.lab), segment.allowedFamily));
      const allowed = familyCandidates.length ? familyCandidates : paletteLab;
      const rolePalette = centers.map((L) => allowed.map((candidate) => ({ ...candidate, cost: Math.hypot((candidate.lab[0] - L) * 1.25, candidate.lab[1] - mean[1], candidate.lab[2] - mean[2]) })).sort((a, b) => a.cost - b.cost || a.index - b.index)[0]);
      segment.indices.forEach((i) => {
        const reference = references.get(i).lab; const role = centers.reduce((best, L, k) => Math.abs(reference[0] - L) < Math.abs(reference[0] - centers[best]) ? k : best, 0);
        matrix[i] = rolePalette[role].color; lockedMask[i] = 1; allowedFamilies[i] = new Set([segment.allowedFamily, ...[...new Set(allowed.map((candidate) => hueFamily(candidate.lab)))]]);
      });
    }
  }
  for (let i = 0; i < cells.length; i += 1) {
    if (!cells[i] || rings[i] < 1 || rings[i] > 2) continue;
    const x = i % width; const y = Math.floor(i / width); let nearestContour = -1; let nearestDistance = Infinity;
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
      const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue; const n = ny * width + nx;
      if (rings[n] !== 0 || !allowedFamilies[n]) continue; const distance = Math.hypot(dx, dy); if (distance < nearestDistance) { nearestDistance = distance; nearestContour = n; }
    }
    if (nearestContour < 0) continue; const families = allowedFamilies[nearestContour]; allowedFamilies[i] = families;
    const currentFamily = hueFamily(colorLab(matrix[i])); if (families.has(currentFamily)) { if (rings[i] === 1) lockedMask[i] = 2; continue; }
    const sourceLab = cells[i].originalOklab || cells[i].oklab;
    const replacement = paletteLab.filter((candidate) => families.has(hueFamily(candidate.lab))).map((candidate) => ({ ...candidate, cost: oklabDistance(candidate.lab, sourceLab) })).sort((a, b) => a.cost - b.cost || a.index - b.index)[0];
    const currentError = oklabDistance(colorLab(matrix[i]), sourceLab);
    if (replacement && (rings[i] === 1 || replacement.cost + 0.025 < currentError)) { options.replacementHistory?.[i]?.push({ stage: `contour-band-${rings[i]}-constraint`, before: keyOf(matrix[i]), after: keyOf(replacement.color) }); matrix[i] = replacement.color; }
    if (rings[i] === 1) lockedMask[i] = 2;
  }
  const rawCodes = matrix.map(keyOf); let cleanedRuns = 0;
  sequences.forEach((sequence) => {
    const runs = encodeRuns(sequence, (i) => keyOf(matrix[i]));
    runs.forEach((run, position) => {
      if (run.indices.length >= 3 || runs.length < 3) return; const previous = runs[(position - 1 + runs.length) % runs.length]; const next = runs[(position + 1) % runs.length];
      const previousFamily = hueFamily(colorLab(matrix[previous.indices[0]])); const nextFamily = hueFamily(colorLab(matrix[next.indices[0]])); const runFamily = hueFamily(colorLab(matrix[run.indices[0]]));
      if (!adjacentFamily(previousFamily, nextFamily) || adjacentFamily(runFamily, previousFamily)) return;
      const supported = run.indices.some((i) => hueFamily(cells[i].originalOklab || cells[i].oklab) === runFamily && hueFamily(interiorReferences[i].lab) === runFamily); if (supported) return;
      run.indices.forEach((i) => { const target = previous.indices.length >= next.indices.length ? matrix[previous.indices.at(-1)] : matrix[next.indices[0]]; options.replacementHistory?.[i]?.push({ stage: "contour-run-cleanup", before: keyOf(matrix[i]), after: keyOf(target) }); matrix[i] = target; }); cleanedRuns += 1;
    });
  });
  return { matrix, sequences, lockedMask, allowedFamilies, interiorReferences, segments, rawCodes, runsBefore, cleanedRuns, metrics: contourMetrics(sequences, matrix, allowedFamilies), dominantConsistency: components.map((component, index) => ({ size: component.length, sequenceSize: sequences[index].length })) };
}

function dominantFamily(indices, labs) {
  const counts = new Map(); indices.forEach((i) => { const family = hueFamily(labs[i]); counts.set(family, (counts.get(family) || 0) + 1); });
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ["", 0];
}

function stabilizeBoundarySamples(cells, coverageMap, rings, width, height, history) {
  let changed = 0; const labs = cells.map((cell) => cell?.oklab);
  for (let i = 0; i < cells.length; i += 1) {
    if (!cells[i] || rings[i] !== 0 || (coverageMap?.[i] ?? 1) >= 0.78) continue;
    const interior = neighborsOf(i, width, height).filter((n) => cells[n] && rings[n] > 0 && rings[n] <= 2);
    if (!interior.length) continue;
    const [family, familyCount] = dominantFamily(interior, labs);
    if (familyCount / interior.length < 0.67) continue;
    const matching = interior.filter((n) => hueFamily(cells[n].oklab) === family);
    const inward = [0, 1, 2].map((c) => matching.reduce((sum, n) => sum + cells[n].oklab[c], 0) / matching.length);
    const sourceDistance = oklabDistance(cells[i].oklab, inward);
    if (sourceDistance < 0.035 || hueFamily(cells[i].oklab) === family) continue;
    const before = [...cells[i].oklab]; cells[i].oklab = cells[i].oklab.map((value, c) => value * 0.28 + inward[c] * 0.72);
    history?.[i]?.push({ stage: "boundary-sample-stabilization", before, after: [...cells[i].oklab], inwardFamily: family }); changed += 1;
  }
  return changed;
}

export function growRegions(cells, width, height, edgeMap, config) {
  const ids = new Int32Array(width * height); ids.fill(-1); const regions = [];
  for (let start = 0; start < cells.length; start += 1) {
    if (!cells[start] || ids[start] >= 0) continue;
    const id = regions.length; const queue = [start]; const pixels = []; ids[start] = id; let mean = [...cells[start].oklab];
    for (let h = 0; h < queue.length; h += 1) {
      const i = queue[h]; pixels.push(i); const x = i % width; const y = Math.floor(i / width);
      for (const n of [i - width, i - 1, i + 1, i + width]) {
        if (n < 0 || n >= cells.length || !cells[n] || ids[n] >= 0 || (n === i - 1 && x === 0) || (n === i + 1 && x + 1 === width)) continue;
        if (Math.max(edgeMap[i], edgeMap[n]) > 0.62 || oklabDistance(mean, cells[n].oklab) > config.regionGrowThreshold) continue;
        ids[n] = id; queue.push(n); const count = queue.length; mean = mean.map((v, c) => v + (cells[n].oklab[c] - v) / count);
      }
    }
    regions.push({ id, pixels, mean, area: pixels.length });
  }
  return { ids, regions };
}

function regionVariance(region, cells) { return region.pixels.reduce((sum, i) => sum + oklabDistance(cells[i].oklab, region.mean) ** 2, 0) / Math.max(1, region.area); }
export function buildRAG(segmentation, cells, edgeMap, width, height) {
  const edges = new Map(); const { ids } = segmentation;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x;
    for (const n of [x + 1 < width ? i + 1 : -1, y + 1 < height ? i + width : -1]) {
      if (n < 0 || ids[i] < 0 || ids[n] < 0 || ids[i] === ids[n]) continue;
      const pair = [ids[i], ids[n]].sort((a, b) => a - b); const key = pair.join("|"); const e = edges.get(key) || { a: pair[0], b: pair[1], sharedBoundaryLength: 0, edgeSum: 0, maxBoundaryStrength: 0 };
      e.sharedBoundaryLength += 1; e.edgeSum += Math.max(edgeMap[i], edgeMap[n]); e.maxBoundaryStrength = Math.max(e.maxBoundaryStrength, edgeMap[i], edgeMap[n]); edges.set(key, e);
    }
  }
  return [...edges.values()].map((e) => ({ ...e, meanBoundaryStrength: e.edgeSum / e.sharedBoundaryLength, colorDistance: oklabDistance(segmentation.regions[e.a].mean, segmentation.regions[e.b].mean) }));
}

export function calculateMergeCost(a, b, edge, cells, config) {
  const mergedMean = a.mean.map((v, c) => (v * a.area + b.mean[c] * b.area) / (a.area + b.area));
  const merged = { pixels: a.pixels.concat(b.pixels), mean: mergedMean, area: a.area + b.area };
  const varianceIncrease = Math.max(0, regionVariance(merged, cells) - (regionVariance(a, cells) * a.area + regionVariance(b, cells) * b.area) / merged.area);
  const spatialPenalty = 1 / Math.max(1, edge.sharedBoundaryLength);
  return config.colorWeight * clamp(edge.colorDistance / 0.22) + config.edgeWeight * edge.meanBoundaryStrength + config.varianceWeight * clamp(varianceIncrease / 0.008) + config.spatialWeight * spatialPenalty;
}

export function mergeRegions(segmentation, cells, edgeMap, width, height, config) {
  let current = segmentation;
  for (let pass = 0; pass < 12; pass += 1) {
    const rag = buildRAG(current, cells, edgeMap, width, height).map((edge) => ({ ...edge, cost: calculateMergeCost(current.regions[edge.a], current.regions[edge.b], edge, cells, config) })).sort((a, b) => a.cost - b.cost || a.a - b.a || a.b - b.b);
    const eligible = rag.filter((e) => e.cost < config.mergeThreshold); if (!eligible.length) break;
    const parent = current.regions.map((_, i) => i); const used = new Uint8Array(parent.length);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const edge of eligible) {
      const a = find(edge.a); const b = find(edge.b);
      if (a === b || used[a] || used[b]) continue;
      parent[b] = a; used[a] = 1; used[b] = 1;
    }
    const groups = new Map();
    for (const region of current.regions) { const root = find(region.id); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(...region.pixels); }
    if (groups.size === current.regions.length) break;
    const ids = new Int32Array(current.ids.length); ids.fill(-1); const regions = [];
    for (const pixels of groups.values()) { const id = regions.length; pixels.forEach((i) => { ids[i] = id; }); const mean = [0, 1, 2].map((c) => pixels.reduce((s, i) => s + cells[i].oklab[c], 0) / pixels.length); regions.push({ id, pixels, mean, area: pixels.length }); }
    current = { ids, regions };
  }
  return current;
}

function paletteBudget(region, cells) { const variance = regionVariance(region, cells); if (region.area <= 8 || variance < 0.0007) return 1; if (region.area < 40 || variance < 0.0025) return 2; return variance > 0.008 ? 4 : 3; }
function roleCenters(region, cells) { const values = region.pixels.map((i) => cells[i].oklab[0]).sort((a, b) => a - b); const budget = paletteBudget(region, cells); return Array.from({ length: budget }, (_, k) => values[Math.min(values.length - 1, Math.floor((k + 0.5) / budget * values.length))]); }

function consolidateAndRepair(matrix, roles, edgeMap, width, height, config, lockedMask = null) {
  const counts = new Map(); const colors = new Map();
  matrix.forEach((color) => { if (color) { const key = keyOf(color); counts.set(key, (counts.get(key) || 0) + 1); colors.set(key, color); } });
  const rareLimit = Math.max(3, Math.round(matrix.length * 0.0015)); let paletteChanges = 0; let continuityChanges = 0;
  const replacements = new Map();
  for (const [key, count] of counts) {
    if (count > rareLimit) continue;
    const source = colors.get(key); const sourceLab = rgbToOKLab(source.rgb);
    const target = [...colors.entries()].filter(([other]) => other !== key && (counts.get(other) || 0) > count)
      .map(([other, color]) => ({ other, color, d: oklabDistance(sourceLab, rgbToOKLab(color.rgb)) }))
      .filter((item) => item.d < 0.045).sort((a, b) => a.d - b.d || String(a.other).localeCompare(String(b.other)))[0];
    if (target) replacements.set(key, target.color);
  }
  for (let i = 0; i < matrix.length; i += 1) if (!lockedMask?.[i] && matrix[i] && replacements.has(keyOf(matrix[i])) && edgeMap[i] < 0.28 && roles[i] === "BASE") { matrix[i] = replacements.get(keyOf(matrix[i])); paletteChanges += 1; }
  for (let y = 1; y + 1 < height; y += 1) for (let x = 1; x + 1 < width; x += 1) {
    const i = y * width + x; if (lockedMask?.[i] || !matrix[i] || edgeMap[i] > 0.25) continue;
    const horizontal = keyOf(matrix[i - 1]) && keyOf(matrix[i - 1]) === keyOf(matrix[i + 1]) ? matrix[i - 1] : null;
    const vertical = keyOf(matrix[i - width]) && keyOf(matrix[i - width]) === keyOf(matrix[i + width]) ? matrix[i - width] : null;
    const target = horizontal || vertical;
    if (target && keyOf(target) !== keyOf(matrix[i]) && roles[i] === "BASE" && oklabDistance(rgbToOKLab(target.rgb), rgbToOKLab(matrix[i].rgb)) < 0.08) { matrix[i] = target; continuityChanges += 1; }
  }
  return { paletteChanges, continuityChanges };
}

function hueFamily(lab) {
  const chroma = Math.hypot(lab[1], lab[2]);
  if (chroma < 0.035) return "neutral";
  const hue = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
  return `h${Math.floor((hue + 15) / 30) % 12}`;
}

export function analyzeBoundaryFamilies(matrix, cells, width, height, rings = buildBoundaryRings(cells, width, height)) {
  const components = buildBoundaryComponents(cells, rings, width, height); let outlierCount = 0; let boundaryCells = 0; const labs = cells.map((cell) => cell?.oklab);
  const details = components.map((pixels) => {
    const [sourceFamily, sourceFamilyCount] = dominantFamily(pixels, labs);
    const finalFamilies = pixels.map((i) => hueFamily(colorLab(matrix[i]))); const counts = new Map(); finalFamilies.forEach((family) => counts.set(family, (counts.get(family) || 0) + 1));
    const finalDominant = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ["", 0];
    const coherentSource = sourceFamilyCount / Math.max(1, pixels.length) >= 0.72;
    const outliers = coherentSource ? pixels.filter((i) => hueFamily(colorLab(matrix[i])) !== sourceFamily && hueFamily(cells[i].oklab) === sourceFamily) : [];
    outlierCount += outliers.length; boundaryCells += pixels.length;
    return { size: pixels.length, sourceFamily, sourceConsistency: sourceFamilyCount / Math.max(1, pixels.length), finalDominantFamily: finalDominant[0], finalConsistency: finalDominant[1] / Math.max(1, pixels.length), outliers };
  });
  return { boundaryCells, boundaryOutlierCount: outlierCount, components: details };
}

function repairBoundaryFamilyOutliers(matrix, cells, paletteLab, rings, width, height, history) {
  const components = buildBoundaryComponents(cells, rings, width, height); let changed = 0; const outliers = [];
  const labs = cells.map((cell) => cell?.oklab);
  for (const pixels of components) {
    if (pixels.length < 5) continue;
    const [family, count] = dominantFamily(pixels, labs); if (count / pixels.length < 0.72) continue;
    const sourceMean = [0, 1, 2].map((c) => pixels.filter((i) => hueFamily(cells[i].oklab) === family).reduce((sum, i) => sum + cells[i].oklab[c], 0) / count);
    for (const i of pixels) {
      const selectedFamily = hueFamily(colorLab(matrix[i])); if (selectedFamily === family || hueFamily(cells[i].oklab) !== family) continue;
      const sameFamilyNeighbors = neighborsOf(i, width, height).filter((n) => matrix[n] && hueFamily(colorLab(matrix[n])) === family);
      if (!sameFamilyNeighbors.length) continue;
      const currentEvidence = oklabDistance(colorLab(matrix[i]), cells[i].oklab);
      const replacement = paletteLab.filter((candidate) => hueFamily(candidate.lab) === family).map((candidate) => ({ ...candidate, cost: oklabDistance(candidate.lab, cells[i].oklab) * 0.72 + oklabDistance(candidate.lab, sourceMean) * 0.28 }))
        .sort((a, b) => a.cost - b.cost || a.index - b.index)[0];
      if (!replacement || replacement.cost + 0.018 >= currentEvidence) continue;
      const before = keyOf(matrix[i]); matrix[i] = replacement.color; outliers.push(i); changed += 1;
      history?.[i]?.push({ stage: "boundary-family-reassignment", before, after: keyOf(replacement.color), sourceFamily: family, sourceEvidenceBefore: currentEvidence, sourceEvidenceAfter: replacement.cost });
    }
  }
  return { changed, outliers };
}

export function buildColorFamilies(colors) {
  const families = new Map();
  for (const color of colors) {
    const lab = colorLab(color); const family = hueFamily(lab);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push({ color, lab, chroma: Math.hypot(lab[1], lab[2]) });
  }
  for (const entries of families.values()) entries.sort((a, b) => a.lab[0] - b.lab[0] || keyOf(a.color).localeCompare(keyOf(b.color)));
  return families;
}

export function buildPaletteSimilarityGraph(colors, threshold = 0.085) {
  const labs = colors.map(colorLab); const graph = new Map(colors.map((color) => [keyOf(color), []]));
  for (let a = 0; a < colors.length; a += 1) for (let b = a + 1; b < colors.length; b += 1) {
    const distance = oklabDistance(labs[a], labs[b]);
    if (distance > threshold) continue;
    graph.get(keyOf(colors[a])).push({ color: colors[b], distance });
    graph.get(keyOf(colors[b])).push({ color: colors[a], distance });
  }
  for (const entries of graph.values()) entries.sort((a, b) => a.distance - b.distance || keyOf(a.color).localeCompare(keyOf(b.color)));
  return graph;
}

function paletteStats(matrix, cells, edgeMap, regionIds, roles, boundaryRings, lockedMask) {
  const stats = new Map();
  matrix.forEach((color, index) => {
    if (!color) return;
    const key = keyOf(color); const item = stats.get(key) || { key, color, lab: colorLab(color), count: 0, edge: 0, detail: 0, boundary: 0, locked: 0, regions: new Map(), roles: new Map() };
    item.count += 1; item.edge += edgeMap?.[index] || 0;
    if ((edgeMap?.[index] || 0) > 0.42) item.detail += 1;
    if (boundaryRings?.[index] === 0) item.boundary += 1;
    if (lockedMask?.[index]) item.locked += 1;
    const region = regionIds?.[index] ?? index; item.regions.set(region, (item.regions.get(region) || 0) + 1);
    const role = roles?.[index] || "BASE"; item.roles.set(role, (item.roles.get(role) || 0) + 1);
    stats.set(key, item);
  });
  return stats;
}

function replacementCandidates(source, stats, graph, families, topK = 8) {
  const family = hueFamily(source.lab); const sameFamily = new Set((families.get(family) || []).map((item) => keyOf(item.color)));
  const linked = new Map((graph.get(source.key) || []).map((item) => [keyOf(item.color), item.distance]));
  return [...stats.values()].filter((item) => item.key !== source.key).map((item) => ({
    ...item,
    distance: linked.get(item.key) ?? oklabDistance(source.lab, item.lab),
    sameFamily: sameFamily.has(item.key),
  })).sort((a, b) => Number(b.sameFamily) - Number(a.sameFamily) || a.distance - b.distance || b.count - a.count || a.key.localeCompare(b.key)).slice(0, topK);
}

export function calculatePaletteRemovalCost(source, candidates, totalCells) {
  if (!candidates.length) return Number.POSITIVE_INFINITY;
  const best = candidates[0]; const usage = source.count / Math.max(1, totalCells);
  const edgeRatio = source.detail / Math.max(1, source.count);
  const roleDiversity = source.roles.size / 3;
  const regionImportance = Math.min(1, source.regions.size / 8);
  const boundaryImportance = source.boundary / Math.max(1, source.count);
  const redundancy = Math.max(0, 1 - best.distance / 0.12);
  return usage * 1.8 + best.distance * 3.6 + edgeRatio * 1.2 + boundaryImportance * 1.6 + roleDiversity * 0.24 + regionImportance * 0.18 - redundancy * 0.55;
}

function groupReplacementCost(indices, candidate, source, cells, matrix, width, roles, boundaryRings) {
  let colorError = 0; let adjacencyReward = 0; let rolePenalty = 0; let edgePenalty = 0;
  for (const i of indices) {
    colorError += oklabDistance(cells?.[i]?.oklab || source.lab, candidate.lab);
    const role = roles?.[i] || "BASE";
    if (role === "SHADOW" && candidate.lab[0] > source.lab[0] + 0.055) rolePenalty += candidate.lab[0] - source.lab[0];
    if (role === "HIGHLIGHT" && candidate.lab[0] < source.lab[0] - 0.055) rolePenalty += source.lab[0] - candidate.lab[0];
    const x = i % width;
    for (const n of [i - width, i - 1, i + 1, i + width]) {
      if (n < 0 || n >= matrix.length || (n === i - 1 && x === 0) || (n === i + 1 && x + 1 === width)) continue;
      if (keyOf(matrix[n]) === candidate.key) adjacencyReward += 1;
    }
    edgePenalty += (source.detail ? 0.18 : 0) * oklabDistance(source.lab, candidate.lab);
  }
  const boundaryRatio = indices.filter((i) => boundaryRings?.[i] === 0).length / indices.length;
  return colorError / indices.length + rolePenalty / indices.length * 2.4 + edgePenalty / indices.length - adjacencyReward / indices.length * 0.012 + (candidate.sameFamily ? 0 : 0.32 + boundaryRatio * 0.75);
}

export function recommendMaxColors(width, height, rgbGrid, regionCount = 0) {
  const labs = rgbGrid.filter(Boolean).map(rgbToOKLab); if (!labs.length) return 1;
  const mean = [0, 1, 2].map((c) => labs.reduce((sum, lab) => sum + lab[c], 0) / labs.length);
  const variance = labs.reduce((sum, lab) => sum + oklabDistance(lab, mean) ** 2, 0) / labs.length;
  const areaFactor = Math.sqrt(width * height) * 0.19;
  return Math.round(clamp(14 + areaFactor + Math.sqrt(Math.max(0, variance)) * 54 + Math.sqrt(Math.max(1, regionCount)) * 0.42, 12, 64));
}

export function enforceMaxPaletteColors(matrix, width, height, options = {}) {
  const maxColors = options.maxColors == null ? null : Math.max(1, Math.floor(options.maxColors));
  const report = { requestedMaxColors: maxColors, initialColorCount: 0, finalColorCount: 0, removedColors: [], reassignedCells: 0 };
  let stats = paletteStats(matrix, options.cells, options.edgeMap, options.regionIds, options.roles, options.boundaryRings, options.lockedMask); report.initialColorCount = stats.size;
  if (maxColors == null || stats.size <= maxColors) { report.finalColorCount = stats.size; return { matrix, report }; }
  while (stats.size > maxColors) {
    const colors = [...stats.values()].map((item) => item.color);
    const graph = buildPaletteSimilarityGraph(colors); const families = buildColorFamilies(colors);
    let choices = [...stats.values()].map((source) => {
      const candidates = replacementCandidates(source, stats, graph, families, options.candidatePaletteK || 8);
      return { source, candidates, hasSameFamily: candidates.some((candidate) => candidate.sameFamily), cost: calculatePaletteRemovalCost(source, candidates, matrix.length) };
    });
    if (choices.some((choice) => choice.hasSameFamily)) choices = choices.filter((choice) => choice.hasSameFamily);
    choices = choices.filter((choice) => !choice.source.locked || choice.hasSameFamily);
    choices.sort((a, b) => a.cost - b.cost || a.source.key.localeCompare(b.source.key));
    const choice = choices[0]; if (!choice?.candidates.length) break;
    const groups = new Map();
    matrix.forEach((color, index) => { if (keyOf(color) !== choice.source.key) return; const group = options.regionIds?.[index] ?? index; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(index); });
    for (const indices of groups.values()) {
      const sameFamilyCandidates = choice.candidates.filter((candidate) => candidate.sameFamily);
      const candidates = sameFamilyCandidates.length ? sameFamilyCandidates : choice.candidates;
      const target = candidates.map((candidate) => ({ candidate, cost: groupReplacementCost(indices, candidate, choice.source, options.cells, matrix, width, options.roles, options.boundaryRings) }))
        .sort((a, b) => a.cost - b.cost || a.candidate.key.localeCompare(b.candidate.key))[0].candidate;
      indices.forEach((index) => {
        options.replacementHistory?.[index]?.push({ stage: "global-palette-budget", before: choice.source.key, after: target.key, sameFamily: target.sameFamily });
        matrix[index] = target.color;
      }); report.reassignedCells += indices.length;
    }
    report.removedColors.push(choice.source.key); stats = paletteStats(matrix, options.cells, options.edgeMap, options.regionIds, options.roles, options.boundaryRings, options.lockedMask);
  }
  report.finalColorCount = stats.size;
  if (report.finalColorCount > maxColors) throw new Error(`Hard palette budget failed: ${report.finalColorCount} > ${maxColors}`);
  return { matrix, report };
}

export function validateFinalPattern(grid, maxColors = null) {
  const colors = new Set(grid.flat().filter(Boolean).map(keyOf));
  const valid = maxColors == null || colors.size <= maxColors;
  return { valid, actualColors: colors.size, maxColors };
}

export function quantizeRegionAware(rgbGrid, width, height, palette, options = {}) {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now(); const config = presetForGridSize(width, height, options);
  const replacementHistory = rgbGrid.map(() => []);
  const cells = rgbGrid.map((rgb) => rgb ? { rgb, oklab: rgbToOKLab(rgb), originalOklab: rgbToOKLab(rgb) } : null);
  const contourBandWidth = contourBandWidthForGrid(width, height);
  const boundaryRings = buildBoundaryRings(cells, width, height, contourBandWidth - 1);
  const boundarySampleChanges = stabilizeBoundarySamples(cells, options.coverageMap, boundaryRings, width, height, replacementHistory);
  const edgeMap = buildGridEdgeMap(cells, width, height, config);
  const initial = growRegions(cells, width, height, edgeMap, config); const merged = mergeRegions(initial, cells, edgeMap, width, height, config);
  const paletteLab = palette.map((color, index) => ({ color, index, lab: rgbToOKLab(color.rgb) })); const matrix = new Array(cells.length).fill(null); const roles = new Array(cells.length).fill("BASE"); const provenance = new Array(cells.length).fill(null);
  for (const region of merged.regions) {
    const centers = roleCenters(region, cells); const touchesBoundary = region.pixels.some((i) => boundaryRings[i] === 0); const regionFamily = hueFamily(region.mean);
    const candidates = centers.map((L) => paletteLab.map((p) => {
      const colorError = Math.hypot((p.lab[0] - L) * 1.25, p.lab[1] - region.mean[1], p.lab[2] - region.mean[2]);
      const familyMismatchPenalty = touchesBoundary && hueFamily(p.lab) !== regionFamily ? 0.24 : 0;
      return { ...p, d: colorError + familyMismatchPenalty, colorError, familyMismatchPenalty };
    }).sort((a, b) => a.d - b.d || a.index - b.index).slice(0, config.candidatePaletteK));
    region.pixels.forEach((i) => {
      const roleIndex = centers.reduce((best, L, k) => Math.abs(cells[i].oklab[0] - L) < Math.abs(cells[i].oklab[0] - centers[best]) ? k : best, 0);
      matrix[i] = candidates[roleIndex][0].color; roles[i] = centers.length === 1 ? "BASE" : roleIndex === 0 ? "SHADOW" : roleIndex === centers.length - 1 ? "HIGHLIGHT" : "BASE";
      provenance[i] = { regionId: region.id, regionMean: [...region.mean], regionColorFamily: regionFamily, candidateBeadColors: candidates[roleIndex].map((candidate) => ({ code: keyOf(candidate.color), cost: candidate.d, colorError: candidate.colorError, familyMismatchPenalty: candidate.familyMismatchPenalty })), selectedBead: keyOf(matrix[i]) };
    });
  }
  const boundaryBefore = analyzeBoundaryFamilies(matrix, cells, width, height, boundaryRings);
  const contour = quantizeOuterContour(cells, paletteLab, width, height, boundaryRings, { matrix, bandWidth: contourBandWidth, replacementHistory });
  const beforeConsolidation = matrix.map(keyOf);
  const globalOptimization = consolidateAndRepair(matrix, roles, edgeMap, width, height, config, contour.lockedMask);
  matrix.forEach((color, i) => { if (beforeConsolidation[i] && beforeConsolidation[i] !== keyOf(color)) replacementHistory[i].push({ stage: "palette-consolidation", before: beforeConsolidation[i], after: keyOf(color) }); });
  // Remove only low-contrast islands; high-contrast eyes, stars and edge details survive.
  let changed = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const i = y * width + x; if (!matrix[i] || boundaryRings[i] >= 0 && boundaryRings[i] <= 1 || edgeMap[i] > (config.detailProtection === "high" ? 0.22 : 0.32)) continue; const ns = [i - width, i - 1, i + 1, i + width].filter((n) => n >= 0 && n < matrix.length && matrix[n] && !(n === i - 1 && x === 0) && !(n === i + 1 && x + 1 === width)); const counts = new Map(); ns.forEach((n) => counts.set(keyOf(matrix[n]), (counts.get(keyOf(matrix[n])) || 0) + 1)); const best = [...counts].sort((a, b) => b[1] - a[1])[0]; if (best?.[1] >= 3 && best[0] !== keyOf(matrix[i])) { const target = ns.find((n) => keyOf(matrix[n]) === best[0]); if (oklabDistance(rgbToOKLab(matrix[i].rgb), rgbToOKLab(matrix[target].rgb)) < 0.09) { const before = keyOf(matrix[i]); matrix[i] = matrix[target]; replacementHistory[i].push({ stage: "small-island-cleanup", before, after: keyOf(matrix[i]) }); changed += 1; } } }
  const recommendedMaxColors = recommendMaxColors(width, height, rgbGrid, merged.regions.length);
  const effectiveMaxColors = options.autoMaxColors ? recommendedMaxColors : options.maxColors;
  const paletteBudget = enforceMaxPaletteColors(matrix, width, height, { maxColors: effectiveMaxColors, cells, edgeMap, regionIds: merged.ids, roles, boundaryRings, lockedMask: contour.lockedMask, replacementHistory, candidatePaletteK: config.candidatePaletteK + 3 });
  const boundaryAfter = analyzeBoundaryFamilies(matrix, cells, width, height, boundaryRings);
  const tracePixel = (x, y) => {
    const index = y * width + x; if (x < 0 || y < 0 || x >= width || y >= height || !cells[index]) return null;
    const nearest = paletteLab.reduce((best, candidate) => { const d = oklabDistance(cells[index].originalOklab, candidate.lab); return !best || d < best.d ? { candidate, d } : best; }, null);
    return { gridCoordinate: { x, y }, ...(options.samplingProvenance?.[index] || {}), sampledRgb: rgbGrid[index], sampledOklab: cells[index].originalOklab, stabilizedOklab: cells[index].oklab, foregroundCoverage: options.coverageMap?.[index] ?? 1, contourBand: boundaryRings[index], contourLocked: contour.lockedMask[index] === 1, contourStronglyProtected: contour.lockedMask[index] === 2, contourAllowedFamilies: [...(contour.allowedFamilies[index] || [])], interiorReferenceOklab: contour.interiorReferences[index]?.lab || null, interiorReferenceCells: contour.interiorReferences[index]?.sampleIndices || [], ...provenance[index], initialNearestBead: keyOf(nearest.candidate.color), edgeStrength: edgeMap[index], replacementHistory: replacementHistory[index], finalBead: keyOf(matrix[index]), neighborBeadCodes: neighborsOf(index, width, height).map((n) => ({ x: n % width, y: Math.floor(n / width), code: keyOf(matrix[n]) || null })) };
  };
  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  return { grid: Array.from({ length: height }, (_, y) => matrix.slice(y * width, (y + 1) * width)), edgeMap, regionIds: merged.ids, roles, boundaryRings, contourLockedMask: contour.lockedMask, contourDebug: { sequences: contour.sequences, interiorReferences: contour.interiorReferences, segments: contour.segments, rawCodes: contour.rawCodes, runsBefore: contour.runsBefore }, tracePixel, report: { version: REGION_AWARE_VERSION, initialRegionCount: initial.regions.length, mergedRegionCount: merged.regions.length, contourBandWidth, boundarySampleChanges, contour: contour.metrics, boundaryBefore, boundaryAfter, cleanupChangedCells: changed, paletteConsolidatedCells: globalOptimization.paletteChanges, structuralContinuityChanges: globalOptimization.continuityChanges, usedColorCount: new Set(matrix.filter(Boolean).map(keyOf)).size, recommendedMaxColors, effectiveMaxColors, paletteBudget: paletteBudget.report, milliseconds: elapsed, config } };
}

const api = { REGION_AWARE_VERSION, LEGACY_NEAREST, REGION_AWARE, RegionAwareConfig, rgbToOKLab, oklabToRgb, oklabDistance, presetForGridSize, buildGridEdgeMap, buildBoundaryRings, contourBandWidthForGrid, analyzeBoundaryFamilies, quantizeOuterContour, growRegions, buildRAG, calculateMergeCost, mergeRegions, buildColorFamilies, buildPaletteSimilarityGraph, calculatePaletteRemovalCost, recommendMaxColors, enforceMaxPaletteColors, validateFinalPattern, quantizeRegionAware };
if (typeof window !== "undefined") window.LibmsRegionAwareQuantizer = api;
