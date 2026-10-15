/**
 * 阶段 4 实验 3 —— 真实色板限色（Lab，**不进生产**）。
 *
 * ── 要回答的问题 ──────────────────────────────────────────────────────
 * 生成现在默认在**整张色卡**（如优肯 C197 / MARD 221）里做 ΔE2000 匹配。
 * 但真实用户手上往往只有一盒小套装（24 / 48 / 96 色）。问题是：
 * **限制到一盒真实色板，质量代价有多大、代价落在哪一类图上？**
 *
 * 这个候选把匹配限制在一个**从色卡里选出的确定性子集**（kit）内：
 *   · kit 用「最远点采样」在 Lab 空间里选 —— 从最接近整体质心的色开始，
 *     每次加入「离已选集合最远」的那一色，直到 kitSize。
 *     这是覆盖最大化的贪心，比「取前 N 色」更公平（不依赖色卡排列顺序）；
 *   · 匹配只在 kit 内做 ΔE2000。
 *
 * ── 为什么这是**测量**而不是「优化」───────────────────────────────────
 * 限色按定义不可能让 ΔE 变好（kit ⊂ 全色卡）。这个实验的价值在决策表：
 *   · 哪些类（平色 / 扁平插画 / 6 色图案）几乎无损 → 限色可以进产品；
 *   · 哪些类（人像肤色渐变 / 灰阶 / 金纹）代价大 → 限色要提示或禁用；
 *   · 代价随 kitSize 的曲线（24 / 48 / 96）决定「最小可用套装」是多少色。
 *
 * 有了这张表，「限制为我的色板 / 库存色板」这个产品功能才有据可依；
 * 没有它，那个功能只能靠猜。**它同时是 REJECT 的证据来源** ——
 * 若代价在任何 kitSize 上都不划算，结论就是不要做这个功能。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────
 *   · kit 选择 deterministic（平票按 index）；
 *   · 只返回色卡 entry（`entry.color`）；
 *   · 诊断里给出 penalty 分布，报告能回答「代价是哪几格付的」。
 */

import { paletteLabTable, rgbToLab, deltaE2000 } from "./buckets.mjs";

export const KIT_LIMIT_ID = "kit-limit";

export const DEFAULT_KIT_LIMIT_OPTIONS = Object.freeze({
  kitSize: 48,
  // 相对生产答案的 ΔE 超过它才算「明显变差」
  penaltyThreshold: 2.0,
});

/** kit 选择结果按「色卡数组 + kitSize」缓存（同一张色卡在同一轮里反复用）。 */
const KIT_CACHE = new WeakMap();

/**
 * 最远点采样选 kit。
 *
 * @param {Array<{code:string, rgb:number[], lab:number[]}>} table paletteLabTable 的输出
 * @param {number} kitSize
 * @returns {Array<{code:string, rgb:number[], lab:number[]}>}
 */
export function selectKit(table, kitSize) {
  const size = Math.max(1, Math.min(table.length, Math.floor(kitSize) || 1));
  if (size >= table.length) return table.slice();
  let perPalette = KIT_CACHE.get(table);
  if (!perPalette) { perPalette = new Map(); KIT_CACHE.set(table, perPalette); }
  const cached = perPalette.get(size);
  if (cached) return cached;

  // 起点：离整体 Lab 质心最近的一色（平票取 index 小者）
  let cl = 0, ca = 0, cb = 0;
  for (const entry of table) { cl += entry.lab[0]; ca += entry.lab[1]; cb += entry.lab[2]; }
  cl /= table.length; ca /= table.length; cb /= table.length;
  let first = table[0], firstD = Infinity;
  for (const entry of table) {
    const dl = entry.lab[0] - cl, da = entry.lab[1] - ca, db = entry.lab[2] - cb;
    const d = dl * dl + da * da + db * db;
    if (d < firstD) { firstD = d; first = entry; }
  }

  const chosen = [first];
  const chosenCodes = new Set([first.code]);
  // 每个色到已选集合的最小 ΔE，增量更新
  const minDelta = new Map();
  for (const entry of table) {
    if (chosenCodes.has(entry.code)) continue;
    minDelta.set(entry.code, deltaE2000(entry.lab, first.lab));
  }

  while (chosen.length < size) {
    let best = null, bestDelta = -Infinity;
    for (const entry of table) {
      if (chosenCodes.has(entry.code)) continue;
      const d = minDelta.get(entry.code) ?? 0;
      // 平票按 index 小者 —— 保证与遍历顺序无关
      if (d > bestDelta || (d === bestDelta && best && entry.index < best.index)) {
        best = entry; bestDelta = d;
      }
    }
    if (!best) break;
    chosen.push(best);
    chosenCodes.add(best.code);
    for (const entry of table) {
      if (chosenCodes.has(entry.code)) continue;
      const d = deltaE2000(entry.lab, best.lab);
      const prev = minDelta.get(entry.code);
      if (prev === undefined || d < prev) minDelta.set(entry.code, d);
    }
  }
  perPalette.set(size, chosen);
  return chosen;
}

