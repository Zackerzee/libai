/**
 * core/metrics.js
 * ─────────────────────────────────────────────────────────────
 * 拼豆矩阵的统一度量层。**不参与生成**，只做测量 —— 第六阶段的算法实验室
 * 靠它把三套结果放到同一把尺子上。
 *
 * 设计纪律：
 *   - 度量只吃「矩阵 + 色板 + 可选的源图逐格样本」，不需要任何引擎内部状态；
 *   - 因此 current（libms V2.5）、pw-original、hybrid-pw 三条完全不同的链路
 *     可以用同一个函数测，横向数字才可比；
 *   - **不给总分、不做排名**。第六阶段要求人工判断，度量层就不能偷偷排序。
 *
 * 十个指标（第六阶段要求）：
 *   1. usedColorCount              实际使用颜色数量
 *   2. meanDeltaE                  平均 ΔE（CIEDE2000）
 *   3. p95DeltaE                   P95 ΔE
 *   4. isolatedSingleBeadCount     孤立单豆数量
 *   5. twoBeadClusterCount         2 豆小区域数量
 *   6. edgeNoiseCount              边缘杂色数量
 *   7. structureRetention          轮廓保持率
 *   8. highlightRetention          高光保持率
 *   9. dominantColorRatio          Dominant Color Ratio
 *  10. transparencyEdgeContamination 透明边缘污染数量
 */

import { rgbToCielab, deltaE2000, otsuThreshold, hexToRgb } from "../../bgs/color-space.mjs";

/** 矩阵单元 → 色号。兼容 `null` / 字符串 / `{code}`。 */
export function cellCode(cell) {
  if (cell == null) return null;
  if (typeof cell === "string") return cell;
  if (typeof cell === "object") return cell.code == null ? null : String(cell.code);
  return null;
}

/** 矩阵单元 → RGB（优先取单元自带的 rgb，否则查色板）。 */
export function cellRgb(cell, lookup) {
  if (cell == null) return null;
  if (typeof cell === "object" && Array.isArray(cell.rgb) && cell.rgb.length >= 3) return cell.rgb;
  const code = cellCode(cell);
  if (code == null) return null;
  return lookup.get(code) || null;
}

/** 色号 → RGB 查表。 */
export function buildLookup(palette) {
  const map = new Map();
  for (const entry of palette || []) {
    if (!entry) continue;
    const code = entry.code ?? entry.id;
    if (code == null) continue;
    const rgb = Array.isArray(entry.rgb) && entry.rgb.length >= 3 ? entry.rgb : hexToRgb(entry.hex);
    if (rgb) map.set(String(code), rgb);
  }
  return map;
}

/** 把任意矩阵规整成 `(string|null)[][]` + 尺寸。 */
export function normalizeMatrix(matrix) {
  if (!Array.isArray(matrix) || !matrix.length) {
    return { cells: [], codes: [], rgb: [], cols: 0, rows: 0 };
  }
  const rows = matrix.length;
  const cols = Math.max(...matrix.map((row) => (Array.isArray(row) ? row.length : 0)));
  const cells = [];
  const codes = [];
  for (let y = 0; y < rows; y++) {
    const rowCells = [];
    const rowCodes = [];
    for (let x = 0; x < cols; x++) {
      const cell = Array.isArray(matrix[y]) ? matrix[y][x] : undefined;
      rowCells.push(cell === undefined ? null : cell);
      rowCodes.push(cellCode(cell));
    }
    cells.push(rowCells);
    codes.push(rowCodes);
  }
  return { cells, codes, cols, rows };
}

/**
 * 同色连通域（4 邻域）。
 * @returns {Array<{color:string, size:number, pixels:number[][]}>}
 */
export function connectedSameColor(codes, cols, rows, {connectivity = 4} = {}) {
  const seen = new Uint8Array(cols * rows);
  const components = [];
  const offsets = connectivity === 8
    ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const stack = [];

  for (let startY = 0; startY < rows; startY++) {
    for (let startX = 0; startX < cols; startX++) {
      const index = startY * cols + startX;
      if (seen[index]) continue;
      const color = codes[startY][startX];
      if (color == null) continue;
      const pixels = [];
      seen[index] = 1;
      stack.push([startX, startY]);

      while (stack.length) {
        const [x, y] = stack.pop();
        pixels.push([x, y]);
        for (const [dy, dx] of offsets) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
          const next = ny * cols + nx;
          if (seen[next] || codes[ny][nx] !== color) continue;
          seen[next] = 1;
          stack.push([nx, ny]);
        }
      }
      components.push({ color, size: pixels.length, pixels });
    }
  }
  return components;
}

