/**
 * 自动裁主体（V2.5 智能生成引擎 · subject-crop）
 *
 * 用途：用户上传「物体在中间、四周大片纯色背景」的照片时，
 * 自动裁到主体外接框（留一点边距），同样网格尺寸下主体占更多豆格、细节更清楚。
 *
 * 核心算法：从四条边框出发做泛洪，把「与边框连通、且颜色相近」的像素判为背景；
 * 前景（非背景）像素的外接框即主体框。
 *
 * 关键设计——泛洪用「种子色」而非「邻居色」做基准：
 *   抗锯齿边缘会在主体与背景间产生中间色（渐变斜坡）。若每一步都拿「邻居色」当基准，
 *   泛洪会顺着这条斜坡一路爬进主体内部（漏进主体）。改用「起点种子像素色」当基准后，
 *   斜坡上稍远离种子的像素与种子色差距立刻超过容差，泛洪在主体边缘外就停下。
 *
 * 复用 palette-engine 的 rgbToLab / deltaE2000，不自建色彩空间。
 */

import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";

const FOUR_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const DEFAULT_SUBJECT_CROP_CONFIG = Object.freeze({
  // CIEDE2000 容差：边框像素与待扩展像素的色差小于它才并入背景
  colorTolerance: 8,
  // 边距比例：按主体外接框长边的该比例外扩（默认 4%）
  paddingRatio: 0.04,
});

/* =========================================================
 * 背景泛洪（迭代式 BFS，显式队列，绝不递归 —— 大图不爆栈）
 * ======================================================= */

/**
 * 从四条边框所有像素出发做多源泛洪，返回背景掩码（Uint8Array，1=背景）。
 *
 * @param {object} imageData  { data:Uint8ClampedArray(RGBA), width, height }
 * @param {object} options
 *   tolerance     CIEDE2000 容差，默认 DEFAULT_SUBJECT_CROP_CONFIG.colorTolerance
 *   useSeedColor  true=用起点种子色做基准（默认，防漏进主体）；false=用邻居色做基准（仅测试对照）
 * @returns {Uint8Array} 长度 width*height，1 表示背景像素
 */
export function floodBackgroundMask(imageData, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_SUBJECT_CROP_CONFIG.colorTolerance;
  const useSeedColor = options.useSeedColor ?? true;
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const size = W * H;
  if (size === 0) return new Uint8Array(0);

  // refIdx[i] != -1 表示 i 已并入背景；同时记录该背景分量的「基准像素」索引：
  //   useSeedColor 时基准 = 最初那条边框种子；useSeedColor=false 时基准 = 上一步的来源像素。
  const refIdx = new Int32Array(size).fill(-1);
  // 环形队列（Int32Array + head/tail 指针，避免 array.shift 的 O(n) 与递归爆栈）
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const enqueue = (idx, ref) => {
    if (refIdx[idx] !== -1) return;
    refIdx[idx] = ref;
    queue[tail++] = idx;
  };

  // 四条边所有像素作为种子入队（基准=自身）
  for (let x = 0; x < W; x++) { enqueue(x, x); enqueue((H - 1) * W + x, (H - 1) * W + x); }
  for (let y = 0; y < H; y++) { enqueue(y * W, y * W); enqueue(y * W + W - 1, y * W + W - 1); }

  while (head < tail) {
    const idx = queue[head++];
    const ref = useSeedColor ? refIdx[idx] : idx;
    const ri = ref * 4;
    const refLab = rgbToLab([data[ri], data[ri + 1], data[ri + 2]]);
    const cx = idx % W;
    const cy = (idx / W) | 0;
    for (const [dx, dy] of FOUR_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nidx = ny * W + nx;
      if (refIdx[nidx] !== -1) continue;
      const ni = nidx * 4;
      const nLab = rgbToLab([data[ni], data[ni + 1], data[ni + 2]]);
      let pass;
      if (useSeedColor) {
        pass = deltaE2000(nLab, refLab) < tolerance;
      } else {
        // 邻居色基准：与「来源像素」比较，演示会漏进主体的退化情况
        const ci = idx * 4;
        const curLab = rgbToLab([data[ci], data[ci + 1], data[ci + 2]]);
        pass = deltaE2000(nLab, curLab) < tolerance;
      }
      if (pass) enqueue(nidx, useSeedColor ? ref : idx);
    }
  }

  const mask = new Uint8Array(size);
  for (let i = 0; i < size; i++) if (refIdx[i] !== -1) mask[i] = 1;
  return mask;
}

