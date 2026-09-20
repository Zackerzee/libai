/**
 * pindou-workbench 算法模块 —— 底层原语测试。
 *
 * 纯 Node，无浏览器、无 Canvas、无磁盘 fixture。
 * 覆盖：config / sampling(cover-resize, grid-sampling) / segmentation(sobel3,
 * sobel5, multi-scale-edge, adaptive-threshold, background-kmeans, morphology,
 * feather-mask) / quantization(kmeans, dominant-colors) / color(weighted-rgb,
 * palette-match)。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PW_CONFIG, PW_CONFIG_META, ORIGIN, UPSTREAM, UPSTREAM_ALGORITHM_REGION,
  PRECISION, GRID_SAMPLE_MODE, THRESHOLD_MODE, BACKGROUND_MODE, ERODE_MODE,
  PALETTE_MATCH_MODE, EDGE_FUSE, PIPELINE_PROFILE,
  resolvePrecision, upstreamConstants, libmsFilledConstants,
} from './config.js';

import {
  FIT_MODE, RESAMPLE_FILTER, fitGeometry, coverGeometry, asRaster, resample, resizeToGrid,
} from './sampling/cover-resize.js';
import {
  cellBounds, sampleCells, sampleGrid, toPixelList, foregroundPixelList, GRID_LIMITS,
} from './sampling/grid-sampling.js';

import { toLuma, sobel3, sobel3Energy, LUMA_WEIGHTS } from './segmentation/sobel3.js';
import { sobel5, sobel5Energy, SOBEL5_RADIUS } from './segmentation/sobel5.js';
import { multiScaleEdge, defaultScales, nonzeroQuantile } from './segmentation/multi-scale-edge.js';
import {
  edgeHistogram, medianOfNonZero, otsuOnMagnitude, resolveThreshold, binarize,
} from './segmentation/adaptive-threshold.js';
import {
  backgroundMargin, collectBorderSamples, borderMean, backgroundKMeans,
  estimateBackground, markBackgroundSimilar,
} from './segmentation/background-kmeans.js';
import {
  dilate, erode, majorityErode, erodeWith, open, close,
  connectedComponents, filterComponents, componentStats,
} from './segmentation/morphology.js';
import {
  gaussianKernel, blurChannel, featherRadiusForPrecision, featherMask,
} from './segmentation/feather-mask.js';
import { segmentForeground } from './segmentation/index.js';

import { kMeans, kMeansPalette, KMEANS_INIT } from './quantization/kmeans.js';
import {
  binKey, colorHistogram, dominantColors, medianCut, colorsToPalette,
} from './quantization/dominant-colors.js';

import {
  weightedRgbDistance, weightedRgbDistanceSquared, normalizedWeightedRgbDistance,
  redmeanDistance, euclideanRgbDistance, WEIGHTED_RGB_WEIGHTS, MAX_WEIGHTED_RGB_DISTANCE,
} from './color/weighted-rgb.js';
import { createPaletteMatcher, preparePalette, MATCH_MODE_INFO } from './color/palette-match.js';

/* ─────────────────────────────────────────────────────────────
 * 测试用色板（自建，不复制任何上游色卡数据）
 * ───────────────────────────────────────────────────────────── */

const TEST_PALETTE = [
  { code: 'W1', name: '白', hex: '#FFFFFF' },
  { code: 'K1', name: '黑', hex: '#000000' },
  { code: 'R1', name: '红', hex: '#E03030' },
  { code: 'G1', name: '绿', hex: '#3FA34D' },
  { code: 'B1', name: '蓝', hex: '#2A5FB4' },
  { code: 'Y1', name: '黄', hex: '#F2D544' },
  { code: 'X0', name: '透明', hex: '#F5F5F5', transparent: true },
];

/** 生成 `{data,width,height}` 四通道栅格。`paint(x,y,w,h)` 返回 `[r,g,b,a?]`。 */
function makeRaster(width, height, paint) {
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

/** 灰度栅格（r=g=b=luma）。 */
function grayRaster(width, height, lumaOf) {
  return makeRaster(width, height, (x, y) => {
    const v = lumaOf(x, y, width, height);
    return [v, v, v];
  });
}

/** `Uint8Array` 掩码 → `{width,height}`。 */
function maskOf(width, height, fn) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mask[y * width + x] = fn(x, y, width, height) ? 1 : 0;
  }
  return mask;
}

const countOn = (mask) => mask.reduce((sum, v) => sum + (v ? 1 : 0), 0);

/* ─────────────────────────────────────────────────────────────
 * config —— 与 bgs 批次同一条纪律：叶子必须是原始值
 * ───────────────────────────────────────────────────────────── */

test('PW_CONFIG leaves are primitives or arrays of primitives', () => {
  const seen = [];
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        for (const [i, element] of value.entries()) {
          assert.notEqual(typeof element, 'object', `${here}[${i}] 应为原始值`);
        }
        seen.push(here);
        continue;
      }
      if (value !== null && typeof value === 'object') {
        walk(value, here);
        continue;
      }
      seen.push(here);
    }
  };
  walk(PW_CONFIG, '');
  assert.ok(seen.length > 30, `叶子数量应足够多，实际 ${seen.length}`);
  // 卷积核必须是平铺数组，不是 tunable 包装对象 —— 否则数值比较会静默失效。
  assert.ok(Array.isArray(PW_CONFIG.sobel3.kx));
  assert.equal(PW_CONFIG.sobel3.kx.length, 9);
  assert.equal(PW_CONFIG.sobel5.kx.length, 25);
  assert.equal(PW_CONFIG.weightedRgb.weights.length, 3);
});

test('PW_CONFIG_META annotates every leaf with origin and provenance evidence', () => {
  const origins = new Set(Object.values(ORIGIN));
  const entries = Object.entries(PW_CONFIG_META);
  assert.ok(entries.length > 30);
  for (const [path, meta] of entries) {
    assert.ok(origins.has(meta.origin), `${path} 的 origin 非法：${meta.origin}`);
    assert.ok('upstreamValue' in meta, `${path} 缺少 upstreamValue`);
    // 移植项必须给出上游文件位置；补全项必须说明「为什么补」。
    if (meta.origin === ORIGIN.UPSTREAM_PORT) assert.ok(meta.ref, `${path} 是移植项但没写 ref`);
    if (meta.origin === ORIGIN.LIBMS_FILL) assert.ok(meta.note, `${path} 是补全项但没写 note`);
  }
  // 有记录的 LIBMS_FILL 叶子必须真的非空（上游没有 5×5 / 多尺度 / 羽化）
  const filled = entries.filter(([, meta]) => meta.origin === ORIGIN.LIBMS_FILL);
  assert.ok(filled.length > 0, '本仓库补全的常量应当非空（上游只有 3×3 Sobel）');
  // 显式声明「上游没有」的项不能同时被算作有上游对应物
  for (const [path, meta] of entries) {
    if (meta.upstreamValue === null) {
      assert.equal(meta.hasUpstreamCounterpart, false, `${path} upstreamValue 为 null 却声称有上游对应物`);
    }
  }
});

test('upstream / libms-filled constant sets partition the config', () => {
  const upstream = upstreamConstants();
  const filled = libmsFilledConstants();
  assert.ok(Object.keys(upstream).length > 0);
  assert.ok(Object.keys(filled).length > 0);
  const overlap = Object.keys(upstream).filter((k) => k in filled);
  assert.deepEqual(overlap, [], '两集合不应有交集');
});

test('config declares the upstream algorithm region and commit', () => {
  assert.equal(UPSTREAM_ALGORITHM_REGION.from, 47);
  assert.equal(UPSTREAM_ALGORITHM_REGION.to, 253);
  assert.ok(typeof UPSTREAM.commit === 'string' && UPSTREAM.commit.length >= 7);
  assert.ok(typeof UPSTREAM.repo === 'string' && UPSTREAM.repo.includes('pindou-workbench'));
});

test('enum constants are frozen and internally consistent', () => {
  for (const enumObject of [
    ORIGIN, PRECISION, GRID_SAMPLE_MODE, THRESHOLD_MODE, BACKGROUND_MODE,
    ERODE_MODE, PALETTE_MATCH_MODE, EDGE_FUSE, PIPELINE_PROFILE,
    FIT_MODE, RESAMPLE_FILTER, KMEANS_INIT,
  ]) {
    assert.ok(Object.isFrozen(enumObject));
  }
  assert.equal(PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB, 'original-weighted-rgb');
  assert.equal(PALETTE_MATCH_MODE.LAB, 'lab');
  assert.equal(PALETTE_MATCH_MODE.CIEDE2000, 'ciede2000');
  assert.equal(PIPELINE_PROFILE.UPSTREAM, 'upstream');
  assert.equal(PIPELINE_PROFILE.IMPROVED, 'improved');
});

