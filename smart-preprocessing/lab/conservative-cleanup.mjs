/**
 * §10 Conservative Cleanup —— 候选算法（Lab，**不进生产**）。
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────────
 * 生产清理（`smart-cleanup-v2`）的判据是四条：保护分低 / source evidence 低 /
 * 连通块小 / 替代色近。这套判据在多数情况下没问题，但它对「**小而真**」的东西
 * 天生不友好：眼睛、高光、文字点、回形纹、金纹、窗格、细建筑线，
 * 全都是「1–4 格的孤立连通块」，正好落在清理的射程里。
 *
 * 生产用 `tierMap >= 4` 兜住最危险的一类。Conservative Cleanup 不重写这套判据，
 * 而是**提高门槛并补齐证据**：每个待清理区域先算六个量，只有
 * 「低结构价值」**且**「替换后源图误差不明显增加」才允许清理。
 *
 * ── 六个量（§10 原文）────────────────────────────────────────────────
 *   regionSize            连通块格数
 *   sourceContrast        本块源图色 vs 周围源图色的 ΔE —— **小而真**的东西这里最大
 *   edgeSupport           本块保护图/边缘图强度 —— 细线、描边在这里最大
 *   neighborSupport       最佳替代色在边界邻域里出现的次数
 *   paletteDistance       本块色 vs 替代色的 ΔE
 *   replacementErrorDelta 替换后源图误差的变化量（正数 = 变差）
 *
 * ── 与生产清理的关键差异（这是它叫 Conservative 的原因）────────────────
 *   ① 保护门槛从 `tier >= 4` 放宽到 `tier >= 3`（`protectTier`）
 *   ② 1–2 格的连通块用**更严**的误差预算（`tinyErrorBudget`）——
 *      「越小的孤立块越可能是特征而不是噪点」这个先验，生产里没有
 *   ③ 必须同时过 `structureScore < 阈值` 和 `errorDelta <= 预算` 两道门
 *   ④ **替换色按连通块整体决定，不逐格决定**
 *
 * ── 第 ④ 条是实测逼出来的 ─────────────────────────────────────────────
 * 首轮 Lab：F 类（回形纹）`componentCount` 470 → 597、`tinyRegions` 209 → 344。
 * 清理算法把连通块**变多了**，这在直觉上说不通 —— 直到看清根因：
 * 逐格挑「最近邻色」时，一个 3 格连通块的三格可能各自挑中不同的邻居色，
 * 于是一个块被劈成三个。生产 `smart-cleanup-v2` 也是逐格的，
 * 只是它的门更严、触发更少，所以症状更轻。
 *
 * 现在改成：先给整个连通块选**一个**替换色（在边界邻域里出现过的色中，
 * 按「块内总源图误差增幅 + 邻域支持度」打分取最优），再整块写入。
 * 一个块进去、一个色出来，**结构上不可能被劈开**。
 *
 * 它**复用** `smart-cleanup-v2` 的 `findConnectedComponents`，
 * 不另写一套连通域 —— 两套连通域实现迟早会在边界处理上分叉，
 * 而那种分叉的表现是「两个清理器对同一张图给出不同的连通块」，无从解释。
 */

import { findConnectedComponents } from "../smart-cleanup-v2.mjs";
import { rgbToLab, deltaE2000, forEachCellPixel, LAB_ALPHA_THRESHOLD } from "./buckets.mjs";

export const CONSERVATIVE_CLEANUP_ID = "conservative-cleanup";