/**
 * 孤立单豆：一个豆的**同色** 4 邻域里一个同色邻居都没有。
 * 注意这是「孤立的单豆」，不是「与异色隔离的豆」—— 后者太多，没有区分度。
 */
export function countIsolatedSingleBeads(codes, cols, rows) {
  let count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = codes[y][x];
      if (color == null) continue;
      let sameNeighbors = 0;
      if (y > 0 && codes[y - 1][x] === color) sameNeighbors++;
      if (y < rows - 1 && codes[y + 1][x] === color) sameNeighbors++;
      if (x > 0 && codes[y][x - 1] === color) sameNeighbors++;
      if (x < cols - 1 && codes[y][x + 1] === color) sameNeighbors++;
      if (sameNeighbors === 0) count++;
    }
  }
  return count;
}

/** 2 豆小区域：同色连通域里**恰好 2 个像素**的数量。 */
export function countTwoBeadClusters(codes, cols, rows) {
  return connectedSameColor(codes, cols, rows).filter((component) => component.size === 2).length;
}

/**
 * 边缘杂色：一个豆的 4 邻域里存在**异色**邻居，且该邻域色彩数与
 * 「自身 + 邻域」的众数不一致 —— 也就是被异色包围的孤立像素。
 *
 * 与「孤立单豆」的区别：孤立单豆只看**同色**邻居数；
 * 边缘杂色只看**异色**邻居数（≥3 才算被包围）。
 */
export function countEdgeNoise(codes, cols, rows, {minDifferent = 3} = {}) {
  let count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = codes[y][x];
      if (color == null) continue;
      let different = 0;
      let neighbors = 0;
      const check = (ny, nx) => {
        if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) return;
        const other = codes[ny][nx];
        if (other == null) return;
        neighbors++;
        if (other !== color) different++;
      };
      check(y - 1, x);
      check(y + 1, x);
      check(y, x - 1);
      check(y, x + 1);
      if (neighbors > 0 && different >= minDifferent) count++;
    }
  }
  return count;
}

/** 逐格源样本（Float32Array，cols*rows*3）→ 每格亮度。 */
function cellLuma(samples, cols, rows) {
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) {
    out[i] = samples[i * 3] * 0.299 + samples[i * 3 + 1] * 0.587 + samples[i * 3 + 2] * 0.114;
  }
  return out;
}

/** 横向/纵向相邻格的亮度梯度。 */
function gradientBetween(luma, cols, rows, x, y, dx, dy) {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return null;
  return Math.abs(luma[y * cols + x] - luma[ny * cols + nx]);
}

/**
 * 轮廓保持率：源图里「有结构边」的位置，输出矩阵里是否也发生了颜色变化。
 *
 * 定义（两侧都用同一套 Otsu 阈值，避免引入主观参数）：
 *   - 源结构边集合 `E_src`：逐格源亮度梯度经 Otsu 二值化后的高分位；
 *   - 输出结构边集合 `E_out`：矩阵里相邻格**颜色不同**的位置；
 *   - retention = |E_src ∩ E_out| / |E_src|；
 *   - precision = |E_src ∩ E_out| / |E_out|；f1 = 调和平均。
 *
 * 之所以要 precision：如果矩阵到处都在换色（噪声很大），retention 会很高但没意义。
 */
export function measureStructure(codes, cols, rows, sourceSamples) {
  if (!sourceSamples || cols < 2 || rows < 2) {
    return { retention: null, precision: null, f1: null, sourceEdges: 0, outputEdges: 0, matched: 0 };
  }

  const luma = cellLuma(sourceSamples, cols, rows);
  const gradient = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let max = 0;
      const right = gradientBetween(luma, cols, rows, x, y, 1, 0);
      const down = gradientBetween(luma, cols, rows, x, y, 0, 1);
      if (right !== null && right > max) max = right;
      if (down !== null && down > max) max = down;
      gradient[y * cols + x] = max;
    }
  }

  // Otsu（复用 bgs 的实现，含纯双峰平台退化修正）
  const histogram = new Uint32Array(256);
  let maxGradient = 0;
  for (let i = 0; i < gradient.length; i++) if (gradient[i] > maxGradient) maxGradient = gradient[i];
  let total = 0;
  for (let i = 0; i < gradient.length; i++) {
    if (!(gradient[i] > 0)) continue;
    let bin = maxGradient > 0 ? Math.floor((gradient[i] / maxGradient) * 255) : 0;
    if (bin > 255) bin = 255;
    histogram[bin]++;
    total++;
  }
  const otsu = otsuThreshold(histogram, total);
  const cutoff = otsu && maxGradient > 0 ? ((otsu.threshold + 0.5) / 255) * maxGradient : 0;

  const isSourceEdge = new Uint8Array(cols * rows);
  let sourceEdges = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // 只在「右边或下边有邻居」的位置定义边，保证两侧集合可比
      const right = gradientBetween(luma, cols, rows, x, y, 1, 0);
      const down = gradientBetween(luma, cols, rows, x, y, 0, 1);
      if (right === null && down === null) continue;
      if (gradient[y * cols + x] > cutoff && cutoff > 0) {
        isSourceEdge[y * cols + x] = 1;
        sourceEdges++;
      }
    }
  }

  let outputEdges = 0;
  let matched = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = codes[y][x];
      const rightColor = x + 1 < cols ? codes[y][x + 1] : undefined;
      const downColor = y + 1 < rows ? codes[y + 1][x] : undefined;
      const rightDiffers = x + 1 < cols && color !== rightColor;
      const downDiffers = y + 1 < rows && color !== downColor;
      if (x + 1 >= cols && y + 1 >= rows) continue;
      const isOutputEdge = rightDiffers || downDiffers;
      if (isOutputEdge) outputEdges++;
      if (isOutputEdge && isSourceEdge[y * cols + x]) matched++;
    }
  }

  const retention = sourceEdges ? matched / sourceEdges : null;
  const precision = outputEdges ? matched / outputEdges : null;
  const f1 = retention !== null && precision !== null && retention + precision > 0
    ? (2 * retention * precision) / (retention + precision)
    : null;

  return { retention, precision, f1, sourceEdges, outputEdges, matched, cutoff };
}