test('resolvePrecision falls back to the default preset for unknown names', () => {
  const balanced = resolvePrecision('balanced');
  assert.deepEqual(
    { edgeThresh: balanced.edgeThresh, colorThresh: balanced.colorThresh, morphIter: balanced.morphIter },
    { edgeThresh: PW_CONFIG.precision.balanced.edgeThresh, colorThresh: PW_CONFIG.precision.balanced.colorThresh, morphIter: PW_CONFIG.precision.balanced.morphIter },
  );
  assert.deepEqual(resolvePrecision('并不存在的档位'), balanced);
  // 档位越高阈值越低、迭代越多（fast 80/1 → precise 40/3）
  assert.ok(resolvePrecision('fast').edgeThresh > resolvePrecision('precise').edgeThresh);
  assert.ok(resolvePrecision('fast').morphIter < resolvePrecision('precise').morphIter);
});

/* ─────────────────────────────────────────────────────────────
 * sampling / cover-resize —— 替换 Canvas drawImage 的宿主边界
 * ───────────────────────────────────────────────────────────── */

test('fitGeometry COVER fills the whole destination and crops the overflow', () => {
  const wide = fitGeometry(FIT_MODE.COVER, 400, 100, 60, 60);
  assert.equal(wide.scale, Math.max(60 / 400, 60 / 100));
  assert.equal(wide.letterboxFraction, 0, 'cover 不应留边');
  assert.ok(wide.croppedFraction > 0, '宽图放进方框必然裁掉两侧');
  assert.equal(wide.sh, 100, 'cover 时可见源高度应等于整幅');

  const tall = fitGeometry(FIT_MODE.COVER, 100, 400, 60, 60);
  assert.equal(tall.sw, 100);
  assert.ok(tall.croppedFraction > 0);

  const same = fitGeometry(FIT_MODE.COVER, 60, 60, 60, 60);
  assert.equal(same.scale, 1);
  assert.equal(same.croppedFraction, 0);
});

test('fitGeometry CONTAIN fits inside and reports the letterbox', () => {
  const geometry = fitGeometry(FIT_MODE.CONTAIN, 400, 100, 60, 60);
  assert.equal(geometry.scale, Math.min(60 / 400, 60 / 100));
  assert.equal(geometry.croppedFraction, 0);
  assert.ok(geometry.letterboxFraction > 0);
  assert.equal(geometry.sw, 400);
  assert.ok(geometry.innerWidth <= 60 && geometry.innerHeight <= 60);
});

test('fitGeometry STRETCH keeps independent axis scales and no crop', () => {
  const geometry = fitGeometry(FIT_MODE.STRETCH, 400, 100, 60, 60);
  assert.equal(geometry.scaleX, 60 / 400);
  assert.equal(geometry.scaleY, 60 / 100);
  assert.equal(geometry.croppedFraction, 0);
  assert.equal(geometry.sw, 400);
});

test('fitGeometry rejects non-positive sizes and falls back on unknown modes', () => {
  assert.throws(() => fitGeometry(FIT_MODE.COVER, 0, 10, 10, 10));
  assert.throws(() => fitGeometry(FIT_MODE.COVER, 10, 10, 0, 10));
  assert.equal(fitGeometry('不是模式', 100, 100, 50, 50).fitMode, FIT_MODE.COVER);
});

test('coverGeometry is the COVER shortcut', () => {
  assert.deepEqual(coverGeometry(200, 100, 50, 50), fitGeometry(FIT_MODE.COVER, 200, 100, 50, 50));
});

test('asRaster normalizes the host object and rejects malformed input', () => {
  const raster = asRaster({ data: new Uint8ClampedArray(4 * 2 * 3), width: 2.7, height: 3.9 });
  assert.deepEqual({ width: raster.width, height: raster.height }, { width: 2, height: 3 });
  assert.throws(() => asRaster(null));
  assert.throws(() => asRaster({ width: 4, height: 4 }));
});

test('resample AREA averages a 2×2 block into one pixel', () => {
  const source = makeRaster(2, 2, (x, y) => (x === 0 && y === 0 ? [0, 0, 0] : [100, 200, 50]));
  const out = resample(source, { sx: 0, sy: 0, sw: 2, sh: 2 }, 1, 1, { filter: RESAMPLE_FILTER.AREA });
  const avg = [(0 + 100 * 3) / 4, (0 + 200 * 3) / 4, (0 + 50 * 3) / 4];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(out.data[c] - avg[c]) < 1.5, `通道 ${c} = ${out.data[c]}`);
  assert.equal(out.width, 1);
  assert.equal(out.height, 1);
  assert.equal(out.filter, RESAMPLE_FILTER.AREA);
});

test('resample NEAREST keeps source colours verbatim (no invented mid-tones)', () => {
  const source = makeRaster(4, 1, (x) => [x * 60, x * 60, x * 60]);
  const out = resample(source, { sx: 0, sy: 0, sw: 4, sh: 1 }, 2, 1, { filter: RESAMPLE_FILTER.NEAREST });
  const allowed = new Set([0, 60, 120, 180]);
  for (let i = 0; i < 2; i++) assert.ok(allowed.has(out.data[i * 4]), `得到 ${out.data[i * 4]}`);
});

test('resample AUTO picks AREA when shrinking and BILINEAR when enlarging', () => {
  const source = grayRaster(8, 8, () => 128);
  const shrink = resample(source, { sx: 0, sy: 0, sw: 8, sh: 8 }, 4, 4, { filter: RESAMPLE_FILTER.AUTO });
  const grow = resample(source, { sx: 0, sy: 0, sw: 8, sh: 8 }, 16, 16, { filter: RESAMPLE_FILTER.AUTO });
  assert.equal(shrink.filter, RESAMPLE_FILTER.AREA);
  assert.equal(grow.filter, RESAMPLE_FILTER.BILINEAR);
  for (let i = 0; i < 4 * 4; i++) assert.ok(Math.abs(shrink.data[i * 4] - 128) < 1e-6);
});

test('resizeToGrid produces the requested geometry and honours cover cropping', () => {
  const source = makeRaster(400, 100, (x, y) => (x < 200 ? [255, 0, 0] : [0, 0, 255]));
  const out = resizeToGrid(source, { cols: 16, rows: 16, fitMode: FIT_MODE.COVER, filter: RESAMPLE_FILTER.AREA });
  assert.equal(out.width, 16);
  assert.equal(out.height, 16);
  assert.equal(out.data.length, 16 * 16 * 4);
  // cover：源图高 100 铺满 16 格高度 -> 只看到中间 100/ (400/16*16=400) 宽的一条；
  // 这里只断言左右两端确实是纯红/纯蓝，证明裁切居中且没有混色。
  const left = out.data[(8 * 16 + 0) * 4];
  const right = out.data[(8 * 16 + 15) * 4 + 2];
  assert.equal(left, 255);
  assert.equal(right, 255);
});

/* ─────────────────────────────────────────────────────────────
 * sampling / grid-sampling
 * ───────────────────────────────────────────────────────────── */

test('cellBounds tiles the raster exactly: no overlap, no gap', () => {
  const rasterWidth = 37;
  const rasterHeight = 23;
  const cols = 5;
  const rows = 4;
  const coverage = new Int32Array(rasterWidth * rasterHeight);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const b = cellBounds(cx, cy, rasterWidth, rasterHeight, cols, rows);
      assert.ok(b.x1 > b.x0 && b.y1 > b.y0, `格 (${cx},${cy}) 不能为空`);
      assert.equal(b.width, b.x1 - b.x0);
      assert.equal(b.height, b.y1 - b.y0);
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) coverage[y * rasterWidth + x]++;
      }
    }
  }
  for (let i = 0; i < coverage.length; i++) {
    assert.equal(coverage[i], 1, `像素 ${i} 被覆盖 ${coverage[i]} 次`);
  }

  const last = cellBounds(cols - 1, rows - 1, rasterWidth, rasterHeight, cols, rows);
  assert.equal(last.x1, rasterWidth);
  assert.equal(last.y1, rasterHeight);
});