/* =========================================================
 * 主体外接框
 * ======================================================= */

function boxFromMask(mask, W, H) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] === 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * 检测主体外接框（前景非背景像素的包围盒）。
 * 返回 { x, y, width, height }（已夹在图像范围内，宽高≥1），整幅都是背景时返回 null。
 */
export function detectSubjectBox(imageData, options = {}) {
  const colorTolerance = options.colorTolerance ?? DEFAULT_SUBJECT_CROP_CONFIG.colorTolerance;
  const mask = floodBackgroundMask(imageData, { tolerance: colorTolerance, useSeedColor: true });
  return boxFromMask(mask, imageData.width, imageData.height);
}

/* =========================================================
 * 裁剪（返回全新的 Uint8ClampedArray，绝不修改原图 —— 原图要留给对照视图）
 * ======================================================= */

/**
 * 按 box 裁出子图。box 可为浮点，内部按 floor/ceil 取整并夹边界。
 * 返回全新的 { data:Uint8ClampedArray, width, height }。
 */
export function cropImageData(imageData, box) {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.width));
  const y1 = Math.min(H, Math.ceil(box.y + box.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = y0; y < y1; y++) {
    const srcRow = y * W;
    const dstRow = (y - y0) * w;
    for (let x = x0; x < x1; x++) {
      const si = (srcRow + x) * 4;
      const di = (dstRow + (x - x0)) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

/* =========================================================
 * 边距外扩（供管线复用）：在图像范围内外扩 padding 像素
 * ======================================================= */

/**
 * 把 box 向四边各外扩 padding 像素，并夹在 [0,width]×[0,height] 内。
 * 保证返回宽高 ≥ 1（主体框本身已在图像内）。
 */
export function expandBox(box, padding, width, height) {
  const x0 = Math.max(0, box.x - padding);
  const y0 = Math.max(0, box.y - padding);
  const x1 = Math.min(width, box.x + box.width + padding);
  const y1 = Math.min(height, box.y + box.height + padding);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/* =========================================================
 * 一键裁到主体
 * ======================================================= */

/**
 * 自动裁到主体。
 * @returns { data, width, height, box, sourceBox, coverage }
 *   box        加过边距后的实际裁剪框（夹在图像内）
 *   sourceBox  未加边距的主体外接框
 *   coverage   前景像素数 / 总像素数（供管线决定是否采纳：主体已占满画面时就没必要裁）
 *
 * 若整幅都是背景（detectSubjectBox 返回 null），原样返回输入（box 等价于整幅、coverage=0），不抛异常。
 * 始终返回全新的 data 数组（即便原样返回也不复用原引用，避免误改对照图）。
 */
export function cropToSubject(imageData, options = {}) {
  const colorTolerance = options.colorTolerance ?? DEFAULT_SUBJECT_CROP_CONFIG.colorTolerance;
  const paddingRatio = options.paddingRatio ?? DEFAULT_SUBJECT_CROP_CONFIG.paddingRatio;
  const W = imageData.width;
  const H = imageData.height;
  const size = W * H;

  const mask = floodBackgroundMask(imageData, { tolerance: colorTolerance, useSeedColor: true });

  let fgCount = 0;
  for (let i = 0; i < size; i++) if (mask[i] === 0) fgCount++;

  // 没有前景 → 整幅都是背景，原样返回（复制一份 data，box 等价于整幅）
  if (fgCount === 0) {
    return {
      data: new Uint8ClampedArray(imageData.data),
      width: W,
      height: H,
      box: { x: 0, y: 0, width: W, height: H },
      sourceBox: { x: 0, y: 0, width: W, height: H },
      coverage: 0,
    };
  }

  const sourceBox = boxFromMask(mask, W, H);
  const coverage = fgCount / size;
  const padding = Math.round(paddingRatio * Math.max(sourceBox.width, sourceBox.height));
  const box = expandBox(sourceBox, padding, W, H);
  const cropped = cropImageData(imageData, box);
  return { data: cropped.data, width: cropped.width, height: cropped.height, box, sourceBox, coverage };
}

export default {
  DEFAULT_SUBJECT_CROP_CONFIG,
  floodBackgroundMask,
  detectSubjectBox,
  cropImageData,
  expandBox,
  cropToSubject,
};
