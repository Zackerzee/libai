// Shared: extract rgbToLab / deltaE2000 / clamp from app.js into a vm context.
import fs from 'node:fs';
import vm from 'node:vm';

export function loadColorMath(appPath = new URL('../../app.js', import.meta.url)) {
  const app = fs.readFileSync(appPath, 'utf8');
  const names = ['clamp', 'rgbToLab', 'deltaE2000'];
  const functions = app.match(/^function [\s\S]*?^}/gm)
    .filter((s) => names.some((n) => new RegExp('^function ' + n + '\\(').test(s)))
    .join('\n');
  const ctx = vm.createContext({});
  vm.runInContext(functions, ctx);
  if (typeof ctx.rgbToLab !== 'function' || typeof ctx.deltaE2000 !== 'function') {
    throw new Error('Failed to extract color math from app.js');
  }
  return ctx;
}

export function loadPalette(palettePath = new URL('../../assets/palettes/mard-221.json', import.meta.url)) {
  const pal = JSON.parse(fs.readFileSync(palettePath, 'utf8'));
  return pal.colors.filter((c) => !c.unidentified);
}