/**
 * 高光保持率：源图里最亮的那批格子（≥P95 亮度），在输出里是否仍然是亮豆（≥ P90 亮度）。
 * 「眼睛高光」正是这类区域 —— 丢掉它们，人物立刻「死眼」。
 */
export function measureHighlightRetention(codes, cols, rows, sourceSamples, lookup) {
  if (!sourceSamples) return { retention: null, sourceHighlights: 0, keptHighlights: 0, cutoffSource: null, cutoffOutput: null };

  const sourceLuma = cellLuma(sourceSamples, cols, rows);
  const outputLuma = new Float32Array(cols * rows).fill(Number.NaN);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const rgb = codes[y][x] == null ? null : lookup.get(codes[y][x]);
      if (!rgb) continue;
      outputLuma[y * cols + x] = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    }
  }

  const sortedSource = [...sourceLuma].sort((a, b) => a - b);
  const cutoffSource = sortedSource[Math.min(sortedSource.length - 1, Math.floor(sortedSource.length * 0.95))];
  const sortedOutput = [...outputLuma].filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const cutoffOutput = sortedOutput.length
    ? sortedOutput[Math.min(sortedOutput.length - 1, Math.floor(sortedOutput.length * 0.9))]
    : 0;

  let sourceHighlights = 0;
  let keptHighlights = 0;
  for (let i = 0; i < sourceLuma.length; i++) {
    if (sourceLuma[i] < cutoffSource) continue;
    sourceHighlights++;
    const value = outputLuma[i];
    if (!Number.isNaN(value) && value >= cutoffOutput) keptHighlights++;
  }

  return {
    retention: sourceHighlights ? keptHighlights / sourceHighlights : null,
    sourceHighlights,
    keptHighlights,
    cutoffSource,
    cutoffOutput,
  };
}

/**
 * 透明边缘污染：豆子紧贴空豆（4 邻域有 null），且自己的颜色与背景色很接近。
 * 这就是抠图残留的「半透明光晕」，在拼豆里表现为一圈脏边。
 */
export function countTransparencyEdgeContamination(codes, cols, rows, lookup, bgColor, maxDeltaE = 12) {
  if (!bgColor) return { count: 0, boundaryBeads: 0, maxDeltaE };
  const bgLab = rgbToCielab([bgColor[0], bgColor[1], bgColor[2]]);
  let boundaryBeads = 0;
  let count = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = codes[y][x];
      if (color == null) continue;
      const touchesEmpty = (y > 0 && codes[y - 1][x] == null)
        || (y < rows - 1 && codes[y + 1][x] == null)
        || (x > 0 && codes[y][x - 1] == null)
        || (x < cols - 1 && codes[y][x + 1] == null);
      if (!touchesEmpty) continue;
      boundaryBeads++;
      const rgb = lookup.get(color);
      if (!rgb) continue;
      if (deltaE2000(rgbToCielab(rgb), bgLab) <= maxDeltaE) count++;
    }
  }

  return { count, boundaryBeads, maxDeltaE };
}

/**
 * 色差：逐格比较「输出豆色」与「该格的源图色」。
 * 只统计有豆的格子 —— 空豆（背景）不算色差。
 */
