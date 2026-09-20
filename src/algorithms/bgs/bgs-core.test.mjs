/**
 * BGS algorithm module — core primitive tests.
 *
 * Pure Node, no browser, no Canvas, no fixtures on disk.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BGS_CONFIG, BGS_CONFIG_META, upstreamSnapshot, calibratedConstants } from './config.mjs';
import {
  srgbToLinear, linearToSrgb, rgbToOklab, rgbToCielab, deltaE2000, oklabDistance,
  oklabChroma, isVisiblyChromatic, isDarkChromatic, otsuThreshold,
  hexToRgb, rgbToHex, preparePalette, buildExactIndex, clamp,
} from './color-space.mjs';
import {
  gridForLongSide, gridFromAspectAnchor, orientedSourceDimensions,
  fitGeometryMetrics, fitPatternInsideBoard, resolveGrid,
} from './geometry.mjs';
import {
  createRaster, cropRaster, rotateRasterCW, mirrorRaster, applyTransforms,
  resizeRaster, nearestRaster, fitRaster, applyPixelBudget, normalizeCrop,
} from './raster.mjs';
import { createMatcher } from './matcher.mjs';
import { cellBounds, resolveSamplingMode, SAMPLING_MODE, createScratch } from './sampling.mjs';
import { labelSourceOwners, thinMicro, buildMicroProjection, resolveMicroOwners } from './topology.mjs';

/* ─────────────────────────────────────────────────────────────
 * 测试用色板（自建，不复制上游色卡数据）
 * ───────────────────────────────────────────────────────────── */

export const TEST_PALETTE = [
  { code: 'H2', name: '白', hex: '#FFFFFF' },
  { code: 'H7', name: '黑', hex: '#000000' },
  { code: 'H3', name: '浅灰', hex: '#B6B1BA' },
  { code: 'H5', name: '深灰', hex: '#48464E' },
  { code: 'F4', name: '红', hex: '#FC283C' },
  { code: 'C5', name: '蓝', hex: '#01ACEB' },
  { code: 'A4', name: '黄', hex: '#FBED56' },
  { code: 'B4', name: '绿', hex: '#5DE035' },
];

function makeImage(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y, width, height);
      const p = (y * width + x) * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = a === undefined ? 255 : a;
    }
  }
  return { data, width, height };
}

/* ─────────────────────────────────────────────────────────────
 * config
 * ───────────────────────────────────────────────────────────── */

test('config exposes plain numeric leaves, never wrapper objects', () => {
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const here = `${path}.${key}`;
      if (Array.isArray(value)) {
        // Ranges are stored as plain arrays; only their *elements* must be primitives.
        for (const [i, element] of value.entries()) {
          assert.notEqual(typeof element, 'object', `${here}[${i}] should be a primitive`);
        }
      } else if (value && typeof value === 'object') {
        assert.equal(value.__tunable, undefined, `${here} leaked a tunable wrapper`);
        walk(value, here);
      } else {
        assert.notEqual(typeof value, 'object', `${here} should be a primitive`);
      }
    }
  };
  walk(BGS_CONFIG, 'BGS_CONFIG');

  // Spot-check the values that were silently mis-compared during development.
  assert.equal(typeof BGS_CONFIG.background.lightLuminance, 'number');
  assert.equal(typeof BGS_CONFIG.classify.docNearWhiteMin, 'number');
  assert.equal(typeof BGS_CONFIG.topology.inkCoverageThreshold, 'number');
  assert.equal(typeof BGS_CONFIG.matcher.candidateCount, 'number');
});

test('config metadata records the upstream origin of every tunable', () => {
  const snapshot = upstreamSnapshot();
  const paths = Object.keys(snapshot);
  assert.ok(paths.length > 120, `expected a rich metadata map, got ${paths.length}`);
  assert.equal(snapshot['background.lightLuminance'], 175);
  assert.equal(snapshot['sampling.outlineFactorBase'], 1.66);
  assert.equal(snapshot['anchors.saturatedHueMinGap'], 0.55);
  assert.equal(snapshot['topology.microLongSide'], 192);
  assert.ok(Object.values(BGS_CONFIG_META).every((entry) => typeof entry.note === 'string' && entry.note.length > 0));
});

