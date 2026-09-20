/**
 * BGS algorithm module — end-to-end pipeline + A/B comparison tests.
 *
 * These tests exercise `convertImageToBeads` as a whole (the same entry the browser
 * bridge calls) plus the A/B harness. Pure Node: no browser, no Canvas, no fixtures
 * on disk. The palette here is self-built so that no upstream colour-card data is
 * copied (see NOTICE).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  convertImageToBeads, DEFAULT_OPTIONS, BGS_ENGINE_ID, BGS_MODULE_VERSION,
  compareEngines, compareMatrices, renderMatrixAsBlockArt, SAMPLING_MODE,
} from './index.mjs';
import { normalizeMatrix } from './ab-test.mjs';

/* ─────────────────────────────────────────────────────────────
 * 夹具
 * ───────────────────────────────────────────────────────────── */

const PALETTE = [
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

/** Photo-ish: a smooth colour ramp with a soft blob, so every sampler path is exercised. */
function photoFixture(size = 64) {
  return makeImage(size, size, (x, y, w, h) => {
    const u = x / (w - 1);
    const v = y / (h - 1);
    const dx = u - 0.5;
    const dy = v - 0.5;
    const blob = Math.max(0, 1 - Math.hypot(dx, dy) * 3);
    return [
      Math.round(40 + u * 190),
      Math.round(60 + v * 160),
      Math.round(80 + blob * 150),
    ];
  });
}

/** Monochrome line art: black strokes on white — the only shape topology protection targets. */
function lineArtFixture(size = 48) {
  return makeImage(size, size, (x, y, w, h) => {
    const inset = Math.round(w * 0.15);
    const onBorder = x === inset || x === w - 1 - inset || y === inset || y === h - 1 - inset;
    const onDiagonal = Math.abs(x - y) <= 1;
    const inBox = (x - w / 2) ** 2 + (y - h / 2) ** 2 <= (w * 0.18) ** 2;
    const inBoxRing = inBox && ((x - w / 2) ** 2 + (y - h / 2) ** 2 >= (w * 0.13) ** 2);
    const ink = onBorder || onDiagonal || inBoxRing;
    return ink ? [10, 10, 12] : [255, 255, 255];
  });
}

/* ─────────────────────────────────────────────────────────────
 * 统一入口契约
 * ───────────────────────────────────────────────────────────── */

test('convertImageToBeads requires a palette', () => {
  assert.throws(() => convertImageToBeads(photoFixture(16), { width: 8, height: 8 }), /palette is required/);
  assert.throws(() => convertImageToBeads(photoFixture(16), { width: 8, height: 8, palette: [] }), /palette/);
});

test('convertImageToBeads returns the documented shape', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 24, height: 24, palette: PALETTE });

  assert.equal(result.width, 24);
  assert.equal(result.height, 24);
  assert.ok(Array.isArray(result.matrix));
  assert.equal(result.matrix.length, result.height);
  for (const row of result.matrix) assert.equal(row.length, result.width);
  assert.ok(result.colorIds instanceof Int16Array);
  assert.equal(result.colorIds.length, result.width * result.height);
  assert.equal(result.palette.length, PALETTE.length);
  assert.equal(result.statistics.usedColorCount !== undefined, true);
  assert.equal(result.diagnostics.engine, BGS_ENGINE_ID);
  assert.equal(result.diagnostics.moduleVersion, BGS_MODULE_VERSION);
});

test('the matrix is a pure bead-colour matrix, never a carrier for UI state', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 24, height: 24, palette: PALETTE });
  const codes = new Set(PALETTE.map((entry) => entry.code));

  for (const row of result.matrix) {
    for (const cell of row) {
      // Only two shapes are allowed: null (no bead) or a palette code string.
      if (cell === null) continue;
      assert.equal(typeof cell, 'string', `matrix cell must be null or a code string, got ${typeof cell}`);
      assert.ok(codes.has(cell), `matrix cell ${cell} is not part of the palette`);
    }
  }

  // No DOM node, function handle or engine state may ride along inside the payload.
  const walk = (node, path) => {
    if (node === null) return;
    const type = typeof node;
    if (type === 'function') assert.fail(`${path} is a function handle`);
    if (type === 'undefined') assert.fail(`${path} is undefined`);
    if (type === 'bigint') assert.fail(`${path} is a bigint`);
    if (node instanceof Int16Array || node instanceof Uint8ClampedArray || node instanceof Float32Array) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (type === 'object') {
      assert.equal(Object.getPrototypeOf(node), Object.prototype, `${path} is not a plain object`);
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
    }
  };
  walk(result.diagnostics, 'diagnostics');
  walk(result.statistics, 'statistics');
  walk(result.palette, 'palette');
  // A DOM-bound engine would have needed these; the module must run without them.
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
});

