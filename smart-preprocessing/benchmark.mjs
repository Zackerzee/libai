import { performance } from "node:perf_hooks";
import { createPaletteEngine } from "./palette-engine.mjs";

const palette = Array.from({ length: 291 }, (_, index) => ({
  code: `C${String(index).padStart(3, "0")}`,
  rgb: [(index * 37) % 256, (index * 67) % 256, (index * 97) % 256],
}));
const engine = createPaletteEngine(palette);
const start = performance.now();
for (let i = 0; i < 104 * 104; i += 1) {
  engine.match([(i * 17) % 256, (i * 31) % 256, (i * 47) % 256], { importance: i % 5 / 4 });
}
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  engine: engine.getReport().version,
  paletteSize: palette.length,
  cells: 104 * 104,
  milliseconds: Math.round(elapsed * 100) / 100,
  cacheHitRate: engine.getReport().cacheHitRate,
}, null, 2));

