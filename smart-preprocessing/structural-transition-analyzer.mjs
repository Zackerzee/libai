export const STRUCTURAL_TRANSITION_VERSION = "0.1.0-detection-only";
export const StructuralTransitionConfig = Object.freeze({
  luminanceWeight: 0.28, hueWeight: 0.16, chromaWeight: 0.10,
  edgeWeight: 0.20, regionWeight: 0.12, textureWeight: 0.08,
  localContrastWeight: 0.06, unsupportedThreshold: 0.32,
  islandSupportThreshold: 0.35, maxIslandArea: 2,
});

const clamp = (v) => Math.max(0, Math.min(1, v));
const code = (color) => color?.code || color?.hex || "";
const neighbors = (i, w, h) => {
  const x = i % w, y = Math.floor(i / w), result = [];
  if (x) result.push(i - 1);
  if (x + 1 < w) result.push(i + 1);
  if (y) result.push(i - w);
  if (y + 1 < h) result.push(i + w);
  return result;
};
const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function buildSourceFeatureMap(rgbGrid, width, height, rgbToOKLab, options = {}) {
  if (rgbGrid.length !== width * height) throw new Error("source feature dimensions mismatch");
  const labs = rgbGrid.map((rgb) => rgb ? rgbToOKLab(rgb) : null);
  const luminance = new Float32Array(labs.length), hue = new Float32Array(labs.length), chroma = new Float32Array(labs.length);
  const gradient = new Float32Array(labs.length), edge = new Float32Array(labs.length), texture = new Float32Array(labs.length), orientation = new Float32Array(labs.length);
  const contrast = new Float32Array(labs.length), regionBoundary = new Float32Array(labs.length);
  labs.forEach((lab, i) => { if (!lab) return; luminance[i] = lab[0]; hue[i] = Math.atan2(lab[2], lab[1]); chroma[i] = Math.hypot(lab[1], lab[2]); });
  labs.forEach((lab, i) => {
    if (!lab) return;
    const x = i % width, y = Math.floor(i / width);
    const left = x ? labs[i - 1] : null, right = x + 1 < width ? labs[i + 1] : null;
    const up = y ? labs[i - width] : null, down = y + 1 < height ? labs[i + width] : null;
    const dx = (right?.[0] ?? lab[0]) - (left?.[0] ?? lab[0]);
    const dy = (down?.[0] ?? lab[0]) - (up?.[0] ?? lab[0]);
    gradient[i] = clamp(Math.hypot(dx, dy) * 2.5);
    orientation[i] = Math.atan2(dy, dx);
    const ns = neighbors(i, width, height).filter((n) => labs[n]);
    const distances = ns.map((n) => labDistance(lab, labs[n]));
    edge[i] = clamp((Math.max(0, ...distances)) * 3);
    contrast[i] = clamp(Math.max(0, ...ns.map((n) => Math.abs(lab[0] - labs[n][0]))) * 3);
    const mean = ns.length ? ns.reduce((sum, n) => sum + labs[n][0], lab[0]) / (ns.length + 1) : lab[0];
    texture[i] = clamp(Math.sqrt(([i, ...ns]).reduce((sum, n) => sum + (labs[n][0] - mean) ** 2, 0) / (ns.length + 1)) * 7);
    regionBoundary[i] = ns.some((n) => options.regionIds && options.regionIds[n] !== options.regionIds[i]) ? 1 : 0;
  });
  return { width, height, labs, sourceLuminanceMap: luminance, sourceHueMap: hue, sourceChromaMap: chroma, sourceGradientMap: gradient, sourceEdgeMap: edge, sourceTextureMap: texture, sourceOrientationMap: orientation, localContrastMap: contrast, regionBoundaryMap: regionBoundary };
}

function hueDifference(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) / Math.PI; }

export function calculateStructuralEvidence(index, features, config = StructuralTransitionConfig) {
  if (!features.labs[index]) return 0;
  const ns = neighbors(index, features.width, features.height).filter((n) => features.labs[n]);
  const hueEvidence = Math.max(0, ...ns.map((n) => hueDifference(features.sourceHueMap[index], features.sourceHueMap[n]))) * 2;
  const chromaEvidence = Math.max(0, ...ns.map((n) => Math.abs(features.sourceChromaMap[index] - features.sourceChromaMap[n]))) * 4;
  return clamp(config.luminanceWeight * features.sourceGradientMap[index] + config.hueWeight * clamp(hueEvidence) + config.chromaWeight * clamp(chromaEvidence) + config.edgeWeight * features.sourceEdgeMap[index] + config.regionWeight * features.regionBoundaryMap[index] + config.textureWeight * features.sourceTextureMap[index] + config.localContrastWeight * features.localContrastMap[index]);
}

export function transitionDirectionConsistency(i, n, features, matrix, rgbToOKLab) {
  const sourceDelta = features.sourceLuminanceMap[i] - features.sourceLuminanceMap[n];
  const beadDelta = rgbToOKLab(matrix[i].rgb)[0] - rgbToOKLab(matrix[n].rgb)[0];
  if (Math.abs(sourceDelta) < 0.012 || Math.abs(beadDelta) < 0.012) return 0.5;
  return Math.sign(sourceDelta) === Math.sign(beadDelta) ? 1 : 0;
}