test('an out-of-range grid is reported, never silently clamped', () => {
  // libms rule: a user-supplied canvas size must not be quietly rewritten.
  const result = convertImageToBeads(photoFixture(32), { width: 5, height: 4000, palette: PALETTE, preserveAspectRatio: false });
  const limits = result.diagnostics.grid.limits;
  assert.ok(limits, 'diagnostics must disclose the limit that was exceeded');
  assert.equal(limits.ok, false);
  assert.deepEqual(
    limits.outOfRange,
    [{ axis: 'rows', value: 4000, limit: 512, kind: 'aboveMax' }],
    'the offending axis must be named together with the limit it broke',
  );
  assert.equal(limits.requested.width, 5);
  assert.equal(limits.requested.height, 4000);

  // The geometry is handed through *unchanged* — a silent clamp would leave the caller
  // unable to tell "the user asked for 5×4000" from "the algorithm produced 5×512".
  assert.equal(result.width, 5);
  assert.equal(result.height, 4000);
  assert.equal(result.matrix.length, 4000);
});

test('conversion is deterministic and does not mutate the input raster', () => {
  const source = photoFixture(64);
  const before = Uint8ClampedArray.from(source.data);
  const a = convertImageToBeads(source, { width: 32, height: 32, palette: PALETTE });
  const b = convertImageToBeads(source, { width: 32, height: 32, palette: PALETTE });
  assert.deepEqual(a.matrix, b.matrix);
  assert.deepEqual(Array.from(source.data), Array.from(before), 'the caller raster must be treated as read-only');
});

test('matrix and colorIds agree with each other', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 24, height: 24, palette: PALETTE });
  const codeById = new Map(result.palette.map((entry) => [entry.index, entry.code]));
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const id = result.colorIds[y * result.width + x];
      const expected = id < 0 ? null : codeById.get(id);
      assert.equal(result.matrix[y][x], expected ?? null, `cell ${x},${y} disagrees between matrix and colorIds`);
    }
  }
});

/* ─────────────────────────────────────────────────────────────
 * 采样 / 拓扑 / 统计
 * ───────────────────────────────────────────────────────────── */

test('every sampling mode produces a usable matrix', () => {
  const canonical = new Set(Object.values(SAMPLING_MODE));
  for (const mode of [SAMPLING_MODE.AUTO, SAMPLING_MODE.CENTER, SAMPLING_MODE.LINEAR, SAMPLING_MODE.DOMINANT, SAMPLING_MODE.EDGE_AWARE, SAMPLING_MODE.DOCUMENT]) {
    const result = convertImageToBeads(photoFixture(64), { width: 16, height: 16, palette: PALETTE, samplingMode: mode });
    // `resolved` is the mode actually used, so AUTO is allowed to resolve to a concrete one.
    assert.ok(canonical.has(result.diagnostics.sampling.resolved), `unexpected resolved mode ${result.diagnostics.sampling.resolved}`);
    if (mode !== SAMPLING_MODE.AUTO) assert.equal(result.diagnostics.sampling.resolved, mode);
    assert.equal(result.width, 16);
    assert.ok(result.statistics.beadCount > 0, `mode ${mode} produced an empty pattern`);
  }
});

test('topology protection engages on monochrome line art when asked', () => {
  const forced = convertImageToBeads(lineArtFixture(48), { width: 36, height: 36, palette: PALETTE, topologyProtection: true });
  assert.equal(forced.diagnostics.lineArt.monochromeLineArt, true, 'the line-art fixture must be recognised as monochrome');
  assert.equal(forced.diagnostics.topology.applied, true);

  const off = convertImageToBeads(lineArtFixture(48), { width: 36, height: 36, palette: PALETTE, topologyProtection: false });
  assert.equal(off.diagnostics.topology.applied, false);
});

test('topology protection stays off for a full-colour photo', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 36, height: 36, palette: PALETTE, topologyProtection: true });
  assert.equal(result.diagnostics.lineArt.monochromeLineArt, false);
  assert.equal(result.diagnostics.topology.applied, false);
});

test('maxColors is honoured', () => {
  for (const maxColors of [2, 3, 5]) {
    const result = convertImageToBeads(photoFixture(64), { width: 32, height: 32, palette: PALETTE, maxColors });
    assert.ok(result.statistics.usedColorCount <= maxColors, `asked for ${maxColors} colours, got ${result.statistics.usedColorCount}`);
    assert.ok(result.statistics.usedColorCount >= 1);
  }
});