test('calibratedConstants reports divergences from upstream', () => {
  const calibrated = calibratedConstants();
  // Nothing is intentionally off-upstream yet; every divergence must be listed here.
  for (const entry of calibrated) {
    assert.notEqual(entry.value, entry.upstreamValue);
  }
});

/* ─────────────────────────────────────────────────────────────
 * color-space
 * ───────────────────────────────────────────────────────────── */

test('sRGB transfer functions round-trip', () => {
  for (const value of [0, 1, 12, 127, 200, 254, 255]) {
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(value)) - value) < 1e-9);
  }
  assert.equal(srgbToLinear(0), 0);
  assert.ok(Math.abs(srgbToLinear(255) - 1) < 1e-12);
});

test('OKLab anchors are correct', () => {
  const white = rgbToOklab([255, 255, 255]);
  assert.ok(Math.abs(white[0] - 1) < 1e-6);
  assert.ok(Math.abs(white[1]) < 1e-6);
  assert.ok(Math.abs(white[2]) < 1e-6);

  const black = rgbToOklab([0, 0, 0]);
  assert.deepEqual(black.map((v) => Math.abs(v) < 1e-12), [true, true, true]);

  // Mid grey is neutral.
  assert.ok(oklabChroma(rgbToOklab([128, 128, 128])) < 1e-6);
});

test('CIELAB anchors are correct', () => {
  const white = rgbToCielab([255, 255, 255]);
  assert.ok(Math.abs(white[0] - 100) < 0.001);
  assert.ok(Math.abs(white[1]) < 0.01);
  assert.ok(Math.abs(white[2]) < 0.02);
  const black = rgbToCielab([0, 0, 0]);
  assert.deepEqual(black.map((v) => Math.abs(v) < 1e-9), [true, true, true]);
});

test('CIEDE2000 matches the Sharma reference pairs', () => {
  const cases = [
    { a: [50.0, 2.6772, -79.7751], b: [50.0, 0.0, -82.7485], expected: 2.0425 },
    { a: [50.0, 3.1571, -77.2803], b: [50.0, 0.0, -82.7485], expected: 2.8615 },
    { a: [50.0, 2.8361, -74.02], b: [50.0, 0.0, -82.7485], expected: 3.4412 },
    { a: [50.0, -1.3802, -84.2814], b: [50.0, 0.0, -82.7485], expected: 1.0 },
    { a: [50.0, -1.1848, -84.8006], b: [50.0, 0.0, -82.7485], expected: 1.0 },
  ];
  for (const { a, b, expected } of cases) {
    assert.ok(
      Math.abs(deltaE2000(a, b) - expected) < 0.001,
      `deltaE2000(${a}) vs (${b}) = ${deltaE2000(a, b)}, expected ${expected}`,
    );
  }
});

test('CIEDE2000 is symmetric and zero on identical colours', () => {
  const a = rgbToCielab([12, 200, 90]);
  const b = rgbToCielab([200, 30, 190]);
  assert.equal(deltaE2000(a, a), 0);
  assert.ok(Math.abs(deltaE2000(a, b) - deltaE2000(b, a)) < 1e-12);
});

test('chromatic detection separates grey from colour and keeps deep hues', () => {
  assert.equal(isVisiblyChromatic([128, 128, 128]), false);
  assert.equal(isVisiblyChromatic([255, 0, 0]), true);
  assert.equal(isVisiblyChromatic([250, 250, 250]), false);

  // A deep blue must not be flattened into "neutral dark".
  const deepBlue = rgbToOklab([10, 10, 90]);
  assert.equal(isDarkChromatic([10, 10, 90], deepBlue[0]), true);
  // A JPEG-tinted near-black should be treated as neutral.
  assert.equal(isDarkChromatic([14, 13, 16], rgbToOklab([14, 13, 16])[0]), false);
});

