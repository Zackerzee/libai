// Real-image regression driver for Cartoon Engine V2.
// Decodes the three fixtures and reports engine metrics so we can
// reason about the two reported defects:
//   (A) complex / black-yellow anime getting too-low color budgets
//   (B) thin clothes lines thickening in Hello-Kitty-style images
// Run:  NODE_PATH=<workspace>/node_modules node scripts/regress-cartoon-v2.mjs
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import {
  detectImageStyle, generateCartoonBeadPattern, resizeForAnalysis,
  edgeDetection, segmentColorRegions, extractRegionColor, cartoonColorBudget,
  protectOutline,
} from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const FIX = new URL('../golden/fixtures/', import.meta.url);

// Mirror engine distanceMath exactly (cached Lab + DeltaE2000).
function distanceMath(math) {
  const cache = new Map();
  const lab = (c) => { const k = c.join(','); if (!cache.has(k)) cache.set(k, math.rgbToLab(...c)); return cache.get(k); };
  return (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] ? 0 : math.deltaE2000(lab(a), lab(b));
}

for (const f of ['test1.png', 'test2.png', 'test3.jpg']) {
  const img = loadImage(new URL(f, FIX));
  const style = detectImageStyle(img);
  const im = resizeForAnalysis(img, 540);
  const delta = distanceMath(ctx);
  const seg = segmentColorRegions(im, delta);
  for (const r of seg.regions) r.color = extractRegionColor(r, im);
  const edges = edgeDetection(im);
  const outline = protectOutline(im, edges);
  const budget = cartoonColorBudget(seg.regions, delta);
  const lineDensity = outline.reduce((a, b) => a + b, 0) / (im.width * im.height);

  // region size histogram in log-ish buckets
  const buckets = { '<5': 0, '5-15': 0, '16-63': 0, '64-255': 0, '256-1023': 0, '>=1024': 0 };
  for (const r of seg.regions) {
    const a = r.area;
    if (a < 5) buckets['<5']++;
    else if (a < 16) buckets['5-15']++;
    else if (a < 64) buckets['16-63']++;
    else if (a < 256) buckets['64-255']++;
    else if (a < 1024) buckets['256-1023']++;
    else buckets['>=1024']++;
  }

  console.log(`\n=== ${f}  ${img.width}x${img.height}px  style=${style.type}  analysis=${im.width}x${im.height} ===`);
  console.log(`  regions=${seg.regions.length}  regionSizeHist=${JSON.stringify(buckets)}`);
  console.log(`  budget => complexity=${budget.complexity} maxColors=${budget.maxColors}  lineDensity=${lineDensity.toFixed(4)}`);
  const biggest = seg.regions.slice().sort((a, b) => b.area - a.area).slice(0, 8)
    .map((r) => `#${r.id} a${r.area} rgb(${r.color.map((v) => Math.round(v)).join(',')})`);
  console.log(`  top regions: ${biggest.join(' | ')}`);

  for (const width of [80, 120, 180]) {
    try {
      const r = generateCartoonBeadPattern(img, { colorMath: ctx, palette, forceCartoon: true, width });
      console.log(`  pipe w${width}: style=${r.diagnostics.style} complexity=${r.diagnostics.complexity} budget=${r.diagnostics.maxColors} region=${r.diagnostics.regionCount} orig=${r.diagnostics.originalColors} final=${r.diagnostics.finalColors} lock=${r.diagnostics.lockedCells} mrg=${r.diagnostics.mergedColors}`);
    } catch (e) {
      console.log(`  pipe w${width}: ERR ${e.message}`);
    }
  }
}
