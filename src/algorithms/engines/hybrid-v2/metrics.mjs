/**
 * Stage Metrics —— 每个阶段都要能统计 BEFORE / AFTER。
 *
 * 九个必测项（用户指定）：
 *   paletteSize · isolatedCellCount · componentCount · smallComponentCount
 *   edgeContaminationCount · protectedDetailLoss · flatRegionFragmentation
 *   dominantColorRatio · structureSimilarity（可选）
 */

import { connectedComponents, backgroundHoles, openingCount, countBeads } from "./topology.mjs";
import { otsuThreshold, rgbToCielab, deltaE2000 } from "../../bgs/color-space.mjs";
import { flattenConfig } from "./config.mjs";

/** 度量口径默认值 —— 全部来自 HybridV2Config.protectedReference，不硬编码。 */
const REF_DEFAULTS = flattenConfig().protectedReference;

export const METRIC_KEYS = Object.freeze([
  "paletteSize",
  "isolatedCellCount",
  "componentCount",
  "smallComponentCount",
  "edgeContaminationCount",
  "protectedDetailLoss",
  "flatRegionFragmentation",
  "dominantColorRatio",
  "structureSimilarity",
]);

/** 四邻全异己的孤豆（E `findIsolatedBeads` 是「四邻无任何豆」，此处按同色口径更严）。 */
export function isolatedCellCount(grid, getColorKey) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  let n = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[y][x];
      if (cell == null) continue;
      const key = getColorKey(cell);
      let same = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const other = grid[ny][nx];
        if (other != null && getColorKey(other) === key) same++;
      }
      if (same === 0) n++;
    }
  }
  return n;
}

/** 边缘杂色：被 ≥3 个异色邻居包围的格。 */
export function edgeContaminationCount(grid, getColorKey) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  let n = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[y][x];
      if (cell == null) continue;
      const key = getColorKey(cell);
      let different = 0;
      let neighbors = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const other = grid[ny][nx];
        if (other == null) continue;
        neighbors++;
        if (getColorKey(other) !== key) different++;
      }
      if (neighbors > 0 && different >= 3) n++;
    }
  }
  return n;
}

/** 平坦区碎片度：低方差格所属连通区里，平均「每 N 格出现多少种色」的代理。 */
export function flatRegionFragmentation(grid, getColorKey, cellFeatures, varianceMax) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  if (!cellFeatures) return 0;
  const flat = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const f = cellFeatures[y * cols + x];
      if (f && (f.variance ?? 1) < varianceMax) flat.push([x, y]);
    }
  }
  if (flat.length < 4) return 0;
  // 以 3×3 窗口统计色号数，取平均
  let total = 0;
  let windows = 0;
  for (const [x, y] of flat) {
    const set = new Set();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const cell = grid[ny][nx];
        if (cell != null) set.add(getColorKey(cell));
      }
    }
    total += set.size;
    windows++;
  }
  return windows ? total / windows : 0;
}

export function dominantColorRatio(grid, getColorKey) {
  const counts = new Map();
  let total = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell == null) continue;
      const key = getColorKey(cell);
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
  }
  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  return total ? max / total : 0;
}

/**
 * 结构相似度：源图梯度边（Otsu 二值化）与输出网格颜色变化边的 F1。
 * 两侧用同一套 Otsu 阈值，避免引入主观参数。
 */
export function structureSimilarity(grid, getColorKey, sourceLuma) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  if (!sourceLuma || cols < 2 || rows < 2) return null;

  const grad = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const l = sourceLuma[y * cols + x];
      const rx = x + 1 < cols ? sourceLuma[y * cols + x + 1] : l;
      const dy = y + 1 < rows ? sourceLuma[(y + 1) * cols + x] : l;
      grad[y * cols + x] = (Math.abs(rx - l) + Math.abs(dy - l)) / 2;
    }
  }
  const threshold = otsuThresholdFrom(grad);

  let srcEdges = 0;
  let outEdges = 0;
  let matched = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const isSrc = grad[y * cols + x] > threshold;
      const rx = x + 1 < cols;
      const dy = y + 1 < rows;
      if (!rx && !dy) continue;
      let out = false;
      if (rx) {
        const a = grid[y][x];
        const b = grid[y][x + 1];
        out = out || (a == null) !== (b == null) || (a != null && b != null && getColorKey(a) !== getColorKey(b));
      }
      if (dy) {
        const a = grid[y][x];
        const b = grid[y + 1][x];
        out = out || (a == null) !== (b == null) || (a != null && b != null && getColorKey(a) !== getColorKey(b));
      }
      if (isSrc) srcEdges++;
      if (out) outEdges++;
      if (isSrc && out) matched++;
    }
  }
  const retention = srcEdges ? matched / srcEdges : null;
  const precision = outEdges ? matched / outEdges : null;
  const f1 = retention && precision ? (2 * retention * precision) / (retention + precision) : null;
  return { retention, precision, f1, srcEdges, outEdges, matched };
}

