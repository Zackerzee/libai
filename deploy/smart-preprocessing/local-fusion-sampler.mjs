/** Opt-in raw sampling only: palette matching and cleanup remain owned by V2. */
import { downsample } from '../src/algorithms/pindou-full/quantize.mjs';
import { cellBounds, extractCellFeatures, SamplingMode, SamplingModeIndex } from './sampling-engine-v2.mjs';

export const LOCAL_FUSION_SAMPLERS = Object.freeze(['area', 'nearest', 'dominant', 'edge', 'dpid', 'ssim'].map(mode => `fusion-pindou-${mode}`));
export function isLocalFusionSampler(name) { return LOCAL_FUSION_SAMPLERS.includes(name); }

export function sampleGridLocalFusion(source, width, height, name, config = {}) {
  if (!isLocalFusionSampler(name)) throw new RangeError(`Unknown local fusion sampler: ${name}`);
  if (![source?.width, source?.height, width, height].every(n => Number.isInteger(n) && n > 0) || source.data?.length !== source.width * source.height * 4) throw new TypeError('Local fusion sampling requires valid RGBA dimensions');
  const nativeMode = name.slice('fusion-pindou-'.length);
  // Native texture default = 100 / 100. No native remap/refine/adjust runs here.
  const rgba = downsample(source.data, source.width, source.height, width, height, nativeMode, 1);
  const colors = [], features = [];
  const alphaThreshold = config.extraction?.alphaThreshold ?? 8;
  // Cleanup recognizes only the established V2 numeric categories. Advanced
  // native modes use edge-aware cleanup policy; this is not a pixel parity claim.
  const policy = nativeMode === 'nearest' ? [SamplingMode.CENTER, SamplingModeIndex.CENTER]
    : nativeMode === 'dominant' ? [SamplingMode.DOMINANT, SamplingModeIndex.DOMINANT]
    : nativeMode === 'area' ? [SamplingMode.LINEAR_MEAN, SamplingModeIndex.LINEAR_MEAN]
    : [SamplingMode.EDGE_AWARE, SamplingModeIndex.EDGE_AWARE];
  for (let y = 0; y < height; y++) {
    colors[y] = []; features[y] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const bounds = cellBounds(x, y, source.width, source.height, width, height);
      features[y][x] = extractCellFeatures(source, bounds, config);
      // Null follows native sampled alpha (<= V2 threshold); source evidence
      // retains original bounds. Native nearest may deliberately pick a hole.
      colors[y][x] = rgba[i + 3] <= alphaThreshold ? null : { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] };
    }
  }
  return { colors, features, resolvedMode: policy[0], modeMap: new Uint8Array(width * height).fill(policy[1]),
    diagnostics: { id: name, nativeMode, alphaThreshold, alphaPolicy: 'native-sampled-alpha', cleanupPolicy: policy[0], quantization: 'v2-palette-engine-only' } };
}
