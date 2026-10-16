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
  return { sampler: eligible || policy.eligible ? 'fusion-pindou-dominant' : null,
    reason: eligible ? 'high-confidence-flat-or-pixel' : policy.eligible ? 'experimental-clean-flat-structure' : 'conservative-v2-fallback', policy };
}

export function runLocalFusionEngine({ sampler = 'auto', ...request }) {
  const evidence = sampler === 'auto' ? analyzeLocalFusionEvidence(request.image) : null;
  const strategy = selectLocalFusionStrategy(evidence, sampler);
  // Plain name uses the same field already passed through existing job overrides.
  const overrides = { ...request.overrides };
  delete overrides.localFusionEnabled;
  delete overrides.localFusionSampler;
  if (strategy.sampler) overrides.localFusionSampler = strategy.sampler;
  const result = runGenerationPipeline({ ...request, routingEvidence: evidence, experimentalSampler: null, overrides });
  const fusion = { version: 1, strategy: strategy.sampler ?? 'v2-baseline', reason: strategy.reason, evidence: evidence ?? result.pipeline.analysis,
    policy: strategy.policy ?? null, scope: 'sampling-only', legacyOptimization: false };
  return { ...result, fusion, pipeline: { ...result.pipeline, fusion }, diagnostics: { ...result.diagnostics, localFusion: fusion } };
}
