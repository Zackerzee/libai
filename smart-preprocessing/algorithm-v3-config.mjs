// Experimental V3 sampling only. No production preset is changed here.
export const PERCEPTUAL_SAMPLER_V3_CONFIG=Object.freeze({
  version:'perceptual-v3-experimental-1',maxSamples:32,maxCandidates:8,alphaThreshold:8,
  contrastL:25,highlightL:85,highlightChroma:20,shadowL:12,
  highlightMinCoverage:.12,highlightMinConnectedPixels:2,highlightMinContrast:35,connectedHighlightMinAlpha:192,
  dominantShadowCoverage:.60,centerWeight:.35,edgeWeight:.45,contrastWeight:.35,saliencyWeight:.4,
  importanceContrast:1,importanceEdge:1,importanceHighlight:2,importanceShadow:1.5,chromaImportance:.3,
  maxChroma:100,maxLightness:100,
  maxSourceLabCacheBytes:64*1024*1024,
});
