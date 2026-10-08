/**
 * §8 Neutral Protection —— 候选算法（Lab，**不进生产**）。
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────────
 * 近中性源色（灰、白、浅灰蓝）在 CIEDE2000 里没有「色相偏好」——
 * 一个饱和度 60 的颜色和一个饱和度 8 的颜色，只要 ΔE 差不多，就被视为同样接近。
 * 结果是一片灰墙被撒上高饱和色点：**每一格单独看都「最近」，整片看全是噪点**。
 *
 * Neutral Protection 给成本加一项：源色接近中性时，惩罚高饱和候选。
 *   finalCost = ΔE2000 + neutralPenalty
 *
 * ── 四条硬约束（§8 原文）──────────────────────────────────────────────
 *   ① neutralPenalty **只在** `sourceChroma < threshold` 时生效
 *   ② **ΔE2000 仍是主距离** → 惩罚有上限（`maxPenalty`），且不是乘性权重
 *   ③ **不允许 neutral penalty 压倒明显更接近的真实色** → `overrideBudget`
 *   ④ **skin 继续走 skin protection / 肤色不能归 neutral** → `skinGuard`
 *
 * 第 ③ 条是这里最容易做错的地方，也是「加个惩罚项」这类改动最常见的翻车方式。
 * 本实现的做法是：先算**纯 ΔE 的最优**，再算**加了惩罚的最优**。
 * 只有当「换答案的代价」不超过 `overrideBudget`（ΔE 口径）时才接受换。
 * 也就是说惩罚最多只能改变 5 个 ΔE 以内的决策 —— 一个 ΔE 2 的真近色
 * 不会被一个 ΔE 8 的「更中性」色顶掉。这不是调参，是量纲上划的界。
 *
 * 第 ④ 条用 `skinToneScore` 显式挡在门外，而不是「希望肤色不满足中性条件」——
 * 深肤色（L 低、chroma 也不高）完全可能落在中性区间里，
 * 靠条件巧合去挡，迟早会漏。
 */

import {
  paletteLabTable, nearestEntries, rgbToLab, deltaE2000, labChroma, skinToneScore,
} from "./buckets.mjs";

export const NEUTRAL_PROTECTION_ID = "neutral-protection";

export const DEFAULT_NEUTRAL_OPTIONS = Object.freeze({
  // 源色色度低于它才进入中性保护。Lab 色度：纯灰是 0，肤色通常在 25–45。
  chromaThreshold: 12,
  // 候选色色度超过它就开始罚。8 大致是「肉眼能看出有颜色」的门槛。
  chromaCap: 8,
  // 每单位超出色度的惩罚量（ΔE 口径）。
  strength: 0.6,
  // 惩罚上限（ΔE 口径）。**约束 ② 的实现**：有上限才谈得上「ΔE2000 仍是主距离」。
  maxPenalty: 12,
  // **约束 ③ 的实现**：换答案最多允许付出这么多 ΔE 的代价。
  overrideBudget: 5,
  // **约束 ④ 的实现**：肤色评分高于它就完全不管。
  // 用 0.4 而不是 `isSkinTone` 的 0.5 —— 宁可多放过一些偏肤色，也不要误伤。
  skinGuard: 0.4,
  // 候选池大小（含生产答案）。见 `nearestEntries` 的注释。
  poolSize: 16,
});

/**
 * 是否该对这条源色启用中性保护。导出是为了让 §11 的组合（BeanFit+Neutral）
 * 用**同一个门**，而不是各写一份条件 —— 两份条件迟早会漂移成
 * 「单独跑 Neutral 有保护、组合跑就没有」。
 */
export function shouldApplyNeutral(sourceRgb, sourceLab, options = {}) {
  const { chromaThreshold, skinGuard } = { ...DEFAULT_NEUTRAL_OPTIONS, ...options };
  if (skinToneScore(sourceRgb) >= skinGuard) return false;
  return labChroma(sourceLab) < chromaThreshold;
}

/** 惩罚项本身。**只依赖候选色度**，不依赖 ΔE —— 保持两个量纲可加。 */
export function neutralPenalty(candidateLab, options = {}) {
  const { chromaCap, strength, maxPenalty } = { ...DEFAULT_NEUTRAL_OPTIONS, ...options };
  const excess = labChroma(candidateLab) - chromaCap;
  if (excess <= 0) return 0;
  return Math.min(maxPenalty, excess * strength);
}