export function createKitLimit({ id = KIT_LIMIT_ID, kitSize, ...overrides } = {}) {
  const opts = { ...DEFAULT_KIT_LIMIT_OPTIONS, ...overrides, ...(kitSize ? { kitSize } : {}) };

  return {
    id,
    matchCell(ctx) {
      const { palette, paletteEngine, rgb, report } = ctx;
      const table = paletteLabTable(palette);
      if (!table.length) return undefined;

      const kit = selectKit(table, opts.kitSize);
      const stat = (report.kitLimit = report.kitLimit || {
        cells: 0, kitSize: kit.length, paletteSize: table.length,
        changed: 0, penaltySum: 0, penaltyMax: 0, penaltyMin: 0,
        forcedWorse: 0, forcedBetter: 0,
        outsideKitProduction: 0, penaltyThreshold: opts.penaltyThreshold,
      });
      stat.cells += 1;

      const sourceLab = rgbToLab([rgb.r, rgb.g, rgb.b]);
      let best = kit[0], bestDelta = Infinity;
      for (const entry of kit) {
        const d = deltaE2000(sourceLab, entry.lab);
        if (d < bestDelta) { bestDelta = d; best = entry; }
      }

      const production = paletteEngine ? paletteEngine.match([rgb.r, rgb.g, rgb.b]) : null;
      if (production) {
        if (!kit.some((entry) => entry.code === production.code)) stat.outsideKitProduction += 1;
        if (production.code !== best.code) {
          // `paletteEngine.match` 返回的是**原始色卡项**（code/rgb/group），没有 lab ——
          // 拿 `production.lab` 会得到 undefined，`deltaE2000` 立刻抛
          // 「labB is not iterable」。生产项的 lab 必须自己算。
          //
          // ── penalty 的符号（踩过一次）─────────────────────────────────
          //   penalty = dist(源→生产答案) − dist(源→kit 答案)
          //     penalty > 0 → 生产答案更远 → **限色后更好**
          //     penalty < 0 → kit 答案更远 → **限色后更差**
          // 早先实现把 `forcedWorse` 写成 `penalty > threshold`，于是它统计的是
          // 「限色更好」的格数，而名字读起来是「更差」—— 一个数字合理、
          // 方向相反、报告里完全看不出来的失效形状。两个方向分开计数。
          const penalty = deltaE2000(sourceLab, rgbToLab(production.rgb)) - bestDelta;
          stat.changed += 1;
          stat.penaltySum += penalty;
          if (penalty > stat.penaltyMax) stat.penaltyMax = penalty;
          if (penalty < stat.penaltyMin) stat.penaltyMin = penalty;
          if (penalty < -opts.penaltyThreshold) stat.forcedWorse += 1;
          else if (penalty > opts.penaltyThreshold) stat.forcedBetter += 1;
        }
      }
      return best.color ?? best;
    },
  };
}
