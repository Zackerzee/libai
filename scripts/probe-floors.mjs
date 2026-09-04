// Probe: with an INCLUSIVE hue count (low area floor), what complexity tier
// would each synthetic + the real hello-kitty fixtures get? Simulates the fix
// before we change the engine, so we can pick sound thresholds.
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { segmentColorRegions, extractRegionColor, detectImageStyle } from '../lib/cartoonEngine.js';
import { loadImage } from './lib/load-image.mjs';

const ctx = loadColorMath();
const cache = new Map();
const lab = (c) => { const k = c.join(','); if (!cache.has(k)) cache.set(k, ctx.rgbToLab(...c)); return cache.get(k); };
const delta = (a, b) => ctx.deltaE2000(lab(a), lab(b));

function makeImage(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h * 4; i++) data[i] = 255;
  paint(data, w, h); return { width: w, height: h, data };
}
function setpx(d, w, x, y, c) { const o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
function rect(d, w, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setpx(d, w, x, y, c); }

// assemble synthetic cases
const W1 = 400, H1 = 300;
const img1 = makeImage(W1, H1, (d, w, h) => {
  const colors = [[220,30,30],[30,180,50],[30,80,220],[240,200,40],[150,30,150],[0,160,180],[250,120,20],[120,80,40],[200,220,40],[240,40,160],[80,60,200],[40,200,150]];
  for (let ci = 0; ci < colors.length; ci++) { const px = (ci * 33 + 8) % (w - 40), py = 20 + (ci % 5) * 30; rect(d, w, px, py, px + 12, py + 12, colors[ci]); }
});
const img2 = makeImage(360, 360, (d, w, h) => {
  rect(d, w, 20, 20, 340, 340, [250, 230, 40]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onRim = x < 20 || x > 340 || y < 20 || y > 340, near = (x0, y0) => Math.hypot(x - x0, y - y0);
    const isDetail = near(120, 150) < 26 || near(240, 150) < 26;
    if (onRim) setpx(d, w, x, y, [20, 18, 16]); else if (isDetail) setpx(d, w, x, y, [15, 12, 12]);
  }
});
const img3 = makeImage(360, 360, (d, w, h) => {
  rect(d, w, 0, 0, 359, 359, [240, 120, 150]);
  const hues = [[240,200,60],[120,160,240],[90,200,120],[230,120,80],[150,90,200],[60,180,200],[250,150,200],[160,160,60],[200,60,60],[60,120,200]];
  for (let s = 0; s < hues.length; s++) rect(d, w, s * 36, 40, s * 36 + 12, 320, hues[s]);
});

function analyze(name, img) {
  const style = detectImageStyle(img);
  const seg = segmentColorRegions(img, delta);
  const total = seg.regions.reduce((s, r) => s + r.area, 0);
  for (const r of seg.regions) r.color = extractRegionColor(r, img);
  // hue counts at different floors
  for (const floorRatio of [0, 0.0002, 0.0005, 0.001, 0.002]) {
    const floor = Math.max(3, total * floorRatio);
    const fams = [];
    for (const r of seg.regions) if (r.area >= floor) if (!fams.some((c) => delta(c, r.color) < 8)) fams.push(r.color);
    console.log(`  ${name}: floor*${floorRatio}(abs=${floor.toFixed(1)}) distinctHues=${fams.length}  -> tier=${fams.length <= 9 ? 'simple' : fams.length <= 18 ? 'normal' : 'complex'}`);
  }
  console.log(`  ${name}: TOTAL px=${total}, region count=${seg.regions.length}`);
}

analyze('many-small-detail(12 colors)', img1);
analyze('black-yellow-anime(2 tones)', img2);
analyze('multicolor-stripes(10 hues)', img3);
for (const f of ['test1.png', 'test2.png', 'test3.jpg']) {
  const img = loadImage(new URL('../golden/fixtures/' + f, import.meta.url));
  analyze('REAL ' + f, img);
}
