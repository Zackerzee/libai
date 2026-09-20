import { performance } from "node:perf_hooks";
import { preprocessPortrait } from "./portrait-preprocessor.mjs";
import { buildDetailProtectionMask, buildEdgeImportanceMap } from "./structure-analyzer.mjs";

const width = 300; const height = 300; // 3x sampling buffer for a 100x100 pattern.
const pixels = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < width * height; i += 1) {
  const x = i % width; const y = Math.floor(i / width); const p = i * 4;
  pixels[p] = (x + y) % 3 ? 184 : 42; pixels[p + 1] = (x + y) % 3 ? 126 : 35; pixels[p + 2] = (x + y) % 3 ? 98 : 38; pixels[p + 3] = 255;
}
const start = performance.now();
const prepared = preprocessPortrait(pixels, width, height, {});
const edges = buildEdgeImportanceMap(prepared.pixels, width, height);
const details = buildDetailProtectionMask(edges, prepared.pixels, width, height);
console.log(JSON.stringify({ targetCells: 10000, samplePixels: width * height, milliseconds: Math.round((performance.now() - start) * 100) / 100, protectedSamples: details.reduce((a, b) => a + b, 0) }, null, 2));
