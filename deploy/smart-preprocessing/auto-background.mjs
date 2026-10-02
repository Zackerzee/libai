/**
 * Generation Engine V2.5 — Auto Background（自动识别真背景：保留空白点）
 *
 * 背景必须被识别成「真正的空豆」(null)，但只有「与图像边框连通的浅色区域」才算背景；
 * 被图案包围的封闭白色区域（眼睛里的高光、白T恤）必须保留为白豆，不能误删。
 *
 * 做法：
 *  1. 在 RGB 网格上判定「像背景的候选」：亮度高(Lab L* >= 门槛) + 彩度低(<= 门槛)；
 *     数据缺失(null)视为候选。
 *  2. 只删「与图像边框连通」的背景候选：从四条边框出发做 4-连通 BFS 泛洪。
 *  3. 容忍抗锯齿/JPEG 噪点：扩散设 maxColorDelta 门槛（与种子色的 CIEDE2000），
 *     「浅色但要相似」才连成一片，防止背景漏进图案内部的浅色区。
 *
 * 复用 palette-engine 的 rgbToLab / deltaE2000。
 *
 * ── Stage B2 §11：透明 ≠ 纯色背景 ──────────────────────────────────
 * 传 `alphaGrid`（Uint8Array，0=该格以透明像素为主）后：
 *   · 透明格**不是**背景候选 —— 它没有颜色，提供不了「背景是什么色」的证据；
 *   · 于是全透明 PNG 不会因为「大量缺失格被当成候选」而误判成「检测到背景」。
 * 不传 alphaGrid 时行为与 B2 之前**逐位一致**（透明格仍按旧的「缺失即候选」处理）。
 */

import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";

const FOUR = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 默认配置：亮度门槛、彩度门槛、跨色扩散门槛。
export const DEFAULT_BACKGROUND_CONFIG = Object.freeze({
  lightnessThreshold: 88, // Lab L* 下限（高于才算浅）
  chromaThreshold: 14, // Lab 彩度上限（低于才算中性浅）
  maxColorDelta: 18, // 连通扩散的 CIEDE2000 门槛
});

function cellRgb(c) {
  if (!c) return null;
  return [c.r, c.g, c.b];
}

/**
 * 在 RGB 网格上解析背景掩码。rgbGrid[y][x] 为 null 或 { r, g, b }。
 *
 * @param {object} input
 * @param {Array} input.rgbGrid
 * @param {number} input.width
 * @param {number} input.height
 * @param {Uint8Array} [input.alphaGrid] 0 = 该格以透明像素为主（Stage B2 §11）。不传 = 全部不透明。
 * @param {object} [input.options]
 * @returns {{backgroundMask:Uint8Array, regionCount:number, regionSeeds:Array<{x:number,y:number,lab:number[]|null}>, diagnostics:object}}
 */
