// Shared image loader for Node regression drivers.
// Decodes PNG (pngjs) or JPEG (jpeg-js) into an RGBA {width,height,data} object
// matching the cartoonEngine contract. Pure JS, no native deps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// Resolve pure-JS decoders from the isolated node workspace so no npm install
// is required inside the E:\libai project itself.
const WS = process.env.WORKBUDDY_NODE_WS || 'C:/Users/Administrator/.workbuddy/binaries/node/workspace';
const require = createRequire(path.join(WS, 'x.mjs'));
const { PNG } = require('pngjs');
const { decode } = require('jpeg-js');

export function loadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath instanceof URL ? fileURLToPath(filePath) : filePath).toLowerCase();
  if (ext === '.png') {
    const png = PNG.sync.read(buf);
    // png.data is RGBA already
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const jpg = decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: jpg.width, height: jpg.height, data: new Uint8ClampedArray(jpg.data) };
  }
  throw new Error('Unsupported image type: ' + ext);
}
