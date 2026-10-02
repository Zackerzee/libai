/**
 * §6 Bean Fit —— 候选算法（Lab，**不进生产**）。
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────────
 * 生产匹配器拿的是**格内像素的均值**（`sampling-engine-v2` 的出口）。
 * 均值有个结构性缺陷：它可能是一个格子里**根本不存在**的颜色。
 * 典型场景是「深棕头发 + 黑色眼睛」这种格：均值是一坨灰棕，
 * 它在色卡上最近的邻居离头发和眼睛都很远 —— 于是这一格既不像头发也不像眼睛。
 *
 * Bean Fit 换一个口径：不看均值，看**像素分布**。
 *   格内像素 → Lab 分桶 → 取权重最高的 3–4 桶 → 候选预筛 → 加权 CIEDE2000
 *   成本 = Σ 桶权重 × ΔE2000(桶, 候选)
 *
 * 直觉：一个候选色如果对「占比 70% 的主桶」和「占比 30% 的次桶」都还行，
 * 它的加权成本就低；而均值色往往对两个桶都不行。
 *
 * ── 三条硬约束（§6 原文）─────────────────────────────────────────────
 *   · 不遍历每像素 × 全色板 → 分桶是 O(像素)，预筛是 O(桶 × 色卡)，
 *     真正的 CIEDE2000 只算在 8–16 个候选上。见 `prefilterCandidates` 的注释。
 *   · deterministic → 分桶和预筛都有第二排序键，不依赖 Map 迭代顺序。
 *   · null-safe → 无有效像素时返回 `undefined`（「我没意见」），
 *     让接缝退回生产匹配器，而不是凭空造一个色。
 *   · maxColors-safe → 候选**只可能来自色卡表**，表本身用与 `PaletteEngine`
 *     逐字一致的过滤口径（`available !== false`）。所以它不可能引入色卡外的色号。
 *
 * ── 关于 `contextBias`（唯一一个不来自 §6 原文的项）─────────────────
 * §6 给的成本函数是纯加权 ΔE2000。但生产匹配器在 ΔE2000 之上还有三套上下文修正：
 * 肤色（`skinPenalty`）、中性（`region === "neutral"`）、暖红（`region === "warm-red"`）。
 * Bean Fit 的成本里没有这些项，直接比会让它在肤色区**系统性输给**生产答案 ——
 * 那不是算法优劣，是少了一个修正项。
 *
 * 处理方式：给生产答案一个乘性折扣（默认 0.85）。这是显式的、可关的
 * （设 `contextBias: 1` 即纯 §6 口径），并且会写进报告的 detail，
 * 所以「Bean Fit 在肤色区到底靠什么赢的」是可以追问的，不是黑箱。
 * 折扣而不是「肤色就走生产」那种 if —— 后者是给单个夹具开的后门，§0 明令禁止。
 */

import { paletteLabTable, buildLabBuckets, topBuckets, weightedBucketCost, prefilterCandidates, rgbToLab, deltaE2000 } from "./buckets.mjs";
import { neutralPenalty, shouldApplyNeutral } from "./neutral-protection.mjs";

export const BEAN_FIT_ID = "bean-fit";

export const DEFAULT_BEAN_FIT_OPTIONS = Object.freeze({
  topBucketCount: 4,
  minBucketShare: 0.08,
  bucketStep: 10,
  poolSize: 12,
  perBucket: 4,
  // **乘在生产成本上**的折扣：`productionCost × contextBias ≤ beanCost` 时生产胜出。
  //   = 1    纯比较，谁成本低谁赢（= 纯 §6 口径）
  //   < 1    生产被折扣，更容易赢。0.85 表示「允许生产贵 17.6% 仍算它赢」
  //   → 0    生产必定赢
  // 方向别记反：是**压低生产侧的成本**，不是抬高。
  contextBias: 0.85,
  // 少于这么多不透明像素就不表态。104 格网下每格约 25 像素，
  // 但降采样到 500 格网时每格 1 像素 —— 那时分桶没有意义，退回生产更诚实。
  minOpaquePixels: 2,
  // §11 的 `BeanFit+Neutral` 就是把这个打开：往同一个成本函数里加中性惩罚项。
  // **不新增第二个匹配器** —— 两个匹配器各算一套成本再比大小，
  // 得到的既不是 Bean Fit 也不是 Neutral，而是「谁的偏置更强」。
  // 传对象即启用（内容见 neutral-protection 的 DEFAULT_NEUTRAL_OPTIONS）。
  neutral: null,
});