export const DEFAULT_CONSERVATIVE_CLEANUP_OPTIONS = Object.freeze({
  maxComponentSize: 5,
  // ① 比生产的 `tier >= 4` 更宽：tier 3 是「高」档，里面就有眼睛/高光
  protectTier: 3,
  // ② 1–2 格的块用更严的预算
  tinySize: 2,
  tinyErrorBudget: 0.8,
  errorBudget: 2.0,
  structureThreshold: 0.5,
  minNeighborSupport: 2,
  // structureScore 的三项权重（和为 1）
  wContrast: 0.45,
  wEdge: 0.40,
  wSize: 0.15,
  // 归一化基准
  contrastScale: 30,
  edgeScale: 0.6,
  // 与生产同口径的 source evidence 门槛（复用 getSourceEvidence）
  sourceEvidenceThreshold: 0.3,
  // 邻域支持度的收益上限，与生产 `findReplacement` 的 `min(6, count*0.5)` 同口径
  supportBonusCap: 6,
  supportBonusPerContact: 0.5,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const EIGHT_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** 一格的源图均值 Lab。没有不透明像素时返回 null。 */
function sourceCellLab(source, bounds) {
  let r = 0, g = 0, b = 0, n = 0;
  forEachCellPixel(source, bounds, (pr, pg, pb, pa) => {
    if (pa <= LAB_ALPHA_THRESHOLD) return;
    r += pr; g += pg; b += pb; n += 1;
  });
  if (!n) return null;
  return rgbToLab([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
}

function meanLab(labs) {
  let l = 0, a = 0, b = 0;
  for (const lab of labs) { l += lab[0]; a += lab[1]; b += lab[2]; }
  const n = labs.length;
  return [l / n, a / n, b / n];
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} [options]
 * @returns {{id:string, cleanup:(ctx:object)=>{records:Array}}}
 */
export function createConservativeCleanup(options = {}) {
  const opts = { ...DEFAULT_CONSERVATIVE_CLEANUP_OPTIONS, ...options };
  const id = options.id || CONSERVATIVE_CLEANUP_ID;
  return {
    id,
    cleanup(ctx) {
      const {
        grid, getColorKey, getRGB, protectionMap, tierMap, getSourceEvidence,
        source, width, height, cellBounds,
      } = ctx;
      const records = [];
      const stat = {
        components: 0,
        cleanedComponents: 0,
        cleanedCells: 0,
        skippedTooBig: 0,
        skippedProtectedTier: 0,
        skippedEvidence: 0,
        skippedNoReplacement: 0,
        skippedStructure: 0,
        skippedErrorDelta: 0,
        skippedNeighborSupport: 0,
        protectTier: opts.protectTier,
        splitGuard: true,
      };

      const components = findConnectedComponents(grid, getColorKey);
  const srcLabCache = new Map();
  // `cellBounds` 六参全给：`source.width/height` 和网格 `width/height` 这里都有。
  // 接缝约定的是两参版本，但六参调用在两参实现上只是多传几个被忽略的实参 ——
  // 两种形状都能work，而两参调用在六参原件上会静默得到 NaN。
  // 这个失效形状见过一次：整条 §10 变成空操作，指标上只表现为「碎片变多」。
  const boundsOf = (x, y) => cellBounds(x, y, source.width, source.height, width, height);
  const labOf = (x, y) => {
    const key = y * width + x;
    if (!srcLabCache.has(key)) srcLabCache.set(key, sourceCellLab(source, boundsOf(x, y)));
    return srcLabCache.get(key);
  };
      const edgeMap = ctx.protection?.edgeMap || null;

      for (const component of components) {
        stat.components += 1;
        if (component.cells.length > opts.maxComponentSize) { stat.skippedTooBig += 1; continue; }
        const n = component.cells.length;

        // ① 保护分层：生产只挡 tier >= 4，这里挡 tier >= 3
        if (tierMap && component.cells.some((c) => tierMap[c.y * width + c.x] >= opts.protectTier)) {
          stat.skippedProtectedTier += 1;
          continue;
        }
        // 沿用生产的 source evidence 门（同一个函数、同一个门槛，不另立标准）。
        // 生产用**块均值**，这里也用块均值 —— 逐格判会让「一块里 3 格低 2 格高」
        // 这种块漏出去，而那正是「小而真」最典型的形状。
        if (getSourceEvidence) {
          let evidenceSum = 0;
          let evidenceCount = 0;
          for (const { x, y } of component.cells) {
            const rgb = getRGB(grid[y][x]);
            if (!rgb) continue;
            evidenceSum += getSourceEvidence(x, y, rgb);
            evidenceCount += 1;
          }
          if (evidenceCount && evidenceSum / evidenceCount >= opts.sourceEvidenceThreshold) {
            stat.skippedEvidence += 1;
            continue;
          }
        }

        // ── sourceContrast：本块源图色 vs 周围源图色 ──
        const ownLabs = [];
        for (const c of component.cells) {
          const lab = labOf(c.x, c.y);
          if (lab) ownLabs.push(lab);
        }
        if (!ownLabs.length) { stat.skippedStructure += 1; continue; }
        const ownMean = meanLab(ownLabs);

        const surroundLabs = [];
        const surroundSeen = new Set();
        for (const { x, y } of component.cells) {
          for (const [dx, dy] of EIGHT_OFFSETS) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ncell = grid[ny][nx];
            if (!ncell) continue;
            if (getColorKey(ncell) === component.key) continue;
            const nkey = ny * width + nx;
            if (surroundSeen.has(nkey)) continue;
            surroundSeen.add(nkey);
            const lab = labOf(nx, ny);
            if (lab) surroundLabs.push(lab);
          }
        }
        const surroundMean = surroundLabs.length ? meanLab(surroundLabs) : null;
        const sourceContrast = surroundMean ? deltaE2000(ownMean, surroundMean) : 0;

        // ── edgeSupport：保护图 / 边缘图强度 ──
        let protectionSum = 0;
        let edgeSum = 0;
        for (const c of component.cells) {
          const idx = c.y * width + c.x;
          protectionSum += protectionMap ? protectionMap[idx] : 0;
          edgeSum += edgeMap ? edgeMap[idx] : 0;
        }
        const edgeSupport = Math.max(protectionSum / n, edgeSum / n);

        // ── structureScore ──
        const contrastScore = clamp01(sourceContrast / opts.contrastScale);
        const edgeScore = clamp01(edgeSupport / opts.edgeScale);
        const sizeScore = clamp01(n / opts.maxComponentSize);
        const structureScore = opts.wContrast * contrastScore + opts.wEdge * edgeScore + opts.wSize * sizeScore;
        if (structureScore >= opts.structureThreshold) { stat.skippedStructure += 1; continue; }

        // ── ④ 整块一个替换色：候选 = 边界邻域里**实际出现过**的色 ──
        // 「实际出现过」是硬条件：选一个邻域里没有的色，块替换完还是孤岛，
        // 那和「清理」的目的正好相反。
        const candidates = new Map(); // code -> { code, cell, contacts }
        for (const { x, y } of component.cells) {
          for (const [dx, dy] of EIGHT_OFFSETS) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ncell = grid[ny][nx];
            if (!ncell) continue;
            const ncode = getColorKey(ncell);
            if (ncode === component.key) continue;
            const entry = candidates.get(ncode);
            if (entry) entry.contacts += 1;
            else candidates.set(ncode, { code: ncode, cell: ncell, contacts: 1 });
          }
        }
        if (!candidates.size) { stat.skippedNoReplacement += 1; continue; }

        const budget = n <= opts.tinySize ? opts.tinyErrorBudget : opts.errorBudget;
        const scored = [];
        for (const entry of candidates.values()) {
          if (entry.contacts < opts.minNeighborSupport) continue;
          const replRgb = getRGB(entry.cell);
          if (!replRgb) continue;
          const replLab = rgbToLab(replRgb);
          let errorDelta = 0;
          let paletteDistance = 0;
          let counted = 0;
          for (const c of component.cells) {
            const srcLab = labOf(c.x, c.y);
            const ownRgb = getRGB(grid[c.y][c.x]);
            if (!srcLab || !ownRgb) continue;
            const ownLab = rgbToLab(ownRgb);
            errorDelta += deltaE2000(srcLab, replLab) - deltaE2000(srcLab, ownLab);
            paletteDistance += deltaE2000(ownLab, replLab);
            counted += 1;
          }
          if (!counted) continue;
          const meanErrorDelta = errorDelta / counted;
          const meanPaletteDistance = paletteDistance / counted;
          scored.push({
            entry,
            meanErrorDelta,
            meanPaletteDistance,
            // 与生产 `findReplacement` 同形的打分：源图误差增幅 − 邻域支持奖励
            score: meanErrorDelta - Math.min(opts.supportBonusCap, entry.contacts * opts.supportBonusPerContact),
          });
        }
        if (!scored.length) { stat.skippedNeighborSupport += 1; continue; }

        // 误差预算先过门，再在过门的候选里挑分数最低的。
        // 顺序不能反：先挑最低分再查预算，会把「分数最低但误差超预算」的候选
        // 判成「无候选可换」，从而漏掉一个完全合规的次优候选。
        const affordable = scored.filter((s) => s.meanErrorDelta <= budget);
        if (!affordable.length) { stat.skippedErrorDelta += 1; continue; }
        affordable.sort((a, b) => a.score - b.score || (a.entry.code < b.entry.code ? -1 : a.entry.code > b.entry.code ? 1 : 0));
        const pick = affordable[0];

        for (const { x, y } of component.cells) {
          const cell = grid[y][x];
          const before = { ...cell, rgb: Array.isArray(cell.rgb) ? [...cell.rgb] : cell.rgb };
          grid[y][x] = { ...pick.entry.cell };
          records.push({
            x, y,
            before,
            after: grid[y][x],
            reason: "conservative-cleanup",
            componentSize: n,
            sourceContrast: round1(sourceContrast),
            edgeSupport: round1(edgeSupport),
            structureScore: round2(structureScore),
            neighborSupport: pick.entry.contacts,
            paletteDistance: round1(pick.meanPaletteDistance),
            replacementErrorDelta: round2(pick.meanErrorDelta),
            errorBudget: budget,
            // 同一连通块的所有格共用同一个替换色 —— 这是 ④ 的可验证痕迹
            componentColor: pick.entry.code,
          });
        }
        stat.cleanedComponents += 1;
        stat.cleanedCells += n;
      }

      ctx.report.conservativeCleanup = stat;
      return { records };
    },
  };
}

export default { createConservativeCleanup, CONSERVATIVE_CLEANUP_ID, DEFAULT_CONSERVATIVE_CLEANUP_OPTIONS };