export function resolveBackgroundMask({ rgbGrid, width, height, alphaGrid = null, options = {} } = {}) {
  const { lightnessThreshold, chromaThreshold, maxColorDelta } = { ...DEFAULT_BACKGROUND_CONFIG, ...options };
  const w = width ?? (rgbGrid?.[0]?.length || 0);
  const h = height ?? (rgbGrid?.length || 0);
  const size = w * h;
  const backgroundMask = new Uint8Array(size);
  const regionSeeds = [];

  const isTransparent = (idx) => Boolean(alphaGrid) && alphaGrid[idx] === 0;

  if (size === 0) {
    return {
      backgroundMask,
      regionCount: 0,
      regionSeeds,
      diagnostics: {
        borderCandidates: 0, floodedCells: 0, enclosedKept: 0, totalCandidates: 0,
        transparentCells: 0, opaqueBorderCells: 0,
        lightnessThreshold, chromaThreshold, maxColorDelta, width: w, height: h,
      },
    };
  }

  const labOf = (x, y) => {
    const idx = y * w + x;
    if (isTransparent(idx)) return null;
    const c = rgbGrid[y]?.[x];
    if (!c) return null;
    return rgbToLab(cellRgb(c));
  };
  // 是否为背景候选：透明 → 不是候选（没有颜色，给不出背景证据）；缺失 → 候选；否则需够亮且够中性
  const isCandidate = (x, y) => {
    const idx = y * w + x;
    if (isTransparent(idx)) return false;
    const c = rgbGrid[y]?.[x];
    if (!c) return true;
    const lab = labOf(x, y);
    const chroma = Math.hypot(lab[1], lab[2]);
    return lab[0] >= lightnessThreshold && chroma <= chromaThreshold;
  };

  let borderCandidates = 0;
  let opaqueBorderCells = 0;
  let transparentCells = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (isTransparent(idx)) { transparentCells += 1; continue; }
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        opaqueBorderCells += 1;
        if (isCandidate(x, y)) borderCandidates += 1;
      }
    }
  }

  // 边框候选出发泛洪；以「种子色」为基准限制跨色扩散（防漏进异色浅区）
  let regionCount = 0;
  const queue = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onBorder = x === 0 || x === w - 1 || y === 0 || y === h - 1;
      if (!onBorder) continue;
      if (!isCandidate(x, y)) continue;
      const idx0 = y * w + x;
      if (backgroundMask[idx0]) continue; // 已并入别的背景区
      const seedLab = labOf(x, y);
      backgroundMask[idx0] = 1;
      regionCount += 1;
      // Stage B2 §3：把每个背景区的种子色留下来，供「多种浅色背景」判定使用。
      regionSeeds.push({ x, y, lab: seedLab ? [...seedLab] : null });
      queue.length = 0;
      queue.push([x, y]);
      while (queue.length) {
        const [cx, cy] = queue.shift();
        for (const [dx, dy] of FOUR) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nidx = ny * w + nx;
          if (backgroundMask[nidx]) continue;
          if (!isCandidate(nx, ny)) continue; // 非候选（深/艳/透明）→ 断
          const nLab = labOf(nx, ny);
          if (nLab && seedLab) {
            // 与种子色差异过大 → 断（这是防漏的核心门槛）
            if (deltaE2000(nLab, seedLab) > maxColorDelta) continue;
          } else if (nLab && !seedLab) {
            // 种子缺失而邻格有色：不主动跨入，交给邻格自身的边框种子处理
            continue;
          }
          backgroundMask[nidx] = 1;
          queue.push([nx, ny]);
        }
      }
    }
  }

  let floodedCells = 0;
  let totalCandidates = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isCandidate(x, y)) {
        totalCandidates += 1;
        if (backgroundMask[y * w + x]) floodedCells += 1;
      }
    }
  }

  return {
    backgroundMask,
    regionCount,
    regionSeeds,
    diagnostics: {
      borderCandidates,
      opaqueBorderCells,
      transparentCells,
      floodedCells,
      enclosedKept: totalCandidates - floodedCells,
      totalCandidates,
      lightnessThreshold,
      chromaThreshold,
      maxColorDelta,
      width: w,
      height: h,
    },
  };
}

/**
 * 按背景掩码把 grid 中「原本有颜色且被判定为背景」的格清空为 null（真·空豆）。
 * 就地修改 grid，返回 blankCells（被清空的 {x,y}）+ 修改后的 grid。
 *
 * 不变量：mask 为 1 的格一定与边框连通；封闭浅色区 mask=0，不会出现在 blankCells。
 */
export function applyBackgroundBlanks({
  grid,
  mask,
  width,
  height,
  getColorKey = (cell) => (cell ? cell.code : null),
  options = {},
} = {}) {
  void getColorKey;
  const w = width ?? (grid?.[0]?.length || 0);
  const h = height ?? (grid?.length || 0);
  const blankCells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const cell = grid[y]?.[x];
      if (!cell) continue; // 原本就真空豆，不算 blank
      if (!mask || !mask[idx]) continue; // 只清背景且原本有颜色的格
      grid[y][x] = null;
      blankCells.push({ x, y });
    }
  }
  return { blankCells, grid };
}

export default {
  DEFAULT_BACKGROUND_CONFIG,
  resolveBackgroundMask,
  applyBackgroundBlanks,
};