/**
 * 梯度阈值：Otsu，**并且必须把零梯度格计入直方图**。
 *
 * 两个实测出来的坑（都静默产生错误结果，不报错）：
 *
 * 1. `otsuThreshold` 返回的是对象 `{threshold, flatPlateau, low, high}`，不是数字。
 *    拿对象去做 `(raw / 255) * max` 得 `NaN`，于是「一条边都选不出来」，
 *    然后静默掉进兜底分支。必须取 `.threshold`。
 *
 * 2. **不能只在非零梯度上跑 Otsu**。Otsu 的前提是「背景类 + 前景类」两峰，
 *    而边格在整幅图里本来就是少数 —— 一旦把零梯度格剔除，剩下的非零样本里
 *    「边格」反而成了多数，Otsu 会把边格当成**背景类**，阈值被推到最高位。
 *    实测 THIN_OUTLINE：排除零 → 只选出 1 个边格；包含零 → 选出 55 个（整条细轮廓）。
 *    另外空 bin 会让 `otsuThreshold` 的 plateau 横跨无人区、中点落到空档里
 *    （同一例子里中点算出 bin 191，而所有边格都在 bin 128），这也是排除零时的连带后果。
 *
 * 若 Otsu 仍把全部格判成边 / 判成非边（无双峰），退回非零梯度的 p75 ——
 * 不用中位数：梯度分布常是「一堆降采样噪声 + 少数真边」，中位数会落在噪声堆里。
 */
export function gradientThreshold(grad) {
  const n = grad.length;
  if (!n) return 0;
  let max = 0;
  for (let i = 0; i < n; i++) if (grad[i] > max) max = grad[i];
  if (max <= 0) return 0;

  const hist = new Float32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.max(0, Math.round((grad[i] / max) * 255)))]++;

  const otsu = otsuThreshold(hist, n);
  if (!otsu) return 0;
  let threshold = ((otsu.threshold + 0.5) / 255) * max;

  let edges = 0;
  for (let i = 0; i < n; i++) if (grad[i] > threshold) edges++;
  if (edges === 0 || edges === n) {
    const nonzero = [];
    for (let i = 0; i < n; i++) if (grad[i] > 0) nonzero.push(grad[i]);
    if (nonzero.length) {
      nonzero.sort((a, b) => a - b);
      threshold = nonzero[Math.floor((nonzero.length - 1) * 0.75)];
    }
  }
  return threshold;
}

function otsuThresholdFrom(values) {
  return gradientThreshold(values);
}

/**
 * 从**源图**导出受保护格集合 —— 与引擎无关。
 *
 * 关键点：A/B benchmark 里 CURRENT 和 HYBRID_V2 必须用**同一套**保护集合、
 * 同一个误差函数、同一个容差，否则「保护损失」这个指标就是在自说自话。
 *
 * 两类受保护格（对应用户的两条目标）：
 *   bit0 = 结构/轮廓：源图梯度高于自适应阈值（Otsu，非零梯度上跑）
 *   bit1 = 高光/眼睛：亮度处于最高分位 **且** 显著高于 5×5 局部均值
 *         （只看全局亮度会把整片白底全算成高光，所以必须叠加局部对比条件）
 *
 * @param {Float32Array} rgb downsample() 的结果，长度 cols*rows*3
 * @returns {{marks: Uint8Array, edgeCount:number, highlightCount:number,
 *            gradientThreshold:number, highlightLuma:number}}
 */
