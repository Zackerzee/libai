import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, runPreviousAuto } from '../tools/local-fusion-calibration.mjs';
import { buildDataset } from '../tools/b4-routing-audit.mjs';
import { analyzeRoutingEvidence, runGenerationPipeline } from '../services/generation-pipeline.mjs';
import { analyzeLocalFusionEvidence, evaluateLocalFlatStructure } from '../services/local-fusion-routing.mjs';
import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';

const palette = [{ code: 'black', paletteId: 'test:black', rgb: [0, 0, 0] }, { code: 'white', paletteId: 'test:white', rgb: [255, 255, 255] }, { code: 'orange', paletteId: 'test:orange', rgb: [245, 100, 30] }];
test('real decoded logo selects integrated image-to-pixel with original classification intact', async () => {
  const { image } = await decode(new URL('../assets/brand/shiliber-mark-256.png', import.meta.url).pathname), before = image.data.slice();
  const evidence = analyzeLocalFusionEvidence(image);
  assert.deepEqual(evidence.routing, analyzeRoutingEvidence(image).routing);
  assert.equal(evidence.routing.mode, 'illustration');
  const request = { image, size: { width: 13, height: 13 }, palette };
  const result = runLocalFusionEngine(request);
  assert.equal(result.fusion.strategy, 'fusion-image-to-pixel');
  assert.equal(result.fusion.policy.category, 'clean-flat-structure');
  assert.match(result.fusion.policy.scoreKind, /not-probability/);
  assert.deepEqual(result.grid, runLocalFusionEngine({ ...request, sampler: 'fusion-image-to-pixel' }).grid);
  assert.deepEqual(result.grid, runLocalFusionEngine(request).grid);
  assert.equal(result.grid.length, 13); assert.ok(result.grid.every(r => r.length === 13));
  assert.deepEqual(image.data, before);
  for (const c of result.grid.flat().filter(Boolean)) assert.ok(palette.some(p => p.code === c.code && p.paletteId === c.paletteId && p.rgb.every((v, i) => v === c.rgb[i])));
});
test('real fantasy and textured sign keep exact previous-auto and production output', async () => {
  for (const file of [new URL('./fixtures/v3/baseline-v3-before-fix/original.jpg', import.meta.url).pathname, '/Users/gongzhenyan/Downloads/羊年福到金红贺岁牌.png']) {
    const { image } = await decode(file), request = { image, size: { width: 13, height: 13 }, palette };
    const result = runLocalFusionEngine(request);
    assert.equal(result.fusion.strategy, 'v2-baseline');
    assert.deepEqual(result.grid, runPreviousAuto(request).grid);
    assert.deepEqual(result.grid, runGenerationPipeline(request).grid);
  }
});
test('all 25 sources keep conservative gate; eligible images use integrated samplers', () => {
  const rows = buildDataset(); assert.equal(rows.length, 25);
  for (const row of rows) {
    const e = analyzeLocalFusionEvidence(row.source), old = ['pixel', 'logo'].includes(e.routing.mode) && e.routing.confidence >= .75;
    assert.equal(evaluateLocalFlatStructure(e.fusionSignals).eligible, false, row.id);
    const request = { image: row.source, size: { width: 7, height: 7 }, palette };
    const result = runLocalFusionEngine(request);
    const sampler=e.routing.mode==='pixel' ? 'fusion-pixel-art-fixer' : 'fusion-image-to-pixel';
    assert.equal(result.fusion.strategy, old ? sampler : 'v2-baseline', row.id);
    assert.deepEqual(result.grid, old ? runLocalFusionEngine({...request,sampler}).grid : runPreviousAuto(request).grid, row.id);
  }
});
test('missing signals, uniform colors and thin strokes cannot pass the structural gate', () => {
  assert.equal(evaluateLocalFlatStructure(null).eligible, false);
  const good = { paletteSize95: 8, largeFlatBlockRatio: .8, localColorVariety: .1, highFrequencyRatio: .01, structureThickness: .95, shadingCoverage: .5, magnificationTrace: 0, edgeDensity: .03 };
  assert.equal(evaluateLocalFlatStructure(good).eligible, true);
  for (const [key, value] of [['structureThickness', .1], ['paletteSize95', 1], ['shadingCoverage', .8], ['magnificationTrace', 1], ['edgeDensity', 0]]) assert.equal(evaluateLocalFlatStructure({ ...good, [key]: value }).eligible, false, key);
  for (const key of Object.keys(good)) assert.equal(evaluateLocalFlatStructure({ ...good, [key]: undefined }).eligible, false, key);
});
test('real pixel-structured preview routes fixer reconstruction through the existing pixel gate', async () => {
  const { image } = await decode('/Users/gongzhenyan/Downloads/02_国清寺_46x46_10x预览.png'), before = image.data.slice();
  const evidence = analyzeLocalFusionEvidence(image);
  assert.equal(evidence.routing.mode, 'pixel');
  assert.ok(evidence.routing.confidence >= .75, `像素门置信度不足：${evidence.routing.confidence}`);
  const request = { image, size: { width: 13, height: 13 }, palette };
  const result = runLocalFusionEngine(request);
  assert.equal(result.fusion.strategy, 'fusion-pixel-art-fixer');
  assert.deepEqual(result.grid, runLocalFusionEngine({ ...request, sampler: 'fusion-pixel-art-fixer' }).grid);
  assert.deepEqual(image.data, before);
});
test('real text and document samples keep conservative baseline (dominant would destroy strokes)', async () => {
  for (const file of ['/Users/gongzhenyan/Downloads/0001.JPEG', '/Users/gongzhenyan/Downloads/2902.JPG']) {
    const { image } = await decode(file), before = image.data.slice();
    const request = { image, size: { width: 13, height: 13 }, palette };
    const result = runLocalFusionEngine(request);
    assert.equal(result.fusion.strategy, 'v2-baseline', file);
    assert.equal(evaluateLocalFlatStructure(analyzeLocalFusionEvidence(image).fusionSignals).eligible, false, file);
    assert.deepEqual(result.grid, runPreviousAuto(request).grid, file);
    assert.deepEqual(image.data, before, file);
  }
});
