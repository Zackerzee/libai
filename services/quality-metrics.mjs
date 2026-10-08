/**
 * Quality metrics — Stage B4 §13 的**唯一一把尺子**。
 *
 * ── 为什么必须只有一个实现 ────────────────────────────────────────────
 * 这些指标同时被三处消费：
 *   ① `tools/b4-lab.mjs`        —— §6–§10 候选算法的跑分
 *   ② `tools/b4-auto-tune.mjs`  —— §13 STANDARD / AUTO-TUNE / ORACLE 三方对比
 *   ③ `services/auto-tune.mjs`  —— 生产里的选择器（它要拿这些数做排序）
 * 三处各写一份，就会出现「跑分器说 edgeRetention 是 X、选择器按 Y 排序」这种
 * 谁都不算错、但**结论已经失去意义**的局面。§4/§5 的 bench runner 已经踩过
 * 同一个坑（见 `tests/b4-bench-runner.mjs` 的头注释），所以这里直接抽出来。
 *
 * ── 参照物一律来自「原图」 ────────────────────────────────────────────
 * 如果引用 `diagnostics.protectionMap` 之类的引擎中间量，参照物就会**跟着候选一起变**
 * —— 「候选 A 的保护图认为这里该保护、候选 B 的不认为」，两边各算各的分数，
 * 最后谁高谁低只是「谁更相信自己」。所以全部从 `downsampleSource()` 的**原图**导出，
 * 所有候选共用同一把尺子。
 *
 * ── 纯计算 ────────────────────────────────────────────────────────────
 * 无 DOM、无 window、无文件 IO。可在 Worker / node --test 直接跑。
 */

import { findConnectedComponents } from "../smart-preprocessing/smart-cleanup-v2.mjs";
import { rgbToLab, deltaE2000, labChroma } from "../smart-preprocessing/lab/buckets.mjs";
import { isSkin } from "./source-classifier.mjs";

/** 判「中性色」的色度阈值。低于它的格子进 neutralError。 */
export const NEUTRAL_CHROMA_THRESHOLD = 12;
/** 相邻格亮度差超过它 → 原图在这里有边缘。 */
export const EDGE_LUM_DELTA = 32;
/** 格子与邻域均值的 ΔE 超过它 → 原图在这里有细节。 */
export const DETAIL_DELTA = 15;
/** 原图这一格「很平」的判据：与所有 4 邻的 ΔE 都低于它。 */
export const FLAT_DELTA = 6;

const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FOUR_OFFSETS = NEIGHBORS;

export const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * 源图 → 目标格数的**盒式降采样**，直接用原图颜色，不做色卡匹配。
 *
 * 这是「原图」参照物的来源：没有它，「算法把颜色改坏了」就没有参照物。
 *
 * 注意：它是**参照物**，不是「理想输出」。盒式均值会把 1 像素宽的线糊成过渡色，
 * 所以 `edgeRetention` 的绝对值天然小于 1 —— 这个指标只在**候选之间**比较才有意义，
 * 不要拿它当「质量分数」去和别的图比。
 */
export function downsampleSource(source, width, height) {
  const out = [];
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.floor(x * sx), x1 = Math.min(source.width, Math.ceil((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.min(source.height, Math.ceil((y + 1) * sy));
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          const i = (py * source.width + px) * 4;
          r += source.data[i]; g += source.data[i + 1]; b += source.data[i + 2]; n += 1;
        }
      }
      row.push(n ? { rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], code: null } : null);
    }
    out.push(row);
  }
  return out;
}

/**
 * 从**原图**导出一次参照物，所有候选共用。
 *
 * 导出物：
 *   lab / chroma        每格的 Lab 与色度（算 ΔE 与「是不是中性色」）
 *   edgeCells           原图在这里有强边缘（亮度差 > EDGE_LUM_DELTA）
 *   detailCells         原图在这里与邻域均值有 ΔE 差（> DETAIL_DELTA）
 *   flatCells           原图在这里**四面都很平**（与所有 4 邻 ΔE < FLAT_DELTA）
 *   skinCells           §12 的肤色判据命中的格子
 */
