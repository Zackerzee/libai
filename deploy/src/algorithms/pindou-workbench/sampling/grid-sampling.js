/**
 * sampling/grid-sampling.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：没有独立函数。
 * 上游把「格采样」整体**委托给 Canvas 缩放**（app.js:417–425 的 drawImage），
 * 缩放后每个格子恰好等于 1 个像素，于是采样退化成一次数组读取：
 *   ```js
 *   for (let i = 0; i < imageData.data.length; i += 4) {
 *     pixels.push([data[i], data[i + 1], data[i + 2]]);
 *   }
 *   ```
 * 也就是：**没有采样模式、没有超采样、没有格内聚合，alpha 被直接丢弃**。
 *
 * 本模块把「格采样」显式化，并给出 4 种模式 + 超采样因子：
 *   point     —— 上游等价（1 格 1 像素）
 *   area-average —— 格内面积均值（超采样时才有意义）
 *   dominant  —— 格内出现最多的量化色
 *   median    —— 格内逐通道中位数（抗离群点）
 *
 * 格边界纪律：`cellBounds` 用 floor 的**同一套**取整生成 x0/x1，
 * 保证相邻格严格首尾相接 —— 不重叠、不留缝。
 * （bgs 批次踩过「x0 用 floor、x1 用 ceil」导致相邻格重叠的坑。）
 */

import { PW_CONFIG, GRID_SAMPLE_MODE } from "../config.js";
import { resizeToGrid, FIT_MODE, RESAMPLE_FILTER, asRaster } from "./cover-resize.js";

// 采样模式的唯一定义在 `config.js`，此处转出，避免出现第二份枚举。
export { GRID_SAMPLE_MODE, FIT_MODE, RESAMPLE_FILTER };

/**
 * 一个格子在栅格上覆盖的像素范围。**严格划分**，相邻格不重叠。
 * @returns {{x0:number, y0:number, x1:number, y1:number, width:number, height:number}}
 */
export function cellBounds(x, y, rasterWidth, rasterHeight, cols, rows) {
  const x0 = Math.floor((x * rasterWidth) / cols);
  const x1 = Math.min(rasterWidth, Math.floor(((x + 1) * rasterWidth) / cols));
  const y0 = Math.floor((y * rasterHeight) / rows);
  const y1 = Math.min(rasterHeight, Math.floor(((y + 1) * rasterHeight) / rows));
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

/**
 * 把格边界夹到「至少一个像素」。
 *
 * 只有当**栅格比网格还小**（`rasterWidth < cols`）时才需要：此时
 * floor/floor 会产出零面积的格子。这里**不改变格边界本身**（否则相邻格会重叠，
 * 正是 bgs 批次踩过的坑），而是让该格退化采样到它左上角那一个像素，
 * 保证每格都有一个确定的值。
 *
 * @returns {{x0:number, y0:number, x1:number, y1:number}}
 */
function sampleBounds(bounds, rasterWidth, rasterHeight) {
  let { x0, y0, x1, y1 } = bounds;
  if (x1 <= x0) {
    x0 = Math.min(x0, rasterWidth - 1);
    x1 = x0 + 1;
  }
  if (y1 <= y0) {
    y0 = Math.min(y0, rasterHeight - 1);
    y1 = y0 + 1;
  }
  return { x0, y0, x1, y1 };
}

/** sRGB → 线性。用于 `space:'linear'` 的均值口径。 */
function srgbToLinearChannel(v) {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** 线性 → sRGB（0–255）。 */
function linearToSrgbChannel(v) {
  const x = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, x * 255));
}

