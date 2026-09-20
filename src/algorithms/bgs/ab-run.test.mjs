/**
 * BGS algorithm module — tests for the standalone A/B runner's host-side pieces.
 *
 * The PNG decoder is the only non-trivial host code in `ab-run.mjs`, and it shipped a real
 * bug once: the row buffer was copied in the wrong direction (`current.set(prior)` instead
 * of `prior.set(current)`), which silently zeroed every scanline before the pixels were
 * written. A single-row fixture would not have caught it, so the fixtures below are
 * deliberately multi-row and exercise the `Sub` / `Up` filter paths that use `prior`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { decodePng } from './ab-run.mjs';

/* ─────────────────────────────────────────────────────────────
 * 最小 PNG 编码器（仅测试用）
 * ───────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/**
 * Encode an RGBA image as PNG, choosing a filter type per row.
 * @param {(x:number,y:number)=>number[]} paint
 * @param {(y:number)=>number} filterFor 0 none · 1 Sub · 2 Up · 3 Average · 4 Paeth
 */
function encodePng(width, height, paint, filterFor = () => 0) {
  const channels = 4;
  const stride = width * channels;
  const rows = [];
  let prior = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      line[x * channels] = r;
      line[x * channels + 1] = g;
      line[x * channels + 2] = b;
      line[x * channels + 3] = a;
    }
    const filterType = filterFor(y);
    const encoded = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = prior[i];
      const upLeft = i >= channels ? prior[i - channels] : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = (left + up) >> 1;
      else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
      }
      encoded[i] = (line[i] - predictor) & 0xff;
    }
    rows.push(Buffer.from([filterType]), Buffer.from(encoded));
    prior = line;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // non-interlaced

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ─────────────────────────────────────────────────────────────
 * 测试
 * ───────────────────────────────────────────────────────────── */

const RAINBOW = (x, y) => [
  (x * 37 + y * 11) & 0xff,
  (x * 13 + y * 53) & 0xff,
  (x * 61 + y * 7) & 0xff,
  255,
];

const expectPixel = (image, x, y) => {
  const [r, g, b, a] = RAINBOW(x, y);
  const p = (y * image.width + x) * 4;
  assert.deepEqual(
    [image.data[p], image.data[p + 1], image.data[p + 2], image.data[p + 3]],
    [r, g, b, a],
    `pixel ${x},${y} decoded wrong`,
  );
};

test('decodePng reads every row of an unfiltered RGBA image', () => {
  const width = 9;
  const height = 6;
  const image = decodePng(encodePng(width, height, RAINBOW, () => 0));
  assert.equal(image.width, width);
  assert.equal(image.height, height);
  assert.equal(image.data.length, width * height * 4);

  // Every row, not just the first — this is what caught the `prior` copy bug.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) expectPixel(image, x, y);
  }
  // No pixel may be left at the default zero value.
  assert.equal(image.data.some((value) => value !== 0), true, 'the decoder returned an all-zero raster');
});

test('decodePng unfilters Sub / Up / Average / Paeth rows', () => {
  const width = 7;
  const height = 8;
  const image = decodePng(encodePng(width, height, RAINBOW, (y) => y % 5));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) expectPixel(image, x, y);
  }
});

test('decodePng rejects what it does not support instead of guessing', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all!!!')), /not a PNG file/);

  // 16-bit RGBA: honest refusal beats a silent mis-decode.
  const sixteenBit = encodePng(4, 4, RAINBOW);
  const ihdrOffset = 8 + 4 + 4;
  sixteenBit[ihdrOffset + 8] = 16;
  assert.throws(() => decodePng(sixteenBit), /only 8-bit PNG/);

  // Interlaced: same.
  const interlaced = encodePng(4, 4, RAINBOW);
  interlaced[ihdrOffset + 12] = 1;
  assert.throws(() => decodePng(interlaced), /interlaced/);
});

test('decodePng output is a raster the bgs module accepts as-is', async () => {
  const { convertImageToBeads } = await import('./index.mjs');
  const image = decodePng(encodePng(24, 24, RAINBOW, (y) => y % 3));
  const result = convertImageToBeads(image, {
    width: 12,
    height: 12,
    palette: [
      { code: 'H2', hex: '#FFFFFF' },
      { code: 'H7', hex: '#000000' },
      { code: 'F4', hex: '#FC283C' },
      { code: 'C5', hex: '#01ACEB' },
    ],
  });
  assert.equal(result.width, 12);
  assert.equal(result.height, 12);
  assert.ok(result.statistics.beadCount > 0);
});