test('cellBounds stays exact when the raster is smaller than the grid', () => {
  // 4×4 栅格切成 6×6 格：允许出现空格，但不能重叠或越界。
  const coverage = new Int32Array(16);
  let empty = 0;
  for (let cy = 0; cy < 6; cy++) {
    for (let cx = 0; cx < 6; cx++) {
      const b = cellBounds(cx, cy, 4, 4, 6, 6);
      assert.ok(b.x0 >= 0 && b.x1 <= 4 && b.y0 >= 0 && b.y1 <= 4);
      if (b.width === 0 || b.height === 0) { empty++; continue; }
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) coverage[y * 4 + x]++;
    }
  }
  assert.ok(empty > 0);
  for (let i = 0; i < coverage.length; i++) assert.equal(coverage[i], 1);
});

test('sampleCells POINT and AREA agree on a uniform raster', () => {
  const raster = grayRaster(8, 8, () => 128);
  const point = sampleCells(raster, { cols: 4, rows: 4, mode: GRID_SAMPLE_MODE.POINT });
  const area = sampleCells(raster, { cols: 4, rows: 4, mode: GRID_SAMPLE_MODE.AREA });
  for (let i = 0; i < 16; i++) {
    for (let c = 0; c < 3; c++) {
      assert.equal(point.samples[i * 3 + c], 128);
      assert.equal(area.samples[i * 3 + c], 128);
    }
    assert.equal(point.alpha[i], 1);
  }
});

test('sampleCells AREA averages inside the cell while POINT takes one pixel', () => {
  // 4×4 栅格，左半 0、右半 200。
  const raster = grayRaster(4, 4, (x) => (x < 2 ? 0 : 200));

  // 整幅作为 1 格 → AREA = 100（一半 0 一半 200）
  const whole = sampleCells(raster, { cols: 1, rows: 1, mode: GRID_SAMPLE_MODE.AREA });
  assert.equal(whole.samples[0], 100);

  // 切成 2×2 格时每格整体落在同一边 → 0 与 200
  const split = sampleCells(raster, { cols: 2, rows: 2, mode: GRID_SAMPLE_MODE.AREA });
  assert.equal(split.samples[0], 0);
  assert.equal(split.samples[3], 200);

  // POINT 取格内左上角像素
  const point = sampleCells(raster, { cols: 2, rows: 2, mode: GRID_SAMPLE_MODE.POINT });
  assert.equal(point.samples[0], 0);
  assert.equal(point.samples[3], 200);
});

test('sampleCells DOMINANT and MEDIAN handle mixed cells', () => {
  const raster = grayRaster(4, 4, (x, y) => (x === 0 && y === 0 ? 0 : 100));
  const dominant = sampleCells(raster, { cols: 2, rows: 2, mode: GRID_SAMPLE_MODE.DOMINANT });
  const median = sampleCells(raster, { cols: 2, rows: 2, mode: GRID_SAMPLE_MODE.MEDIAN });
  // 3 个 100 对 1 个 0，两个众数口径都应给 100。
  assert.equal(dominant.samples[0], 100);
  assert.equal(median.samples[0], 100);
  assert.equal(dominant.cellSizes[0], 4);
});

test('sampleCells reports per-cell pixel counts and transparent cells', () => {
  const raster = makeRaster(4, 2, (x) => (x < 2 ? [10, 20, 30, 255] : [0, 0, 0, 0]));
  const result = sampleCells(raster, { cols: 2, rows: 1, mode: GRID_SAMPLE_MODE.POINT });
  assert.equal(result.cellSizes[0], 4);
  assert.equal(result.cellSizes[1], 4);
  assert.equal(result.alpha[0], 1);
  assert.equal(result.alpha[1], 0);
  assert.deepEqual([result.samples[0], result.samples[1], result.samples[2]], [10, 20, 30]);
});

test('sampleGrid accepts a raw source and matches sampleCells on a prebuilt raster', () => {
  const source = makeRaster(16, 16, (x, y) => [x * 8, y * 8, 128]);
  const viaGrid = sampleGrid(source, { cols: 4, rows: 4, mode: GRID_SAMPLE_MODE.AREA, fitMode: FIT_MODE.COVER });
  const raster = resizeToGrid(source, { cols: 16, rows: 16, fitMode: FIT_MODE.STRETCH, filter: RESAMPLE_FILTER.NEAREST });
  const viaCells = sampleCells(raster, { cols: 4, rows: 4, mode: GRID_SAMPLE_MODE.AREA });
  assert.equal(viaGrid.samples.length, viaCells.samples.length);
  for (let i = 0; i < viaGrid.samples.length; i++) {
    assert.ok(Math.abs(viaGrid.samples[i] - viaCells.samples[i]) < 0.51, `样本 ${i}`);
  }
});

test('toPixelList / foregroundPixelList split by alpha', () => {
  const raster = makeRaster(2, 1, (x) => (x === 0 ? [200, 0, 0, 255] : [0, 0, 200, 0]));
  const sampled = sampleCells(raster, { cols: 2, rows: 1, mode: GRID_SAMPLE_MODE.POINT });
  const all = toPixelList(sampled.samples);
  assert.equal(all.length, 2);
  const foreground = foregroundPixelList(sampled.samples, sampled.alpha, 0.5);
  assert.equal(foreground.length, 1);
  assert.deepEqual(foreground[0], [200, 0, 0]);
});