/** 5 位分桶键（用于 dominant 模式的多数投票）。 */
export function binKey5(r, g, b) {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

function newAccumulator(count) {
  return {
    sums: new Float64Array(count * 3),
    alpha: new Float64Array(count),
    weights: new Float64Array(count),
    counts: new Uint32Array(count),
  };
}

/**
 * 采集所有格子的样本。
 *
 * @param {{data:Float32Array, width:number, height:number}} raster 已栅格化的图像
 * @param {{cols:number, rows:number, mode?:string, space?:'srgb'|'linear'}} options
 * @returns {{samples:Float32Array, alpha:Float32Array, mode:string, cellSizes:Uint32Array}}
 */
export function sampleCells(raster, options) {
  const cols = options.cols;
  const rows = options.rows;
  const mode = Object.values(GRID_SAMPLE_MODE).includes(options.mode) ? options.mode : GRID_SAMPLE_MODE.POINT;
  const linear = options.space === "linear";
  const count = cols * rows;

  const samples = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const cellSizes = new Uint32Array(count);

  if (mode === GRID_SAMPLE_MODE.DOMINANT || mode === GRID_SAMPLE_MODE.MEDIAN) {
    return sampleCellsCollect(raster, cols, rows, mode, linear);
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bounds = sampleBounds(
        cellBounds(cx, cy, raster.width, raster.height, cols, rows),
        raster.width,
        raster.height,
      );
      const index = cy * cols + cx;
      cellSizes[index] = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let weight = 0;

      for (let py = bounds.y0; py < bounds.y1; py++) {
        for (let px = bounds.x0; px < bounds.x1; px++) {
          const p = (py * raster.width + px) * 4;
          const a = raster.data[p + 3] / 255;
          const contribution = mode === GRID_SAMPLE_MODE.POINT ? 1 : a;
          const w = mode === GRID_SAMPLE_MODE.POINT ? 1 : a || 1e-9;
          if (linear) {
            sumR += srgbToLinearChannel(raster.data[p]) * contribution;
            sumG += srgbToLinearChannel(raster.data[p + 1]) * contribution;
            sumB += srgbToLinearChannel(raster.data[p + 2]) * contribution;
          } else {
            sumR += raster.data[p] * contribution;
            sumG += raster.data[p + 1] * contribution;
            sumB += raster.data[p + 2] * contribution;
          }
          sumA += a;
          weight += w;
        }
      }

      if (weight <= 0) {
        samples[index * 3] = 0;
        samples[index * 3 + 1] = 0;
        samples[index * 3 + 2] = 0;
        alpha[index] = 0;
        continue;
      }

      if (linear) {
        samples[index * 3] = linearToSrgbChannel(sumR / weight);
        samples[index * 3 + 1] = linearToSrgbChannel(sumG / weight);
        samples[index * 3 + 2] = linearToSrgbChannel(sumB / weight);
      } else {
        samples[index * 3] = sumR / weight;
        samples[index * 3 + 1] = sumG / weight;
        samples[index * 3 + 2] = sumB / weight;
      }
      alpha[index] = sumA / cellSizes[index];
    }
  }

  return { samples, alpha, mode, cellSizes };
}

/** dominant / median 需要先把格内像素收齐，单独一条路径。 */
function sampleCellsCollect(raster, cols, rows, mode, linear) {
  const count = cols * rows;
  const samples = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const cellSizes = new Uint32Array(count);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bounds = sampleBounds(
        cellBounds(cx, cy, raster.width, raster.height, cols, rows),
        raster.width,
        raster.height,
      );
      const index = cy * cols + cx;
      const n = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
      cellSizes[index] = n;

      const rs = [];
      const gs = [];
      const bs = [];
      const votes = new Map();
      let sumA = 0;

      for (let py = bounds.y0; py < bounds.y1; py++) {
        for (let px = bounds.x0; px < bounds.x1; px++) {
          const p = (py * raster.width + px) * 4;
          const r = raster.data[p];
          const g = raster.data[p + 1];
          const b = raster.data[p + 2];
          sumA += raster.data[p + 3] / 255;
          if (mode === GRID_SAMPLE_MODE.DOMINANT) {
            const key = binKey5(r | 0, g | 0, b | 0);
            let bucket = votes.get(key);
            if (!bucket) {
              bucket = { count: 0, r: 0, g: 0, b: 0 };
              votes.set(key, bucket);
            }
            bucket.count++;
            bucket.r += r;
            bucket.g += g;
            bucket.b += b;
          } else {
            rs.push(r);
            gs.push(g);
            bs.push(b);
          }
        }
      }

      if (mode === GRID_SAMPLE_MODE.DOMINANT) {
        let best = null;
        // 平票时取分桶键较小者 —— 确定性，不依赖 Map 的插入顺序。
        const keys = [...votes.keys()].sort((a, b) => a - b);
        for (const key of keys) {
          const bucket = votes.get(key);
          if (!best || bucket.count > best.count) best = bucket;
        }
        if (best) {
          samples[index * 3] = best.r / best.count;
          samples[index * 3 + 1] = best.g / best.count;
          samples[index * 3 + 2] = best.b / best.count;
        }
      } else if (rs.length) {
        rs.sort((a, b) => a - b);
        gs.sort((a, b) => a - b);
        bs.sort((a, b) => a - b);
        const mid = rs.length >> 1;
        samples[index * 3] = rs.length % 2 ? rs[mid] : (rs[mid - 1] + rs[mid]) / 2;
        samples[index * 3 + 1] = gs.length % 2 ? gs[mid] : (gs[mid - 1] + gs[mid]) / 2;
        samples[index * 3 + 2] = bs.length % 2 ? bs[mid] : (bs[mid - 1] + bs[mid]) / 2;
      }

      alpha[index] = n ? sumA / n : 0;
    }
  }

  // `linear` 口径在 dominant / median 下不适用（它们本来就是非线性统计量）。
  void linear;
  return { samples, alpha, mode, cellSizes };
}

