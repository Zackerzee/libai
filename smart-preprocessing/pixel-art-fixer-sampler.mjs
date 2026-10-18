// Selected port of Retro-Diffusion/pixel-art-fixer two_stage_pack (MIT).
// See vendor/pixel-art-fixer/PROVENANCE.md for scope and deliberate differences.
const MAX_SOURCE_PIXELS = 4_000_000;
const MAX_TARGET_SIDE = 1000;
const BIN_COUNT = 4096;

function keyAt(data, offset) {
  return ((data[offset] >> 4) << 8) | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
}
function distance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
function nearest(point, centers) {
  let winner = 0, best = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = distance(point, centers[i]);
    if (d < best) { best = d; winner = i; }
  }
  return winner;
}

/** Explicit-size reconstruction; returns RGBA only, never brand palette identities. */
export function samplePixelArtFixer(source, width, height, { alphaThreshold = 8 } = {}) {
  const sw = source?.width, sh = source?.height, data = source?.data;
  if (!Number.isInteger(sw) || !Number.isInteger(sh) || sw < 1 || sh < 1 || sw * sh > MAX_SOURCE_PIXELS
      || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
      || data.length !== sw * sh * 4) throw new RangeError('Pixel Art Fixer：源图必须是有效 RGBA，最多 400 万像素');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > MAX_TARGET_SIDE || height > MAX_TARGET_SIDE) throw new RangeError('Pixel Art Fixer：目标宽高必须为 1–1000 格');
  if (!Number.isFinite(alphaThreshold) || alphaThreshold < 0 || alphaThreshold >= 255)
    throw new RangeError('Pixel Art Fixer：透明阈值必须为 0–254');
  const counts = new Uint32Array(BIN_COUNT);
  const sums = new Float64Array(BIN_COUNT * 3);
  let opaque = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] <= alphaThreshold) continue;
    const key = keyAt(data, p); counts[key]++; opaque++;
    for (let c = 0; c < 3; c++) sums[key * 3 + c] += data[p + c];
  }
  const points = [];
  let meaningful = 0;
  for (let key = 0; key < BIN_COUNT; key++) if (counts[key]) {
    points.push({ key, count: counts[key], rgb: [0, 1, 2].map(c => sums[key * 3 + c] / counts[key]) });
    if (counts[key] / opaque >= 0.003) meaningful++;
  }
  const k = Math.min(points.length, Math.max(16, Math.min(48, meaningful)));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const diagnostics = { algorithm: 'pixel-art-fixer-two-stage-js-v1',
    upstreamRevision: 'ef376e57e1c272633ca2dbf5f29ec3fcf6596465', sourceWidth: sw, sourceHeight: sh,
    targetWidth: width, targetHeight: height, structureColors: k, histogramBins: points.length,
    maxIterations: 12, automaticGridDetection: false };
  if (!opaque) return { rgba, diagnostics };
  let first = points[0];
  for (const point of points) if (point.count > first.count) first = point;
  let centers = [first.rgb.slice()];
  // Stable farthest-point initialization, ties resolved by ascending bin key.
  while (centers.length < k) {
    let best = null, score = -1;
    for (const point of points) {
      const d = distance(point.rgb, centers[nearest(point.rgb, centers)]);
      if (d > score) { score = d; best = point; }
    }
    centers.push(best.rgb.slice());
  }
  for (let iteration = 0; iteration < 12; iteration++) {
    const totals = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const point of points) {
      const total = totals[nearest(point.rgb, centers)];
      for (let c = 0; c < 3; c++) total[c] += point.rgb[c] * point.count;
      total[3] += point.count;
    }
    const next = totals.map((total, i) => total[3] ? total.slice(0, 3).map(v => v / total[3]) : centers[i]);
    const movement = next.reduce((sum, center, i) => sum + distance(center, centers[i]), 0);
    centers = next;
    if (movement <= 0.25) break;
  }
  const labels = new Uint8Array(BIN_COUNT);
  for (const point of points) labels[point.key] = nearest(point.rgb, centers);
  const votes = new Float64Array(k), colors = new Float64Array(k * 3);
  const stepX = sw / width, stepY = sh / height;
  for (let cy = 0; cy < height; cy++) for (let cx = 0; cx < width; cx++) {
    const x0 = Math.ceil(cx * sw / width), x1 = Math.ceil((cx + 1) * sw / width);
    const y0 = Math.ceil(cy * sh / height), y1 = Math.ceil((cy + 1) * sh / height);
    const output = (cy * width + cx) * 4;
    // Native packing leaves holes when enlarged; explicit-size browser contract uses nearest fill.
    if (x0 === x1 || y0 === y1) {
      const p = (Math.min(sh - 1, Math.floor((cy + 0.5) * stepY)) * sw
        + Math.min(sw - 1, Math.floor((cx + 0.5) * stepX))) * 4;
      if (data[p + 3] > alphaThreshold) {
        rgba[output] = data[p]; rgba[output + 1] = data[p + 1]; rgba[output + 2] = data[p + 2]; rgba[output + 3] = 255;
      }
      continue;
    }
    votes.fill(0); colors.fill(0);
    let visible = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = (y * sw + x) * 4;
      if (data[p + 3] <= alphaThreshold) continue;
      visible++;
      const label = labels[keyAt(data, p)];
      const wx = Math.max(0, 1 - 2 * Math.abs((x + 0.5 - cx * stepX) / stepX - 0.5));
      const wy = Math.max(0, 1 - 2 * Math.abs((y + 0.5 - cy * stepY) / stepY - 0.5));
      const weight = wx * wy + 1e-4;
      votes[label] += weight;
      for (let c = 0; c < 3; c++) colors[label * 3 + c] += data[p + c] * weight;
    }
    if (visible <= (x1 - x0) * (y1 - y0) / 2) continue;
    let winner = 0;
    for (let label = 1; label < k; label++) if (votes[label] > votes[winner]) winner = label;
    for (let c = 0; c < 3; c++) rgba[output + c] = Math.round(colors[winner * 3 + c] / votes[winner]);
    rgba[output + 3] = 255;
  }
  return { rgba, diagnostics };
}