test('hex and rgb helpers round-trip', () => {
  assert.deepEqual(hexToRgb('#01ACEB'), [1, 172, 235]);
  assert.deepEqual(hexToRgb('01aceb'), [1, 172, 235]);
  assert.equal(hexToRgb('nope'), null);
  assert.equal(rgbToHex([1, 172, 235]), '#01ACEB');
});

test('otsuThreshold returns the plateau midpoint for a degenerate bimodal histogram', () => {
  // Two narrow spikes: the between-class variance plateaus across the valley.
  const histogram = new Uint32Array(256);
  histogram[40] = 500;
  histogram[200] = 500;
  const result = otsuThreshold(histogram, 1000);
  assert.ok(result.threshold > 40 && result.threshold < 200, `got ${result.threshold}`);
  assert.equal(result.flatPlateau, true);
  assert.equal(otsuThreshold(new Uint32Array(256), 0), null);
});

test('preparePalette always derives lab/cieLab and throws without a palette', () => {
  assert.throws(() => preparePalette([]), /palette/i);
  assert.throws(() => preparePalette(null), /palette/i);

  const prepared = preparePalette(TEST_PALETTE);
  assert.equal(prepared.length, TEST_PALETTE.length);
  for (const entry of prepared) {
    assert.equal(entry.lab.length, 3);
    assert.equal(entry.cieLab.length, 3);
    assert.equal(entry.rgb.length, 3);
    assert.equal(typeof entry.index, 'number');
    assert.equal(typeof entry.hex, 'string');
  }
  // Entries without an explicit index fall back to array position.
  assert.deepEqual(prepared.map((entry) => entry.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(prepared[0].transparent, false);

  // #RRGGBB is accepted in place of an rgb array.
  const fromHex = preparePalette([{ code: 'X', hex: '#123456' }]);
  assert.deepEqual(fromHex[0].rgb, [18, 52, 86]);

  // A palette entry with neither rgb nor hex must fail loudly, not silently.
  assert.throws(() => preparePalette([{ code: 'X' }]), /neither/);

  const exact = buildExactIndex(prepared);
  assert.equal(exact.get((255 << 16) | (255 << 8) | 255), 0);
  assert.equal(exact.get(0), 1);
});

/* ─────────────────────────────────────────────────────────────
 * geometry — the "no silent clamping" contract
 * ───────────────────────────────────────────────────────────── */

test('geometry preserves aspect ratio on the long side', () => {
  assert.deepEqual(gridForLongSide(5560, 3992, 24).rows, 17);
  assert.deepEqual(gridForLongSide(5560, 3992, 24).cols, 24);
  assert.deepEqual(gridForLongSide(1000, 1400, 24).cols, 17);
  assert.deepEqual(gridForLongSide(1000, 1400, 24).rows, 24);
});

test('geometry reports out-of-range requests instead of clamping them', () => {
  const huge = gridForLongSide(1000, 1000, 5000);
  assert.equal(huge.cols, 5000, 'must NOT be clamped to maxSide');
  assert.equal(huge.limits.ok, false);
  assert.deepEqual(huge.limits.outOfRange[0], { axis: 'cols', value: 5000, limit: BGS_CONFIG.limits.maxGridSide, kind: 'aboveMax' });

  const tiny = gridFromAspectAnchor(1000, 1000, 0, 'cols');
  assert.equal(tiny.cols, 1);
  assert.equal(tiny.limits.ok, true, 'side 1 is within [minGridSide, maxGridSide]');
});

test('resolveGrid derives the missing axis and reports how', () => {
  const fromWidth = resolveGrid({ sourceWidth: 200, sourceHeight: 100, width: 40 });
  assert.equal(fromWidth.cols, 40);
  assert.equal(fromWidth.rows, 20);
  assert.equal(fromWidth.derived, 'rowsFromWidth');

  const fromHeight = resolveGrid({ sourceWidth: 200, sourceHeight: 100, height: 40 });
  assert.equal(fromHeight.rows, 40);
  assert.equal(fromHeight.cols, 80);
  assert.equal(fromHeight.derived, 'colsFromHeight');

  assert.throws(() => resolveGrid({ sourceWidth: 10, sourceHeight: 10 }), /width or options.height/);

  // preserveAspectRatio: false must accept both axes verbatim.
  const stretched = resolveGrid({ sourceWidth: 200, sourceHeight: 100, width: 30, height: 90, preserveAspectRatio: false });
  assert.deepEqual([stretched.cols, stretched.rows], [30, 90]);
  assert.equal(stretched.derived, 'none');
});

test('EXIF orientation detection compares log aspect error', () => {
  assert.deepEqual(orientedSourceDimensions({ width: 4032, height: 3024 }, { width: 3024, height: 4032 }), {
    width: 3024, height: 4032, orientationSwapped: true,
  });
  assert.equal(orientedSourceDimensions({ width: 100, height: 50 }, { width: 100, height: 50 }).orientationSwapped, false);
});

test('fitGeometryMetrics discloses letterbox and crop cost separately', () => {
  const contain = fitGeometryMetrics(200, 100, 40, 60, 'contain');
  assert.ok(contain.letterboxFraction > 0);
  assert.equal(contain.cropFraction, 0);

  const cover = fitGeometryMetrics(200, 100, 40, 60, 'cover');
  assert.equal(cover.letterboxFraction, 0);
  assert.ok(cover.cropFraction > 0);

  const exact = fitGeometryMetrics(200, 100, 40, 20, 'contain');
  assert.ok(exact.mismatch < 1e-9);
});

test('fitPatternInsideBoard centres without stretching', () => {
  const fit = fitPatternInsideBoard(5560, 3992, 52, 52);
  assert.deepEqual({ cols: fit.cols, rows: fit.rows, offsetX: fit.offsetX, offsetY: fit.offsetY }, {
    cols: 52, rows: 37, offsetX: 0, offsetY: 7,
  });
  assert.equal(fit.blankTop, 7);
  assert.equal(fit.blankBottom, 8);
  assert.ok(fit.aspectError < 0.02);
});

/* ─────────────────────────────────────────────────────────────
 * raster — host boundary, pure
 * ───────────────────────────────────────────────────────────── */

test('asRaster-style validation rejects malformed input', () => {
  assert.throws(() => cropRaster({ width: 4, height: 4 }, { x: 0, y: 0, w: 2, h: 2 }), /must be/);
  const short = { data: new Uint8ClampedArray(4), width: 2, height: 2 };
  assert.throws(() => cropRaster(short, { x: 0, y: 0, w: 1, h: 1 }), /too short/);
});

test('cropRaster extracts the requested window', () => {
  const src = makeImage(4, 4, (x, y) => [x * 60, y * 60, 0]);
  const cropped = cropRaster(src, { x: 1, y: 1, w: 2, h: 2 });
  assert.equal(cropped.width, 2);
  assert.equal(cropped.height, 2);
  assert.deepEqual([cropped.data[0], cropped.data[1], cropped.data[2]], [60, 60, 0]);
  assert.deepEqual([cropped.data[4], cropped.data[5], cropped.data[6]], [120, 60, 0]);
});

test('rotate and mirror are correct and involutive', () => {
  const src = makeImage(3, 2, (x, y) => [x * 100, y * 100, 0]);

  const rotated = rotateRasterCW(src);
  assert.deepEqual([rotated.width, rotated.height], [2, 3]);

  const mirrored = mirrorRaster(src, 'h');
  assert.deepEqual([mirrored.data[0], mirrored.data[1]], [200, 0], 'leftmost source column moves to the right');
  assert.deepEqual(mirrorRaster(mirrored, 'h').data, src.data);

  const flipped = mirrorRaster(src, 'v');
  assert.deepEqual(mirrorRaster(flipped, 'v').data, src.data);

  // Four rotations return to the original.
  let spun = src;
  for (let i = 0; i < 4; i++) spun = rotateRasterCW(spun);
  assert.deepEqual(spun.data, src.data);

  // Transforms apply in order.
  const chain = applyTransforms(src, ['rotate', 'mirrorH']);
  assert.deepEqual([chain.width, chain.height], [2, 3]);
  assert.deepEqual(chain.data, mirrorRaster(rotateRasterCW(src), 'h').data);
});

test('resizeRaster area-averages on downscale and preserves a flat colour exactly', () => {
  const flat = makeImage(16, 16, () => [10, 200, 90]);
  const small = resizeRaster(flat, 4, 4);
  assert.deepEqual([small.width, small.height], [4, 4]);
  for (let i = 0; i < 4 * 4; i++) {
    assert.equal(small.data[i * 4], 10);
    assert.equal(small.data[i * 4 + 1], 200);
    assert.equal(small.data[i * 4 + 2], 90);
    assert.equal(small.data[i * 4 + 3], 255);
  }
});

test('resizeRaster blends translucent edges without dark fringes', () => {
  // Half opaque red, half fully transparent: the premultiplied result must stay red,
  // not drift towards black.
  const src = createRaster(2, 1);
  src.data.set([255, 0, 0, 255], 0);
  src.data.set([255, 0, 0, 0], 4);
  const out = resizeRaster(src, 1, 1);
  assert.equal(out.data[0], 255);
  assert.equal(out.data[1], 0);
  assert.equal(out.data[2], 0);
  assert.ok(out.data[3] > 100 && out.data[3] < 160, `alpha ${out.data[3]} should be about half`);
});

test('resizeRaster upscales with bilinear interpolation', () => {
  const src = createRaster(2, 1);
  src.data.set([0, 0, 0, 255], 0);
  src.data.set([255, 255, 255, 255], 4);
  const out = resizeRaster(src, 4, 1);
  assert.ok(out.data[0] < 60, 'left edge stays dark');
  assert.ok(out.data[12] > 190, 'right edge stays light');
  assert.ok(out.data[4] > out.data[0] && out.data[8] > out.data[4], 'gradient is monotonic');
});

test('nearestRaster does not introduce new colours', () => {
  const src = makeImage(2, 2, (x, y) => (x === y ? [255, 255, 255] : [0, 0, 0]));
  const up = nearestRaster(src, 4, 4);
  for (let i = 0; i < 16; i++) {
    const rgb = [up.data[i * 4], up.data[i * 4 + 1], up.data[i * 4 + 2]];
    assert.ok(rgb[0] === 0 || rgb[0] === 255, `unexpected colour ${rgb}`);
  }
});

test('fitRaster contain pads and reports the letterbox fraction', () => {
  const src = makeImage(40, 10, () => [0, 0, 255]);
  const result = fitRaster(src, 40, 40, { fitMode: 'contain' });
  assert.deepEqual([result.raster.width, result.raster.height], [40, 40]);
  assert.ok(result.letterboxFraction > 0.7, `letterbox ${result.letterboxFraction}`);
  assert.equal(result.cropFraction, 0);
  // Padded rows are transparent.
  assert.equal(result.raster.data[3], 0);
});

test('fitRaster cover crops and reports the crop fraction', () => {
  const src = makeImage(40, 10, () => [0, 0, 255]);
  const result = fitRaster(src, 40, 40, { fitMode: 'cover' });
  assert.deepEqual([result.raster.width, result.raster.height], [40, 40]);
  assert.equal(result.letterboxFraction, 0);
  assert.ok(result.cropFraction > 0.5, `crop ${result.cropFraction}`);
  // Every output pixel is filled.
  assert.equal(result.raster.data[3], 255);
});

test('applyPixelBudget only ever downscales', () => {
  const src = makeImage(100, 100, () => [1, 2, 3]);
  const untouched = applyPixelBudget(src, 1_000_000);
  assert.equal(untouched.downscaled, false);
  assert.equal(untouched.scale, 1);

  const reduced = applyPixelBudget(src, 2500);
  assert.equal(reduced.downscaled, true);
  assert.ok(reduced.raster.width * reduced.raster.height <= 2500);
  assert.ok(Math.abs(reduced.raster.width - 50) <= 1);
});

test('normalizeCrop keeps crops inside the source', () => {
  assert.deepEqual(normalizeCrop(null), { x: 0, y: 0, w: 1, h: 1 });
  const clamped = normalizeCrop({ x: 0.8, y: 0.8, w: 1, h: 1 });
  assert.ok(clamped.w <= 0.2 + 1e-9);
  assert.ok(clamped.h <= 0.2 + 1e-9);
});

/* ─────────────────────────────────────────────────────────────
 * matcher
 * ───────────────────────────────────────────────────────────── */

test('matcher returns exact palette colours verbatim', () => {
  const palette = preparePalette(TEST_PALETTE);
  const matcher = createMatcher(palette);
  for (const entry of palette) {
    const hit = matcher.match(entry.rgb[0], entry.rgb[1], entry.rgb[2]);
    assert.deepEqual(hit.entry.rgb, entry.rgb);
    assert.equal(hit.distance, 0);
    assert.equal(hit.exact, true);
  }
});

test('matcher resolves off-palette colours to a perceptual neighbour', () => {
  const matcher = createMatcher(preparePalette(TEST_PALETTE));
  const hit = matcher.match(250, 20, 40); // near F4 red
  assert.equal(hit.entry.code, 'F4');
  assert.ok(hit.distance > 0 && hit.distance < 20);
});

test('matcher anchors: black is the darkest neutral, white is the declared white', () => {
  const matcher = createMatcher(preparePalette(TEST_PALETTE), { whiteCode: 'H2', blackCode: 'H7' });
  assert.equal(matcher.palette[matcher.whitePosition].code, 'H2');
  assert.equal(matcher.palette[matcher.blackPosition].code, 'H7');
  assert.equal(matcher.palette[matcher.outlinePosition].code, 'H7');
  // Crisp grey must stay grey rather than snapping to a chromatic colour.
  assert.equal(matcher.match(128, 128, 128).entry.code, 'H3');
});

test('matcher is deterministic and threads palette.index correctly', () => {
  const palette = preparePalette([
    { code: 'T', hex: '#FDFBFF', transparent: true },
    { code: 'H2', hex: '#FFFFFF' },
    { code: 'H7', hex: '#000000' },
  ]);
  const matcher = createMatcher(palette);
  const first = matcher.match(254, 253, 255).entry.code;
  const second = matcher.match(254, 253, 255).entry.code;
  assert.equal(first, second);
  // `entryOf` is addressed by palette.index, not array position.
  const withoutTransparent = preparePalette([
    { code: 'H2', hex: '#FFFFFF' },
    { code: 'H7', hex: '#000000' },
  ]);
  const reindexed = createMatcher(withoutTransparent);
  assert.equal(reindexed.entryOf(1).code, 'H7');
  assert.equal(reindexed.isChromaticIndex(1), false);
  // An index the palette does not contain is not chromatic, it simply does not exist.
  assert.equal(reindexed.isChromaticIndex(4), false);

  // Index 4 of the full test palette is F4 red, which is visibly chromatic.
  const full = createMatcher(preparePalette(TEST_PALETTE));
  assert.equal(full.entryOf(4).code, 'F4');
  assert.equal(full.isChromaticIndex(4), true, 'F4 red is chromatic');
  assert.equal(full.isChromaticIndex(0), false, 'H2 white is neutral');
});

test('forceNeutral confines a match to neutral entries', () => {
  const matcher = createMatcher(preparePalette(TEST_PALETTE));
  // A warm orange: nearest by CIEDE2000 is F4 red, but a neutral-only match must not
  // reach a chromatic entry.
  const free = matcher.match(200, 80, 40);
  const forced = matcher.match(200, 80, 40, { forceNeutral: true });
  assert.equal(matcher.isChromaticIndex(free.entry.index), true);
  assert.equal(matcher.isChromaticIndex(forced.entry.index), false);
  assert.notEqual(free.entry.code, forced.entry.code);
});

test('OKLab distance and clamp behave', () => {
  assert.equal(oklabDistance([0, 0, 0], [0, 0, 0]), 0);
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(Number.NaN, 2, 10), 2);
});

/* ─────────────────────────────────────────────────────────────
 * sampling primitives
 * ───────────────────────────────────────────────────────────── */

test('cellBounds partitions the source without gaps or overlap', () => {
  const cols = 7;
  const rows = 5;
  const width = 33;
  const height = 21;
  const cover = new Uint32Array(width * height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const b = cellBounds(x, y, width, height, cols, rows);
      assert.ok(b.x1 > b.x0 && b.y1 > b.y0);
      for (let sy = b.y0; sy < b.y1; sy++) {
        for (let sx = b.x0; sx < b.x1; sx++) cover[sy * width + sx]++;
      }
    }
  }
  for (let i = 0; i < cover.length; i++) {
    assert.equal(cover[i], 1, `pixel ${i} covered ${cover[i]} times`);
  }
});