export function measureColorError(codes, cols, rows, sourceSamples, lookup) {
  if (!sourceSamples) return { meanCiede2000: null, p95Ciede2000: null, p99Ciede2000: null, samples: 0 };
  const values = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = codes[y][x];
      if (color == null) continue;
      const rgb = lookup.get(color);
      if (!rgb) continue;
      const i = (y * cols + x) * 3;
      const sourceRgb = [sourceSamples[i], sourceSamples[i + 1], sourceSamples[i + 2]];
      values.push(deltaE2000(rgbToCielab(rgb), rgbToCielab(sourceRgb)));
    }
  }
  if (!values.length) return { meanCiede2000: null, p95Ciede2000: null, p99Ciede2000: null, samples: 0 };
  values.sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const at = (q) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
  return { meanCiede2000: mean, p95Ciede2000: at(0.95), p99Ciede2000: at(0.99), samples: values.length };
}

/** Dominant Color Ratio：使用最多的那个颜色占总豆数的比例。 */
export function measureDominantRatio(codes, cols, rows) {
  const counts = new Map();
  let total = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const color = codes[y][x];
      if (color == null) continue;
      counts.set(color, (counts.get(color) || 0) + 1);
      total++;
    }
  }
  let max = 0;
  let dominant = null;
  for (const [color, count] of counts) {
    if (count > max) { max = count; dominant = color; }
  }
  return { ratio: total ? max / total : 0, dominant, dominantCount: max, total };
}

/**
 * 一次性算出全部十个指标。
 *
 * @param {{
 *   matrix:Array, palette:Array, sourceSamples?:Float32Array,
 *   bgColor?:number[], contaminationDeltaE?:number
 * }} input
 * @returns {object}
 */
export function measureMatrix(input) {
  const { cells, codes, cols, rows } = normalizeMatrix(input.matrix);
  const lookup = buildLookup(input.palette);

  if (!cols || !rows) {
    return {
      cols: 0, rows: 0, beadCount: 0, usedColorCount: 0,
      isolatedSingleBeadCount: 0, twoBeadClusterCount: 0, edgeNoiseCount: 0,
      structureRetention: null, structurePrecision: null, structureF1: null,
      highlightRetention: null, dominantColorRatio: 0, dominantColor: null,
      transparencyEdgeContamination: 0, boundaryBeadCount: 0,
      colorError: { meanCiede2000: null, p95Ciede2000: null, p99Ciede2000: null, samples: 0 },
      emptyCount: 0,
    };
  }

  const flat = codes.flat();
  const used = new Set();
  let beadCount = 0;
  let emptyCount = 0;
  for (const code of flat) {
    if (code == null) emptyCount++;
    else { used.add(code); beadCount++; }
  }

  const structure = measureStructure(codes, cols, rows, input.sourceSamples);
  const highlight = measureHighlightRetention(codes, cols, rows, input.sourceSamples, lookup);
  const dominant = measureDominantRatio(codes, cols, rows);
  const contamination = countTransparencyEdgeContamination(codes, cols, rows, lookup, input.bgColor, input.contaminationDeltaE ?? 12);
  const colorError = measureColorError(codes, cols, rows, input.sourceSamples, lookup);

  return {
    cols,
    rows,
    beadCount,
    emptyCount,
    usedColorCount: used.size,
    usedColors: [...used].sort(),
    isolatedSingleBeadCount: countIsolatedSingleBeads(codes, cols, rows),
    twoBeadClusterCount: countTwoBeadClusters(codes, cols, rows),
    edgeNoiseCount: countEdgeNoise(codes, cols, rows),
    componentCount: connectedSameColor(codes, cols, rows).length,
    structureRetention: structure.retention,
    structurePrecision: structure.precision,
    structureF1: structure.f1,
    structureEdges: { source: structure.sourceEdges, output: structure.outputEdges, matched: structure.matched },
    highlightRetention: highlight.retention,
    highlightDetail: highlight,
    dominantColorRatio: dominant.ratio,
    dominantColor: dominant.dominant,
    dominantColorCount: dominant.dominantCount,
    transparencyEdgeContamination: contamination.count,
    boundaryBeadCount: contamination.boundaryBeads,
    colorError,
  };
}

export const METRIC_LABELS = Object.freeze({
  usedColorCount: "实际使用颜色数量",
  meanDeltaE: "平均 ΔE",
  p95DeltaE: "P95 ΔE",
  isolatedSingleBeadCount: "孤立单豆数量",
  twoBeadClusterCount: "2 豆小区域数量",
  edgeNoiseCount: "边缘杂色数量",
  structureRetention: "轮廓保持率",
  highlightRetention: "高光保持率",
  dominantColorRatio: "Dominant Color Ratio",
  transparencyEdgeContamination: "透明边缘污染数量",
});
