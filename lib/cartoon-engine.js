/**
 * Independent Cartoon Engine. No UI, network, portrait, or export dependencies.
 * Pooling / border flood fill adapted from liangdabiao/perler-beads-ai,
 * commit 573006fec96eb59552862556a7a3e438077328a4 (Apache-2.0).
 * Copyright 2024 Zippland. See ../THIRD_PARTY_NOTICES.md and licenses/.
 * Modified 2026-09-04: pure RGBA API, injected Lab/DeltaE2000 mapper,
 * center/quantized modes, local BFS and structure-aware color budget.
 * BFS is a local extension, NOT the upstream main branch's global merge.
 */

const luma = rgb => .299 * rgb[0] + .587 * rgb[1] + .114 * rgb[2];
const neighbours = (i, w, h) => {
  const x = i % w, y = Math.floor(i / w), out = [];
  if (y > 0) out.push(i - w);
  if (y + 1 < h) out.push(i + w);
  if (x > 0) out.push(i - 1);
  if (x + 1 < w) out.push(i + 1);
  return out;
};

/** Exact upstream floor/ceil cells, alpha>=128 and running strict-max tie rule. */
export function poolCartoonCells(source, width, height, crop, mode = 'dominant') {
  const output = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = crop.x + Math.floor(x * crop.width / width);
    const y0 = crop.y + Math.floor(y * crop.height / height);
    const x1 = crop.x + Math.min(crop.width, Math.ceil((x + 1) * crop.width / width));
    const y1 = crop.y + Math.min(crop.height, Math.ceil((y + 1) * crop.height / height));
    let winner = null, max = 0, n = 0; const counts = new Map(), sum = [0, 0, 0];
    if (mode === 'center') {
      const p = (Math.floor((y0 + y1 - 1) / 2) * source.width + Math.floor((x0 + x1 - 1) / 2)) * 4;
      output.push(source.data[p + 3] >= 128 ? Array.from(source.data.slice(p, p + 3)) : null);
      continue;
    }
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const p = (sy * source.width + sx) * 4;
      if (source.data[p + 3] < 128) continue;
      const rgb = [source.data[p], source.data[p + 1], source.data[p + 2]];
      n++;
      if (mode === 'mean') { for (let c = 0; c < 3; c++) sum[c] += rgb[c]; continue; }
      const key = mode === 'dominantQuantized' ? rgb.map(c => c >> 4).join(',') : rgb.join(',');
      const count = (counts.get(key) || 0) + 1; counts.set(key, count);
      if (count > max) { max = count; winner = rgb; }
    }
    output.push(mode === 'mean' ? (n ? sum.map(c => Math.round(c / n)) : null) : winner);
  }
  return output;
}

/** Optional neutral-line coverage rescue. Never draws a line without source evidence.
 * A minority gray connected component must span a cell and continue into a neighbour.
 * Kept separate from the exact upstream dominant baseline and disabled by default.
 */