export function buildReference(originalGrid) {
  const h = originalGrid.length;
  const w = originalGrid[0]?.length ?? 0;
  const lab = new Array(w * h).fill(null);
  const chroma = new Float64Array(w * h);
  const edgeCells = new Uint8Array(w * h);
  const detailCells = new Uint8Array(w * h);
  const flatCells = new Uint8Array(w * h);
  const skinCells = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const cell = originalGrid[y][x];
      if (!cell) continue;
      const idx = y * w + x;
      lab[idx] = rgbToLab(cell.rgb);
      chroma[idx] = labChroma(lab[idx]);
      if (isSkinRgb(cell.rgb, lum(cell.rgb))) skinCells[idx] = 1;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      const own = originalGrid[y][x];
      if (!own) continue;
      const neighbours = [];
      let lumEdge = false;
      let maxDelta = 0;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nc = originalGrid[ny][nx];
        if (!nc) continue;
        neighbours.push(nc.rgb);
        if (Math.abs(lum(own.rgb) - lum(nc.rgb)) > EDGE_LUM_DELTA) lumEdge = true;
        const d = deltaE2000(lab[idx], rgbToLab(nc.rgb));
        if (d > maxDelta) maxDelta = d;
      }
      if (!neighbours.length) continue;
      if (lumEdge) edgeCells[idx] = 1;
      let r = 0, g = 0, b = 0;
      for (const n of neighbours) { r += n[0]; g += n[1]; b += n[2]; }
      const meanLab = rgbToLab([r / neighbours.length, g / neighbours.length, b / neighbours.length]);
      if (deltaE2000(lab[idx], meanLab) > DETAIL_DELTA) detailCells[idx] = 1;
      // 「平」用的是**最大**邻差：只要有一个邻居差得多，这里就不是平区。
      // 用最小值会把「一侧平、一侧有边」的格子也算成平的 —— 而那正是边界格，
      // 于是 flatAreaStability 会奖励「在边界上不画线」，方向完全反了。
      if (maxDelta < FLAT_DELTA) flatCells[idx] = 1;
    }
  }
  return { lab, chroma, edgeCells, detailCells, flatCells, skinCells, width: w, height: h };
}

/**
 * 肤色判据 —— **直接复用 `services/source-classifier.mjs` 的 `isSkin`**。
 *
 * 刻意不在这里抄一份：§12 的 `skinRatio` 与 §13 的 `skinError` 必须是**同一批格子**，
 * 否则会出现「路由说这是人像（skinRatio 高）、但肤色指标说这张图没有肤色格子」
 * 这种自相矛盾的报告。抄一份就等于给漂移留了口子。
 */
export function isSkinRgb(rgb, luminance = lum(rgb)) {
  return isSkin(rgb[0], rgb[1], rgb[2], luminance);
}

/** 输出网格里，某格是否与任一 4 邻不同色（= 输出在这一格上确实画出了边界）。 */
export function hasBoundary(grid, x, y) {
  const own = grid[y]?.[x];
  if (!own) return false;
  const w = grid[0].length;
  const h = grid.length;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    const other = grid[ny][nx];
    if (!other || other.code !== own.code) return true;
  }
  return false;
}

/**
 * 量一个输出网格。**必须传同一张图的 reference**（`buildReference(downsampleSource(...))`）。
 *
 * 指标口径：
 *   perceptualError   全格平均 ΔE2000（相对原图降采样）—— 越小越好
 *   tonalError        全格平均 |ΔL*| —— 只看明暗，不看色相。写实模式的「影调保持」
 *   neutralError      低色度格（chroma < 12）的平均 ΔE —— 灰墙 / 白衣 / 阴影
 *   skinError         §12 肤色判据命中格的平均 ΔE —— 人像模式的「肤色保真」
 *   edgeRetention     原图边缘格中，输出**确实画出了边界**的比例 —— 越大越好
 *   detailRetention   原图细节格中，输出确实画出了边界的比例 —— 越大越好
 *   flatAreaStability 原图平区格中，输出**没有**凭空造出边界的比例 —— 越大越好
 *   fragmentation     连通块数 / (填充格 / 1000)
 *   tinyRegions       面积 ≤ 2 格的连通块数
 *   isolatedPixels    四邻都不同色的格数
 */
