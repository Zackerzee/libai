/**
 * 阶段 4 实验 2 —— 色差预筛（Lab，**不进生产**）。
 *
 * ── 要回答的问题 ──────────────────────────────────────────────────────
 * 生产对**每一格**都走完整的采样出口 + `paletteEngine.match`（ΔE2000 + 候选短名单
 * + 肤色/中性/暖红三套上下文修正）。但图纸里大量格子是**真正的单色格**
 * （平色区、色块内部、像素画的实心块）—— 这些格上：
 *   · 任何采样策略（center / dominant / mean / edge-aware）都给出同一个颜色；
 *   · 上下文修正没有可修正的东西（没有第二种颜色可以混淆）。
 *
 * 本候选做一次**色差预筛**：先用「格内像素相对均值的最大 ΔE」和
 * 「落在容差内的像素占比」两个量，判定这一格是不是单色格；
 * 是 → 直接 `match(均值)` 并返回（快路径）；不是 → 返回 `undefined` 交给生产。
 *
 * ── 判定它有没有用的两个量（缺一不可）─────────────────────────────────
 *   ① **gridHash 是否与生产逐位一致**：单色格上的快路径**必须**与生产同答案。
 *      若不一致，说明生产的上下文修正在单色格上改了东西 —— 那本身是个发现，
 *      但要靠 ΔE 判定哪边更好，不能默认快路径更好。
 *   ② **timingMs 是否真的下降**：预筛的两次格内遍历不便宜，
 *      若净收益为负，这个实验的结论就是 REJECT（没有免费的午餐）。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────
 *   · 只返回色卡 entry（`entry.color`），不可能造色；
 *   · 不确定就弃权（`undefined`）并计数，不猜；
 *   · 阈值全部写进诊断，报告里能回答「预筛在什么参数下过的」。
 */

import { forEachCellPixel, rgbToLab, deltaE2000, LAB_ALPHA_THRESHOLD } from "./buckets.mjs";

export const CHROMA_PRESCREEN_ID = "chroma-prescreen";

export const DEFAULT_CHROMA_PRESCREEN_OPTIONS = Object.freeze({
  minOpaquePixels: 4,
  // 格内像素到均值的最大 ΔE 不超过它 → 单色格
  spreadThreshold: 3.0,
  // 且至少这么高比例的像素落在均值的 spreadThreshold 内（防「一半纯色一半异色」）
  withinShareThreshold: 0.95,
});

export function createChromaPrescreen({ id = CHROMA_PRESCREEN_ID, ...overrides } = {}) {
  const opts = { ...DEFAULT_CHROMA_PRESCREEN_OPTIONS, ...overrides };

  return {
    id,
    matchCell(ctx) {
      const { source, bounds, paletteEngine, report } = ctx;
      if (!paletteEngine) return undefined;

      const stat = (report.chromaPrescreen = report.chromaPrescreen || {
        cells: 0, passed: 0, rejected: 0, noPixels: 0, switched: 0,
        spreadSum: 0, spreadThreshold: opts.spreadThreshold,
        withinShareThreshold: opts.withinShareThreshold,
      });
      stat.cells += 1;

      // Pass 1：均值
      let r = 0, g = 0, b = 0, n = 0;
      forEachCellPixel(source, bounds, (pr, pg, pb, pa) => {
        if (pa <= LAB_ALPHA_THRESHOLD) return;
        r += pr; g += pg; b += pb; n += 1;
      });
      if (n < opts.minOpaquePixels) { stat.noPixels += 1; return undefined; }
      const meanRgb = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      const meanLab = rgbToLab(meanRgb);

      // Pass 2：最大偏差 + 容差内占比
      let maxDelta = 0, within = 0;
      forEachCellPixel(source, bounds, (pr, pg, pb, pa) => {
        if (pa <= LAB_ALPHA_THRESHOLD) return;
        const d = deltaE2000(rgbToLab([pr, pg, pb]), meanLab);
        if (d > maxDelta) maxDelta = d;
        if (d <= opts.spreadThreshold) within += 1;
      });
      stat.spreadSum += maxDelta;

      const singleColor = maxDelta <= opts.spreadThreshold
        && (within / n) >= opts.withinShareThreshold;
      if (!singleColor) { stat.rejected += 1; return undefined; }

      const produced = paletteEngine.match(meanRgb);
      if (!produced) { stat.rejected += 1; return undefined; }

      const production = paletteEngine.match([ctx.rgb.r, ctx.rgb.g, ctx.rgb.b]);
      if (production && produced.code !== production.code) {
        const delta = deltaE2000(rgbToLab(produced.rgb), rgbToLab(production.rgb));
        if (delta >= 0.5) stat.switched += 1;
      }
      stat.passed += 1;
      return produced.color ?? produced;
    },
  };
}