test('maxColors 0 means unlimited and is not a silent default', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 32, height: 32, palette: PALETTE, maxColors: 0 });
  assert.equal(result.diagnostics.colors.limitApplied, false);
  assert.equal(result.diagnostics.colors.limitRequested, null);
  assert.ok(result.statistics.usedColorCount > 1);
});

test('statistics expose all six requested comparison metrics', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 24, height: 24, palette: PALETTE });
  const stats = result.statistics;
  // 1 使用颜色数量 · 2 孤立像素数量 · 3 边缘杂色数量 · 4 色差 · 5 结构保持率 · 6 输出矩阵
  assert.equal(typeof stats.usedColorCount, 'number');
  assert.equal(typeof stats.isolatedPixelCount, 'number');
  assert.equal(typeof stats.edgeNoiseCount, 'number');
  assert.equal(typeof stats.colorDifference.meanCiede2000, 'number');
  assert.equal(typeof stats.colorDifference.rmseSrgb, 'number');
  assert.equal(typeof stats.structureRetention, 'number');
  assert.ok(Array.isArray(result.matrix));
  assert.ok(stats.structureRetention >= 0 && stats.structureRetention <= 1);
  assert.ok(stats.colorDifference.meanCiede2000 >= 0);
});

test('a fully transparent source yields an empty pattern instead of throwing', () => {
  const blank = makeImage(16, 16, () => [0, 0, 0, 0]);
  const result = convertImageToBeads(blank, { width: 8, height: 8, palette: PALETTE });
  assert.equal(result.statistics.beadCount, 0);
  assert.equal(result.matrix.flat().every((cell) => cell === null), true);
});

/* ─────────────────────────────────────────────────────────────
 * A/B 对比
 * ───────────────────────────────────────────────────────────── */

/** A stand-in for libms's DOM-bound pipeline: deterministic, and deliberately different. */
function fixtureCurrentRunner({ imageData, palette, width, height }) {
  // The runner receives the *caller's* palette, which may declare colours as hex only —
  // exactly like libms, whose catalog entries have no `rgb` until the engine derives it.
  const entries = palette.map((entry) => {
    const hex = String(entry.hex || '#000000').replace('#', '');
    const rgb = Array.isArray(entry.rgb)
      ? entry.rgb
      : [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    return { code: entry.code, rgb };
  });
  const neutrals = entries.filter((entry) => entry.rgb[0] === entry.rgb[1] && entry.rgb[1] === entry.rgb[2]);

  const { data, width: sw, height: sh } = imageData;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / width));
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / height));
      const p = (sy * sw + sx) * 4;
      const luma = (data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722) / 255;
      // Quantise to a coarse grey ladder built from the palette's neutral codes only.
      if (!neutrals.length || data[p + 3] === 0) { row.push(null); continue; }
      const pick = neutrals[Math.min(neutrals.length - 1, Math.floor(luma * neutrals.length))];
      row.push(pick.code);
    }
    rows.push(row);
  }
  return rows;
}

test('compareEngines runs both engines on one raster and reports the six metrics', async () => {
  const source = photoFixture(64);
  const report = await compareEngines({
    imageData: source,
    palette: PALETTE,
    width: 24,
    height: 24,
    options: { maxColors: 6 },
    currentRunner: fixtureCurrentRunner,
    includeMatrix: true,
  });

  assert.equal(report.engines.current, 'current');
  assert.equal(report.engines.bgs, BGS_ENGINE_ID);
  assert.equal(report.currentError, null);

  for (const side of ['current', 'bgs']) {
    const metrics = report.metrics[side];
    assert.ok(metrics, `${side} metrics are missing`);
    for (const key of ['usedColorCount', 'isolatedPixelCount', 'edgeNoiseCount', 'structureRetention']) {
      assert.equal(typeof metrics[key], 'number', `${side}.${key} must be a number`);
    }
    assert.equal(typeof metrics.colorDifference.meanCiede2000, 'number');
    assert.equal(typeof metrics.colorDifference.rmseSrgb, 'number');
    assert.ok(Array.isArray(report.matrices[side]), `${side} matrix is missing`);
    assert.equal(report.matrices[side].length, 24);
  }

  assert.ok(report.diff);
  assert.equal(report.diff.totalCells, 24 * 24);
  assert.ok(report.diff.changedCells >= 0 && report.diff.changedCells <= report.diff.totalCells);
});

test('compareEngines never declares a winner', async () => {
  const report = await compareEngines({
    imageData: photoFixture(48), palette: PALETTE, width: 20, height: 20, currentRunner: fixtureCurrentRunner,
  });
  assert.equal(report.verdict, null);
  assert.equal('winner' in report, false);
  assert.equal('recommendation' in report, false);
  assert.match(report.note, /No automatic winner/);
  // Delta is published as raw numbers only; it is explicitly not a score.
  assert.ok(report.delta);
  assert.equal(typeof report.delta.usedColorCount, 'number');
});

