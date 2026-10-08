import { performance } from "node:perf_hooks";
import { quantizeRegionAware } from "./region-aware-quantizer.mjs";

const width = 104; const height = 104;
const source = Array.from({ length: width * height }, (_, i) => {
  const x = i % width; const y = Math.floor(i / width);
  if ((x - 52) ** 2 + (y - 50) ** 2 < 22 ** 2) return [190 + (x % 5), 132 + (y % 7), 102];
  if (x < 12 || x > 91 || y < 10 || y > 89) return [92 + (x % 9), 57 + (y % 7), 38];
  return [225 + (x % 4), 218 + (y % 5), 198];
});
const palette = Array.from({ length: 221 }, (_, i) => ({ code: `C${i}`, rgb: [(i * 37) % 256, (i * 67) % 256, (i * 97) % 256] }));
const start = performance.now(); const result = quantizeRegionAware(source, width, height, palette); const elapsed = performance.now() - start;
console.log(JSON.stringify({ cells: source.length, milliseconds: Math.round(elapsed * 100) / 100, ...result.report }, null, 2));