/**
 * @param {object} [options]
 * @returns {{id:string, matchCell:(ctx:object)=>object|undefined, report:object}}
 */
export function createBeanFit(options = {}) {
  const opts = { ...DEFAULT_BEAN_FIT_OPTIONS, ...options };
  const id = options.id || BEAN_FIT_ID;
  return {
    id,
    matchCell(ctx) {
      const { source, bounds, palette, paletteEngine, report } = ctx;
      const table = paletteLabTable(palette);
      if (!table.length) return undefined;

      const { opaque, buckets } = buildLabBuckets(source, bounds, { bucketStep: opts.bucketStep });
      if (opaque < opts.minOpaquePixels || !buckets.length) return undefined;

      const kept = topBuckets(buckets, opts.topBucketCount, opts.minBucketShare);
      if (!kept.length) return undefined;

      const pool = prefilterCandidates(kept, table, opts.poolSize, opts.perBucket);
      if (!pool.length) return undefined;

      // 生产答案也进候选池 —— 否则「Bean Fit 在平色格上和生产不一致」这件事
      // 会被记成一次改动，而实际上两者本该一致。让它们同台比成本，
      // 平色格自然收敛到同一个答案，报告的 switched 计数才有意义。
      const production = paletteEngine ? paletteEngine.match([ctx.rgb.r, ctx.rgb.g, ctx.rgb.b]) : null;

      // §11 组合：中性惩罚是**加在同一个成本函数上的一项**，不是第二个匹配器。
      const neutralOpts = opts.neutral || null;
      const sourceLab = neutralOpts ? rgbToLab([ctx.rgb.r, ctx.rgb.g, ctx.rgb.b]) : null;
      const useNeutral = Boolean(neutralOpts)
        && shouldApplyNeutral([ctx.rgb.r, ctx.rgb.g, ctx.rgb.b], sourceLab, neutralOpts);
      const costOf = (entry) => weightedBucketCost(kept, entry.lab)
        + (useNeutral ? neutralPenalty(entry.lab, neutralOpts) : 0);

      let best = null;
      let bestCost = Infinity;
      let productionCost = Infinity;
      for (const entry of pool) {
        const cost = costOf(entry);
        if (entry.color === production) productionCost = Math.min(productionCost, cost);
        if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && best && entry.index < best.index)) {
          bestCost = cost;
          best = entry;
        }
      }
      if (!best) return undefined;

      // 生产答案即使不在池子里也要能参与比较 —— 它在池外说明预筛把它筛掉了，
      // 那就更要显式算一次，否则「Bean Fit 赢了生产」可能是预筛作弊。
      if (production && productionCost === Infinity) {
        const entry = table.find((e) => e.color === production);
        if (entry) productionCost = costOf(entry);
      }

      const stat = (report.beanFit = report.beanFit || {
        cells: 0, switched: 0, costBefore: 0, costAfter: 0, neutralApplied: 0,
        contextBias: opts.contextBias, topBucketCount: opts.topBucketCount,
        neutral: Boolean(neutralOpts),
      });
      stat.cells += 1;
      if (useNeutral) stat.neutralApplied += 1;

      const biasedProduction = Number.isFinite(productionCost) ? productionCost * opts.contextBias : Infinity;
      let chosen = best;
      let chosenCost = bestCost;
      if (production && biasedProduction <= bestCost) {
        chosenCost = productionCost;
        chosen = table.find((e) => e.color === production) || best;
      }

      stat.costBefore += Number.isFinite(productionCost) ? productionCost : chosenCost;
      stat.costAfter += chosenCost;
      if (!production || chosen.color !== production) stat.switched += 1;

      return chosen.color;
    },
  };
}

export default { createBeanFit, BEAN_FIT_ID, DEFAULT_BEAN_FIT_OPTIONS, deltaE2000 };