export function transitionEvidenceScore(i, n, features, matrix, rgbToOKLab, options = {}) {
  if (!features.labs[i] || !features.labs[n] || !matrix[i] || !matrix[n]) return 0;
  const colorSupport = clamp(labDistance(features.labs[i], features.labs[n]) * 4);
  const edgeSupport = Math.max(features.sourceEdgeMap[i], features.sourceEdgeMap[n]);
  const regionSupport = options.regionIds?.[i] !== options.regionIds?.[n] && options.regionIds ? 1 : 0;
  const roleSupport = options.roles?.[i] !== options.roles?.[n] && options.roles ? 0.5 : 0;
  const direction = transitionDirectionConsistency(i, n, features, matrix, rgbToOKLab);
  return clamp(colorSupport * 0.38 + edgeSupport * 0.20 + regionSupport * 0.16 + roleSupport * 0.08 + direction * 0.10 + Math.max(features.sourceTextureMap[i], features.sourceTextureMap[n]) * 0.08);
}

export function detectStructuralTransitions(grid, features, rgbToOKLab, options = {}) {
  const { width, height } = features, matrix = grid.flat();
  if (matrix.length !== width * height) throw new Error("pattern feature dimensions mismatch");
  const config = { ...StructuralTransitionConfig, ...options.config };
  const unsupportedTransitionMap = new Uint8Array(matrix.length);
  const structuralEvidenceMap = Float32Array.from(matrix, (_color, i) => calculateStructuralEvidence(i, features, config));
  const transitions = [];
  matrix.forEach((color, i) => {
    if (!color) return;
    for (const n of [i % width + 1 < width ? i + 1 : -1, i + width < matrix.length ? i + width : -1]) {
      if (n < 0 || !matrix[n] || code(color) === code(matrix[n])) continue;
      const support = transitionEvidenceScore(i, n, features, matrix, rgbToOKLab, options);
      if (support < config.unsupportedThreshold) { unsupportedTransitionMap[i] = 1; unsupportedTransitionMap[n] = 1; transitions.push({ a: i, b: n, support }); }
    }
  });
  const visited = new Uint8Array(matrix.length), components = [];
  matrix.forEach((color, start) => {
    if (!color || visited[start]) return;
    const queue = [start], pixels = [], adjacent = new Map(); visited[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head]; pixels.push(i);
      neighbors(i, width, height).forEach((n) => {
        if (!matrix[n]) return;
        if (code(matrix[n]) === code(color)) { if (!visited[n]) { visited[n] = 1; queue.push(n); } }
        else adjacent.set(code(matrix[n]), (adjacent.get(code(matrix[n])) || 0) + 1);
      });
    }
    const sourceEvidence = pixels.reduce((sum, i) => sum + structuralEvidenceMap[i], 0) / pixels.length;
    const detailImportance = pixels.reduce((sum, i) => sum + Math.max(features.sourceEdgeMap[i], features.localContrastMap[i]), 0) / pixels.length;
    const unsupportedRatio = pixels.filter((i) => unsupportedTransitionMap[i]).length / pixels.length;
    const neighborDominance = Math.max(0, ...adjacent.values()) / Math.max(1, [...adjacent.values()].reduce((a, b) => a + b, 0));
    const protectedContour = pixels.some((i) => options.contourLockedMask?.[i]);
    const artifactScore = clamp((pixels.length <= config.maxIslandArea ? 0.34 : 0) + unsupportedRatio * 0.25 + neighborDominance * 0.23 + (1 - sourceEvidence) * 0.18 - detailImportance * 0.55 - (protectedContour ? 0.5 : 0));
    components.push({ code: code(color), pixels, area: pixels.length, perimeter: [...adjacent.values()].reduce((a, b) => a + b, 0), boundingBox: { x0: Math.min(...pixels.map((i) => i % width)), x1: Math.max(...pixels.map((i) => i % width)), y0: Math.min(...pixels.map((i) => Math.floor(i / width))), y1: Math.max(...pixels.map((i) => Math.floor(i / width))) }, neighborColors: [...adjacent], sourceEvidence, detailImportance, unsupportedRatio, artifactScore, protectedContour, suspectedArtifact: pixels.length <= config.maxIslandArea && sourceEvidence < config.islandSupportThreshold && detailImportance < config.islandSupportThreshold && unsupportedRatio > 0 && !protectedContour });
  });
  const unsupported = components.filter((component) => component.suspectedArtifact);
  return { version: STRUCTURAL_TRANSITION_VERSION, mode: "detection-only", structuralEvidenceMap, unsupportedTransitionMap, unsupportedTransitions: transitions, components, suspectedArtifacts: unsupported, metrics: { colorCount: new Set(matrix.filter(Boolean).map(code)).size, unsupportedTransitionCount: transitions.length, unsupportedIslandCount: unsupported.length, unsupportedIslandPixels: unsupported.reduce((sum, item) => sum + item.area, 0), unsupportedIslandRatio: unsupported.reduce((sum, item) => sum + item.area, 0) / Math.max(1, matrix.filter(Boolean).length) } };
}

const api = { STRUCTURAL_TRANSITION_VERSION, StructuralTransitionConfig, buildSourceFeatureMap, calculateStructuralEvidence, transitionDirectionConsistency, transitionEvidenceScore, detectStructuralTransitions };
if (typeof window !== "undefined") window.LibmsStructuralTransitionAnalyzer = api;