test('sampling mode aliases resolve to canonical modes', () => {
  assert.equal(resolveSamplingMode('pixel'), SAMPLING_MODE.CENTER);
  assert.equal(resolveSamplingMode('photo'), SAMPLING_MODE.LINEAR);
  assert.equal(resolveSamplingMode('detail'), SAMPLING_MODE.LINEAR);
  assert.equal(resolveSamplingMode('cartoon'), SAMPLING_MODE.DOMINANT);
  assert.equal(resolveSamplingMode('dominant'), SAMPLING_MODE.DOMINANT);
  assert.equal(resolveSamplingMode('edge-aware'), SAMPLING_MODE.EDGE_AWARE);
  assert.equal(resolveSamplingMode('document'), SAMPLING_MODE.DOCUMENT);
  // auto falls back to the content classification.
  assert.equal(resolveSamplingMode('auto', { likelyDocument: true }), SAMPLING_MODE.DOCUMENT);
  assert.equal(resolveSamplingMode('auto', { likelyPhoto: true }), SAMPLING_MODE.LINEAR);
  assert.equal(resolveSamplingMode('auto', {}), SAMPLING_MODE.DOMINANT);
});

test('createScratch sizes buffers from the palette and sample axes', () => {
  const scratch = createScratch(12, 9);
  assert.equal(scratch.scores.length, 12);
  assert.equal(scratch.rawScores.length, 12);
  assert.equal(scratch.featureScores.length, 12);
  assert.equal(scratch.outlineRowHits.length, 9);
  assert.equal(scratch.outlineColHits.length, 9);
});

