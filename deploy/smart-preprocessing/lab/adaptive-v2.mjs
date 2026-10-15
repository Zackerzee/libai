/**
 * 阶段 4 实验 1 —— 色卡感知自适应采样（Lab，**不进生产**）。
 *
 * ── 要回答的问题 ──────────────────────────────────────────────────────
 * 生产的 AUTO 采样是「按内容预设权重，逐格在 linear-mean / center / dominant /
 * edge-aware 之间选一个」（`sampling-engine-v2.sampleGridAdaptive`）。选择的依据是
 * **格内像素的边缘证据**（edgeScore / cluster separation），与色卡无关。
 *
 * 这个候选换一个依据：**色卡结构**。
 *   · 格内主要颜色桶的最近色卡项**是同一个** → 这一格无论怎么采都落在同一个色号上，
 *     用均值（最稳、最不抖）；
 *   · 主要颜色桶指向**不同**色卡项 → 这一格是「两个色号的交界」，
 *     用占比最高的那个桶自己的颜色（保住结构，不让均值把它抹成不存在的中间色）。
 *
 * ── 为什么这是可判定的实验 ────────────────────────────────────────────
 * 两条路径的取舍方向不同且可测：
 *   · meanPath 在**平色区**上应该与生产一致（ΔE 不变、用色不涨）；
 *   · dominantPath 在**交界格**上应该提高 edgeRetention，代价可能是 ΔE 略升；
 *   · 若两类都不变 → 说明色卡结构信息在这一步没有增量（REJECT 的合法理由）。
 *
 * ── 与 Bean Fit 的关系（为什么不是重复实验）───────────────────────────
 * Bean Fit 改的是**匹配成本函数**（加权 ΔE2000 选色号）；本候选改的是
 * **采样出口的颜色**（均值 vs 主桶），之后仍走生产的 `paletteEngine.match`。
 * 两者的改动点不同，可以叠加，也可以各自独立判定。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────
 *   · deterministic：桶排序、色卡短名单、平票都由 index 兜底；
 *   · null-safe：无有效像素 / 桶为空 / 主桶占比不足 → 返回 `undefined`
 *     （「我没意见」），让接缝退回生产匹配器并计数；
 *   · maxColors-safe：只返回色卡表里的 entry（`entry.color`），
 *     不可能引入色卡外的色号，也不会丢 `paletteId` 身份。
 */

import {
  paletteLabTable, buildLabBuckets, topBuckets, nearestEntries,
  forEachCellPixel, rgbToLab, deltaE2000, LAB_ALPHA_THRESHOLD,
} from "./buckets.mjs";

export const ADAPTIVE_V2_ID = "adaptive-v2";

export const DEFAULT_ADAPTIVE_V2_OPTIONS = Object.freeze({
  // 少于这么多不透明像素的格没有统计意义 → 弃权
  minOpaquePixels: 4,
  topBucketCount: 3,
  minBucketShare: 0.08,
  bucketStep: 10,
  // 主桶占比低于该值 → 这格没有明确的「主色」，交给生产
  dominantShare: 0.5,
  // 与生产答案不同的最小 ΔE 才算 switched，避免浮点噪声被记成一次切换
  switchEpsilon: 0.5,
});

/**
 * 格内不透明像素的 RGB 均值（四舍五入到整数）。
 *
 * 用 RGB 直接求均值而**不是**「Lab 均值再转回 RGB」：
 * 后者要走一次往返近似，而生产 linear-mean 的口径就是 RGB 均值 ——
 * 口径不一致的话，平色格上的差异会有一部分来自转换误差，无法归因。
 */
function meanRgbOfCell(source, bounds) {
  let r = 0, g = 0, b = 0, n = 0;
  forEachCellPixel(source, bounds, (pr, pg, pb, pa) => {
    if (pa <= LAB_ALPHA_THRESHOLD) return;
    r += pr; g += pg; b += pb; n += 1;
  });
  if (!n) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function createAdaptiveV2({ id = ADAPTIVE_V2_ID, ...overrides } = {}) {
  const opts = { ...DEFAULT_ADAPTIVE_V2_OPTIONS, ...overrides };

  return {
    id,
    matchCell(ctx) {
      const { source, bounds, palette, paletteEngine, report } = ctx;
      const table = paletteLabTable(palette);
      if (!table.length || !paletteEngine) return undefined;

      const stat = (report.adaptiveV2 = report.adaptiveV2 || {
        cells: 0, meanPath: 0, dominantPath: 0, abstained: 0,
        switched: 0, noPalette: 0, subEpsilonSwitch: 0,
        topBucketCount: opts.topBucketCount, dominantShare: opts.dominantShare,
      });
      stat.cells += 1;

      const { opaque, buckets } = buildLabBuckets(source, bounds, { bucketStep: opts.bucketStep });
      if (opaque < opts.minOpaquePixels || !buckets.length) { stat.abstained += 1; return undefined; }

      const kept = topBuckets(buckets, opts.topBucketCount, opts.minBucketShare);
      if (!kept.length) { stat.abstained += 1; return undefined; }

      // 每个主桶的最近色卡项 —— 离散判据（按 code 比较），不再引入第二个 ΔE 门
      const codes = new Set(
        kept.map((bucket) => nearestEntries(bucket.lab, table, 1)[0]?.code).filter(Boolean),
      );

      const production = paletteEngine.match([ctx.rgb.r, ctx.rgb.g, ctx.rgb.b]);
      let produced = null;

      if (codes.size <= 1) {
        // 同一个色卡项 → 均值路径（最稳）
        const meanRgb = meanRgbOfCell(source, bounds);
        if (!meanRgb) { stat.abstained += 1; return undefined; }
        produced = paletteEngine.match(meanRgb);
        stat.meanPath += 1;
      } else {
        // 跨色卡项 → 主桶路径（保结构），主桶不够明确就弃权
        if (kept[0].share < opts.dominantShare) { stat.abstained += 1; return undefined; }
        produced = paletteEngine.match(kept[0].rgb);
        stat.dominantPath += 1;
      }

      if (!produced) { stat.noPalette += 1; return undefined; }

      if (production && produced.code !== production.code) {
        const delta = deltaE2000(rgbToLab(produced.rgb), rgbToLab(production.rgb));
        if (delta >= opts.switchEpsilon) stat.switched += 1;
        else stat.subEpsilonSwitch += 1;
      }
      return produced.color ?? produced;
    },
  };
}