/**
 * 在候选池里选一个：先算纯 ΔE 最优，再算加罚最优，然后用 overrideBudget 裁决。
 * 抽出来是为了让独立模式（下面）和 §11 的组合走**同一条裁决逻辑**。
 *
 * @param {Array<{index:number, color:object, lab:number[]}>} pool
 * @param {number[]} sourceLab
 * @param {object} opts
 * @returns {{chosen:object, pureBest:object, penalizedBest:object, pureDelta:number,
 *            chosenDelta:number, switched:boolean, guardFired:boolean}}
 */
export function pickWithNeutralPenalty(pool, sourceLab, opts) {
  let pureBest = null;
  let pureDelta = Infinity;
  let penalizedBest = null;
  let penalizedCost = Infinity;
  for (const entry of pool) {
    const delta = deltaE2000(sourceLab, entry.lab);
    const cost = delta + neutralPenalty(entry.lab, opts);
    if (delta < pureDelta - 1e-9 || (Math.abs(delta - pureDelta) <= 1e-9 && pureBest && entry.index < pureBest.index)) {
      pureDelta = delta;
      pureBest = entry;
    }
    if (cost < penalizedCost - 1e-9 || (Math.abs(cost - penalizedCost) <= 1e-9 && penalizedBest && entry.index < penalizedBest.index)) {
      penalizedCost = cost;
      penalizedBest = entry;
    }
  }
  if (!pureBest || !penalizedBest) return null;
  const penalizedDelta = deltaE2000(sourceLab, penalizedBest.lab);
  // **约束 ③**：惩罚可以改变决策，但不能改变「差得很远的决策」。
  const budget = opts.overrideBudget ?? DEFAULT_NEUTRAL_OPTIONS.overrideBudget;
  const guardFired = penalizedBest !== pureBest && (penalizedDelta - pureDelta) > budget;
  const chosen = guardFired ? pureBest : penalizedBest;
  return {
    chosen,
    pureBest,
    penalizedBest,
    pureDelta,
    chosenDelta: guardFired ? pureDelta : penalizedDelta,
    switched: chosen !== pureBest,
    guardFired,
  };
}

/**
 * 独立模式：以**源色均值**为基准（和生产匹配器同基准），只加中性惩罚。
 * 不引入分桶 —— 这样 §11 里 `Neutral` 和 `BeanFit+Neutral` 的差异
 * 才是「成本函数里有没有分桶」这一件事，而不是两个变量一起动。
 */
export function createNeutralProtection(options = {}) {
  const opts = { ...DEFAULT_NEUTRAL_OPTIONS, ...options };
  const id = options.id || NEUTRAL_PROTECTION_ID;
  return {
    id,
    matchCell(ctx) {
      const { rgb, palette, paletteEngine, report } = ctx;
      const table = paletteLabTable(palette);
      if (!table.length || !paletteEngine) return undefined;
      const sourceRgb = [rgb.r, rgb.g, rgb.b];
      const sourceLab = rgbToLab(sourceRgb);

      const stat = (report.neutralProtection = report.neutralProtection || {
        cells: 0, gatedOut: 0, skinGated: 0, switched: 0, guardFired: 0,
        sumPenalty: 0, chromaThreshold: opts.chromaThreshold,
      });
      stat.cells += 1;
      if (!shouldApplyNeutral(sourceRgb, sourceLab, opts)) {
        stat.gatedOut += 1;
        if (skinToneScore(sourceRgb) >= opts.skinGuard) stat.skinGated += 1;
        return undefined;
      }

      const pool = nearestEntries(sourceLab, table, opts.poolSize);
      const production = paletteEngine.match(sourceRgb);
      if (production) {
        const entry = table.find((e) => e.color === production);
        if (entry && !pool.includes(entry)) pool.push(entry);
      }
      const picked = pickWithNeutralPenalty(pool, sourceLab, opts);
      if (!picked) return undefined;

      stat.sumPenalty += neutralPenalty(picked.chosen.lab, opts);
      if (picked.switched) stat.switched += 1;
      if (picked.guardFired) stat.guardFired += 1;
      return picked.chosen.color;
    },
  };
}

export default {
  createNeutralProtection,
  neutralPenalty,
  shouldApplyNeutral,
  pickWithNeutralPenalty,
  NEUTRAL_PROTECTION_ID,
  DEFAULT_NEUTRAL_OPTIONS,
};
