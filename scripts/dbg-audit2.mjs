// Classify frame gap cells: cells that should carry the light frame but ended
// dark. lockedBlack = cell contains near-black outline pixels (outline wins by
// design). lost = no such excuse -- the line was dropped.
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { generateCartoonBeadPattern, detectContentCrop, resizeForAnalysis, edgeDetection, protectOutline } from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const delta = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] ? 0 : ctx.deltaE2000(ctx.rgbToLab(...a), ctx.rgbToLab(...b));
const lum = c => .299 * c[0] + .587 * c[1] + .114 * c[2];
const img = loadImage('E:/libai/golden/fixtures/blackyellow-src.png');
const crop = detectContentCrop(img, delta);
const FRAME = [211, 207, 200];
const bandY0 = .06, bandY1 = .24;
const W = 120;
const r = generateCartoonBeadPattern(img, { colorMath: ctx, palette, forceCartoon: true, width: W });
const im = resizeForAnalysis(img, 540, crop);
const edges = edgeDetection(im);
const outline = protectOutline(im, edges);
const frameMask = new Uint8Array(im.width * im.height);
for (let i = 0; i < im.width * im.height; i++) {
  const y = Math.floor(i / im.width), ny = y / im.height;
  if (ny < bandY0 || ny > bandY1) continue;
  const c = Array.from(im.data.subarray(i * 4, i * 4 + 3));
  if (delta(c, FRAME) < 10) frameMask[i] = 1;
}
let locked = 0, lost = 0;
const lostMap = new Map();
for (let gy = 0; gy < r.height; gy++) for (let gx = 0; gx < r.width; gx++) {
  const bead = r.grid[gy][gx];
  if (bead && lum(bead.rgb) > 120) continue;
  const x0 = Math.floor(gx * im.width / r.width), x1 = Math.ceil((gx + 1) * im.width / r.width);
  const y0 = Math.floor(gy * im.height / r.height), y1 = Math.ceil((gy + 1) * im.height / r.height);
  let hasFrame = false, hasLock = false;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * im.width + x;
    if (frameMask[i]) hasFrame = true;
    if (outline[i]) hasLock = true;
  }
  if (!hasFrame) continue;
  if (hasLock) locked++;
  else { lost++; lostMap.set(gx + ',' + gy, bead ? bead.rgb.join(',') : 'empty'); }
}
console.log(`W=${W} frame-bearing dark cells: lockedBlack(ok)=${locked} lost(bad)=${lost}`);
console.log('lost cells (first 40):');
for (const [k, v] of [...lostMap.entries()].slice(0, 40)) console.log(' ', k, '->', v);