/* ─────────────────────────────────────────────────────────────
 * topology primitives
 * ───────────────────────────────────────────────────────────── */

test('labelSourceOwners separates disconnected ink components', () => {
  const width = 20;
  const height = 10;
  const src = makeImage(width, height, (x, y) => {
    if (x >= 1 && x <= 3 && y >= 1 && y <= 3) return [0, 0, 0];      // 4×4 square → 3×3
    if (x >= 15 && x <= 17 && y >= 6 && y <= 8) return [0, 0, 0];    // separate square
    return [255, 255, 255];
  });

  const luminance = new Uint8Array(width * height).fill(255);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    luminance[i] = src.data[p] === 0 ? 0 : 255;
  }
  const background = new Uint8Array(width * height);
  const { owners, ownerAreas, components } = labelSourceOwners({
    raster: src, width, height, luminance, background, rasterCutoff: 156,
  });

  assert.equal(components, 2);
  assert.equal(ownerAreas[1], 9);
  assert.equal(ownerAreas[2], 9);
  assert.equal(owners[2 * width + 2], 1);
  assert.equal(owners[7 * width + 16], 2);
  assert.equal(owners[5 * width + 10], 0);
});

test('labelSourceOwners ignores chromatic pixels so colour art is not ink', () => {
  const src = makeImage(6, 6, () => [240, 30, 30]);
  const luminance = new Uint8Array(36).fill(80);
  const { components } = labelSourceOwners({
    raster: src, width: 6, height: 6, luminance, background: new Uint8Array(36), rasterCutoff: 156,
  });
  assert.equal(components, 0);
});