export function measureGrid(grid, reference) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  let filled = 0;
  let nulls = 0;
  let perceptualSum = 0;
  let tonalSum = 0;
  let neutralSum = 0;
  let neutralCount = 0;
  let skinSum = 0;
  let skinCount = 0;
  let edgeTotal = 0;
  let edgeKept = 0;
  let detailTotal = 0;
  let detailKept = 0;
  let flatTotal = 0;
  let flatStable = 0;
  let isolated = 0;
  const used = new Set();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const cell = grid[y][x];
      if (!cell) { nulls += 1; continue; }
      filled += 1;
      used.add(cell.code);
      const idx = y * w + x;
      const refLab = reference.lab[idx];
      const boundary = hasBoundary(grid, x, y);
      if (refLab) {
        const outLab = rgbToLab(cell.rgb);
        const delta = deltaE2000(refLab, outLab);
        perceptualSum += delta;
        tonalSum += Math.abs(refLab[0] - outLab[0]);
        if (reference.chroma[idx] < NEUTRAL_CHROMA_THRESHOLD) { neutralSum += delta; neutralCount += 1; }
        if (reference.skinCells[idx]) { skinSum += delta; skinCount += 1; }
      }
      if (reference.edgeCells[idx]) { edgeTotal += 1; if (boundary) edgeKept += 1; }
      if (reference.detailCells[idx]) { detailTotal += 1; if (boundary) detailKept += 1; }
      if (reference.flatCells[idx]) { flatTotal += 1; if (!boundary) flatStable += 1; }
      let same = false;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const other = grid[ny][nx];
        if (other && other.code === cell.code) { same = true; break; }
      }
      if (!same) isolated += 1;
    }
  }
  const components = findConnectedComponents(grid, (cell) => (cell ? cell.code : null));
  const tiny = components.filter((c) => c.cells.length <= 2).length;
  return {
    usedColors: used.size,
    nullCells: nulls,
    filledCells: filled,
    totalCells: w * h,
    perceptualError: round2(perceptualSum / Math.max(1, filled)),
    tonalError: round2(tonalSum / Math.max(1, filled)),
    neutralError: neutralCount ? round2(neutralSum / neutralCount) : null,
    neutralCells: neutralCount,
    skinError: skinCount ? round2(skinSum / skinCount) : null,
    skinCells: skinCount,
    edgeRetention: edgeTotal ? round3(edgeKept / edgeTotal) : null,
    edgeCells: edgeTotal,
    detailRetention: detailTotal ? round3(detailKept / detailTotal) : null,
    detailCells: detailTotal,
    flatAreaStability: flatTotal ? round3(flatStable / flatTotal) : null,
    flatCells: flatTotal,
    fragmentation: round2(components.length / Math.max(1, filled / 1000)),
    tinyRegions: tiny,
    isolatedPixels: isolated,
    componentCount: components.length,
  };
}

/**
 * 一次到位：源图 + 输出网格 → 指标。
 *
 * 便利函数，**只给单次调用用**。批量比较候选时必须自己建一次 reference 再复用
 * —— 每格重建一次 reference 会让「同一把尺子」这件事变得又慢又容易写错。
 */
export function measureAgainstSource(source, grid) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const reference = buildReference(downsampleSource(source, w, h));
  return measureGrid(grid, reference);
}

/** 只做 reference，供批量候选复用。 */
export function referenceFor(source, width, height) {
  return buildReference(downsampleSource(source, width, height));
}

/** 一份指标的「只保留数值」快照，用于缓存 / JSON / 比较（去掉派生计数外的全部）。 */
export function snapshotMetrics(metrics) {
  return {
    usedColors: metrics.usedColors,
    nullCells: metrics.nullCells,
    perceptualError: metrics.perceptualError,
    tonalError: metrics.tonalError,
    neutralError: metrics.neutralError,
    skinError: metrics.skinError,
    edgeRetention: metrics.edgeRetention,
    detailRetention: metrics.detailRetention,
    flatAreaStability: metrics.flatAreaStability,
    fragmentation: metrics.fragmentation,
    tinyRegions: metrics.tinyRegions,
    isolatedPixels: metrics.isolatedPixels,
  };
}

export { FOUR_OFFSETS };
