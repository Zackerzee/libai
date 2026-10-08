/**
 * png-io —— 最小 PNG 编解码（RGBA 8-bit）。
 *
 * 用途：Hybrid V2 Phase B.1 的 REAL_FAILURE_FIXTURES 需要把"照片级"生成的
 * 原图以文件形式落盘（`tests/fixtures/real-failures/<id>/image.png`），
 * 并支持用户**放入真实 PNG 原图**走同一加载路径。
 *
 * 不引入任何 npm 依赖：编码走 `node:zlib` 的 deflate（filter 0），
 * 解码走 inflate + 全部 5 种 unfilter（为了能读真实 PNG）。
 *
 * 仅支持 colorType=6（RGBA, 8-bit）、bitDepth=8、interlace=0。
 * 其他 colorType / 隔行扫描一律抛错（本项目的夹具与真实原图都是 RGBA）。
 */

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// ── CRC32（PNG chunk CRC over type+data）──────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

/**
 * 编码 RGBA 图像为 PNG Buffer。
 * @param {object} imageData { width, height, data: Uint8ClampedArray|Uint8Array } (RGBA)
 * @returns {Buffer}
 */
export function encodePng(imageData) {
  const { width, height, data } = imageData;
  if (data.length < width * height * 4) throw new Error("png-io: data 长度不足 width*height*4");

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // raw scanlines：每行 1 字节 filter(0) + RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    raw[off] = 0; // filter type None
    for (let x = 0; x < stride; x++) raw[off + 1 + x] = data[y * stride + x];
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 解码 PNG Buffer 为 { width, height, data: Uint8Array }（RGBA）。
 * 仅支持 colorType=6、bitDepth=8、interlace=0；否则抛错。
 */
export function decodePng(buf) {
  if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) throw new Error("png-io: 非 PNG 签名");

  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idatParts = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (type === "IHDR") {
      width = (buf[dataStart] << 24) | (buf[dataStart + 1] << 16) | (buf[dataStart + 2] << 8) | buf[dataStart + 3];
      height = (buf[dataStart + 4] << 24) | (buf[dataStart + 5] << 16) | (buf[dataStart + 6] << 8) | buf[dataStart + 7];
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    pos = dataEnd + 4; // 跳过 CRC
  }

  if (colorType !== 6) throw new Error(`png-io: 仅支持 RGBA(colorType=6)，收到 ${colorType}`);
  if (bitDepth !== 8) throw new Error(`png-io: 仅支持 8-bit，收到 ${bitDepth}`);
  if (interlace !== 0) throw new Error("png-io: 不支持隔行扫描 PNG");

  const raw = inflateSync(Buffer.concat(idatParts.map((p) => Buffer.from(p))));
  const bpp = 4;
  const stride = width * bpp;
  const data = new Uint8Array(width * height * bpp);
  let rp = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rp++];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break; // None
        case 1: val = rawByte + a; break; // Sub
        case 2: val = rawByte + b; break; // Up
        case 3: val = rawByte + ((a + b) >> 1); break; // Average
        case 4: val = rawByte + paeth(a, b, c); break; // Paeth
        default: throw new Error(`png-io: 未知 filter 类型 ${filter}`);
      }
      cur[x] = val & 0xff;
    }
    data.set(cur, y * stride);
    prev = cur;
  }
  return { width, height, data };
}
