// Render a generated bead grid to a PNG file (each bead = scale px) so the
// result can be visually inspected against reference patterns.
// Usage: node scripts/grid-to-png.mjs <img> <gridWidth> <out.png> [scale] [lineLockShare]
import fs from 'node:fs';
import path from 'node:path';
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { generateCartoonBeadPattern } from '../lib/cartoonEngine.js';
const { createRequire } = await import('node:module');
const WS = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace';
const require = createRequire(path.join(WS, 'x.mjs'));
const { PNG } = require('pngjs');

const ctx = loadColorMath();
const palette = loadPalette();
const raw = process.argv[2];
const file = /^[a-zA-Z]:[\\/]/.test(raw) ? raw : new URL(raw, import.meta.url);
const gridW = Number(process.argv[3] || 120);
const outPath = process.argv[4];
const scale = Number(process.argv[5] || 8);
const share = process.argv[6];
const opt = { colorMath: ctx, palette, forceCartoon: true, width: gridW };
if (share !== undefined) opt.lineLockShare = Number(share);
if (process.argv[7] !== undefined) opt.maxColors = Number(process.argv[7]);
const img = loadImage(file);
const r = generateCartoonBeadPattern(img, opt);

const W = r.width * scale, H = r.height * scale;
const png = new PNG({ width: W, height: H });
// background transparent-ish checker? keep white
for (let gy = 0; gy < r.height; gy++) for (let gx = 0; gx < r.width; gx++) {
  const c = r.grid[gy][gx];
  const rgb = c ? c.rgb : [255, 255, 255];
  for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
    // subtle grid line on right/bottom edge of each bead
    const edge = dx === scale - 1 || dy === scale - 1;
    const mix = edge ? rgb.map((v) => Math.max(0, v - 18)) : rgb;
    const idx = ((gy * scale + dy) * W + (gx * scale + dx)) * 4;
    png.data[idx] = mix[0]; png.data[idx + 1] = mix[1]; png.data[idx + 2] = mix[2]; png.data[idx + 3] = 255;
  }
}
fs.writeFileSync(outPath, PNG.sync.write(png));
console.log(`wrote ${outPath} grid=${r.width}x${r.height} scale=${scale} final=${r.diagnostics.finalColors} budget=${r.diagnostics.maxColors} complexity=${r.diagnostics.complexity} lock=${r.diagnostics.lockedCells}`);
