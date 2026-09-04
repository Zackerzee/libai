// Budget-logic probe with synthetic images. Generates a handful of controlled
// images (many small colored detail regions; black-yellow anime-like; many flat
// colors) and reports the engine's complexity tier + family counts, so we can
// see whether fragmented small regions are being ignored by cartoonColorBudget.
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { loadImage } from './lib/load-image.mjs';
import { segmentColorRegions, extractRegionColor, cartoonColorBudget,
         detectImageStyle, generateCartoonBeadPattern } from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const cache = new Map();
const lab = (c) => { const k = c.join(','); if (!cache.has(k)) cache.set(k, ctx.rgbToLab(...c)); return cache.get(k); };
const delta = (a, b) => ctx.deltaE2000(lab(a), lab(b));

function makeImage(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < w * h; i++) { data[i * 4 + 3] = 255; }
  paint(data, w, h);
  return { width: w, height: h, data };
}
function setpx(d, w, x, y, c) { const o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
function rect(d, w, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setpx(d, w, x, y, c); }
function hsv(h, s, v) {
  const c = v * s, hp = h / 60, x = c * (1 - Math.abs(hp % 2 - 1)), m = v - c;
  const rgb = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return rgb.map((k) => Math.round((k + m) * 255));
}

function budgetReport(name, img, w, h) {
  const style = detectImageStyle(img);
  // emulate engine path
  const seg = segmentColorRegions(img, delta);
  for (const r of seg.regions) r.color = extractRegionColor(r, img);
  const budget = cartoonColorBudget(seg.regions, delta);
  const r = generateCartoonBeadPattern(img, { colorMath: ctx, palette, forceCartoon: true });
  console.log(`\n[${name}] style=${style.type} size=${w}x${h} regions=${seg.regions.length} -> complexity=${budget.complexity} maxColors=${budget.maxColors}`);
  console.log(`    pipe: finalColors=${r.diagnostics.finalColors} origColors=${r.diagnostics.originalColors} budget=${r.diagnostics.maxColors} complexity=${r.diagnostics.complexity}`);
}

// --- Case 1: many SMALL colored regions on white (fragmented anime detail) ---
const W = 400, H = 300;
const img1 = makeImage(W, H, (d, w, h) => {
  // background white already
  let cx = 10;
  const colors = [[220,30,30],[30,180,50],[30,80,220],[240,200,40],[150,30,150],[0,160,180],[250,120,20],[120,80,40],[200,220,40],[240,40,160],[80,60,200],[40,200,150]];
  // 12 small colored squares scattered (each ~10x10 = 0.08% of 120k, under old 0.2% floor)
  for (let ci = 0; ci < colors.length; ci++) {
    const px = (ci * 33 + 8) % (w - 40), py = 20 + (ci % 5) * 30;
    rect(d, w, px, py, px + 12, py + 12, colors[ci]);
  }
});
budgetReport('many-small-colored-detail', img1, W, H);

// --- Case 2: black-yellow anime-like: black thick outline + a few mid tones ---
const img2 = makeImage(360, 360, (d, w, h) => {
  // yellow face, black rim, few dark detail shapes
  rect(d, w, 20, 20, 340, 340, [250, 230, 40]);      // yellow body
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onRim = x < 20 || x > 340 || y < 20 || y > 340;
    const near = (x0, y0) => Math.hypot(x - x0, y - y0);
    const isDetail = near(120, 150) < 26 || near(240, 150) < 26; // two eyes
    if (onRim) setpx(d, w, x, y, [20, 18, 16]); else if (isDetail) setpx(d, w, x, y, [15, 12, 12]);
  }
});
budgetReport('black-yellow-anime-like', img2, 360, 360);

// Case 3: complex multi-color with gradients split into many regions ---
const img3 = makeImage(360, 360, (d, w, h) => {
  rect(d, w, 0, 0, 359, 359, [240, 120, 150]); // base pink
  // many stripes of different hues (simulating detailed anime clothing)
  const hues = [[240,200,60],[120,160,240],[90,200,120],[230,120,80],[150,90,200],[60,180,200],[250,150,200],[160,160,60],[200,60,60],[60,120,200]];
  for (let s = 0; s < hues.length; s++) rect(d, w, s * 36, 40, s * 36 + 12, 320, hues[s]);
});
budgetReport('complex-multicolor-stripes', img3, 360, 360);

// Case 4: TRUE complex anime — 22 distinct flat hues scattered in many pieces
// (typical anime frame). Should classify complex (=> 30 budget) not simple.
const img4 = makeImage(420, 420, (d, w, h) => {
  rect(d, w, 0, 0, 419, 419, [235, 235, 245]);
  const pal = [];
  for (let i = 0; i < 22; i++) {
    const hue = (i * 137) % 360, sat = 0.55 + 0.4 * ((i * 31) % 10) / 10, val = 0.55 + 0.4 * ((i * 17) % 10) / 10;
    const c = hsv(hue, sat, val); pal.push(c);
  }
  // scatter each hue as several small blobs (30x14 each) around the canvas
  for (let i = 0; i < pal.length; i++) {
    const cx = 14 + (i % 6) * 66, cy = 14 + Math.floor(i / 6) * 70;
    for (let y = 0; y < 70; y++) for (let x = 0; x < 62; x++) setpx(d, w, cx + x, cy + y, pal[i]);
  }
});
budgetReport('true-complex-anime(22 hues)', img4, 420, 420);

// Case 5: black-yellow character with shading — yellow base, many orange/tan
// tone patches + black lineart, so real hue count is ~8-9 (needs normal).
const img5 = makeImage(400, 400, (d, w, h) => {
  rect(d, w, 0, 0, 399, 399, [255, 255, 255]);
  rect(d, w, 40, 40, 359, 359, [252, 224, 30]);            // yellow body
  // tone shading patches (skin/orange)
  const tones = [[255,190,60],[250,150,50],[240,180,90],[255,210,90],[200,120,20],[255,160,110]];
  for (let i = 0; i < tones.length; i++) rect(d, w, 60 + (i % 3) * 90, 90 + Math.floor(i / 3) * 120, 130 + (i % 3) * 90, 190 + Math.floor(i / 3) * 120, tones[i]);
  // black lineart frame + eyes
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) {
    const onRim = x < 40 || x > 359 || y < 40 || y > 359 || x === 90 || x === 300;
    if (onRim) setpx(d, w, x, y, [18, 16, 14]);
  }
});
budgetReport('black-yellow-with-shading', img5, 400, 400);

// print final color fidelity: distinct colors reached vs budget cap, for each case
console.log('\n== final color fidelity (real hues kept under budget) ==');
for (const f of ['../golden/fixtures/test1.png', '../golden/fixtures/test2.png', '../golden/fixtures/test3.jpg']) {
  const img = loadImage(new URL(f, import.meta.url));
  const r = generateCartoonBeadPattern(img, { colorMath: ctx, palette, forceCartoon: true });
  console.log(`${f}: complexity=${r.diagnostics.complexity} budget=${r.diagnostics.maxColors} orig=${r.diagnostics.originalColors} final=${r.diagnostics.finalColors} -> ${r.diagnostics.finalColors <= r.diagnostics.maxColors ? 'OK<=budget' : 'EXCEED'}`);
}