export function protectCartoonNeutralLines(source, pooled, width, height, crop) {
  const candidates = new Array(pooled.length).fill(null);
  const neutral = rgb => rgb && luma(rgb) >= 90 && luma(rgb) <= 225 && Math.max(...rgb) - Math.min(...rgb) <= 22;
  // Preserve existing enclosed dark counters (e.g. the holes in a small "8" clip).
  // Compute from the immutable baseline, not from already repaired strokes.
  const counters = new Uint8Array(pooled.length), visited = new Uint8Array(pooled.length);
  for (let seed = 0; seed < pooled.length; seed++) {
    if (visited[seed] || !pooled[seed] || luma(pooled[seed]) > 85) continue;
    const queue = [seed]; visited[seed] = 1; let border = false;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % width, y = Math.floor(i / width);
      border ||= x === 0 || x === width - 1 || y === 0 || y === height - 1;
      for (const j of neighbours(i, width, height)) if (!visited[j] && pooled[j] && luma(pooled[j]) <= 85) {
        visited[j] = 1; queue.push(j);
      }
    }
    if (!border && queue.length <= 8) for (const i of queue) counters[i] = 1;
  }
  for (let i = 0; i < pooled.length; i++) {
    if (!pooled[i] || luma(pooled[i]) > 85 || counters[i]) continue;
    const x = i % width, y = Math.floor(i / width);
    const x0 = crop.x + Math.floor(x * crop.width / width), y0 = crop.y + Math.floor(y * crop.height / height);
    const x1 = crop.x + Math.ceil((x + 1) * crop.width / width), y1 = crop.y + Math.ceil((y + 1) * crop.height / height);
    const cw = x1 - x0, ch = y1 - y0, mask = new Uint8Array(cw * ch);
    for (let sy = 0; sy < ch; sy++) for (let sx = 0; sx < cw; sx++) {
      const p = ((sy + y0) * source.width + sx + x0) * 4;
      if (source.data[p + 3] >= 128 && neutral([source.data[p], source.data[p + 1], source.data[p + 2]])) mask[sy * cw + sx] = 1;
    }
    let best = 0;
    for (let seed = 0; seed < mask.length; seed++) {
      if (!mask[seed]) continue;
      mask[seed] = 0; const queue = [seed], sum = [0, 0, 0];
      let minX = cw, maxX = 0, minY = ch, maxY = 0;
      for (let head = 0; head < queue.length; head++) {
        const j = queue[head], sx = j % cw, sy = Math.floor(j / cw);
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        const p = ((sy + y0) * source.width + sx + x0) * 4;
        for (let c = 0; c < 3; c++) sum[c] += source.data[p + c];
        for (const n of neighbours(j, cw, ch)) if (mask[n]) { mask[n] = 0; queue.push(n); }
      }
      const area = queue.length;
      if (area > best && area >= Math.max(2, cw * ch * .065) &&
        ((maxX - minX + 1) / cw >= .55 || (maxY - minY + 1) / ch >= .55)) {
        candidates[i] = sum.map(c => Math.round(c / area)); best = area;
      }
    }
  }
  const protectedMask = new Uint8Array(pooled.length);
  const colors = pooled.map((rgb, i) => {
    const candidate = candidates[i]; if (!candidate) return rgb;
    // Bridge at most six missing cells between existing stroke endpoints.
    // Every intervening cell needs source evidence; rescue never feeds back into itself.
    const x = i % width, y = Math.floor(i / width);
    // Do not turn three existing gray corners into a solid 2x2 block.
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const other = [pooled[y * width + x + dx], pooled[(y + dy) * width + x], pooled[(y + dy) * width + x + dx]];
      if (other.every(rgb => neutral(rgb) && Math.abs(luma(rgb) - luma(candidate)) < 30)) return rgb;
    }
    const endpoint = (dx, dy) => {
      for (let step = 1; step <= 6; step++) {
        const nx = x + dx * step, ny = y + dy * step;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return 0;
        const j = ny * width + nx, original = pooled[j];
        if (neutral(original) && Math.abs(luma(original) - luma(candidate)) < 30) return step;
        if (!candidates[j] || Math.abs(luma(candidates[j]) - luma(candidate)) >= 30) return 0;
      }
      return 0;
    };
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const a = endpoint(dx, dy), b = endpoint(-dx, -dy);
      if (a && b && a + b <= 7) {
        protectedMask[i] = 1; return candidate;
      }
    }
    return rgb;
  });
  return { colors, protectedMask };
}

/** Edge comparisons use the immutable input grid, not the growing region's winner. */
export function mergeCartoonRegions(input, width, height, threshold, distance) {
  const output = input.slice();
  if (threshold === 0) return output;
  const seen = new Uint8Array(input.length);
  for (let start = 0; start < input.length; start++) {
    if (seen[start] || !input[start]) continue;
    const queue = [start], counts = new Map(); seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], c = input[i]; counts.set(c.code, (counts.get(c.code) || 0) + 1);
      for (const j of neighbours(i, width, height)) {
        if (!seen[j] && input[j] && distance(c, input[j]) < threshold) { seen[j] = 1; queue.push(j); }
      }
    }
    let winner = input[start], max = 0;
    for (const i of queue) if (counts.get(input[i].code) > max) { winner = input[i]; max = counts.get(winner.code); }
    for (const i of queue) output[i] = winner;
  }
  return output;
}

