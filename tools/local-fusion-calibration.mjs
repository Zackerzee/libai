/** Local-only reproducible structural routing audit and real input comparisons. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runGenerationPipeline, analyzeRoutingEvidence } from '../services/generation-pipeline.mjs';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';
import { analyzeLocalFusionEvidence, evaluateLocalFlatStructure } from '../services/local-fusion-routing.mjs';
import { buildDataset } from './b4-routing-audit.mjs';
import { MARD_FULL_COLORS } from '../smart-preprocessing/palette-data.mjs';

export const canvas = createRequire(import.meta.url)('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
export async function decode(file) {
  const image = await canvas.loadImage(file), cv = canvas.createCanvas(image.width, image.height), ctx = cv.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { image: ctx.getImageData(0, 0, cv.width, cv.height), cv };
}
// Frozen definition of the pre-calibration auto selector, using current unchanged production pipeline.
export function runPreviousAuto(request) {
  const evidence = analyzeRoutingEvidence(request.image);
  const sampler = ['pixel', 'logo'].includes(evidence.routing.mode) && evidence.routing.confidence >= .75 ? 'fusion-pindou-dominant' : null;
  const overrides = { ...request.overrides }; delete overrides.localFusionSampler;
  if (sampler) overrides.localFusionSampler = sampler;
  return runGenerationPipeline({ ...request, routingEvidence: evidence, experimentalSampler: null, overrides });
}
const sha = value => createHash('sha256').update(value).digest('hex');
export async function calibrate() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // --out=<目录>：复跑写入新目录，避免覆盖既有证据（默认仍是 docs/local-fusion-calibration）。
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const out = path.resolve(root, outArg ? outArg.slice('--out='.length) : 'docs/local-fusion-calibration');
  await fs.mkdir(out, { recursive: true });
  const palette = MARD_FULL_COLORS.map(c => ({ ...c, paletteId: c.paletteId ?? `mard:${c.code}`, brand: 'MARD' }));
  const inputs = [
    { id: 'brand-logo', file: path.join(root, 'assets/brand/shiliber-mark-256.png'), provenance: 'existing brand raster logo' },
    { id: 'new-year-sign', file: '/Users/gongzhenyan/Downloads/羊年福到金红贺岁牌.png', provenance: 'user supplied festive sign; no OCR performed' },
    { id: 'fantasy-illustration', file: path.join(root, 'tests/fixtures/v3/baseline-v3-before-fix/original.jpg'), provenance: 'existing fantasy illustration, not a verified photograph' },
  ];
  // --inputs=<json>：追加真实素材输入（格式 [{id,file,provenance}]）。
  // 基础三件不变以保持可比；追加项的 provenance 必须写清来源与局限。
  const inputsArg = process.argv.find((a) => a.startsWith('--inputs='));
  if (inputsArg) {
    const extra = JSON.parse(await fs.readFile(path.resolve(root, inputsArg.slice('--inputs='.length)), 'utf8'));
    for (const item of extra) {
      if (!item.id || !item.file || !item.provenance) throw new Error(`--inputs 条目缺少 id/file/provenance：${JSON.stringify(item)}`);
      if (!inputs.some(i => i.id === item.id)) inputs.push(item);
    }
  }
  const metrics = [], manifest = [], sheet = canvas.createCanvas(5 * 240, Math.max(3, inputs.length) * 270), ctx = sheet.getContext('2d');
  ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  function draw(cv, col, row, label) {
    const x = col * 240, y = row * 270, scale = Math.min(230 / cv.width, 230 / cv.height);
    ctx.imageSmoothingEnabled = col === 0; ctx.drawImage(cv, x, y, cv.width * scale, cv.height * scale);
    ctx.fillStyle = '#111'; ctx.font = '13px sans-serif'; ctx.fillText(label, x, y + 250);
  }
  for (const [row, input] of inputs.entries()) {
    const { image, cv } = await decode(input.file), before = sha(image.data), edge = 104;
    const size = { width: Math.round(image.width * edge / Math.max(image.width, image.height)), height: Math.round(image.height * edge / Math.max(image.width, image.height)) };
    const request = { image, size, palette, mode: 'auto', maxColors: 16, overrides: { sampling: 'auto', subjectCrop: false, autoBackground: false } };
    const evidence = analyzeLocalFusionEvidence(image);
    manifest.push({ ...input, fileSha256: sha(await fs.readFile(input.file)), dimensions: { width: image.width, height: image.height }, size, evidence, policy: evaluateLocalFlatStructure(evidence.fusionSignals) });
    draw(cv, 0, row, input.id);
    let reference;
    for (const [col, variant] of ['v25', 'previous-auto', 'calibrated-auto', 'manual-dominant'].entries()) {
      const result = variant === 'v25' ? runGenerationPipeline(request) : variant === 'previous-auto' ? runPreviousAuto(request) : runLocalFusionEngine({ ...request, sampler: variant === 'manual-dominant' ? 'fusion-pindou-dominant' : 'auto' });
      const cells = result.grid.flat(), key = c => c ? `${c.code}|${c.rgb}` : null;
      reference ??= cells;
      const illegal = cells.filter(c => c && !palette.some(p => p.code === c.code && p.rgb.every((v, i) => v === c.rgb[i]))).length;
      const identityMismatches = cells.filter(c => c && !palette.some(p => p.code === c.code && p.paletteId === c.paletteId && p.rgb.every((v, i) => v === c.rgb[i])));
      const metric = { input: input.id, variant, size, strategy: result.fusion?.strategy ?? (variant === 'previous-auto' && ['pixel', 'logo'].includes(evidence.routing.mode) && evidence.routing.confidence >= .75 ? 'fusion-pindou-dominant' : 'v2-baseline'), originalRouting: evidence.routing, policy: result.fusion?.policy ?? null, gridSha256: sha(JSON.stringify(result.grid)), colors: new Set(cells.filter(Boolean).map(key)).size, differingCellsVsV25: cells.reduce((n, c, i) => n + (key(c) !== key(reference[i])), 0), illegalPaletteCells: illegal, paletteIdentityMismatchCells: identityMismatches.length, paletteIdentityMismatchExample: identityMismatches[0] ?? null, sourceImmutable: before === sha(image.data), exactDimensions: result.grid.length === size.height && result.grid.every(r => r.length === size.width) };
      metrics.push(metric);
      const preview = canvas.createCanvas(size.width, size.height), pctx = preview.getContext('2d');
      result.grid.forEach((line, y) => line.forEach((cell, x) => { if (cell) { pctx.fillStyle = `rgb(${cell.rgb})`; pctx.fillRect(x, y, 1, 1); } }));
      await fs.writeFile(path.join(out, `${input.id}-${variant}.png`), preview.toBuffer('image/png'));
      draw(preview, col + 1, row, `${variant}: ${metric.differingCellsVsV25}diff`);
    }
  }
  const corpus = buildDataset().map(row => {
    const e = analyzeLocalFusionEvidence(row.source), old = ['pixel', 'logo'].includes(e.routing.mode) && e.routing.confidence >= .75, policy = evaluateLocalFlatStructure(e.fusionSignals);
    return { id: row.id, group: row.group, provenance: row.group === 'bench' || row.group === 'noisy-photo' ? 'synthetic fixture' : 'existing generated failure fixture; not a verified photograph', originalRouting: e.routing, signals: e.fusionSignals, policy, previousStrategy: old ? 'fusion-pindou-dominant' : 'v2-baseline', calibratedStrategy: old || policy.eligible ? 'fusion-pindou-dominant' : 'v2-baseline' };
  });
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify({ inputs: manifest, paletteCount: palette.length, paletteSha256: sha(JSON.stringify(palette)), maxColors: 16, edge: 104, noCrop: true, noBackgroundRemoval: true, scoreKind: 'structural fraction, not probability' }, null, 2));
  await fs.writeFile(path.join(out, 'corpus.json'), JSON.stringify(corpus, null, 2));
  await fs.writeFile(path.join(out, 'contact-sheet.png'), sheet.toBuffer('image/png'));
  console.log(JSON.stringify({ cases: metrics.length, corpus: corpus.length, corpusStrategyChanges: corpus.filter(r => r.previousStrategy !== r.calibratedStrategy).map(r => r.id), metrics: metrics.map(({ input, variant, strategy, differingCellsVsV25, illegalPaletteCells, exactDimensions, sourceImmutable }) => ({ input, variant, strategy, differingCellsVsV25, illegalPaletteCells, exactDimensions, sourceImmutable })) }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await calibrate();
