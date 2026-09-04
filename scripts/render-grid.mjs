// Render a generated bead grid (output of generateCartoonBeadPattern) as ASCII
// to inspect outline thickness and color layout without viewing the image.
// Usage: node scripts/render-grid.mjs <img> <gridWidth>
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { generateCartoonBeadPattern } from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const raw = process.argv[2];
const file = /^[a-zA-Z]:[\\/]/.test(raw) ? raw : new URL(raw, import.meta.url);
const gridW = Number(process.argv[3] || 120);
const img = loadImage(file);
const opt = { colorMath: ctx, palette, forceCartoon: true, width: gridW };
const share = process.argv[4];
if (share !== undefined) opt.lineLockShare = Number(share);
const r = generateCartoonBeadPattern(img, opt);

// block glyphs: use a dense char for ink intensity
const cells = r.grid;
const lumCell = (c) => (c ? 0.299 * c.rgb[0] + 0.587 * c.rgb[1] + 0.114 * c.rgb[2] : 255);
const glyph = (c) => {
  if (!c) return '.';
  const l = lumCell(c);
  if (l < 40) return '#';      // near black
  if (l > 235) return ' ';     // white/near white
  // color band map via a few chars
  const [rr, gg, bb] = c.rgb;
  if (rr > 150 && gg < 120 && bb > 120) return 'M';  // pink/magenta
  if (rr > 150 && gg < 110 && bb < 110) return 'R';  // red
  if (rr > 150 && gg > 130 && bb < 110) return 'Y';  // yellow/orange
  if (rr < 120 && gg < 120 && bb > 150) return 'B';  // blue
  if (rr < 100 && gg > 120 && bb < 100) return 'G';  // green
  if (Math.max(rr, gg, bb) - Math.min(rr, gg, bb) < 20) return 'g'; // grey
  return 'o';
};
for (const row of cells) {
  let line = '';
  for (const c of row) line += glyph(c);
  console.log(line);
}
console.log(`\n(diagnostics: complexity=${r.diagnostics.complexity} budget=${r.diagnostics.maxColors} finalColors=${r.diagnostics.finalColors} lock=${r.diagnostics.lockedCells} size=${r.width}x${r.height})`);
