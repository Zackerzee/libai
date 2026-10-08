#!/usr/bin/env node
/**
 * BGS algorithm module — standalone A/B runner (Node).
 *
 * Runs the two engines on the *same* raster using the *real* implementations:
 *
 *   current → smart-preprocessing/generation-engine-v2.mjs (`generateV2`), i.e. exactly
 *             what the production V2.5 path runs. Verified DOM-free.
 *   bgs     → src/algorithms/bgs/index.mjs (`convertImageToBeads`)
 *
 * and reports the six requested items side by side:
 *
 *   1. 使用颜色数量  usedColorCount
 *   2. 孤立像素数量  isolatedPixelCount
 *   3. 边缘杂色数量  edgeNoiseCount
 *   4. 色差          colorDifference (CIEDE2000 + sRGB RMSE vs the source raster)
 *   5. 结构保持率    structureRetention
 *   6. 输出矩阵      matrix (+ block art + per-cell diff)
 *
 * **No winner is produced.** The report always carries `verdict: null`; picking between
 * the two engines is a human call.
 *
 * Usage:
 *   node src/algorithms/bgs/ab-run.mjs                       # synthetic fixtures
 *   node src/algorithms/bgs/ab-run.mjs photo.png logo.png    # your own images (PNG)
 *   node src/algorithms/bgs/ab-run.mjs photo.png --width 128 --max-colors 38 --out docs
 *
 * Everything is dependency-free: PNG decoding is done with node:zlib.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareEngines, renderMatrixAsBlockArt, normalizeMatrix } from './ab-test.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..', '..', '..');

/* ─────────────────────────────────────────────────────────────
 * 参数
 * ───────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { files: [], width: 96, maxColors: 0, paletteSize: 221, out: 'docs', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--width') args.width = Math.max(1, Number(argv[++i]) || args.width);
    else if (token === '--max-colors') args.maxColors = Math.max(0, Number(argv[++i]) || 0);
    else if (token === '--palette-size') args.paletteSize = Math.max(1, Number(argv[++i]) || 221);
    else if (token === '--out') args.out = argv[++i] || args.out;
    else if (token === '--quiet') args.quiet = true;
    else if (token.startsWith('--')) throw new Error(`unknown flag ${token}`);
    else args.files.push(token);
  }
  return args;
}

/* ─────────────────────────────────────────────────────────────
 * 调色板：直接读工程自己的色卡数据，不复制任何上游色卡
 * ───────────────────────────────────────────────────────────── */

function readProjectPalette(size) {
  const source = readFileSync(path.join(PROJECT_ROOT, 'app.js'), 'utf8');
  const grab = (name) => {
    const match = source.match(new RegExp(`const ${name} =\\s*"([^"]+)"`));
    if (!match) throw new Error(`could not find ${name} in app.js`);
    return match[1];
  };
  const parse = (value) => value.split(';').map((entry) => {
    const [code, rgbText] = entry.split(':');
    const rgb = rgbText.split(',').map(Number);
    return { code, rgb, hex: `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}` };
  });
  const all = [...parse(grab('BASE_PALETTE')), ...parse(grab('EXTRA_PALETTE'))];
  return all.slice(0, Math.min(size, all.length)).map((color) => ({ ...color, name: color.code }));
}