test('grid limits mirror the libms blank-board rule', () => {
  assert.equal(GRID_LIMITS.minSide, PW_CONFIG.grid.minSide);
  assert.equal(GRID_LIMITS.maxSide, PW_CONFIG.grid.maxSide);
  assert.equal(GRID_LIMITS.minSide, 16);
  assert.equal(GRID_LIMITS.maxSide, 256);
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / sobel
 * ───────────────────────────────────────────────────────────── */

test('toLuma uses the declared weight vector and stays in range', () => {
  assert.equal(LUMA_WEIGHTS.length, 3);
  const white = grayRaster(2, 2, () => 255);
  const luma = toLuma(white);
  assert.equal(luma.length, 4);
  for (const v of luma) assert.ok(Math.abs(v - 255) < 1e-9);
  const black = grayRaster(2, 2, () => 0);
  for (const v of toLuma(black)) assert.equal(v, 0);
});

test('sobel3 reports zero on a flat field and a ridge on a step edge', () => {
  const flat = grayRaster(9, 9, () => 100);
  const flatOut = sobel3(toLuma(flat), 9, 9);
  for (const v of flatOut.magnitude) assert.equal(v, 0);

  const step = grayRaster(9, 9, (x) => (x < 4 ? 0 : 255));
  const stepOut = sobel3(toLuma(step), 9, 9);
  const atEdge = stepOut.magnitude[4 * 9 + 4];
  const farAway = stepOut.magnitude[4 * 9 + 8];
  assert.ok(atEdge > 0, '竖直边界上应有响应');
  assert.equal(farAway, 0, '远离边界应为 0');
});

test('sobel3 leaves a 1px border untouched (no wrap-around response)', () => {
  const step = grayRaster(9, 9, (x) => (x < 4 ? 0 : 255));
  const out = sobel3(toLuma(step), 9, 9);
  for (let x = 0; x < 9; x++) {
    assert.equal(out.magnitude[x], 0, `顶边第 ${x} 列`);
    assert.equal(out.magnitude[8 * 9 + x], 0, `底边第 ${x} 列`);
  }
});

test('sobel3Energy is a positive constant derived from the kernels', () => {
  const energy = sobel3Energy();
  assert.ok(energy > 0);
  assert.equal(energy, sobel3Energy(), '必须是确定值');
});

test('sobel5 reports zero on a flat field and responds to the same step edge', () => {
  assert.equal(SOBEL5_RADIUS, 2);
  const flat = grayRaster(11, 11, () => 77);
  for (const v of sobel5(toLuma(flat), 11, 11).magnitude) assert.equal(v, 0);

  const step = grayRaster(11, 11, (x) => (x < 5 ? 0 : 255));
  const out = sobel5(toLuma(step), 11, 11);
  assert.ok(out.magnitude[5 * 11 + 5] > 0);
  assert.equal(out.magnitude[5 * 11 + 10], 0);
  // 5×5 核需要 2px 边距，因此最外两圈必须为 0。
  for (let x = 0; x < 11; x++) assert.equal(out.magnitude[1 * 11 + x], 0);
  assert.ok(sobel5Energy() > sobel3Energy(), '5×5 核的能量更大');
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / multi-scale-edge
 * ───────────────────────────────────────────────────────────── */

test('defaultScales exposes the 3×3 + 5×5 pair with blur sigmas', () => {
  const scales = defaultScales();
  assert.ok(scales.length >= 2);
  assert.equal(scales[0].kernel, 3);
  assert.equal(scales[1].kernel, 5);
  assert.ok(scales.every((s) => typeof s.sigma === 'number' && s.sigma >= 0));
});

test('nonzeroQuantile ignores zeros and interpolates', () => {
  const values = new Float32Array([0, 0, 10, 20, 30, 40]);
  assert.equal(nonzeroQuantile(values, 0), 10);
  assert.equal(nonzeroQuantile(values, 1), 40);
  const mid = nonzeroQuantile(values, 0.5);
  assert.ok(mid >= 20 && mid <= 30, `中位应在 20–30 之间，实际 ${mid}`);
  assert.equal(nonzeroQuantile(new Float32Array([0, 0, 0]), 0.5), 0);
});

test('multiScaleEdge energy-normalizes the 5×5 plane onto the 3×3 scale', () => {
  const step = grayRaster(24, 24, (x) => (x < 12 ? 0 : 255));
  const fused = multiScaleEdge(toLuma(step), 24, 24);
  assert.equal(fused.perScale.length, 2);
  assert.equal(fused.fuse, PW_CONFIG.multiScale.fuse);
  for (const plane of fused.perScale) {
    assert.ok(plane.energy > 0);
    assert.ok(Math.abs(plane.energyScale - sobel3Energy() / plane.energy) < 1e-9);
  }
  assert.equal(fused.validRadius, 2, '含 5×5 时有效半径应为 2');
  assert.equal(fused.magnitude.length, 24 * 24);
});

test('multiScaleEdge zeroes the outer invalid ring', () => {
  const step = grayRaster(24, 24, (x) => (x < 12 ? 0 : 255));
  const fused = multiScaleEdge(toLuma(step), 24, 24);
  for (let x = 0; x < 24; x++) {
    assert.equal(fused.magnitude[0 * 24 + x], 0);
    assert.equal(fused.magnitude[1 * 24 + x], 0);
    assert.equal(fused.magnitude[23 * 24 + x], 0);
  }
  assert.ok(fused.magnitude[12 * 24 + 12] > 0, '内部边界仍应有响应');
});

test('multiScaleEdge normalize / fuse options change the output', () => {
  const step = grayRaster(24, 24, (x) => (x < 12 ? 0 : 255));
  const luma = toLuma(step);
  const mean = multiScaleEdge(luma, 24, 24, { fuse: EDGE_FUSE.WEIGHTED_MEAN });
  const max = multiScaleEdge(luma, 24, 24, { fuse: EDGE_FUSE.MAX });
  assert.equal(max.fuse, EDGE_FUSE.MAX);
  let differs = false;
  for (let i = 0; i < mean.magnitude.length; i++) {
    if (Math.abs(mean.magnitude[i] - max.magnitude[i]) > 1e-6) { differs = true; break; }
  }
  assert.ok(differs, 'max 与加权均值不应逐像素相同');

  // 自定义尺度：只保留 3×3 -> 有效半径回落到 1
  const single = multiScaleEdge(luma, 24, 24, { scales: [{ kernel: 3, sigma: 0 }] });
  assert.equal(single.validRadius, 1);
});

test('multiScaleEdge output differs measurably from a bare 3×3 Sobel', () => {
  const step = grayRaster(24, 24, (x) => (x < 12 ? 0 : 255));
  const luma = toLuma(step);
  const bare = sobel3(luma, 24, 24).magnitude;
  const fused = multiScaleEdge(luma, 24, 24).magnitude;
  const atEdgeBare = bare[12 * 24 + 12];
  const atEdgeFused = fused[12 * 24 + 12];
  assert.ok(Math.abs(atEdgeBare - atEdgeFused) > 0, '融合后不应与单尺度逐位相同');
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / adaptive-threshold
 * ───────────────────────────────────────────────────────────── */

test('edgeHistogram buckets every non-zero sample exactly once', () => {
  const magnitude = new Float32Array([0, 0, 1, 5, 5, 5, 100, 255]);
  const hist = edgeHistogram(magnitude, { bins: 8 });
  assert.equal(hist.counts.length, 8);
  assert.equal(hist.total, 6, '总数为 8 个样本减去 2 个零');
  assert.equal(hist.counts.reduce((a, b) => a + b, 0), hist.total);
  assert.equal(hist.edges.length, 9);
  assert.equal(hist.max, 255);
  // 零值不进直方图：这正是上游「median of non-zero」口径的前提
  const zeros = edgeHistogram(new Float32Array([0, 0, 0]), { bins: 4 });
  assert.equal(zeros.total, 0);
});

test('medianOfNonZero falls back when every sample is zero', () => {
  assert.equal(medianOfNonZero(new Float32Array([0, 0, 0]), 50), 50);
  const values = new Float32Array([0, 10, 20, 30]);
  assert.equal(medianOfNonZero(values, 50), 20);
});

test('otsuOnMagnitude separates a bimodal magnitude plane', () => {
  const magnitude = new Float32Array(200);
  for (let i = 0; i < 100; i++) magnitude[i] = 8;
  for (let i = 100; i < 200; i++) magnitude[i] = 200;
  const result = otsuOnMagnitude(magnitude, { scale: 1 });
  assert.ok(result.otsu, 'Otsu 应给出分割结果');
  assert.ok(result.value >= 8 && result.value <= 200, `阈值应落在两峰之间，实际 ${result.value}`);
  assert.equal(result.histogram256.length, 256);
  // 全零幅值：没有可分割的东西，返回 0 且不抛错
  const degenerate = otsuOnMagnitude(new Float32Array(64), { scale: 1 });
  assert.equal(degenerate.value, 0);
  assert.equal(degenerate.otsu, null);
});

test('resolveThreshold supports every declared mode and never sinks below the floor', () => {
  const luma = toLuma(grayRaster(24, 24, (x) => (x < 12 ? 0 : 255)));
  const magnitude = sobel3(luma, 24, 24).magnitude;
  for (const mode of Object.values(THRESHOLD_MODE)) {
    const result = resolveThreshold(magnitude, { mode, floor: 0 });
    assert.ok(Number.isFinite(result.value) && result.value >= 0, `模式 ${mode} → ${result.value}`);
    assert.equal(result.mode, mode);
  }
  // 上游关键语义：阈值不低于 floor（即 edgeThresh）
  const floored = resolveThreshold(magnitude, { mode: THRESHOLD_MODE.MEDIAN, floor: 9999 });
  assert.equal(floored.value, 9999);
  assert.ok(floored.raw < 9999, 'raw 保持未抬升前的中位数口径');
  // median 档 = 非零中位数 × 0.8（上游 app.js:120）
  const median = resolveThreshold(magnitude, { mode: THRESHOLD_MODE.MEDIAN, floor: 0 });
  assert.ok(Math.abs(median.value - median.components.median * PW_CONFIG.threshold.medianFactor) < 1e-6);
});

test('binarize keeps the magnitude strictly above the threshold', () => {
  const magnitude = new Float32Array([0, 10, 20, 30]);
  const mask = binarize(magnitude, 15);
  assert.ok(mask instanceof Uint8Array);
  assert.deepEqual([...mask], [0, 0, 1, 1]);
  assert.equal(binarize(magnitude, 0).reduce((a, b) => a + b, 0), 3, '阈值 0 时零值也不算边缘');
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / background
 * ───────────────────────────────────────────────────────────── */

test('backgroundMargin scales with the raster and has a floor', () => {
  const small = backgroundMargin(10, 10);
  const large = backgroundMargin(400, 400);
  assert.ok(large >= small);
  assert.ok(small >= 1);
  assert.equal(backgroundMargin(100, 100), backgroundMargin(100, 100));
});

test('collectBorderSamples counts the ring and deduplicates colours', () => {
  const raster = grayRaster(10, 10, (x, y) => (x === 5 && y === 5 ? 0 : 240));
  const collected = collectBorderSamples(raster);
  assert.equal(collected.margin, backgroundMargin(10, 10));
  assert.ok(collected.count > 0);
  assert.equal(collected.distinctPixels, 1, '全边框同色时量化色只有一种');
  assert.ok(collected.samples.every((s) => s[0] === 240));
});

test('borderMean of a uniform raster is that colour', () => {
  const raster = makeRaster(8, 8, () => [12, 34, 56]);
  assert.deepEqual(borderMean(collectBorderSamples(raster).samples), [12, 34, 56]);
});

test('borderMean is skewed when the subject touches the border (documented defect)', () => {
  // 上游只取边框均值：主体压到边界就会把背景估计拖偏。
  const raster = grayRaster(20, 20, (x, y) => (y >= 10 ? 0 : 250));
  const collected = collectBorderSamples(raster);
  const estimated = borderMean(collected.samples);
  assert.ok(estimated[0] > 0 && estimated[0] < 250, `边框均值被拖到中间值，实际 ${estimated[0]}`);
  const mean = collected.samples.reduce((sum, s) => sum + s[0], 0) / collected.samples.length;
  assert.ok(Math.abs(estimated[0] - mean) < 1e-6);
});

test('backgroundKMeans splits the border colours and sums to the sample count', () => {
  const samples = [];
  for (let i = 0; i < 60; i++) samples.push([250, 250, 250]);
  for (let i = 0; i < 40; i++) samples.push([10, 10, 10]);
  // 最外一圈以浅色为主（索引 0–29 与 90–99），深色只出现在内侧
  const outerRing = new Uint8Array(samples.length);
  for (let i = 0; i < 30; i++) outerRing[i] = 1;
  for (let i = 90; i < 100; i++) outerRing[i] = 1;

  const result = backgroundKMeans(samples, { k: 2, outerRing });
  assert.equal(result.clusters.length, 2);
  assert.equal(result.clusters.reduce((sum, c) => sum + c.count, 0), samples.length);
  for (const cluster of result.clusters) {
    assert.equal(cluster.center.length, 3);
    assert.ok(cluster.share > 0 && cluster.share <= 1);
    assert.ok(cluster.outerCount >= 0);
  }
  assert.equal(result.clusters[0].count, 60, '占比最大的簇是浅色');
  assert.ok(result.dominant[0] > 200);
  assert.ok(result.nearestOuter[0] > 200, `最外圈以浅色为主时应选浅色簇，实际 ${result.nearestOuter}`);
  assert.ok(result.dominantShare > 0.5);
});

test('backgroundKMeans is deterministic and never invents samples', () => {
  const samples = [];
  for (let i = 0; i < 24; i++) samples.push([i * 10, i * 10, i * 10]);
  const a = backgroundKMeans(samples, { k: 3 });
  const b = backgroundKMeans(samples, { k: 3 });
  assert.deepEqual(a.clusters.map((c) => c.center), b.clusters.map((c) => c.center));
  assert.equal(a.clusters.reduce((sum, c) => sum + c.count, 0), samples.length);
  assert.deepEqual(backgroundKMeans([], { k: 3 }).clusters, []);
});

test('estimateBackground BORDER_KMEANS_NEAREST resists a subject that touches the border', () => {
  const raster = grayRaster(40, 40, (x, y) => (y >= 20 ? 5 : 250));
  const borderMeanEstimate = estimateBackground(raster, { mode: BACKGROUND_MODE.BORDER_MEAN });
  const kmeansEstimate = estimateBackground(raster, { mode: BACKGROUND_MODE.BORDER_KMEANS_NEAREST });
  assert.equal(borderMeanEstimate.mode, BACKGROUND_MODE.BORDER_MEAN);
  assert.equal(borderMeanEstimate.clusters, null);
  assert.equal(kmeansEstimate.mode, BACKGROUND_MODE.BORDER_KMEANS_NEAREST);
  assert.ok(Array.isArray(kmeansEstimate.clusters));
  // K-means 口径应明显比边框均值更接近真实背景（浅色 250）
  assert.ok(
    Math.abs(kmeansEstimate.color[0] - 250) <= Math.abs(borderMeanEstimate.color[0] - 250),
    `kmeans=${kmeansEstimate.color[0]} borderMean=${borderMeanEstimate.color[0]}`,
  );
});

test('estimateBackground reports multi-modality and falls back on a flat border', () => {
  const flat = grayRaster(20, 20, () => 200);
  const estimate = estimateBackground(flat, { mode: BACKGROUND_MODE.BORDER_KMEANS });
  assert.deepEqual(estimate.color, [200, 200, 200]);
  assert.equal(estimate.multiModal, false);
  assert.ok(estimate.sampleCount > 0);
});

test('markBackgroundSimilar flags only pixels near the background colour', () => {
  const raster = makeRaster(4, 1, (x) => (x < 2 ? [250, 250, 250] : [0, 0, 0]));
  const { similar, distances, stats } = markBackgroundSimilar(raster, [250, 250, 250], { threshold: 30 });
  assert.deepEqual([...similar], [1, 1, 0, 0]);
  assert.equal(distances.length, 4);
  assert.equal(distances[0], 0);
  assert.equal(stats.below, 2);
  assert.equal(stats.above, 2);
  assert.ok(stats.maxDistance > 700, `离背景最远的应是黑，实际 ${stats.maxDistance}`);
});

test('markBackgroundSimilar treats transparent pixels as background when asked', () => {
  const raster = makeRaster(3, 1, (x) => (x === 2 ? [0, 0, 0, 0] : [250, 250, 250]));
  const strict = markBackgroundSimilar(raster, [250, 250, 250], { threshold: 30 });
  const lenient = markBackgroundSimilar(raster, [250, 250, 250], { threshold: 30, alphaThreshold: 128 });
  assert.deepEqual([...strict.similar], [1, 1, 0]);
  assert.deepEqual([...lenient.similar], [1, 1, 1], 'alpha 低于阈值视作背景');
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / morphology
 * ───────────────────────────────────────────────────────────── */

test('dilate grows a shape and erode shrinks it', () => {
  const width = 9;
  const height = 9;
  const mask = maskOf(width, height, (x, y) => x >= 4 && x <= 5 && y >= 4 && y <= 5);
  const before = countOn(mask);

  const grown = dilate(mask, width, height);
  const shrunk = erode(mask, width, height);
  assert.equal(grown.mask.length, width * height);
  assert.equal(grown.radius, PW_CONFIG.morphology.radius);
  assert.equal(shrunk.mode, ERODE_MODE.MIN_FILTER);
  assert.ok(countOn(grown.mask) > before, '膨胀应变大');
  assert.ok(countOn(shrunk.mask) < before, '腐蚀应变小');
  assert.equal(countOn(erode(grown.mask, width, height).mask), before, '腐蚀膨胀结果回到原尺寸');
  assert.deepEqual([...mask], [...maskOf(width, height, (x, y) => x >= 4 && x <= 5 && y >= 4 && y <= 5)], '原掩码不得被就地改写');
});

test('standard erode and upstream majority erode differ on a 3px line', () => {
  const width = 9;
  const height = 9;
  const line = maskOf(width, height, (x, y) => y >= 3 && y <= 5);
  const standard = erode(line, width, height);
  const majority = majorityErode(line, width, height);

  // 上游 app.js:201 用「3×3 前景数 >= 5」，比标准 min-filter 弱得多。
  // 两种腐蚀都不处理最外一圈，因此 9 列里只有 x=1..7 参与（7 px/行）。
  assert.equal(countOn(standard.mask), 7, 'min-filter 只留中间 1 行（7 个内部列）');
  assert.equal(countOn(majority.mask), 21, 'sum>=5 的多数口径保住整条 3px 线（3 行 × 7 列）');
  assert.notEqual(countOn(standard.mask), countOn(majority.mask), '两种腐蚀必须可区分');

  assert.equal(countOn(erodeWith(ERODE_MODE.MIN_FILTER, line, width, height).mask), 7);
  assert.equal(countOn(erodeWith(ERODE_MODE.MAJORITY, line, width, height).mask), 21);
  // 把上游阈值收紧到 9 就退化成标准腐蚀
  assert.equal(countOn(majorityErode(line, width, height, { threshold: 9 }).mask), 7);
});

test('both erosion modes agree on a 1px line', () => {
  const width = 9;
  const height = 9;
  const thin = maskOf(width, height, (x, y) => y === 4);
  assert.equal(countOn(erode(thin, width, height).mask), 0);
  assert.equal(countOn(majorityErode(thin, width, height).mask), 0);
});

test('open removes specks while close fills pinholes', () => {
  const width = 11;
  const height = 11;
  const withSpeck = maskOf(width, height, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6) || (x === 9 && y === 9));
  const opened = open(withSpeck, width, height, { erodeMode: ERODE_MODE.MIN_FILTER, iterations: 1 });
  assert.equal(opened.erodeMode, ERODE_MODE.MIN_FILTER);
  assert.equal(opened.mask[9 * width + 9], 0, '孤立 1px 斑点应被开运算清掉');
  assert.equal(opened.mask[4 * width + 4], 1, '主体保留');
  assert.equal(opened.mask[4 * width + 3], 1, '膨胀把主体恢复到原尺寸');

  const withHole = maskOf(width, height, (x, y) => x >= 3 && x <= 6 && y >= 3 && y <= 6 && !(x === 4 && y === 4));
  const closed = close(withHole, width, height, { iterations: 1 });
  assert.equal(countOn(withHole), 15);
  assert.equal(closed.mask[4 * width + 4], 1, '孔洞应被闭运算补上');
  assert.equal(countOn(closed.mask), 16);
});

test('connectedComponents labels 4- and 8-connectivity differently', () => {
  const width = 6;
  const height = 6;
  // 两个斜向相邻的像素：4 邻接下是两个分量，8 邻接下是一个。
  const mask = maskOf(width, height, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2));
  const four = connectedComponents(mask, width, height, { connectivity: 4 });
  const eight = connectedComponents(mask, width, height, { connectivity: 8 });
  assert.equal(four.count, 2);
  assert.equal(eight.count, 1);
  assert.equal(eight.components[0].size, 2);
  assert.equal(eight.components[0].pixels.length, 2);
  assert.equal(four.labels.length, width * height);
  assert.equal(four.labels.filter((l) => l >= 0).length, 2);
});

test('filterComponents keeps only large components and honours border contact', () => {
  const width = 10;
  const height = 10;
  const mask = maskOf(width, height, (x, y) => {
    if (x >= 2 && x <= 5 && y >= 2 && y <= 5) return true; // 4×4 主体（不贴边）
    if (x === 9 && y === 9) return true;                   // 1px 噪点（贴角）
    return false;
  });

  const bySize = filterComponents(mask, width, height, { minSize: 4 });
  assert.equal(bySize.kept, 1);
  assert.equal(bySize.removed, 1);
  assert.equal(countOn(bySize.mask), 16);
  assert.equal(bySize.mask[9 * width + 9], 0);

  const keepBorder = filterComponents(mask, width, height, { minSize: 1, keepBorderContact: true });
  assert.equal(countOn(keepBorder.mask), 1, '只留贴边的那块');
  const dropBorder = filterComponents(mask, width, height, { minSize: 1, keepBorderContact: false });
  assert.equal(countOn(dropBorder.mask), 16, '剔掉贴边的那块');
});

test('componentStats summarizes sizes deterministically', () => {
  const width = 8;
  const height = 8;
  const mask = maskOf(width, height, (x, y) => (x < 2 && y < 2) || (x === 6 && y === 6));
  const stats = componentStats(mask, width, height);
  assert.equal(stats.count, 2);
  assert.equal(stats.totalPixels, 5);
  assert.equal(stats.largest, 4);
  assert.equal(stats.smallest, 1);
  assert.equal(stats.borderContact, 1, '角落那块贴边');
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / feather
 * ───────────────────────────────────────────────────────────── */

test('gaussianKernel is normalized, symmetric and never divides by zero', () => {
  const kernel = gaussianKernel(1.5, 4);
  assert.equal(kernel.length, 9);
  const sum = kernel.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-6, `核应归一化，实际和 ${sum}`);
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(kernel[i] - kernel[8 - i]) < 1e-12, `对称性 ${i}`);
  assert.ok(kernel[4] > kernel[0], '中心权重最大');

  // sigma <= 0 不抛错：夹到一个极小值，退化成「只在中心有权重」的 δ 核
  const degenerate = gaussianKernel(0, 2);
  assert.equal(degenerate.length, 5);
  assert.ok(Math.abs(degenerate[2] - 1) < 1e-6, `δ 核中心应为 1，实际 ${degenerate[2]}`);
  assert.ok([...degenerate].every((v) => Number.isFinite(v)));
});

test('blurChannel preserves a flat field and softens a step', () => {
  const flat = new Float32Array(16).fill(7);
  const blurredFlat = blurChannel(flat, 4, 4, { sigma: 1, radius: 1 });
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(blurredFlat.data[i] - 7) < 1e-6);

  const step = new Float32Array(16);
  for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) step[y * 4 + x] = 1;
  const blurred = blurChannel(step, 4, 4, { sigma: 1, radius: 1 });
  assert.ok(blurred.data[1 * 4 + 1] > 0 && blurred.data[1 * 4 + 1] < 1, '边界应出现中间值');
  assert.equal(blurred.radius, 1);
});

test('featherMask produces a hard mask at radius 0 and soft edges otherwise', () => {
  const width = 12;
  const height = 12;
  const mask = maskOf(width, height, (x) => x >= 6);

  const hard = featherMask(mask, width, height, { radius: 0 });
  assert.ok(hard.alpha.every((v) => v === 0 || v === 1), '半径 0 时不应有中间值');
  assert.equal(hard.radius, 0);

  const soft = featherMask(mask, width, height, { radius: 2 });
  assert.equal(soft.radius, 2);
  const partial = [...soft.alpha].filter((v) => v > 0 && v < 1);
  assert.ok(partial.length > 0, '羽化后应出现软过渡像素');
  assert.ok(soft.binary.every((v) => v === 0 || v === 1));
  const before = hard.alpha.filter((v) => v > 0).length;
  const after = [...soft.alpha].filter((v) => v > 0).length;
  assert.ok(after >= before, '羽化不应缩小前景');
});

test('featherRadiusForPrecision maps presets to a radius', () => {
  const radii = ['fast', 'balanced', 'precise'].map((p) => featherRadiusForPrecision(p));
  assert.ok(radii.every((r) => Number.isInteger(r) && r >= 0));
  assert.ok(radii[0] <= radii[1] && radii[1] <= radii[2]);
});

/* ─────────────────────────────────────────────────────────────
 * segmentation / 组合入口
 * ───────────────────────────────────────────────────────────── */

test('segmentForeground upstream profile reproduces the border-mean background', () => {
  const raster = grayRaster(24, 24, (x, y) => (x > 6 && x < 18 && y > 6 && y < 18 ? 20 : 245));
  const result = segmentForeground(raster, { profile: PIPELINE_PROFILE.UPSTREAM });
  assert.equal(result.bgColor[0], 245, '上游口径用边框均值');
  assert.equal(result.alpha.length, 24 * 24);
  assert.equal(result.mask.length, 24 * 24);
  assert.ok(result.diagnostics);
  assert.equal(result.diagnostics.profile, PIPELINE_PROFILE.UPSTREAM);
});

test('segmentForeground improved profile switches to k-means and honours explicit fields', () => {
  const raster = grayRaster(24, 24, (x, y) => (x > 6 && x < 18 && y > 6 && y < 18 ? 20 : 245));
  const result = segmentForeground(raster, {
    profile: PIPELINE_PROFILE.IMPROVED,
    backgroundMode: BACKGROUND_MODE.BORDER_KMEANS_NEAREST,
    edgeThresh: 77,
    colorThresh: 12,
    morphIter: 1,
  });
  assert.equal(result.diagnostics.profile, PIPELINE_PROFILE.IMPROVED);
  assert.equal(result.stages.threshold.floor, 77, 'edgeThresh 作为阈值下限生效');
  assert.equal(result.stages.marking.colorThresh, 12);
  assert.equal(result.stages.morphology.iterations, 1);
  assert.equal(result.stages.background.mode, BACKGROUND_MODE.BORDER_KMEANS_NEAREST);
  assert.ok(result.stages.connectivity, 'improved 档默认做连通性过滤（上游没有）');
  assert.ok(result.hardMask instanceof Uint8Array);
});

test('segmentForeground keeps multi-scale edge strictly opt-in', () => {
  const raster = grayRaster(24, 24, (x, y) => (x > 6 && x < 18 && y > 6 && y < 18 ? 20 : 245));
  const off = segmentForeground(raster, { profile: PIPELINE_PROFILE.IMPROVED });
  const on = segmentForeground(raster, { profile: PIPELINE_PROFILE.IMPROVED, useMultiScale: true });
  assert.equal(off.stages.edge.kind, 'sobel3', '默认必须退回单尺度 3×3（上游语义）');
  assert.equal(off.stages.edge.validRadius, 1);
  assert.equal(on.stages.edge.kind, 'multi-scale');
  assert.equal(on.stages.edge.validRadius, 2);
});

/* ─────────────────────────────────────────────────────────────
 * quantization / kmeans
 * ───────────────────────────────────────────────────────────── */

test('kMeans is deterministic across runs (strided init, no RNG)', () => {
  const points = [];
  for (let i = 0; i < 64; i++) points.push([i, 255 - i, (i * 7) % 256]);
  const a = kMeans(points, 4);
  const b = kMeans(points, 4);
  assert.deepEqual(a.centroids, b.centroids);
  assert.deepEqual([...a.assignments], [...b.assignments]);
  assert.equal(a.distanceFnName, b.distanceFnName);
});

test('kMeans clamps k to the sample count (no undefined centroids)', () => {
  const points = [[10, 10, 10], [200, 200, 200]];
  const result = kMeans(points, 8);
  assert.equal(result.centroids.length, 2);
  for (const centroid of result.centroids) {
    assert.equal(centroid.length, 3);
    assert.ok(centroid.every((v) => Number.isFinite(v)));
  }
  assert.equal(result.sizes.reduce((a, b) => a + b, 0), 2);
});

test('kMeans returns an explicit empty result for zero points', () => {
  const result = kMeans([], 4);
  assert.deepEqual(result.centroids, []);
  assert.equal(result.iterations, 0);
  assert.equal(result.converged, true);
});

test('kMeans reports empty clusters and can reseed them', () => {
  // 全部点同一色：k 个质心会塌缩，除首个外都是空簇。
  const points = [];
  for (let i = 0; i < 30; i++) points.push([128, 128, 128]);
  const without = kMeans(points, 3, { reseedEmptyClusters: false });
  assert.ok(without.emptyClusters > 0, '同一色应当产生空簇');
  assert.equal(without.reseeded, 0);

  const withReseed = kMeans(points, 3, { reseedEmptyClusters: true, init: KMEANS_INIT.FARTHEST_FIRST });
  assert.ok(withReseed.reseeded >= 0);
  assert.equal(withReseed.sizes.reduce((a, b) => a + b, 0), points.length);
});

test('kMeans separates two well-separated colour groups', () => {
  const points = [];
  for (let i = 0; i < 40; i++) points.push([250, 250, 250]);
  for (let i = 0; i < 40; i++) points.push([10, 10, 10]);
  const result = kMeans(points, 2);
  const sorted = result.centroids.map((c) => c[0]).sort((a, b) => a - b);
  assert.ok(Math.abs(sorted[0] - 10) < 12, `暗簇中心 ${sorted[0]}`);
  assert.ok(Math.abs(sorted[1] - 250) < 12, `亮簇中心 ${sorted[1]}`);
});

test('kMeansPalette snaps centroids onto the caller palette (K-1 fix)', () => {
  const matcher = createPaletteMatcher(TEST_PALETTE, { mode: PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB });
  const points = [];
  for (let i = 0; i < 30; i++) points.push([252, 250, 248]);
  for (let i = 0; i < 30; i++) points.push([232, 40, 44]);
  const result = kMeansPalette(points, 3, matcher);

  assert.ok(result.beads.length > 0);
  // 上游的 kMeansPalette 忽略调用方色板、直接返回内置 MARD 色号（缺陷 K-1）；
  // 这里必须**只**返回传入色板里的条目。
  for (const bead of result.beads) {
    assert.ok(matcher.candidates.some((candidate) => candidate.code === bead.code), `${bead.code} 不在传入色板里`);
  }
  const codes = new Set(result.beads.map((bead) => bead.code));
  assert.ok(codes.has('W1'), `应命中白色，实际 ${[...codes]}`);
  assert.ok(codes.has('R1'), `应命中红色，实际 ${[...codes]}`);
  assert.equal(result.requestedK, 3);
  assert.equal(result.effectiveK, 3);
  assert.equal(result.uniqueCount, result.beads.length);
  assert.ok(Array.isArray(result.duplicates));
  assert.equal(result.sources.length, [...result.sizes].filter((s) => s > 0).length);
});

test('kMeansPalette reports duplicates instead of silently shrinking the palette', () => {
  const matcher = createPaletteMatcher(TEST_PALETTE);
  const points = [];
  for (let i = 0; i < 20; i++) points.push([250, 250, 250]);
  for (let i = 0; i < 20; i++) points.push([244, 244, 244]);
  // 两个簇确实分开了，但都落回同一个白色色号 —— 必须显式记录而不是静默去重。
  const result = kMeansPalette(points, 2, matcher);
  assert.equal(result.beads.length, 1);
  assert.deepEqual(result.duplicates, ['W1']);
  assert.equal(result.uniqueCount, 1);
  assert.equal(result.sources.length, 2, '两个簇都应留下落色卡记录');
});

/* ─────────────────────────────────────────────────────────────
 * quantization / dominant-colors
 * ───────────────────────────────────────────────────────────── */

test('binKey quantizes 5-bit channels into a stable integer', () => {
  const a = binKey([255, 0, 128]);
  assert.equal(a, binKey([255, 0, 128]));
  assert.equal(a, binKey([250, 3, 130]), '同桶内应得到同一键');
  assert.notEqual(a, binKey([0, 0, 0]));
});

test('colorHistogram sums to the sample count and reports distinct buckets', () => {
  const points = [];
  for (let i = 0; i < 10; i++) points.push([200, 100, 50]);
  for (let i = 0; i < 3; i++) points.push([10, 10, 10]);
  const histogram = colorHistogram(points);
  assert.equal(histogram.total, 13);
  const sum = [...histogram.buckets.values()].reduce((acc, b) => acc + b.count, 0);
  assert.equal(sum, 13);
  assert.equal(histogram.distinct, 2);
  assert.equal(histogram.bits, 5);
  // minCount 过滤只影响桶，不改变 total
  const filtered = colorHistogram(points, { minCount: 5 });
  assert.equal(filtered.distinct, 1);
  assert.equal(filtered.total, 13);
});

test('dominantColors returns frequency-ordered colours with shares', () => {
  const points = [];
  for (let i = 0; i < 8; i++) points.push([255, 0, 0]);
  for (let i = 0; i < 2; i++) points.push([0, 0, 255]);
  const top = dominantColors(points);
  assert.equal(top.length, 2);
  assert.equal(top[0].count, 8);
  assert.deepEqual(top[0].rgb, [255, 0, 0]);
  assert.ok(top[0].share > top[1].share);
  assert.ok(Math.abs(top[0].share + top[1].share - 1) < 1e-9);
  assert.equal(dominantColors(points, { count: 1 }).length, 1);
  // 5 位分桶会把 250 归到 248 桶，但 withMean 默认回吐桶内真实均值
  const meaned = dominantColors([[250, 250, 250]], { withMean: true });
  assert.deepEqual(meaned[0].rgb, [250, 250, 250]);
  const binned = dominantColors([[250, 250, 250]], { withMean: false });
  assert.notDeepEqual(binned[0].rgb, [250, 250, 250]);
});

test('medianCut covers every point and respects the box budget', () => {
  const points = [];
  for (let i = 0; i < 50; i++) points.push([(i * 5) % 256, (i * 9) % 256, (i * 13) % 256]);
  const result = medianCut(points, { count: 4 });
  assert.ok(result.centroids.length <= 4);
  assert.equal(result.count, result.centroids.length);
  assert.equal(result.boxes.length, result.centroids.length);
  assert.equal(result.boxes.reduce((sum, box) => sum + box.count, 0), points.length);
  for (const centroid of result.centroids) assert.equal(centroid.length, 3);
  assert.deepEqual(medianCut([], { count: 4 }), { centroids: [], boxes: [], count: 0 });
});

test('colorsToPalette projects colours onto palette codes and dedupes', () => {
  const matcher = createPaletteMatcher(TEST_PALETTE, { mode: PALETTE_MATCH_MODE.CIEDE2000 });
  const mapped = colorsToPalette([[250, 250, 250], [8, 8, 8], [252, 252, 252]], matcher);
  assert.equal(mapped.beads.length, 2, '两个近白应当合并为同一个色号');
  assert.deepEqual(mapped.beads.map((bead) => bead.code), ['W1', 'K1']);
  assert.deepEqual(mapped.duplicates, ['W1']);
  assert.equal(mapped.sources.length, 3);
  assert.equal(mapped.uniqueCount, 2);
});

/* ─────────────────────────────────────────────────────────────
 * color / weighted-rgb
 * ───────────────────────────────────────────────────────────── */

test('weighted RGB uses the upstream 2:4:3 ratio and a 765 ceiling', () => {
  assert.deepEqual([...WEIGHTED_RGB_WEIGHTS], [2, 4, 3]);
  assert.equal(MAX_WEIGHTED_RGB_DISTANCE, 765);
  // 逐通道满幅：sqrt(2*255² + 4*255² + 3*255²) = 765
  assert.ok(Math.abs(weightedRgbDistance([0, 0, 0], [255, 255, 255]) - 765) < 1e-9);
  // 绿色分量权重最大 -> 绿通道差异比蓝贵，蓝比红贵（sqrt: g=510 > b=441.7 > r=360.6）
  const green = weightedRgbDistance([0, 0, 0], [0, 255, 0]);
  const blue = weightedRgbDistance([0, 0, 0], [0, 0, 255]);
  const red = weightedRgbDistance([0, 0, 0], [255, 0, 0]);
  assert.ok(green > blue && blue > red, `g=${green} b=${blue} r=${red}`);
});

test('weightedRgbDistance is symmetric, zero on equality and bounds respecting', () => {
  const a = [12, 200, 45];
  const b = [250, 3, 190];
  assert.equal(weightedRgbDistance(a, a), 0);
  assert.equal(weightedRgbDistance(a, b), weightedRgbDistance(b, a));
  assert.ok(weightedRgbDistance(a, b) <= MAX_WEIGHTED_RGB_DISTANCE);
  assert.ok(Math.abs(weightedRgbDistance(a, b) ** 2 - weightedRgbDistanceSquared(a, b)) < 1e-6);
});

test('normalizedWeightedRgbDistance lands in [0,1]', () => {
  assert.equal(normalizedWeightedRgbDistance([0, 0, 0], [0, 0, 0]), 0);
  assert.ok(Math.abs(normalizedWeightedRgbDistance([0, 0, 0], [255, 255, 255]) - 1) < 1e-9);
  const mid = normalizedWeightedRgbDistance([0, 0, 0], [128, 128, 128]);
  assert.ok(mid > 0 && mid < 1);
});

test('redmean and euclidean metrics are distinct but both plausible', () => {
  const a = [200, 30, 30];
  const b = [30, 200, 30];
  const redmean = redmeanDistance(a, b);
  const euclidean = euclideanRgbDistance(a, b);
  assert.ok(redmean > 0 && euclidean > 0);
  assert.notEqual(redmean, euclidean);
  assert.ok(Math.abs(euclidean - weightedRgbDistance(a, b)) > 0, '两者口径必须不同');
  assert.equal(redmeanDistance(a, a), 0);
});

/* ─────────────────────────────────────────────────────────────
 * color / palette-match
 * ───────────────────────────────────────────────────────────── */

test('preparePalette names every colour space explicitly (no dialect ambiguity)', () => {
  const entries = preparePalette(TEST_PALETTE);
  assert.equal(entries.length, TEST_PALETTE.length);
  for (const [i, entry] of entries.entries()) {
    assert.equal(entry.position, i);
    assert.equal(entry.cieLab.length, 3);
    assert.equal(entry.oklab.length, 3);
    assert.equal(entry.rgb.length, 3);
    assert.ok(entry.hex.startsWith('#'));
    // 白/黑应当明显分离
  }
  assert.equal(entries[0].code, 'W1');
  assert.ok(entries[0].cieLab[0] > 95, '白色 L* 接近 100');
  assert.ok(entries[1].cieLab[0] < 5, '黑色 L* 接近 0');
  assert.equal(entries[6].transparent, true);
});

test('preparePalette accepts rgb arrays and rejects unusable entries', () => {
  const entries = preparePalette([{ code: 'A', rgb: [1, 2, 3] }, { code: 'B', hex: '#102030' }]);
  assert.deepEqual(entries[0].rgb, [1, 2, 3]);
  assert.deepEqual(entries[1].rgb, [16, 32, 48]);
  assert.throws(() => preparePalette([]));
  assert.throws(() => preparePalette([{ code: 'X' }]));
});

test('createPaletteMatcher skips transparent entries by default', () => {
  const matcher = createPaletteMatcher(TEST_PALETTE);
  assert.equal(matcher.entries.length, TEST_PALETTE.length);
  assert.equal(matcher.skippedTransparent, 1);
  assert.equal(matcher.size, TEST_PALETTE.length - 1);
  const kept = createPaletteMatcher(TEST_PALETTE, { skipTransparent: false });
  assert.equal(kept.size, TEST_PALETTE.length);
});

test('the three paletteMatchMode values produce different distances', () => {
  const query = [180, 90, 40];
  const results = {};
  for (const mode of [PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB, PALETTE_MATCH_MODE.LAB, PALETTE_MATCH_MODE.CIEDE2000]) {
    const matcher = createPaletteMatcher(TEST_PALETTE, { mode });
    assert.equal(matcher.mode, mode);
    const best = matcher.match(query);
    assert.ok(best, `模式 ${mode} 应给出匹配`);
    assert.ok(Number.isFinite(best.distance) && best.distance >= 0);
    results[mode] = best.distance;
  }
  assert.notEqual(results[PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB], results[PALETTE_MATCH_MODE.LAB]);
  assert.notEqual(results[PALETTE_MATCH_MODE.LAB], results[PALETTE_MATCH_MODE.CIEDE2000]);
  assert.ok(results[PALETTE_MATCH_MODE.CIEDE2000] <= MATCH_MODE_INFO[PALETTE_MATCH_MODE.CIEDE2000].range[1]);
});

test('every mode agrees that a pure colour matches its own swatch', () => {
  for (const mode of Object.values(PALETTE_MATCH_MODE)) {
    const matcher = createPaletteMatcher(TEST_PALETTE, { mode });
    assert.equal(matcher.match([255, 255, 255]).code, 'W1', `模式 ${mode} 白色`);
    assert.equal(matcher.match([0, 0, 0]).code, 'K1', `模式 ${mode} 黑色`);
    assert.equal(matcher.match([227, 48, 48]).code, 'R1', `模式 ${mode} 红色`);
  }
});

test('matched distance is zero-ish for an exact swatch in every mode', () => {
  for (const mode of Object.values(PALETTE_MATCH_MODE)) {
    const matcher = createPaletteMatcher(TEST_PALETTE, { mode });
    const hit = matcher.match([63, 163, 77]); // G1 = #3FA34D
    assert.equal(hit.code, 'G1');
    assert.ok(hit.distance < 1e-6, `模式 ${mode} 的自身距离应为 0，实际 ${hit.distance}`);
  }
});

test('matcher exposes lookup helpers and a chromatic predicate', () => {
  const matcher = createPaletteMatcher(TEST_PALETTE, { mode: PALETTE_MATCH_MODE.CIEDE2000 });
  assert.equal(matcher.entryOf(0).code, 'W1');
  assert.equal(matcher.positionByCode('B1'), 4);
  assert.equal(matcher.entryOf(4).code, 'B1');
  assert.equal(matcher.isChromatic(0), false, '白色不算有彩色');
  assert.equal(matcher.isChromatic(2), true, '红色算有彩色');
  assert.equal(matcher.positionByCode('不存在的色号'), undefined);
  assert.equal(matcher.diagnostics.mode, PALETTE_MATCH_MODE.CIEDE2000);
  assert.equal(matcher.diagnostics.candidateCount, matcher.size);
});

test('matcher cache on/off yields identical results', () => {
  const cached = createPaletteMatcher(TEST_PALETTE, { mode: PALETTE_MATCH_MODE.CIEDE2000, useCache: true });
  const uncached = createPaletteMatcher(TEST_PALETTE, { mode: PALETTE_MATCH_MODE.CIEDE2000, useCache: false });
  assert.equal(cached.diagnostics.matchCache, true);
  assert.equal(uncached.diagnostics.matchCache, false);
  for (let i = 0; i < 64; i++) {
    const query = [(i * 4) % 256, (i * 7) % 256, (i * 11) % 256];
    assert.equal(cached.match(query).code, uncached.match(query).code);
    assert.equal(cached.match(query).distance, uncached.match(query).distance);
  }
});

test('matcher rejects an empty palette', () => {
  assert.throws(() => createPaletteMatcher([]));
  assert.throws(() => createPaletteMatcher(null));
});
