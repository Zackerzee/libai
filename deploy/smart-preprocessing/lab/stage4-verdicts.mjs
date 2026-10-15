/**
 * 阶段 4 四项隔离实验的**裁定注册表**（§15 的产物）。
 *
 * ── 为什么裁定要落成代码，而不是只写进报告 ────────────────────────────
 * B4 已经踩过这个坑：`AUTO_TUNE_LAB_CANDIDATES` 那份白名单之所以存在，
 * 是因为「REJECT 的算法不许回到搜索空间」如果只靠报告里的文字，
 * 下一个人加一个 id 到配置表里，CI 不会红、跑分器不会红，
 * 只有「线上多了一种没人裁过的算法」这一件事会静默发生。
 *
 * 所以阶段 4 的四个裁定也落成代码，并由
 * `tests/stage4-verdicts.test.mjs` 钉住三件事：
 *   ① 矩阵里每个非 current 条目都必须有一条裁定（不许有「忘了裁」的候选）；
 *   ② REJECT 的 id 不许出现在任何生产/Auto Tune 搜索空间里；
 *   ③ **本阶段没有任何候选进生产默认路径** —— 这条是空的，且必须保持空。
 *
 * ── 裁定口径（KEEP / REJECT / MODE-SPECIFIC）───────────────────────────
 *   KEEP            全类一致改善，且通过 §14 人工看图 → 可以进默认路径
 *   MODE-SPECIFIC   只在部分类/模式下改善 → 只可作为 opt-in，不得改默认行为
 *   REJECT          有类退化，或改善不可证 → 不进生产，且不得回到搜索空间
 *
 * 判定的**唯一依据**是 `tools/b4-lab.mjs --matrix stage4 --fixtures all` 的产物
 * （`metrics.json` / `summary.json` / `zoom/*`）＋ 对 zoom 图的人工看图。
 * 证据已归档在 `docs/evidence/stage4/`，报告在 `docs/stage4-four-experiments.md`。
 *
 * 纯数据，无 DOM、无 window、无副作用。
 */

/** 四条裁定。`evidence` 是可复核的锚点，不是形容词。 */
export const STAGE4_VERDICTS = Object.freeze([
  {
    id: "adaptive-v2",
    label: "AdaptiveV2（色卡感知自适应采样）",
    verdict: "REJECT",
    // 决定性证据：§17 明令「眼睛高光必须保留」，这里被破坏了。
    reason: "交界格的主桶路径把 1 逻辑像素的眼睛高光判错，B 类高光被啃掉一角（L 形缺口）",
    evidence: "docs/evidence/stage4/B-anime-eye-highlight.png（第 3 列 adaptive-v2 vs 第 2 列 current）",
    metrics: {
      perceptualError: "+0.001（无改善）",
      edgeRetention: "-0.005",
      isolatedPixels: "+6.64（更差）",
      usedColors: "+0.06",
      runtimeMs: "+34%",
    },
  },
  {
    id: "chroma-prescreen",
    label: "ChromaPrescreen（色差预筛）",
    verdict: "REJECT",
    // 它唯一的卖点是速度，实测为负 —— 这就是「没有免费的午餐」。
    reason: "行为基本不变（探针 47 项里 A–F 全同），但耗时 +20%；预筛的两次格内遍历比省下的上下文修正更贵",
    evidence: "docs/evidence/stage4/summary.json（chroma-prescreen 行）＋ 探针 diff：G–Q 噪声图上改了 14 项，含 L.fur-texture 真实换色 C148→C153",
    metrics: {
      perceptualError: "-0.005（可忽略）",
      edgeRetention: "0（全类一致）",
      isolatedPixels: "+7.94（更差）",
      runtimeMs: "+20%（净收益为负）",
    },
  },
  {
    id: "kit-limit",
    label: "KitLimit（真实色板限色，kitSize 24/48/96）",
    verdict: "MODE-SPECIFIC",
    // 限色按定义不可能让 ΔE 变好 —— 它的价值是**决策表**，不是改善。
    reason: "限色是用户约束而非优化：代价随 kitSize 单调下降（24→+4.42 / 48→+1.66 / 96→+0.68 平均 ΔE），"
      + "但 24/48 会把白色→灰、天空→紫、金纹→扁平、眼睛→绿。只可作为「限制为我的色板」的 opt-in，"
      + "且最低套装不得低于 96 色；不进默认生成路径",
    evidence: "docs/evidence/stage4/ 下 A-portrait-shirt-white / H-white-shirt-shirt / F-pattern-gold / "
      + "N-architecture-mullion / K-real-portrait-eye-specular / O-jpeg-noise-block-structure",
    metrics: {
      "kit-24": "ΔE +4.42 / 用色 9.65→5.76",
      "kit-48": "ΔE +1.66 / 用色 9.65→7.18",
      "kit-96": "ΔE +0.68 / 用色 9.65→8.88（白色与金纹保留）",
    },
  },
  {
    id: "cleanup",
    label: "ConservativeCleanup（保护性小区域清理）",
    verdict: "REJECT",
    // B4 §0 已裁掉它；本轮在当前管线上重跑，符号按类分裂，结论不变。
    reason: "B4 §0 已 REJECT（`AUTO_TUNE_LAB_CANDIDATES` 只留 bean-fit）。本轮重跑：ΔE 全类不退化（≤0），"
      + "但改动方向按类分裂 —— 孤点在 J/K/M 改善（-26/-29/-215），在 L/N/O 退化（+61/+31/+69），"
      + "不满足 KEEP 的「全类一致」门槛",
    evidence: "docs/evidence/stage4/M-indoor-lowlight-shadow-noise.png（第 8 列）＋ summary.json（cleanup 行）",
    metrics: {
      perceptualError: "-0.01（略好）",
      edgeRetention: "+0.006",
      fragmentation: "11.91 vs 13.18（更好）",
      isolatedPixels: "27.12 vs 33.18（更好，但由 M 一类的 -215 拉动）",
    },
  },
]);

export const STAGE4_VERDICT_BY_ID = Object.freeze(
  Object.fromEntries(STAGE4_VERDICTS.map((entry) => [entry.id, entry])),
);

/** REJECT 的候选 id。**不得出现在任何生产 / Auto Tune 搜索空间里。** */
export const STAGE4_REJECTED = Object.freeze(
  STAGE4_VERDICTS.filter((entry) => entry.verdict === "REJECT").map((entry) => entry.id),
);

/**
 * 阶段 4 允许进**生产默认路径**的候选。
 *
 * **刻意是空集。** 四项实验无一通过 KEEP 门槛：两个 REJECT（一个破坏高光、
 * 一个耗时倒挂）、一个 MODE-SPECIFIC（限色是 opt-in 约束，不是默认行为）、
 * 一个维持 B4 的 REJECT。空集本身就是本阶段的结论 ——
 * 如果哪天有人往这里加 id，`tests/stage4-verdicts.test.mjs` 会立刻变红。
 */
export const STAGE4_PRODUCTION_CANDIDATES = Object.freeze([]);

/** MODE-SPECIFIC 的候选（只可 opt-in，不得改默认行为）。 */
export const STAGE4_MODE_SPECIFIC = Object.freeze(
  STAGE4_VERDICTS.filter((entry) => entry.verdict === "MODE-SPECIFIC").map((entry) => entry.id),
);