/**
 * 端到端格采样：源图 → 适配 → 栅格化 → 逐格采样。
 *
 * @param {object} source `{data, width, height}`
 * @param {{
 *   cols:number, rows:number,
 *   fitMode?:string, filter?:string,
 *   mode?:string, space?:'srgb'|'linear',
 *   supersample?:number
 * }} options
 */
export function sampleGrid(source, options) {
  const rasterSource = asRaster(source);
  const cols = Math.max(1, (options.cols ?? 0) | 0);
  const rows = Math.max(1, (options.rows ?? 0) | 0);
  const supersample = Math.max(1, Math.min(4, (options.supersample ?? 1) | 0));
  const mode = options.mode || GRID_SAMPLE_MODE.POINT;
  const fitMode = options.fitMode || FIT_MODE.COVER;
  const filter = options.filter || RESAMPLE_FILTER.AUTO;

  const rasterWidth = cols * supersample;
  const rasterHeight = rows * supersample;
  const rasterized = resizeToGrid(rasterSource, { cols: rasterWidth, rows: rasterHeight, fitMode, filter });

  const collected = sampleCells(rasterized, { cols, rows, mode, space: options.space || "srgb" });

  return {
    samples: collected.samples,
    alpha: collected.alpha,
    width: cols,
    height: rows,
    mode: collected.mode,
    cellSizes: collected.cellSizes,
    supersample,
    rasterFilter: rasterized.filter,
    rasterWidth,
    rasterHeight,
    geometry: rasterized.geometry,
  };
}

/** 把格样本摊平成 `[[r,g,b], …]` —— 上游 `pixels` 数组的等价物。 */
export function toPixelList(samples) {
  const count = samples.length / 3;
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[i] = [samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]];
  return out;
}

/**
 * 只取「背景掩码之外」的格样本 —— 修复上游「K-means 把背景也算进色板配额」的问题。
 * @param {Float32Array} samples
 * @param {Uint8Array|null} foregroundMask 1 = 前景；null 表示不过滤
 */
export function foregroundPixelList(samples, foregroundMask) {
  const count = samples.length / 3;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (foregroundMask && foregroundMask[i] !== 1) continue;
    out.push([samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]]);
  }
  return out;
}

export const DEFAULT_GRID_SAMPLING = Object.freeze({
  mode: GRID_SAMPLE_MODE.POINT,
  fitMode: FIT_MODE.COVER,
  filter: RESAMPLE_FILTER.AUTO,
  supersample: 1,
  space: "srgb",
});


export const GRID_LIMITS = Object.freeze({ minSide: PW_CONFIG.grid.minSide, maxSide: PW_CONFIG.grid.maxSide });
