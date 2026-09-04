// Diagnose why the goggles frame (light stroke on black hair) breaks up.
// Dumps: region structure around the frame color, per-cell voting results
// along the frame band, and final bead codes there.
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import {
  detectContentCrop, resizeForAnalysis, edgeDetection,
  segmentColorRegions, extractRegionColor, protectOutline, cartoonColorBudget,
  calculateCartoonGridSize, mergeSimilarColors,
} from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const delta = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] ? 0 : ctx.deltaE2000(ctx.rgbToLab(...a), ctx.rgbToLab(...b));
const lum = c => .299 * c[0] + .587 * c[1] + .114 * c[2];

const img = loadImage('E:/libai/golden/fixtures/blackyellow-src.png');
const crop = detectContentCrop(img, delta);
const im = resizeForAnalysis(img, 540, crop);
console.log('analysis', im.width + 'x' + im.height, 'crop', JSON.stringify(crop));
const edges = edgeDetection(im);
const seg = segmentColorRegions(im, delta);
for (const r of seg.regions) r.color = extractRegionColor(r, im);
const outline = protectOutline(im, edges);

// Goggles occupy roughly the top 8%..22% of the cropped subject (from the
// visual crop). Collect regions whose pixels fall in that band and that are
// light (frame candidates) or dark fills.
const bandY0 = Math.floor(im.height * .06), bandY1 = Math.floor(im.height * .24);
const inBand = r => r.pixels.some(i => { const y = Math.floor(i / im.width); return y >= bandY0 && y <= bandY1; });
const cands = seg.regions.filter(inBand).map(r => ({
  id: r.id, area: r.area, color: r.color, luma: Math.round(lum(r.color)),
  ratio: +(r.area / Math.max(1, r.boundary.length)).toFixed(2),
}));
// frame = light pixels in band; fills = dark large regions in band
const lights = cands.filter(c => c.luma > 120).sort((a, b) => b.area - a.area);
const darks = cands.filter(c => c.luma <= 120 && c.area > 200).sort((a, b) => b.area - a.area).slice(0, 6);
console.log('LIGHT regions in goggle band (id area luma ratio rgb):');
for (const c of lights.slice(0, 25)) console.log(' ', c.id, c.area, c.luma, c.ratio, c.color.join(','));
console.log('DARK fills in band:');
for (const c of darks) console.log(' ', c.id, c.area, c.luma, c.ratio, c.color.join(','));

// stroke set as engine computes it
const strokes = new Set(seg.regions.filter(r => r.area >= 8 && r.area / Math.max(1, r.boundary.length) < 2.2).map(r => r.id));
const lightStrokeIds = lights.filter(c => strokes.has(c.id)).map(c => c.id);
const lightLost = lights.filter(c => !strokes.has(c.id) && c.area >= 4);
console.log('light regions qualifying as strokes:', lightStrokeIds.length, 'of', lights.length,
  '| dropped (area<8 or ratio):', lightLost.slice(0, 15).map(c => `${c.id}(a${c.area},r${c.ratio})`).join(' '));

// Per-cell voting simulation on rows through the goggles, using engine params
const budget = cartoonColorBudget(seg.regions, delta, outline, im);
const size = calculateCartoonGridSize(im, budget.complexity, 120);
const colors = mergeSimilarColors(im, seg, delta);
console.log('grid', size.width + 'x' + size.height);
const gy0 = Math.floor(bandY0 * size.height / im.height), gy1 = Math.ceil(bandY1 * size.height / im.height);
console.log('scanning grid rows', gy0, '..', gy1);
for (let y = gy0; y <= gy1; y++) {
  let line = '';
  for (let x = 0; x < size.width; x++) {
    const samples = [], counts = new Map(); let winner = -1, count = 0;
    for (let sy = Math.floor(y * im.height / size.height); sy < Math.ceil((y + 1) * im.height / size.height); sy++)
      for (let sx = Math.floor(x * im.width / size.width); sx < Math.ceil((x + 1) * im.width / size.width); sx++) {
        const i = sy * im.width + sx; if (!colors[i]) continue;
        samples.push(colors[i]); const id = seg.ids[i], n = (counts.get(id) || 0) + 1; counts.set(id, n); if (n > count) { count = n; winner = id; }
      }
    if (!samples.length) { line += '.'; continue; }
    let strokeN = 0, strokeId = -1;
    for (const [id, n] of counts) if (strokes.has(id) && n > strokeN) { strokeId = id; strokeN = n; }
    const winnerLuma = winner >= 0 ? lum(seg.regions[winner].color) : 255;
    // mark cells where a light stroke exists but did NOT win/override
    if (strokeId >= 0 && lum(seg.regions[strokeId].color) > 120) {
      const fires = strokeN >= samples.length * .25;
      line += fires ? '#' : (winnerLuma > 120 ? 'w' : 'x'); // # override fires, x suppressed
    } else line += winnerLuma > 120 ? 'w' : '.';
  }
  console.log(String(y).padStart(3), line);
}