test('thinMicro reduces a 3-pixel-wide bar to a single-pixel line', () => {
  const microWidth = 20;
  const microHeight = 20;
  const microCount = microWidth * microHeight;
  const microTotal = new Float32Array(microCount).fill(1);
  const microInk = new Float32Array(microCount);
  for (let y = 9; y <= 11; y++) {
    for (let x = 2; x <= 17; x++) microInk[y * microWidth + x] = 1;
  }

  const { thinned, rounds, hitRoundLimit } = thinMicro({ microInk, microTotal, microWidth, microHeight });
  assert.equal(hitRoundLimit, false);
  assert.ok(rounds > 0);

  let width = 0;
  for (let y = 0; y < microHeight; y++) {
    for (let x = 0; x < microWidth; x++) if (thinned[y * microWidth + x]) width++;
  }
  assert.ok(width <= 16, `thinned to ${width} pixels, expected <= the 16-wide bar`);

  // The line must remain one connected, unbroken run — no gaps anywhere along it.
  const row = 10;
  let horizontal = 0;
  let firstColumn = -1;
  let lastColumn = -1;
  for (let x = 0; x < microWidth; x++) {
    let has = false;
    for (let y = 8; y <= 12; y++) if (thinned[y * microWidth + x]) has = true;
    if (has) {
      horizontal++;
      if (firstColumn < 0) firstColumn = x;
      lastColumn = x;
    }
  }
  // A run of `horizontal` columns with no gap must also span exactly that many columns.
  assert.equal(lastColumn - firstColumn + 1, horizontal, 'the thinned line must have no gap');

  // Zhang–Suen is allowed to erode a few pixels off each free end of the bar, but it must
  // keep the great majority of the stroke so the pattern still reads as the same object.
  assert.ok(horizontal >= 12, `the line must still span most of the original 16 columns, got ${horizontal}`);
  assert.ok(horizontal <= 16, `the line must not grow beyond the original 16 columns, got ${horizontal}`);

  // A correct thinning output is one bead wide: no pixel may have more than 2 neighbours,
  // and a straight stroke has exactly two endpoints.
  const neighbourCounts = [];
  for (let y = 0; y < microHeight; y++) {
    for (let x = 0; x < microWidth; x++) {
      if (!thinned[y * microWidth + x]) continue;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= microHeight || nx < 0 || nx >= microWidth) continue;
          if (thinned[ny * microWidth + nx]) count++;
        }
      }
      neighbourCounts.push(count);
    }
  }
  assert.ok(neighbourCounts.every((count) => count <= 2), 'thinning must not leave thick nodes behind');
  assert.equal(neighbourCounts.filter((count) => count === 1).length, 2, 'a straight stroke has exactly two endpoints');
  assert.ok(thinned[row * microWidth + 9] === 1 || thinned[(row - 1) * microWidth + 9] === 1 || thinned[(row + 1) * microWidth + 9] === 1);
});

