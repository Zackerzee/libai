// Coarse ASCII visualization of a fixture so we can reason about layout
// without viewing the image. Buckets colors and prints a char grid.
// Run: node scripts/ascii-fixture.mjs <file> <cols>
import { loadImage } from './lib/load-image.mjs';
const raw = process.argv[2];
const file = /^[a-zA-Z]:[\\/]/.test(raw) ? raw : new URL(raw, import.meta.url);
const cols = Number(process.argv[3] || 100);
const img = loadImage(file);
// quantize to a coarse palette label map by rounding
const lab = new Map();
const name = (c) => {
  const r = Math.round(c[0] / 32) * 32, g = Math.round(c[1] / 32) * 32, b = Math.round(c[2] / 32) * 32;
  const k = `${r},${g},${b}`;
  if (!lab.has(k)) lab.set(k, lab.size);
  return lab.get(k);
};
const scale = cols / img.width;
const rows = Math.max(1, Math.round(img.height * scale));
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*';
for (let gy = 0; gy < rows; gy++) {
  let row = '';
  for (let gx = 0; gx < cols; gx++) {
    // sample center of block
    const px = Math.min(img.width - 1, Math.floor((gx + 0.5) / scale));
    const py = Math.min(img.height - 1, Math.floor((gy + 0.5) / scale));
    const o = (py * img.width + px) * 4;
    const c = [img.data[o], img.data[o + 1], img.data[o + 2]];
    row += chars[name(c) % chars.length];
  }
  console.log(row);
}
console.log('\nlegend (index -> rgb32 approx):');
for (const [k, v] of lab) console.log(`  ${v}: ${k}`);
