/**
 * Safe Fragment Cleanup / Edge Contamination Cleanup / Flat Region Regularization
 * —— Hybrid V2 阶段 8、10、12。
 *
 * 铁律：任何改格必须走 `requestChange()`（ProtectedDetailMask + TopologyGuard），
 * 禁止直接写 grid。
 *
 * Phase B.1：向 `requestChange()` 透传 **阶段名 + 每提案上下文**（componentSize /
 * localVariance / boundaryRatio / deltaE / edgeStrength / confidence / category），
 * 使每个提案都留下可解释记录（见 trace.mjs）。无 tracer 时行为与历史完全一致。
 *
 * 证据来源：
 *   - 小域清理准入：G 彩色小域（≤2 格 / cellSupport<0.42 / 邻色数 ≥ size+2）
 *   - 误差闸门：B `regionCleanup` 允许 ΔE00 增量 3.5、边缘拒绝 0.5
 *   - 分类：classifySmallComponent 七分类（UNKNOWN 默认保留）
 */

import { classifySmallComponent, COMPONENT_CATEGORY, estimateDeltaEIncrement } from "./classify.mjs";
import { connectedComponents } from "./topology.mjs";
import { requestChange } from "./protected-mask.mjs";
import { STAGE } from "./trace.mjs";
import { HybridV2Config } from "./config.mjs";

const C = HybridV2Config.cleanup;
const F = HybridV2Config.flatRegion;
const v = (node) => node.value;

function majorityNeighbor(grid, cols, rows, pixels, getColorKey, exclude) {
  const counts = new Map();
  for (const [x, y] of pixels) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const cell = grid[ny][nx];
      if (cell == null) continue;
      const key = getColorKey(cell);
      if (key === exclude) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let best = null;
  let bestN = 0;
  for (const [key, n] of counts) if (n > bestN) { bestN = n; best = key; }
  return best;
}

/** 组件边界比：与异色/背景相邻的格占比。 */
function boundaryRatioOf(component, grid, cols, rows, getColorKey) {
  const pixels = component.pixels;
  if (!pixels.length) return 0;
  let boundary = 0;
  for (const [x, y] of pixels) {
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { edge = true; break; }
      const o = grid[ny][nx];
      if (o == null || getColorKey(o) !== getColorKey(grid[y][x])) { edge = true; break; }
    }
    if (edge) boundary++;
  }
  return boundary / pixels.length;
}

/** 组件平均格内方差（来自采样特征，扁平数组按全局列数索引）；缺特征时返回 null。 */
function avgVarianceOf(component, cellFeatures, cols) {
  if (!cellFeatures) return null;
  let sum = 0;
  let n = 0;
  for (const [x, y] of component.pixels) {
    const f = cellFeatures[y * cols + x];
    if (f && typeof f.variance === "number") { sum += f.variance; n++; }
  }
  return n ? sum / n : null;
}

/**
 * 阶段 8：Safe Fragment Cleanup。
 * @returns {{grid, classifications:Array, changed:number, rejected:number, reasons:Array}}
 */
export function safeFragmentCleanup(grid, ctx) {
  const { cols, rows, getColorKey, cellFeatures, protectedMask, guard, config = {} } = ctx;
  const cv = (key, fallback) => (config[key] === undefined ? fallback : config[key]);
  const tracer = ctx.tracer;
  const mode = ctx.mode;
  const maxSize = cv("maxComponentSize", v(C.maxComponentSize));
  const components = connectedComponents(grid, getColorKey, 4).filter((c) => c.size <= maxSize);

  const classifications = [];
  let changed = 0;
  let rejected = 0;

  for (const component of components) {
    const result = classifySmallComponent(component, {
      grid,
      cols,
      rows,
      getColorKey,
      getRGB: ctx.getRGB,
      tierMap: protectedMask?.tierMap,
      protectionMap: protectedMask?.mask,
      protectionReasonMap: protectedMask?.reasonMap,
      highlightMap: protectedMask?.highlightMap,
      eyeLikeMap: protectedMask?.eyeLikeMap,
      edgeMap: protectedMask?.edgeMap,
      cellFeatures,
      cellSourceRgb: ctx.cellSourceRgb,
      config,
    });
    classifications.push({ component: { key: component.key, size: component.size, pixels: component.pixels }, ...result });

    // 计算每提案上下文（供 trace 记录）
    component._avgVar = avgVarianceOf(component, cellFeatures, cols);
    component._boundary = boundaryRatioOf(component, grid, cols, rows, getColorKey);

    if (result.category !== COMPONENT_CATEGORY.NOISE || !result.allowAutoAction) continue;

    const target = majorityNeighbor(grid, cols, rows, component.pixels, getColorKey, component.key);
    if (target == null) continue;
    const decision = requestChange(protectedMask, guard, component.pixels[0][0], component.pixels[0][1], target, {
      grid,
      getColorKey,
      tracer,
      mode,
      stage: STAGE.FRAGMENT,
      context: {
        reason: result.category,
        confidence: result.confidence,
        componentSize: component.size,
        localVariance: component._avgVar ?? null,
        boundaryRatio: component._boundary ?? null,
        deltaE: estimateDeltaEIncrement(component, {
          grid, cols, rows, getRGB: ctx.getRGB, cellSourceRgb: ctx.cellSourceRgb, getKey: getColorKey,
        }),
        edgeStrength: null,
        category: result.category,
        minConfidence: null,
      },
    });
    if (!decision.applied) { rejected++; continue; }
    for (const [x, y] of component.pixels) { grid[y][x] = target; changed++; }
  }

  return { grid, classifications, changed, rejected, componentCount: components.length };
}

