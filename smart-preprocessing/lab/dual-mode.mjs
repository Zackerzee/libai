/**
 * §7 Dual Mode —— 候选算法（Lab，**不进生产**）。
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────────
 * 一个格子里经常有**两群**像素，而均值落在两群之间 —— 一个色卡上不存在的颜色。
 * 最典型的是「皮肤 + 眼睛」「头发 + 高光」「描边 + 填充」。
 * 生产匹配器只能给一个答案，于是这类格子被抹成一个中间色，
 * 眼睛糊掉、高光消失、描边变灰。
 *
 * Dual Mode 的做法：认出「主模式」和「次模式」，**当次模式确实是一块结构时，
 * 这一格就交给次模式**。理由是不对称的：主模式在周围格子里已经被大量重复，
 * 少这一格不会丢信息；次模式如果这一格不画，它可能整幅图就没了（1 格眼睛）。
 *
 * ── 硬约束（§7 原文）─────────────────────────────────────────────────
 * 第二模式必须**同时**满足四条，缺一条就不表态：
 *   ① pixel share 足够          → `minSecondaryShare`
 *   ② ΔL / ΔE 足够              → `minSeparation` + `minLightnessDelta`
 *   ③ 有结构价值                → `minCoherence`（见 `bucketCoherence`）
 *   ④ 不是单个异常像素          → `minSecondaryPixels`
 *
 * 第 ③ 条是「1 个黑像素 → 整格变黑」这个失败的真正防线。
 * 只卡像素数是不够的：4 个散落的噪声像素也能凑够数，但它们的连贯性是 0。
 * 连贯性口径刻意**不惩罚 1 像素宽的直线**（回形纹、窗格、建筑细线都是这种），
 * 用「外接框填充率」会把它们全判成噪声。
 *
 * ── 内部信息不外露 ────────────────────────────────────────────────────
 * `primaryMode / secondaryMode / secondaryWeight / modeSeparation /
 * structuralConfidence` 全部只写进 `report`（落在 `diagnostics.lab.detail`），
 * 而 `lab` 在生产链路上恒为 null。所以这些字段到不了 UI —— 不是靠约定，
 * 是靠「生产模式表里根本没有 lab 这个入口」。
 */

import {
  paletteLabTable, buildLabBuckets, bucketCoherence, deltaE2000,
} from "./buckets.mjs";

export const DUAL_MODE_ID = "dual-mode";