/** Upstream border-majority seed rule; optional explicit candidate code set. */
export function floodCartoonBackground(input, width, height, candidates = null) {
  const border = [];
  for (let x = 0; x < width; x++) { border.push(x); if (height > 1) border.push((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { border.push(y * width); if (width > 1) border.push(y * width + width - 1); }
  const counts = new Map();
  for (const i of border) if (input[i]) counts.set(input[i].code, (counts.get(input[i].code) || 0) + 1);
  const keys = candidates === null ? new Set([...counts].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([k]) => k)) : new Set(candidates);
  const external = new Uint8Array(input.length), queue = [];
  const push = i => { if (!external[i] && (!input[i] || keys.has(input[i].code))) { external[i] = 1; queue.push(i); } };
  border.forEach(push);
  for (let head = 0; head < queue.length; head++) neighbours(queue[head], width, height).forEach(push);
  return { external, candidates: [...keys] };
}

/** Value is a heuristic, not face/object recognition. Recomputed after each merge. */
export function reduceCartoonColors(input, width, height, maxColors, distance) {
  const output = input.slice(), merges = [];
  while (true) {
    const groups = new Map();
    for (let i = 0; i < output.length; i++) {
      const c = output[i]; if (!c) continue;
      if (!groups.has(c.code)) groups.set(c.code, { color: c, area: 0, edge: 0, contrast: 0 });
      const g = groups.get(c.code); g.area++;
      for (const j of neighbours(i, width, height)) if (output[j] && output[j].code !== c.code) {
        g.edge++; g.contrast += Math.abs(luma(c.rgb) - luma(output[j].rgb)) / 255;
      }
    }
    if (groups.size <= maxColors) break;
    const list = [...groups.values()];
    for (const g of list) {
      const rgb = g.color.rgb, light = luma(rgb), chroma = Math.max(...rgb) - Math.min(...rgb);
      const nearest = Math.min(...list.filter(v => v !== g).map(v => distance(g.color, v.color)));
      const accent = Math.min(3, nearest / 12);
      const skin = rgb[0] > rgb[1] && rgb[1] > rgb[2] && light > 90 && chroma < 95;
      const anchor = (light < 40 || light > 225) ? 4 : skin ? 1.8 : 1;
      // area/frequency, edge density, contrast, and perceptually unique accents.
      const theme = chroma > 65 && g.area / output.length > .0025 ? 3 : 1;
      g.value = Math.sqrt(g.area) * anchor * theme * (1 + g.edge / g.area + g.contrast / g.area + accent * 2);
    }
    list.sort((a, b) => a.value - b.value || a.color.code.localeCompare(b.color.code));
    const removed = list[0];
    const target = list.slice(1).sort((a, b) => distance(removed.color, a.color) - distance(removed.color, b.color))[0];
    const error = distance(removed.color, target.color);
    merges.push({ from: removed.color.code, to: target.color.code, area: removed.area, value: removed.value, deltaE: error });
    for (let i = 0; i < output.length; i++) if (output[i]?.code === removed.color.code) output[i] = target.color;
  }
  return { colors: output, merges };
}

/**
 * source={width,height,data:RGBA}; crop is an integer source-pixel rectangle.
 * colorMath={rgbToLab,deltaE2000} must be the host's existing implementation.
 * Defaults: dominant; no merge (0 DeltaE); keep background; unlimited colors.
 * grid uses color/null for host compatibility; cells additionally mark isExternal.
 * Run in a worker for large inputs. This module never hooks existing modes.
 */
export function runCartoonBeadPipeline({ source, width, height, palette, colorMath,
  crop = null, poolingMode = 'dominant', similarityThreshold = 0,
  removeBackground = false, backgroundCandidates = null, maxColors = null, excludedCodes = [], preserveNeutralLines = false }) {
  const integer = (v, max) => Number.isInteger(v) && v > 0 && v <= max;
  if (!source || !integer(source.width, 16384) || !integer(source.height, 16384) ||
    source.width * source.height > 64000000 || source.data?.length !== source.width * source.height * 4)
    throw new Error('Invalid RGBA source (maximum 64 million pixels)');
  crop ||= { x: 0, y: 0, width: source.width, height: source.height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 ||
    crop.width < 1 || crop.height < 1 || crop.x + crop.width > source.width || crop.y + crop.height > source.height)
    throw new Error('Invalid crop rectangle');
  height ??= Math.max(1, Math.round(width * crop.height / crop.width));
  if (!integer(width, 500) || !integer(height, 500)) throw new Error('Grid dimensions must be 1..500');
  if (!['dominant', 'center', 'mean', 'dominantQuantized'].includes(poolingMode)) throw new Error('Unknown pooling mode');
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0) throw new Error('Invalid DeltaE threshold');
  if (maxColors !== null && !integer(maxColors, 1024)) throw new Error('Invalid maxColors');
  if (typeof colorMath?.rgbToLab !== 'function' || typeof colorMath?.deltaE2000 !== 'function') throw new Error('Host Lab/DeltaE2000 required');
  const excluded = new Set(excludedCodes);
  if (!Array.isArray(palette) || palette.length > 1024) throw new Error('Invalid palette');
  const allowed = palette.filter(c => !excluded.has(c.code));
  if (!allowed.length || new Set(allowed.map(c => c.code)).size !== allowed.length || allowed.some(c =>
    !c.code || !Array.isArray(c.rgb) || c.rgb.length !== 3 || c.rgb.some(v => !Number.isFinite(v) || v < 0 || v > 255)))
    throw new Error('Empty or invalid palette after exclusions');
  const labs = new Map(allowed.map(c => [c.code, colorMath.rgbToLab(...c.rgb)])), distances = new Map();
  const distance = (a, b) => {
    const key = [a.code, b.code].sort().join('\0');
    if (!distances.has(key)) distances.set(key, colorMath.deltaE2000(labs.get(a.code), labs.get(b.code)));
    return distances.get(key);
  };
  const baseline = poolCartoonCells(source, width, height, crop, poolingMode), cache = new Map();
  const structure = preserveNeutralLines && poolingMode === 'dominant'
    ? protectCartoonNeutralLines(source, baseline, width, height, crop)
    : { colors: baseline, protectedMask: new Uint8Array(baseline.length) };
  const pooled = structure.colors;
  const mapped = pooled.map(rgb => {
    if (!rgb) return null;
    const key = rgb.join(','); if (cache.has(key)) return cache.get(key);
    const lab = colorMath.rgbToLab(...rgb); let best = allowed[0], error = Infinity;
    for (const c of allowed) { const d = colorMath.deltaE2000(lab, labs.get(c.code)); if (d < error) { error = d; best = c; } }
    cache.set(key, best); return best;
  });
  const merged = mergeCartoonRegions(mapped, width, height, similarityThreshold, distance);
  const background = removeBackground ? floodCartoonBackground(merged, width, height, backgroundCandidates)
    : { external: new Uint8Array(mapped.length), candidates: [] };
  const visible = merged.map((c, i) => background.external[i] ? null : c);
  const reduction = maxColors === null ? { colors: visible, merges: [] } : reduceCartoonColors(visible, width, height, maxColors, distance);
  const clone = c => c ? { ...c, rgb: [...c.rgb] } : null;
  const grid = Array.from({ length: height }, (_, y) => reduction.colors.slice(y * width, (y + 1) * width).map(clone));
  const cells = grid.map((row, y) => row.map((c, x) => c ? { ...c, isExternal: false }
    : { code: null, rgb: null, isExternal: Boolean(background.external[y * width + x]) }));
  return { width, height, grid, cells, diagnostics: {
    poolingMode, thresholdMetric: 'DeltaE2000', similarityThreshold, maxColors,
    preserveNeutralLines, protectedLineCells: structure.protectedMask.reduce((a, b) => a + b, 0),
    mappedColors: new Set(mapped.filter(Boolean).map(c => c.code)).size,
    usedColors: new Set(reduction.colors.filter(Boolean).map(c => c.code)).size,
    backgroundCandidates: background.candidates, externalCells: background.external.reduce((a, b) => a + b, 0),
    merges: reduction.merges,
  } };
}