test('compareEngines hands the current runner the caller palette, never the bgs-prepared one', async () => {
  // Regression guard for a real integration bug: libms's palette-engine treats a
  // pre-existing `lab` field as authoritative CIELAB, while BGS's prepared entries carry
  // OKLab there. Leaking the prepared palette into `current` silently changes which
  // colours it picks, which would make the whole A/B meaningless.
  const original = [
    { code: 'H2', hex: '#FFFFFF' },
    { code: 'H7', hex: '#000000' },
    { code: 'H3', hex: '#B6B1BA' },
    { code: 'F4', hex: '#FC283C' },
  ];
  let received = null;
  await compareEngines({
    imageData: photoFixture(32),
    palette: original,
    width: 8,
    height: 8,
    currentRunner: ({ palette }) => { received = palette; return null; },
  });

  assert.equal(received, original, 'the runner must receive the caller array by identity');
  for (const entry of received) {
    for (const forbidden of ['lab', 'cieLab', 'position', 'index', 'transparent']) {
      assert.equal(forbidden in entry, false, `bgs dialect field "${forbidden}" leaked into the current engine`);
    }
  }
});

test('compareEngines survives a failing current runner without losing the bgs side', async () => {
  const report = await compareEngines({
    imageData: photoFixture(48), palette: PALETTE, width: 20, height: 20,
    currentRunner: () => { throw new Error('legacy pipeline unavailable in Node'); },
  });
  assert.match(report.currentError, /legacy pipeline unavailable/);
  assert.equal(report.metrics.current, null);
  assert.equal(report.metrics.bgs.usedColorCount >= 1, true);
  assert.equal(report.verdict, null);
});

test('compareEngines works with no current runner at all', async () => {
  const report = await compareEngines({ imageData: photoFixture(48), palette: PALETTE, width: 20, height: 20 });
  assert.equal(report.currentError, null);
  assert.equal(report.metrics.current, null);
  assert.equal(report.diff, null);
  assert.equal(report.metrics.bgs.usedColorCount >= 1, true);
});

test('compareEngines is deterministic across runs', async () => {
  const source = photoFixture(48);
  const args = { imageData: source, palette: PALETTE, width: 20, height: 20, currentRunner: fixtureCurrentRunner };
  const first = await compareEngines(args);
  const second = await compareEngines(args);
  assert.deepEqual(first.matrices, second.matrices);
  assert.equal(first.diff.changedCells, second.diff.changedCells);
});

test('compareMatrices evaluates two matrices the caller already holds', () => {
  const current = [
    ['H2', 'H2', null],
    ['H7', 'H5', 'H5'],
  ];
  const bgs = [
    ['H2', null, null],
    ['H7', 'H3', 'H5'],
  ];
  const report = compareMatrices({ currentMatrix: current, bgsMatrix: bgs, palette: PALETTE, raster: photoFixture(48) });
  assert.equal(report.verdict, null);
  assert.equal(report.size.current.cols, 3);
  assert.equal(report.diff.totalCells, 6);
  // (1,0) current has H2 where bgs is empty · (1,1) current H5 → bgs H3.
  // (2,0) is empty on both sides, (2,1) is H5 on both.
  assert.equal(report.diff.changedCells, 2);
  assert.equal(report.diff.onlyCurrent, 1);
  assert.equal(report.diff.onlyBgs, 0);
  assert.equal(report.diff.bothEmpty, 1);
  assert.ok(report.metrics.current.usedColorCount >= 1);
  assert.ok(report.metrics.bgs.usedColorCount >= 1);
});

test('block art is renderable and matches the matrix geometry', () => {
  const result = convertImageToBeads(photoFixture(64), { width: 24, height: 24, palette: PALETTE });
  const normalized = normalizeMatrix(result.matrix, result.palette);
  const art = renderMatrixAsBlockArt(normalized.colorIds, normalized.cols, normalized.rows, result.palette);
  const lines = art.split('\n');
  assert.equal(lines.length, 24);
  for (const line of lines) assert.equal([...line].length, 24);
});

test('DEFAULT_OPTIONS is frozen and never mutated by a run', () => {
  const snapshot = JSON.stringify(DEFAULT_OPTIONS);
  convertImageToBeads(photoFixture(32), { width: 12, height: 12, palette: PALETTE, maxColors: 4, samplingMode: 'linear' });
  assert.equal(JSON.stringify(DEFAULT_OPTIONS), snapshot);
  assert.equal(Object.isFrozen(DEFAULT_OPTIONS), true);
});