export const DEFAULT_DUAL_MODE_OPTIONS = Object.freeze({
  bucketStep: 10,
  minOpaquePixels: 4,
  minSecondaryShare: 0.18,
  minSeparation: 12,
  minLightnessDelta: 8,
  minSecondaryPixels: 4,
  minCoherence: 0.5,
  confidenceThreshold: 0.5,
  // 只在「占比过半」的格子上表态。这条不是 §7 原文，是实测加的口径：
  // 主桶占比过低说明这格本身就是碎花/纹理（照片噪声、毛边），
  // 那时「谁是次模式」没有意义，随便选一个只是把噪点放大。
  minPrimaryShare: 0.45,
  // ── 上下文支配度门（实测逼出来的）──────────────────────────────────
  //
  // 首轮 Lab：B 类（动漫，2px 黑描边 + 1px 眼高光）`detailRetention` 1.0 → 0.761，
  // `perceptualError` 6.41 → 7.54。诊断很清楚：**描边被吃掉了**。
  //
  // 根因是「次模式有结构价值就让次模式赢」这条规则对**细线是反的**。
  // 一格描边的构成是「黑 60% + 填充色 40%」：黑是主模式，填充是次模式，
  // 两者都是有结构的（各自都和邻格连成片），于是次模式赢 → 描边断掉。
  // 而眼睛那格是「肤色 70% + 黑 30%」：肤色是主模式，黑是次模式 ——
  // 这时让次模式赢才对。
  //
  // 两者的差别**不在格内，在格子的四周**：
  //   · 眼睛格：四周几乎全是肤色（主模式）→ 黑是**侵入**一块统一区
  //   · 描边格：四周黑白各半 → 这格本身就是**边界**
  // 所以加一个上下文支配度门：把格子向外扩一圈采样，
  // 只有主模式在**周围**也占支配地位时，才认为次模式是「统一区里的一块真结构」。
  //
  // 判据用的是源图像素，不是已生成的网格 —— matchCell 在逐格构建时被调用，
  // 右边和下边的格子还没生成，拿网格判邻域会读到一堆 null。
  contextMargin: 0.5,
  minContextDominance: 0.6,
  // 上下文里算作「同一模式」的 ΔE 半径
  contextMatchDelta: 6,
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * 主模式在**格子四周**的支配度（0–1）。
 *
 * 把采样框向外扩 `margin` 个格宽，重新分桶，然后把落在 `primaryLab`
 * 附近 `contextMatchDelta` 以内的桶的权重加起来。
 *
 * 为什么扩框而不是只看格内：见 `minContextDominance` 的注释 ——
 * 「眼睛」和「描边」在格内长得一样（都是主色 + 次色），
 * 区别只在四周是统一还是对半。
 */
function contextDominance(source, rect, primaryLab, opts) {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const padX = w * opts.contextMargin;
  const padY = h * opts.contextMargin;
  const { buckets } = buildLabBuckets(source, {
    x0: rect.x0 - padX,
    x1: rect.x1 + padX,
    y0: rect.y0 - padY,
    y1: rect.y1 + padY,
  }, { bucketStep: opts.bucketStep });
  let share = 0;
  for (const bucket of buckets) {
    if (deltaE2000(bucket.lab, primaryLab) <= opts.contextMatchDelta) share += bucket.share;
  }
  return share;
}

/**
 * @param {object} [options]
 * @returns {{id:string, matchCell:(ctx:object)=>object|undefined}}
 */
export function createDualMode(options = {}) {
  const opts = { ...DEFAULT_DUAL_MODE_OPTIONS, ...options };
  const id = options.id || DUAL_MODE_ID;
  return {
    id,
    matchCell(ctx) {
      const { source, bounds, palette, paletteEngine, report } = ctx;
      const table = paletteLabTable(palette);
      if (!table.length || !paletteEngine) return undefined;

      const { opaque, buckets, rect, pixelKeys } = buildLabBuckets(source, bounds, {
        bucketStep: opts.bucketStep,
        withPixelMap: true,
      });
      if (opaque < opts.minOpaquePixels || buckets.length < 2) return undefined;

      const stat = (report.dualMode = report.dualMode || {
        cells: 0,
        accepted: 0,
        rejectedPrimaryShare: 0,
        rejectedShare: 0,
        rejectedSeparation: 0,
        rejectedLightness: 0,
        rejectedPixels: 0,
        rejectedCoherence: 0,
        rejectedConfidence: 0,
        rejectedContext: 0,
        sumSecondaryShare: 0,
        sumSeparation: 0,
        sumConfidence: 0,
        sumDominance: 0,
      });
      stat.cells += 1;

      const primary = buckets[0];
      if (primary.share < opts.minPrimaryShare) { stat.rejectedPrimaryShare += 1; return undefined; }

      let secondary = null;
      let secondaryCoherence = 0;
      for (let i = 1; i < buckets.length; i += 1) {
        const bucket = buckets[i];
        if (bucket.share < opts.minSecondaryShare) { stat.rejectedShare += 1; continue; }
        const separation = deltaE2000(primary.lab, bucket.lab);
        if (separation < opts.minSeparation) { stat.rejectedSeparation += 1; continue; }
        const lightness = Math.abs(primary.lab[0] - bucket.lab[0]);
        if (lightness < opts.minLightnessDelta) { stat.rejectedLightness += 1; continue; }
        if (bucket.count < opts.minSecondaryPixels) { stat.rejectedPixels += 1; continue; }
        const coherence = bucketCoherence(pixelKeys, rect, bucket.key);
        if (coherence < opts.minCoherence) { stat.rejectedCoherence += 1; continue; }
        secondary = bucket;
        secondaryCoherence = coherence;
        break;
      }
      if (!secondary) return undefined;

      const separation = deltaE2000(primary.lab, secondary.lab);
      const lightness = Math.abs(primary.lab[0] - secondary.lab[0]);
      // 四项分数各自归一到「刚过线 = 0，明显超过 = 1」，再加权。
      // 用加权和而不是「全部必须超过某个高线」：四个指标不是同一种证据，
      // 用 AND 会把「share 刚好 0.2 但连贯性满分」这种真结构也一起毙掉。
      const shareScore = clamp01((secondary.share - opts.minSecondaryShare) / 0.27);
      const separationScore = clamp01((separation - opts.minSeparation) / 25);
      const lightnessScore = clamp01((lightness - opts.minLightnessDelta) / 25);
      const coherenceScore = clamp01((secondaryCoherence - opts.minCoherence) / 0.5);
      const structuralConfidence = 0.30 * shareScore + 0.25 * separationScore
        + 0.15 * lightnessScore + 0.30 * coherenceScore;
      if (structuralConfidence < opts.confidenceThreshold) { stat.rejectedConfidence += 1; return undefined; }

      // 上下文支配度门：四周也是主模式的地盘，次模式才算「统一区里的真结构」。
      const dominance = contextDominance(source, rect, primary.lab, opts);
      if (dominance < opts.minContextDominance) { stat.rejectedContext += 1; return undefined; }

      const matched = paletteEngine.match(secondary.rgb);
      if (!matched) return undefined;

      stat.accepted += 1;
      stat.sumSecondaryShare += secondary.share;
      stat.sumSeparation += separation;
      stat.sumConfidence += structuralConfidence;
      stat.sumDominance += dominance;
      return matched;
    },
  };
}

export default { createDualMode, DUAL_MODE_ID, DEFAULT_DUAL_MODE_OPTIONS };
