/** Local diagnostic artifacts only; no product wiring. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { runGenerationPipeline as runGenerationPipelineV25 } from '../services/generation-pipeline.mjs';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';
import { LOCAL_FUSION_SAMPLERS } from '../smart-preprocessing/local-fusion-sampler.mjs';
import { MARD_FULL_COLORS } from '../smart-preprocessing/palette-data.mjs';
const { createCanvas, loadImage } = createRequire(import.meta.url)('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.find(a => a.startsWith('--out='))?.slice(6) ?? 'docs/local-fusion-validation';
const out = path.resolve(root, outArg);
if (!out.startsWith(path.join(root, 'docs') + path.sep)) throw new Error('--out must name a repository docs subdirectory');
const qualityOnly = args.includes('--quality-only'), performanceOnly = args.includes('--performance-only');
if (qualityOnly && performanceOnly) throw new Error('Choose only one phase flag');
await fs.mkdir(out, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const palette = MARD_FULL_COLORS.map(c => ({ ...c, paletteId: c.paletteId ?? `mard:${c.code}`, brand: 'MARD' }));
const inputs = [
  { id: 'new-year-sign', file: '/Users/gongzhenyan/Downloads/羊年福到金红贺岁牌.png', category: 'user-supplied festive sign illustration; not a real photograph' },
  { id: 'brand-logo', file: path.join(root, 'assets/brand/shiliber-mark-256.png'), category: 'existing brand logo' },
  { id: 'fantasy-illustration', file: path.join(root, 'tests/fixtures/v3/baseline-v3-before-fix/original.jpg'), category: 'existing fantasy illustration with photographic-style rendering; not a real photograph or verified anime input' },
];
for (const input of inputs) {
  // File-path decode avoids loadImage's Buffer SVG sniff matching C2PA payload text.
  const bytes = await fs.readFile(input.file), decoded = await loadImage(input.file);
  const cv = createCanvas(decoded.width, decoded.height), ctx = cv.getContext('2d');
  ctx.drawImage(decoded, 0, 0);
  input.image = ctx.getImageData(0, 0, cv.width, cv.height);
  input.canvas = cv; input.sha256 = sha(bytes);
}
const settings = ['v25', 'auto', ...LOCAL_FUSION_SAMPLERS];
const request = (input, edge) => ({ image: input.image, mode: 'auto', size: { width: Math.max(1, Math.round(input.image.width * edge / Math.max(input.image.width, input.image.height))), height: Math.max(1, Math.round(input.image.height * edge / Math.max(input.image.width, input.image.height))) }, palette, maxColors: 16, overrides: { sampling: 'auto', subjectCrop: false, autoBackground: false } });
const run = (req, sampler) => sampler === 'v25' ? runGenerationPipelineV25(req) : runLocalFusionEngine({ ...req, sampler });
function render(grid) {
  const cv = createCanvas(grid[0].length, grid.length), ctx = cv.getContext('2d');
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) if (grid[y][x]) { ctx.fillStyle = `rgb(${grid[y][x].rgb.join(',')})`; ctx.fillRect(x, y, 1, 1); }
  return cv;
}
function draw(ctx, cv, col, row, label) {
  const x = col * 220, y = row * 250;
  for (let py = 0; py < 210; py += 10) for (let px = 0; px < 210; px += 10) { ctx.fillStyle = (px / 10 + py / 10) % 2 ? '#ddd' : '#fff'; ctx.fillRect(x + px, y + py, 10, 10); }
  const scale = Math.min(210 / cv.width, 210 / cv.height); ctx.imageSmoothingEnabled = col === 0;
  ctx.drawImage(cv, x + (210 - cv.width * scale) / 2, y + (210 - cv.height * scale) / 2, cv.width * scale, cv.height * scale);
  ctx.fillStyle = '#111'; ctx.font = '12px sans-serif'; ctx.fillText(label, x, y + 225);
}
const sheet = createCanvas(9 * 220, 6 * 250), ctx = sheet.getContext('2d'); ctx.fillStyle = '#f6f6f6'; ctx.fillRect(0, 0, sheet.width, sheet.height);
const quality = [];
if (!performanceOnly) for (const [index, input] of inputs.entries()) for (const [sizeIndex, edge] of [52, 104].entries()) {
  const row = index * 2 + sizeIndex, req = request(input, edge); let baseline;
  draw(ctx, input.canvas, 0, row, `${input.id} / long edge ${edge}`);
  for (const [col, sampler] of settings.entries()) {
    const started = performance.now(), result = run(req, sampler), runtimeMs = performance.now() - started;
    const cells = result.grid.flat(); if (sampler === 'v25') baseline = cells;
    const key = c => c ? `${c.code}:${c.rgb.join(',')}` : null;
    const metrics = { input: input.id, edge, size: req.size, sampler, runtimeMs, routedMode: result.pipeline.routedMode, routing: result.fusion?.evidence?.routing ?? result.pipeline.analysis?.routing, chosenStrategy: result.fusion?.strategy ?? 'v2-baseline', reason: result.fusion?.reason ?? 'existing-production-runner', colors: new Set(cells.filter(Boolean).map(key)).size, nullCount: cells.filter(c => !c).length, differingCellsVsV25: cells.reduce((n, c, i) => n + (key(c) !== key(baseline[i])), 0), gridSha256: sha(JSON.stringify(result.grid)), illegalPaletteCells: cells.filter(c => c && !palette.some(p => p.code === c.code && p.rgb.every((v, i) => v === c.rgb[i]))).length };
    quality.push(metrics); const cv = render(result.grid);
    await fs.writeFile(path.join(out, `${input.id}-${edge}-${sampler}.png`), cv.toBuffer('image/png'));
    draw(ctx, cv, col + 1, row, `${sampler.replace('fusion-pindou-', '')}: ${metrics.colors}c ${metrics.differingCellsVsV25}diff`);
    console.log(JSON.stringify(metrics));
  }
}
if (!performanceOnly) {
  await fs.writeFile(path.join(out, 'contact-sheet.png'), sheet.toBuffer('image/png'));
  await fs.writeFile(path.join(out, 'quality.json'), JSON.stringify(quality, null, 2));
} else {
  try { quality.push(...JSON.parse(await fs.readFile(path.join(out, 'quality.json'), 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
const performanceRuns = [];
const compareArg = args.find(a => a.startsWith('--compare='))?.slice(10);
if (compareArg) {
  const before = JSON.parse(await fs.readFile(path.resolve(root, compareArg, 'quality.json'), 'utf8'));
  const key = x => [x.input, x.edge, x.sampler].join('|');
  const cases = quality.map(x => { const old = before.find(y => key(y) === key(x)); return { case: key(x), fullGridHashEqual: old?.gridSha256 === x.gridSha256, beforeRuntimeMs: old?.runtimeMs, afterRuntimeMs: x.runtimeMs }; });
  const comparison = { count: cases.length, allEqual: cases.length === before.length && cases.every(x => x.fullGridHashEqual), runtimeCaution: 'Quality runtimes are single observations, not P50 or statistical performance evidence.', cases };
  await fs.writeFile(path.join(out, 'before-after-grid-comparison.json'), JSON.stringify(comparison, null, 2));
  if (!comparison.allEqual) throw new Error('Full grid hash changed versus comparison artifacts');
}
if (!qualityOnly) for (const edge of [52, 78, 104, 250, 500]) for (const sampler of ['v25', 'auto', 'fusion-pindou-dominant']) {
  const req = request(inputs[0], edge), samples = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    const rssBefore = process.memoryUsage().rss, started = performance.now(); const result = run(req, sampler);
    samples.push({ repetition, runtimeMs: performance.now() - started, rssBefore, rssAfter: process.memoryUsage().rss, chosenStrategy: result.fusion?.strategy ?? 'v2-baseline' });
  }
  const sorted = samples.map(s => s.runtimeMs).sort((a, b) => a - b);
  const item = { input: inputs[0].id, edge, size: req.size, sampler, repetitions: 3, p50Ms: sorted[1], p95Ms: sorted[2], percentileMethod: 'nearest rank; n=3 P95 equals observed maximum', samples };
  performanceRuns.push(item); console.log('PERF ' + JSON.stringify(item));
  await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(performanceRuns, null, 2));
}
const manifest = { createdAt: new Date().toISOString(), node: process.version, palette: 'actual MARD_FULL_COLORS export', paletteCount: palette.length, paletteSha256: sha(JSON.stringify(palette)), inputs: inputs.map(({ image, canvas, ...i }) => ({ ...i, dimensions: { width: image.width, height: image.height } })), settings: { maxColors: 16, mode: 'auto', fit: 'original source, aspect-preserving long-edge target; no crop or background removal; same request for every sampler' }, limitations: ['No verified real photograph or anime source found in inspected fixtures. real-failures metadata explicitly says generated-photographic; excluded.', 'Cell differences and palette legality are objective comparisons, not semantic or global visual-quality scores.', 'Native canvas decode is not verified browser ICC parity.', 'Synchronous Node runtimes measure main-thread blocking compute, not browser UI responsiveness.', 'RSS values are before/after process samples, not true peak, and include retained memory from earlier runs.', 'Three sequential repetitions, no warmup, fixed ordering; P95 is the maximum of three samples.'] };
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(out, 'README.md'), `# Local fusion validation\n\nReproduce: \`node tools/local-fusion-validation.mjs\` from repository root.\n\nSee manifest.json for provenance and settings, quality.json for 48 comparisons, performance.json for 45 sequential timed runs, and contact-sheet.png for source/result review.\n\n${manifest.limitations.map(s => '- ' + s).join('\n')}\n\nAuto selected fusion for ${quality.filter(r => r.sampler === 'auto' && r.chosenStrategy !== 'v2-baseline').length}/6 input/size cases. A fallback equal to V2.5 is not an improvement claim.\n\n| Long edge | Path | P50 ms | P95 ms (n=3 maximum) |\n| --- | --- | ---: | ---: |\n${performanceRuns.map(r => `| ${r.edge} | ${r.sampler} | ${r.p50Ms.toFixed(1)} | ${r.p95Ms.toFixed(1)} |`).join('\n')}\n`);
