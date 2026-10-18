/** Local fusion runner; callers explicitly own opt-in and transport. */
import { runGenerationPipeline } from './generation-pipeline.mjs';
import { analyzeLocalFusionEvidence, evaluateLocalFlatStructure } from './local-fusion-routing.mjs';
import { isLocalFusionSampler } from '../smart-preprocessing/local-fusion-sampler.mjs';

export function selectLocalFusionStrategy(evidence, sampler = 'auto') {
  if (sampler !== 'auto' && sampler !== 'v2-baseline' && !isLocalFusionSampler(sampler)) throw new RangeError(`Unknown local fusion strategy: ${sampler}`);
  if (sampler !== 'auto') return { sampler: sampler === 'v2-baseline' ? null : sampler, reason: 'explicit-local-override' };
  const routing = evidence?.routing;
  const eligible = ['pixel', 'logo'].includes(routing?.mode) && routing.confidence >= 0.75;
  const policy = evaluateLocalFlatStructure(evidence?.fusionSignals);
  const externalSampler = routing?.mode === 'pixel' ? 'fusion-pixel-art-fixer' : 'fusion-image-to-pixel';
  return { sampler: eligible || policy.eligible ? externalSampler : null,
    reason: eligible ? 'high-confidence-flat-or-pixel' : policy.eligible ? 'experimental-clean-flat-structure' : 'conservative-v2-fallback', policy };
}

/** Auto routing must not turn an existing large-image upload into a failure. */
export function boundAutomaticFusionStrategy(strategy, source) {
  const pixels = Number(source?.width) * Number(source?.height);
  const desired = strategy.sampler;
  const cappedFixer = desired === 'fusion-pixel-art-fixer' && pixels > 4_000_000;
  const cappedImage = desired === 'fusion-image-to-pixel' && pixels > 16_777_216;
  if (!cappedFixer && !cappedImage) return strategy;
  const sampler = pixels <= 16_777_216 ? 'fusion-image-to-pixel' : 'fusion-pindou-dominant';
  return {...strategy,sampler,reason:'external-source-limit-compatible-fallback',
    sourceSizeFallback:{requested:desired,selected:sampler,sourcePixels:pixels}};
}

export function runLocalFusionEngine({ sampler: explicitSampler, ...request }) {
  const sampler = explicitSampler ?? request.overrides?.localFusionSampler ?? 'auto';
  const evidence = sampler === 'auto' ? analyzeLocalFusionEvidence(request.image) : null;
  const selected = selectLocalFusionStrategy(evidence, sampler);
  const strategy = sampler === 'auto' ? boundAutomaticFusionStrategy(selected, request.image) : selected;
  // Plain name uses the same field already passed through existing job overrides.
  const overrides = { ...request.overrides };
  delete overrides.localFusionEnabled;
  delete overrides.localFusionSampler;
  if (strategy.sampler) overrides.localFusionSampler = strategy.sampler;
  const result = runGenerationPipeline({ ...request, routingEvidence: evidence, experimentalSampler: null, overrides });
  const fusion = { version: 2, strategy: strategy.sampler ?? 'v2-baseline', reason: strategy.reason, evidence: evidence ?? result.pipeline.analysis,
    policy: strategy.policy ?? null, sourceSizeFallback:strategy.sourceSizeFallback ?? null, scope: 'sampling-only', legacyOptimization: false };
  return { ...result, fusion, pipeline: { ...result.pipeline, fusion }, diagnostics: { ...result.diagnostics, localFusion: fusion } };
}