/* ─────────────────────────────────────────────────────────────
 * 最小 PNG 解码（8 位、非隔行、colourType 0/2/4/6）
 * ───────────────────────────────────────────────────────────── */

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let offset = 8;
  let header = null;
  const idat = [];
  let palette = null;
  let transparency = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const data = buffer.subarray(start, start + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') transparency = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    offset = start + length + 4;
  }
  if (!header) throw new Error('PNG has no IHDR');
  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported');
  if (header.bitDepth !== 8) throw new Error(`only 8-bit PNG is supported (got ${header.bitDepth})`);

  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[header.colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${header.colorType}`);
  if (header.colorType === 3 && !palette) throw new Error('indexed PNG without a PLTE chunk');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const out = new Uint8ClampedArray(header.width * header.height * 4);
  const prior = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  let position = 0;

  for (let y = 0; y < header.height; y++) {
    const filterType = raw[position++];
    raw.copy(current, 0, position, position + stride);
    position += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = prior[i];
      const upLeft = i >= channels ? prior[i - channels] : 0;
      let value = current[i];
      if (filterType === 1) value += left;
      else if (filterType === 2) value += up;
      else if (filterType === 3) value += (left + up) >> 1;
      else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
      } else if (filterType !== 0) throw new Error(`unknown PNG filter ${filterType}`);
      current[i] = value & 0xff;
    }
    // Keep this row for the next row's `up` reference (copy current → prior).
    prior.set(current);

    for (let x = 0; x < header.width; x++) {
      const s = x * channels;
      const d = (y * header.width + x) * 4;
      if (header.colorType === 6) {
        out[d] = current[s]; out[d + 1] = current[s + 1]; out[d + 2] = current[s + 2]; out[d + 3] = current[s + 3];
      } else if (header.colorType === 2) {
        out[d] = current[s]; out[d + 1] = current[s + 1]; out[d + 2] = current[s + 2]; out[d + 3] = 255;
      } else if (header.colorType === 0) {
        out[d] = current[s]; out[d + 1] = current[s]; out[d + 2] = current[s]; out[d + 3] = 255;
      } else if (header.colorType === 4) {
        out[d] = current[s]; out[d + 1] = current[s]; out[d + 2] = current[s]; out[d + 3] = current[s + 1];
      } else {
        const index = current[s];
        out[d] = palette[index * 3]; out[d + 1] = palette[index * 3 + 1]; out[d + 2] = palette[index * 3 + 2];
        out[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      }
    }
  }
  return { data: out, width: header.width, height: header.height };
}

/* ─────────────────────────────────────────────────────────────
 * 合成夹具（没有传图片时用）
 * ───────────────────────────────────────────────────────────── */

function photoFixture(size = 192) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const blob = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 3);
      const p = (y * size + x) * 4;
      data[p] = Math.round(30 + u * 200);
      data[p + 1] = Math.round(50 + v * 170);
      data[p + 2] = Math.round(70 + blob * 160);
      data[p + 3] = 255;
    }
  }
  return { name: 'synthetic-photo', data, width: size, height: size };
}

function lineArtFixture(size = 192) {
  const data = new Uint8ClampedArray(size * size * 4);
  const inset = Math.round(size * 0.12);
  const stroke = Math.max(2, Math.round(size / 64));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onBorder = Math.abs(x - inset) < stroke || Math.abs(x - (size - 1 - inset)) < stroke
        || Math.abs(y - inset) < stroke || Math.abs(y - (size - 1 - inset)) < stroke;
      const onDiagonal = Math.abs(x - y) < stroke;
      const radius = Math.hypot(x - size / 2, y - size / 2);
      const onRing = Math.abs(radius - size * 0.2) < stroke * 1.5;
      const onCross = Math.abs(x - size / 2) < stroke && y > size * 0.25 && y < size * 0.75;
      const ink = onBorder || onDiagonal || onRing || onCross;
      const p = (y * size + x) * 4;
      const value = ink ? 12 : 254;
      data[p] = value; data[p + 1] = value; data[p + 2] = value === 12 ? 16 : value; data[p + 3] = 255;
    }
  }
  return { name: 'synthetic-line-art', data, width: size, height: size };
}

function flatLogoFixture(size = 192) {
  const data = new Uint8ClampedArray(size * size * 4);
  const colors = [[252, 40, 60], [1, 172, 235], [251, 237, 86], [93, 224, 53], [255, 255, 255]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const band = Math.floor((x / size) * 3) + Math.floor((y / size) * 3);
      const [r, g, b] = colors[band % colors.length];
      const p = (y * size + x) * 4;
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
  }
  return { name: 'synthetic-flat-logo', data, width: size, height: size };
}

/* ─────────────────────────────────────────────────────────────
 * 跑一次 A/B
 * ───────────────────────────────────────────────────────────── */

async function runOne(fixture, { palette, width, maxColors }) {
  const height = Math.max(1, Math.round((width * fixture.height) / fixture.width));
  const source = { data: fixture.data, width: fixture.width, height: fixture.height };

  const report = await compareEngines({
    imageData: source,
    palette,
    width,
    height,
    options: { maxColors, preserveAspectRatio: false },
    currentRunner: async ({ imageData: shared, palette: sharedPalette }) => {
      // Stage B4 §2：这里曾经手抄一份生成面板的配置（preset/sampling/五个保护值）。
      // 手抄副本必然漂移，而且 `preset` 自 B4 起在引擎侧已经**不再被读**——
      // 模式表收敛到了 services/mode-profile.mjs，换算边界收敛到了 toEngineOptions。
      // 现在直接走那两份唯一来源，离线报告与浏览器里的生产链路就是同一条链路。
      const [{ generateV2 }, { resolveGenerationPipeline, toEngineOptions }] = await Promise.all([
        import(path.join(PROJECT_ROOT, 'smart-preprocessing', 'generation-engine-v2.mjs')),
        import(path.join(PROJECT_ROOT, 'services', 'mode-profile.mjs')),
      ]);
      return generateV2({
        source: shared,
        width,
        height,
        palette: sharedPalette,
        options: toEngineOptions(resolveGenerationPipeline('auto'), { maxColors }),
      }).grid;
    },
    includeMatrix: true,
  });

  if (report.matrices) {
    const prepared = report.palette;
    const current = normalizeMatrix(report.matrices.current, prepared);
    const bgs = normalizeMatrix(report.matrices.bgs, prepared);
    report.blockArt = {
      current: renderMatrixAsBlockArt(current.colorIds, current.cols, current.rows, prepared),
      bgs: renderMatrixAsBlockArt(bgs.colorIds, bgs.cols, bgs.rows, prepared),
    };
  }
  return { fixture, width, height, report };
}

/* ─────────────────────────────────────────────────────────────
 * 输出
 * ───────────────────────────────────────────────────────────── */

const fmt = (value, digits = 3) => (typeof value === 'number' ? Number(value.toFixed(digits)).toString() : String(value));

function consoleTable(run) {
  const { report } = run;
  const rows = [
    ['使用颜色数量 usedColorCount', fmt(report.metrics.current?.usedColorCount), fmt(report.metrics.bgs.usedColorCount)],
    ['孤立像素数量 isolatedPixelCount', fmt(report.metrics.current?.isolatedPixelCount), fmt(report.metrics.bgs.isolatedPixelCount)],
    ['边缘杂色数量 edgeNoiseCount', fmt(report.metrics.current?.edgeNoiseCount), fmt(report.metrics.bgs.edgeNoiseCount)],
    ['色差 CIEDE2000', fmt(report.metrics.current?.colorDifference?.meanCiede2000), fmt(report.metrics.bgs.colorDifference.meanCiede2000)],
    ['色差 sRGB RMSE', fmt(report.metrics.current?.colorDifference?.rmseSrgb), fmt(report.metrics.bgs.colorDifference.rmseSrgb)],
    ['结构保持率 structureRetention', fmt(report.metrics.current?.structureRetention), fmt(report.metrics.bgs.structureRetention)],
    ['豆数 beadCount', fmt(report.metrics.current?.beadCount), fmt(report.metrics.bgs.beadCount)],
  ];
  const width = Math.max(...rows.map((row) => row[0].length));
  const lines = [
    `图片 ${run.fixture.name}  ${run.width}×${run.height}`,
    `  ${'指标'.padEnd(width, ' ')}  ${'current'.padStart(12)}  ${'bgs'.padStart(12)}`,
    `  ${'-'.repeat(width)}  ${'-'.repeat(12)}  ${'-'.repeat(12)}`,
    ...rows.map(([label, a, b]) => `  ${label.padEnd(width, ' ')}  ${a.padStart(12)}  ${b.padStart(12)}`),
    `  逐格差异 ${report.diff.changedCells}/${report.diff.totalCells} (${(report.diff.changedPercent * 100).toFixed(1)}%)`
      + ` · 仅 current 有豆 ${report.diff.onlyCurrent} · 仅 bgs 有豆 ${report.diff.onlyBgs}`,
    '  verdict: null（不自动判定优劣）',
  ];
  return lines.join('\n');
}

function markdownReport(runs, meta) {
  const lines = [
    '# 算法 A/B 对比报告（current vs bgs）',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 网格：长边 ${meta.width} 格（按原图比例推导另一轴）`,
    `- 颜色上限 maxColors：${meta.maxColors || '不限'}`,
    `- 调色板：工程自有 MARD 色卡前 ${meta.palette.length} 色`,
    '- `current` = `smart-preprocessing/generation-engine-v2.mjs` 的 `generateV2`（生产 V2.5 同款）',
    '- `bgs` = `src/algorithms/bgs/index.mjs` 的 `convertImageToBeads`',
    '',
    '> **本报告不给出赢家。** 两套算法并存，供人工比较；`verdict` 恒为 `null`。',
    '',
  ];

  for (const run of runs) {
    const { report } = run;
    // Deltas only exist for the ranked-free metric set; anything else prints as "—"
    // rather than "undefined" (the delta is diagnostics, not a score).
    const dash = (value) => (typeof value === 'number' ? fmt(value) : '—');
    const delta = (key) => dash(report.delta?.[key]);
    lines.push(
      `## ${run.fixture.name}（${run.fixture.width}×${run.fixture.height} → ${run.width}×${run.height}）`,
      '',
      '| 指标 | current | bgs | 差值 (bgs − current) |',
      '| --- | ---: | ---: | ---: |',
      `| 使用颜色数量 | ${fmt(report.metrics.current?.usedColorCount)} | ${fmt(report.metrics.bgs.usedColorCount)} | ${delta('usedColorCount')} |`,
      `| 孤立像素数量 | ${fmt(report.metrics.current?.isolatedPixelCount)} | ${fmt(report.metrics.bgs.isolatedPixelCount)} | ${delta('isolatedPixelCount')} |`,
      `| 边缘杂色数量 | ${fmt(report.metrics.current?.edgeNoiseCount)} | ${fmt(report.metrics.bgs.edgeNoiseCount)} | ${delta('edgeNoiseCount')} |`,
      `| 色差 meanCIEDE2000 | ${fmt(report.metrics.current?.colorDifference?.meanCiede2000)} | ${fmt(report.metrics.bgs.colorDifference.meanCiede2000)} | ${delta('meanCiede2000')} |`,
      `| 色差 sRGB RMSE | ${fmt(report.metrics.current?.colorDifference?.rmseSrgb)} | ${fmt(report.metrics.bgs.colorDifference.rmseSrgb)} | ${delta('rmseSrgb')} |`,
      `| 结构保持率 | ${fmt(report.metrics.current?.structureRetention)} | ${fmt(report.metrics.bgs.structureRetention)} | ${delta('structureRetention')} |`,
      `| 豆数 | ${fmt(report.metrics.current?.beadCount)} | ${fmt(report.metrics.bgs.beadCount)} | ${dash(report.metrics.current && report.metrics.bgs ? report.metrics.bgs.beadCount - report.metrics.current.beadCount : undefined)} |`,
      '',
      `逐格差异：**${report.diff.changedCells} / ${report.diff.totalCells}**（${(report.diff.changedPercent * 100).toFixed(1)}%），`
        + `其中仅 current 有豆 ${report.diff.onlyCurrent} 格，仅 bgs 有豆 ${report.diff.onlyBgs} 格，两侧都空 ${report.diff.bothEmpty} 格。`,
      '',
      `BGS 诊断：采样模式 \`${report.diagnostics.bgs.sampling.resolved}\``
        + `　拓扑保护 ${report.diagnostics.bgs.topology.applied ? '已启用' : '未启用'}`
        + `　清理 ${report.diagnostics.bgs.cleanup.cleanedCells} 格`
        + `　降色计划 ${report.diagnostics.bgs.colors.limitPlan} 项`
        + `　网格越界 ${report.diagnostics.bgs.grid.limits.ok ? '无' : JSON.stringify(report.diagnostics.bgs.grid.limits.outOfRange)}`,
      '',
      '<details><summary>输出矩阵（方块字符预览，左 current | 右 bgs）</summary>',
      '',
      '```text',
      ...report.blockArt.current.split('\n').map((line, index) => `${line}   |   ${report.blockArt.bgs.split('\n')[index] ?? ''}`),
      '```',
      '',
      '</details>',
      '',
    );
  }
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
 * main
 * ───────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const palette = readProjectPalette(args.paletteSize);

  let fixtures;
  if (args.files.length) {
    fixtures = args.files.map((file) => {
      const decoded = decodePng(readFileSync(file));
      return { name: path.basename(file), ...decoded };
    });
  } else {
    fixtures = [photoFixture(), lineArtFixture(), flatLogoFixture()];
  }

  const runs = [];
  for (const fixture of fixtures) {
    const run = await runOne(fixture, { palette, width: args.width, maxColors: args.maxColors });
    runs.push(run);
    if (!args.quiet) console.log(`\n${consoleTable(run)}\n`);
  }

  const outDir = path.isAbsolute(args.out) ? args.out : path.join(PROJECT_ROOT, args.out);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'algorithm-ab-report.json');
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: { width: args.width, maxColors: args.maxColors, paletteSize: palette.length },
    results: runs.map((run) => ({
      fixture: run.fixture.name,
      size: { width: run.width, height: run.height },
      metrics: run.report.metrics,
      delta: run.report.delta,
      diff: { changedCells: run.report.diff.changedCells, totalCells: run.report.diff.totalCells, onlyCurrent: run.report.diff.onlyCurrent, onlyBgs: run.report.diff.onlyBgs },
      matrices: run.report.matrices,
      blockArt: run.report.blockArt,
      diagnostics: run.report.diagnostics,
      verdict: null,
    })),
  }, null, 2), 'utf8');

  const mdPath = path.join(outDir, 'ALGORITHM_AB_TEST_REPORT.md');
  writeFileSync(mdPath, `${markdownReport(runs, { ...args, palette })}\n`, 'utf8');

  console.log(`报告已写入：\n  ${mdPath}\n  ${jsonPath}`);
}

// 只在被当作脚本直接运行时才跑 main，这样 decodePng 也能被单独 import 做单测。
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}