export function sourceProtectedCells(rgb, cols, rows, options = {}) {
  const n = cols * rows;
  const marks = new Uint8Array(n);
  if (!rgb || n === 0) return { marks, edgeCount: 0, highlightCount: 0, gradientThreshold: 0, highlightLuma: 0 };

  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];

  const grad = new Float32Array(n);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const l = luma[i];
      const rx = x + 1 < cols ? luma[i + 1] : l;
      const dy = y + 1 < rows ? luma[i + cols] : l;
      grad[i] = (Math.abs(rx - l) + Math.abs(dy - l)) / 2;
    }
  }
  const threshold = gradientThreshold(grad);

  const quantile = options.highlightQuantile ?? REF_DEFAULTS.highlightQuantile;
  const delta = options.highlightDelta ?? REF_DEFAULTS.highlightDelta;
  const sorted = Array.from(luma).sort((a, b) => a - b);
  const highlightLuma = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];

  let edgeCount = 0;
  let highlightCount = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (grad[i] > threshold) { marks[i] |= 1; edgeCount++; }
      if (luma[i] >= highlightLuma) {
        // 高光 = 全局亮 **且** 5×5 局部峰值 **且** 明显高于局部均值。
        // 只满足「高于均值」会把「白底挨着暗块」的整圈光晕全算成高光（实测会多算 1000+ 格），
        // 所以必须同时要求它是邻域最大值 —— 这才是镜面高光 / 眼神光的形态。
        let sum = luma[i];
        let cnt = 1;
        let peak = -Infinity;
        let peakCnt = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const l = luma[ny * cols + nx];
            sum += l;
            cnt++;
            if (l > peak) peak = l;
            peakCnt++;
          }
        }
        // 均值含中心（否则暗块旁的白格会被自己的缺席抬高差值，实测多算 300+ 格）
        const local = sum / cnt;
        // 峰值排除中心（否则恒真，失去约束）
        const isPeak = peakCnt === 0 || luma[i] >= peak;
        if (isPeak && luma[i] - local > delta) { marks[i] |= 2; highlightCount++; }
      }
    }
  }

  // 连通块上限：白底 + 细线的图里，几乎每个白格都满足「局部亮峰 + 高于局部均值」，
  // 但它们连成一整片 —— 那不是高光，是背景。真正的高光（眼神光 / 镜面反射）是小blob。
  // 所以：候选块超过上限就整块剔除。上限取 max(8, 2% 格数)，确定性、不随图漂移。
  const maxBlob = Math.max(8, Math.ceil(n * (options.highlightMaxShare ?? REF_DEFAULTS.highlightMaxShare)));
  highlightCount = pruneLargeBlobs(marks, 2, cols, rows, maxBlob);

  return { marks, edgeCount, highlightCount, gradientThreshold: threshold, highlightLuma };
}

/**
 * 把 mask 里标记了 `bit` 的格按 8 邻接分块，删掉超过 `maxBlob` 的块。
 * @returns {number} 删除后剩余标记数
 */
function pruneLargeBlobs(marks, bit, cols, rows, maxBlob) {
  const stack = [];
  let remaining = 0;
  for (let start = 0; start < marks.length; start++) {
    if (!(marks[start] & bit)) continue;
    const blob = [];
    stack.push(start);
    marks[start] &= ~bit;
    while (stack.length) {
      const cur = stack.pop();
      blob.push(cur);
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (!(marks[ni] & bit)) continue;
          marks[ni] &= ~bit;
          stack.push(ni);
        }
      }
    }
    if (blob.length <= maxBlob) {
      for (const i of blob) { marks[i] |= bit; remaining++; }
    }
  }
  return remaining;
}

/**
 * 保护损失：受保护格里，输出色与**该格源色**的 CIEDE2000 超过容差的数量。
 * 输出为 null（留空）也计为丢失 —— 结构/高光被抹掉和留空是同一种损失。
 *
 * @returns {{loss:number, total:number, ratio:number, edgeLoss:number, highlightLoss:number}}
 */