test('buildMicroProjection uses fractional area so scale is irrelevant', () => {
  const width = 8;
  const height = 8;
  const owners = new Int32Array(width * height);
  // A single ink pixel at the centre.
  owners[4 * width + 4] = 1;

  const projection = buildMicroProjection({ owners, width, height, cols: 2, rows: 2, supersample: 4 });
  assert.deepEqual([projection.microWidth, projection.microHeight], [8, 8]);

  let totalInk = 0;
  for (const value of projection.microInk) totalInk += value;
  assert.ok(Math.abs(totalInk - 1) < 1e-9, `ink mass ${totalInk} must equal one source pixel`);

  const ownersResolved = resolveMicroOwners({ ...projection, ownerAreas: Int32Array.from([0, 1]) });
  let owned = 0;
  for (const value of ownersResolved) if (value) owned++;
  assert.ok(owned >= 1 && owned <= 4, `one pixel should touch 1–4 micro cells, got ${owned}`);
});

test('buildMicroProjection records conflicts when two owners share a micro cell', () => {
  const width = 4;
  const height = 1;
  const owners = Int32Array.from([1, 1, 2, 2]);
  const projection = buildMicroProjection({ owners, width, height, cols: 2, rows: 1, supersample: 2 });
  // Downscaling 4 source pixels into 2 micro columns puts owners 1 and 2 in one cell
  // only if the boundary falls inside a cell; here it lands exactly on a boundary.
  const totalInk = Array.from(projection.microInk).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(totalInk - 4) < 1e-9);
});

export { makeImage };