/**
 * 阶段 10：Edge Contamination Cleanup。
 * 只处理「四邻中 ≥3 个异色」的格，且必须过保护门 + 拓扑门。
 */
export function edgeContaminationCleanup(grid, ctx) {
  const { cols, rows, getColorKey, protectedMask, guard } = ctx;
  const tracer = ctx.tracer;
  const mode = ctx.mode;
  let changed = 0;
  let rejected = 0;
  const candidates = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = grid[y][x];
      if (cell == null) continue;
      const key = getColorKey(cell);
      const counts = new Map();
      let different = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const other = grid[ny][nx];
        if (other == null) continue;
        const k = getColorKey(other);
        counts.set(k, (counts.get(k) || 0) + 1);
        if (k !== key) different++;
      }
      if (different < 3) continue;
      let target = null;
      let bestN = 0;
      for (const [k, n] of counts) if (k !== key && n > bestN) { bestN = n; target = k; }
      if (target == null || bestN < 2) continue;
      candidates.push({ x, y, from: key, to: target, edgeStrength: different });
    }
  }

  for (const c of candidates) {
    const decision = requestChange(protectedMask, guard, c.x, c.y, c.to, {
      grid,
      getColorKey,
      tracer,
      mode,
      stage: STAGE.EDGE,
      context: {
        reason: "edge-contamination",
        confidence: null,
        componentSize: 1,
        edgeStrength: c.edgeStrength,
        category: null,
        minConfidence: null,
      },
    });
    if (!decision.applied) { rejected++; continue; }
    grid[c.y][c.x] = c.to;
    changed++;
  }
  return { grid, changed, rejected, candidateCount: candidates.length };
}

/**
 * 阶段 12：Flat Region Regularization。
 * 只在低方差（平坦）且色号碎片度超限的连通块内，把少数色并到块内主色。
 * 面积小于 minArea 的块不动（交给七分类处理）。
 */
export function flatRegionRegularization(grid, ctx) {
  const { cols, rows, getColorKey, cellFeatures, protectedMask, guard, config = {} } = ctx;
  const cv = (key, fallback) => (config[key] === undefined ? fallback : config[key]);
  const tracer = ctx.tracer;
  const mode = ctx.mode;
  const varianceMax = cv("varianceMax", v(F.varianceMax));
  const minArea = cv("minArea", v(F.minArea));
  const maxFragmentColors = cv("maxFragmentColors", v(F.maxFragmentColors));

  const flat = new Uint8Array(cols * rows);
  for (let i = 0; i < flat.length; i++) {
    const f = cellFeatures ? cellFeatures[i] : null;
    flat[i] = f && (f.variance ?? 1) < varianceMax ? 1 : 0;
  }
  const seen = new Uint8Array(cols * rows);
  const blocks = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (seen[i] || !flat[i]) { seen[i] = 1; continue; }
      const stack = [[x, y]];
      seen[i] = 1;
      const pixels = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        pixels.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !flat[ni]) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      blocks.push(pixels);
    }
  }

  let changed = 0;
  let rejected = 0;
  const touched = [];
  const maxShare = cv("maxBlockShareOfGrid", v(F.maxBlockShareOfGrid));
  const gridCells = cols * rows || 1;

  for (const pixels of blocks) {
    if (pixels.length < minArea) continue;
    if (pixels.length / gridCells > maxShare) continue;
    const counts = new Map();
    for (const [x, y] of pixels) {
      const cell = grid[y][x];
      if (cell == null) continue;
      const k = getColorKey(cell);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (counts.size <= maxFragmentColors) continue;
    let dominant = null;
    let bestN = 0;
    let total = 0;
    for (const [, n] of counts) total += n;
    for (const [k, n] of counts) if (n > bestN) { bestN = n; dominant = k; }
    if (dominant == null) continue;
    const minorityMax = cv("minorityShareMax", v(F.minorityShareMax));
    for (const [x, y] of pixels) {
      const cell = grid[y][x];
      if (cell == null) continue;
      const key = getColorKey(cell);
      if (key === dominant) continue;
      if ((counts.get(key) || 0) / total > minorityMax) continue;
      const decision = requestChange(protectedMask, guard, x, y, dominant, {
        grid,
        getColorKey,
        tracer,
        mode,
        stage: STAGE.FLAT,
        context: {
          reason: "flat-fragment",
          confidence: null,
          componentSize: pixels.length,
          localVariance: varianceMax * 0.5,
          category: null,
          minConfidence: null,
        },
      });
      if (!decision.applied) { rejected++; continue; }
      grid[y][x] = dominant;
      changed++;
      touched.push({ x, y });
    }
  }
  return { grid, changed, rejected, blockCount: blocks.length, touched };
}
