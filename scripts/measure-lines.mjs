// Quantify thin-line handling: at output resolution, does a bead become black
// (a) when its source footprint truly carries a structural black line (recall),
// and (b) only then (no spurious black over non-line fills = no thickening)?
// Also reports the thickness of connected black runs per row.
import { loadImage } from './lib/load-image.mjs';
import { loadColorMath, loadPalette } from './lib/color-math.mjs';
import { generateCartoonBeadPattern, protectOutline, edgeDetection, resizeForAnalysis, detectContentCrop } from '../lib/cartoonEngine.js';

const ctx = loadColorMath();
const palette = loadPalette();
const raw = process.argv[2];
const file = /^[a-zA-Z]:[\\/]/.test(raw) ? raw : new URL(raw, import.meta.url);
const img = loadImage(file);
// The engine auto-trims uniform margins; the reference mask must cover the
// same area or cell comparison misaligns (false recall loss / spurious gain).
const crop = detectContentCrop(img, (a, b) => ctx.deltaE2000(ctx.rgbToLab(...a), ctx.rgbToLab(...b)));
const im = resizeForAnalysis(img, 540, crop);
const edges = edgeDetection(im);
// Structural black line: near-black AND strong local edge (the line pixels)
const blackLine = Uint8Array.from(edges, (e, i) => (im.data[i * 4 + 3] >= 128 && (0.299 * im.data[i*4] + 0.587 * im.data[i*4+1] + 0.114 * im.data[i*4+2]) < 45 && e > 12 ? 1 : 0));
const blackLineCount = blackLine.reduce((a, b) => a + b, 0);

for (const W of [Number(process.argv[3] || 120)]) {
  const share = process.argv[4];
  const opt = { colorMath: ctx, palette, forceCartoon: true, width: W };
  if (share !== undefined) opt.lineLockShare = Number(share);
  const r = generateCartoonBeadPattern(img, opt);
  const gW = r.width, gH = r.height;
  const isBlack = (c) => (c && 0.299 * c.rgb[0] + 0.587 * c.rgb[1] + 0.114 * c.rgb[2] < 45);
  let recallN = 0, recallHit = 0;    // source-black-bearing cells that became black
  let spurious = 0, spuriousN = 0;   // cells with no source black that became black
  for (let gy = 0; gy < gH; gy++) for (let gx = 0; gx < gW; gx++) {
    const x0 = Math.floor(gx * im.width / gW), x1 = Math.ceil((gx + 1) * im.width / gW);
    const y0 = Math.floor(gy * im.height / gH), y1 = Math.ceil((gy + 1) * im.height / gH);
    let srcBlack = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (blackLine[y * im.width + x]) { srcBlack = true; break; }
    const outBlack = isBlack(r.grid[gy][gx]);
    if (srcBlack) { recallN++; if (outBlack) recallHit++; }
    else { spuriousN++; if (outBlack) spurious++; }
  }
  console.log(`${file.split(/[\\/]/).pop()} W=${W} grid=${gW}x${gH}  srcLinePx=${blackLineCount}`);
  console.log(`   recall(lines kept) ${(100 * recallHit / Math.max(1, recallN)).toFixed(1)}%  (${recallHit}/${recallN} cells w/ line became black)`);
  console.log(`   spurious-black(thickening) ${(100 * spurious / Math.max(1, spuriousN)).toFixed(2)}%  (${spurious}/${spuriousN} non-line cells turned black)`);
  // run-length thickness of horizontal black runs
  const runs = [];
  for (let gy = 0; gy < gH; gy++) { let len = 0; for (let gx = 0; gx <= gW; gx++) { const b = gx < gW && isBlack(r.grid[gy][gx]); if (b) len++; else { if (len >= 2) runs.push(len); len = 0; } } }
  const avg = runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0;
  console.log(`   horizontal black runs(>=2) count=${runs.length} avgLen=${avg.toFixed(2)}`);
}
