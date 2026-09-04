// Side-by-side black-structure comparison: source (auto-downsampled via cell
// dominance) vs generated grid, at the same width. '.'=non-black, '#'=black.
// Lets us see whether thin source lines bloat into thick black beads.
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { generateCartoonBeadPattern } from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const raw = process.argv[2];
const file = /^[a-zA-Z]:[\\/]/.test(raw) ? raw : new URL(raw, import.meta.url);
const gridW = Number(process.argv[3] || 120);
const img = loadImage(file);
const lum = (i) => 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
const isBlackSrc = (i) => lum(i) < 45;

const r = generateCartoonBeadPattern(img, { colorMath: ctx, palette, forceCartoon: true, width: gridW });
const W = r.width, H = r.height;
const srcMask = Array.from({ length: H }, () => Array(W).fill('.'));
for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
  const x0 = Math.floor(gx * img.width / W), x1 = Math.ceil((gx + 1) * img.width / W);
  const y0 = Math.floor(gy * img.height / H), y1 = Math.ceil((gy + 1) * img.height / H);
  let black = 0, tot = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { tot++; if (isBlackSrc(y * img.width + x)) black++; }
  if (black / Math.max(1, tot) >= 0.5) srcMask[gy][gx] = '#'; // majority-black source cell
}
const outBlack = r.grid.map((row) => row.map((c) => (c && lum2(c) < 45 ? '#' : '.')));
function lum2(c) { return 0.299 * c.rgb[0] + 0.587 * c.rgb[1] + 0.114 * c.rgb[2]; }

console.log('SOURCE black mask (majority-black per cell)  ----  OUTPUT black cells');
console.log('legend: # = black cell  ; white cells left as space for readability');
for (let y = 0; y < H; y++) {
  console.log('SRC|' + srcMask[y].join('').replace(/\./g, ' ') + '|  OUT|' + outBlack[y].join('').replace(/\./g, ' ') + '|');
}
console.log(`\nOUT black cell count=${outBlack.flat().filter((c) => c === '#').length}  SRC majority-black cells=${srcMask.flat().filter((c) => c === '#').length}  grid=${W}x${H}`);