export function protectedDetailLoss(grid, getColorKey, ctx) {
  const { protectedCells, sourceRGB, getRGB, tolerance } = ctx;
  const empty = { loss: 0, total: 0, ratio: 0, edgeLoss: 0, highlightLoss: 0 };
  if (!protectedCells || !sourceRGB || typeof getRGB !== "function") return empty;

  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  if (!cols) return empty;
  const tol = tolerance ?? REF_DEFAULTS.colorErrorTolerance;

  let loss = 0;
  let total = 0;
  let edgeLoss = 0;
  let highlightLoss = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const mark = protectedCells[y * cols + x];
      if (!mark) continue;
      total++;
      const cell = grid[y][x];
      let bad = false;
      if (cell == null) {
        bad = true;
      } else {
        const key = getColorKey(cell);
        if (key == null) bad = true;
        else {
          const i = y * cols + x;
          const src = [sourceRGB[i * 3], sourceRGB[i * 3 + 1], sourceRGB[i * 3 + 2]];
          const dst = getRGB(key);
          const d = deltaE2000(rgbToCielab(src), rgbToCielab(dst));
          bad = !(d <= tol);
        }
      }
      if (bad) {
        loss++;
        if (mark & 1) edgeLoss++;
        if (mark & 2) highlightLoss++;
      }
    }
  }
  return { loss, total, ratio: total ? loss / total : 0, edgeLoss, highlightLoss };
}

/** 一次完整快照。 */
export function snapshot(grid, ctx) {
  const { getColorKey, cellFeatures, varianceMax, sourceLuma, protectedMask, smallMax = 2 } = ctx;
  const components = connectedComponents(grid, getColorKey);
  const colors = new Set();
  for (const row of grid) for (const cell of row) if (cell != null) colors.add(getColorKey(cell));

  const small = components.filter((c) => c.size <= smallMax);

  // 保护损失有两条口径，取「更能反映事实」的那条：
  //   1) 色号级：受保护色号被 MaxColors 挤掉几个（只在管内部有基线时可用）
  //   2) 源图级：受保护格的输出色偏离源色多少（引擎无关，A/B 可比）—— 优先
  const gridLoss = protectedDetailLoss(grid, getColorKey, ctx);
  let protectedLoss = gridLoss.loss;
  if (protectedLoss === 0 && protectedMask && ctx.baselineProtectedKeys) {
    for (const key of ctx.baselineProtectedKeys) if (!colors.has(key)) protectedLoss++;
  }

  return {
    protectedDetailLossRatio: gridLoss.ratio,
    protectedEdgeLoss: gridLoss.edgeLoss,
    protectedHighlightLoss: gridLoss.highlightLoss,
    protectedCellsTotal: gridLoss.total,
    paletteSize: colors.size,
    isolatedCellCount: isolatedCellCount(grid, getColorKey),
    componentCount: components.length,
    smallComponentCount: small.length,
    edgeContaminationCount: edgeContaminationCount(grid, getColorKey),
    protectedDetailLoss: protectedLoss,
    flatRegionFragmentation: flatRegionFragmentation(grid, getColorKey, cellFeatures, varianceMax ?? 0.008),
    dominantColorRatio: dominantColorRatio(grid, getColorKey),
    structureSimilarity: structureSimilarity(grid, getColorKey, sourceLuma),
    holeCount: backgroundHoles(grid).length,
    openingCount: openingCount(grid),
    beadCount: countBeads(grid),
  };
}

/** 两个快照求差（只对数，不判优劣）。 */
export function diffSnapshot(before, after) {
  const delta = {};
  for (const key of METRIC_KEYS) {
    const a = before[key];
    const b = after[key];
    if (typeof a === "number" && typeof b === "number") delta[key] = b - a;
    else if (a && b && typeof a === "object") {
      delta[key] = {
        retention: num(b.retention - a.retention),
        precision: num(b.precision - a.precision),
        f1: num(b.f1 - a.f1),
      };
    } else delta[key] = null;
  }
  delta.holeCount = after.holeCount - before.holeCount;
  delta.openingCount = after.openingCount - before.openingCount;
  delta.beadCount = after.beadCount - before.beadCount;
  return delta;
}

function num(x) {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
}
