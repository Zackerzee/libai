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

import {
  paletteLabTable, buildLabBuckets, topBuckets, weightedBucketCost,
  prefilterCandidates, neighbourhoodBuckets, sourceSupport, rgbToLab, deltaE2000,
} from "./buckets.mjs";
import { neutralPenalty, shouldApplyNeutral } from "./neutral-protection.mjs";

export const BEAN_FIT_ID = "bean-fit";

/* =========================================================
 * §12.4 BEAN FIT MODE POLICY
 * ======================================================= */

/**
 * §12.4 模式策略表。**取值不是「跑不跑」，而是「跑的时候允许它做多大的主张」。**
 *
 *   allow        跑，越界惩罚（soft）。默认档。
 *   experimental 跑，越界惩罚（soft），但**该行不进汇总平均** —— 跑分器把它
 *                单独列出。语义是「算法在这里可以跑，但我们还没有人工看图
 *                背书它的结论」。这个项目的纪律里，「未看图的结论」和
 *                「已知不稳的取景」是同一种东西（见 b4-lab.mjs 的 framingStable）。
 *   cautious     跑，但**硬门**：候选池被限制在「被源色桶支持」的那些色里。
 *                池子空了就弃权（`undefined` → 退回生产匹配器）。
 *                这是 §12 原文「必须限制在原始 / 基线候选集合内」的字面实现。
 *   off          不跑。`matchCell` 第一行就返回 `undefined`，代价为 0。
 *
 * ── 为什么 pixel / logo 是 OFF，而不是「soft 惩罚一下」────────────────
 * 因为在这两类内容上，**生产采样本来就是对的**：pixel 用 `center`
 * （一格一个源像素，逐位忠实），logo 用 `dominant`。Bean Fit 的价值来自
 * 「均值不代表任何真实像素」，而 `center` 根本不产生均值 —— 它没有可修的东西，
 * 只有可造的东西。实测：A–J 里 8 类路由到 pixel、2 类路由到 logo，
 * 全部命中 OFF；§12.4 之前 Bean Fit 在这些夹具上的行为是 A 6→12 色、D 6→8 色、
 * C 7→10 色、G 4→5 色 —— 每一次增色都是一次越界。
 *
 * ── 为什么 auto / beginner 是 cautious 而不是 allow ──────────────────
 * 它们是「路由没能给出内容模式」时的落点（低信心 → `routing.mode = "auto"`）。
 * 既然不知道内容是什么，就不该按 allow 放行 —— 这是 §12 原文「不要强猜」。
 *
 * ⚠️ 这张表**只被 Lab 跑分器消费**，没有接进生产。§12.4 明说「先跑 bench」。
 * 接生产时它应该长在 `resolveGenerationPipeline` 的出口上，而不是散在调用方。
 *
 * ── 实测（`--fixtures noisy`，K–Q）：allow 两档并不干净 ────────────────
 * K（portrait）边保留 0.972 → **0.942**、ΔE 只从 8.44 到 8.42；
 * M（photo）边保留 0.988 → **0.924**、ΔE 13.06 → 13.07（还略差）、用色 9 → 8。
 * 也就是说：策略把 pixel/logo 的灾难挡掉了、越界惩罚把「凭空造色」挡掉了，
 * 但在**允许**的档位上，Bean Fit 仍拿边缘保留换一个很小的 ΔE 改善。
 * 这不是本轮要修的东西（§12.4 只要求建立策略 + 惩罚），但它意味着
 * **§13 不该把 portrait / photo 默认当 allow 用** —— 那两档要单独裁定。
 * P（illustration）反而是最像样的一档：ΔE 6.33 → 5.99、边 0.996 → 1.000，
 * 代价是用色 17 → 19。三档的取舍方向不一样，这正是「MODE-SPECIFIC」的定义。
 */
export const BEAN_FIT_MODE_POLICY = Object.freeze({
  portrait: "allow",
  photo: "allow",
  // `realistic` 不是 `GENERATION_MODES` 里的模式名，它是 §12.3 分类器的候选名，
  // 经 `ROUTING_MODE_ALIASES` 映射到 `photo`。这里**显式**写一份而不是靠调用方
  // 先做映射：少一次「忘了映射」的机会。测试会钉住它与 photo 一致。
  realistic: "allow",
  illustration: "experimental",
  anime: "cautious",
  pixel: "off",
  logo: "off",
  auto: "cautious",
  beginner: "cautious",
});

export const BEAN_FIT_POLICIES = Object.freeze(["allow", "experimental", "cautious", "off"]);

/**
 * 查模式策略。**未知模式 → `cautious`**，不是 `allow`：
 * 一个没见过的模式名意味着「我们不知道这是什么内容」，按最保守的那档处理。
 *
 * `Object.hasOwn` 而不是 `table[key] ?? default` —— 后者在 `mode` 恰好是
 * `"toString"` / `"constructor"` 这类原型键时会返回一个**函数**，
 * 然后 `policy.enabled` 是 `undefined`（falsy）→ 静默变成 OFF。
 * 一个拼错的模式名把整个候选关掉，且没有任何报错，是典型的静默失效形状。
 */
export function resolveBeanFitPolicy(mode) {
  const key = typeof mode === "string" ? mode : "";
  const policy = Object.hasOwn(BEAN_FIT_MODE_POLICY, key) ? BEAN_FIT_MODE_POLICY[key] : "cautious";
  return {
    mode: key || null,
    policy,
    enabled: policy !== "off",
    // 硬门 vs 软惩罚。这是策略表里唯一影响**成本函数形状**的分叉。
    supportMode: policy === "cautious" ? "hard" : "soft",
  };
}

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
  // ── §12.4 新增 ────────────────────────────────────────────────────
  /** 路由后的模式名。由跑分器注入；`null` = 未知 → 按 `cautious` 处理。 */
  mode: null,
  /** 策略表覆盖（跑分器用 `--policy` 传）。`null` = 按 mode 查表。
   *  取值：
   *    "allow"  强制 allow（§12.4 反事实：策略关掉的，越界惩罚自己挡不挡得住）
   *    "pure"   强制 allow **且关掉源色支持机制** —— 即 §6 原口径。
   *             这一档存在的唯一理由：让「越界增色」有一个能出图的**改动前**基线。
   *             §0 的纪律要求决策建立在看图之上，没有这一档就只能拿数字说事。
   */
  policyOverride: null,
  /** 「接近源色桶」的 ΔE2000 门，透传给 `sourceSupport`。 */
  supportTau: 10,
  /**
   * 候选必须被这么高占比的源色桶支持，才算「源图里真有这个色」。
   *
   * 0.25 的取证：A–J 全语料 3193 个改动格里，support 的分布是
   *   0.00 → 286 格，0.00–0.10 → **0 格**，0.10–0.25 → 1 格，0.25–0.44 → 14 格，0.44+ → 2892 格。
   * 门开在 0.25 = 开在一条空带里，±0.05 不会翻结论。
   */
  minSupport: 0.25,
  /**
   * soft 档下的越界惩罚权重（ΔE2000 单位）。
   *
   * 语义可以直读：「一个几乎不代表本格任何源色的候选，必须在 §6 成本上
   * 比生产答案低 12 以上，才值得采纳它」。12 在 CIEDE2000 尺度上是「明显不同的两个颜色」，
   * 所以这条门槛要求「有实质改善」，而不是「数字上小赢一点」。
   */
  supportPenalty: 12,
  /** 是否启用 3×3 邻域支持（懒计算，见 `matchCell` 里的可证明性说明）。 */
  neighbourhoodSupport: true,
});

/**
 * @param {object} [options]
 * @returns {{id:string, policy:object, matchCell:(ctx:object)=>object|undefined, report:object}}
 */
export function createBeanFit(options = {}) {
  const opts = { ...DEFAULT_BEAN_FIT_OPTIONS, ...options };
  const id = options.id || BEAN_FIT_ID;
  const basePolicy = resolveBeanFitPolicy(opts.mode);
  const policy = opts.policyOverride
    ? {
      ...basePolicy,
      policy: "allow",
      enabled: true,
      supportMode: "soft",
      overridden: true,
    }
    : basePolicy;
  // `pure` = 关掉源色支持机制。放在这里而不是塞进 `supportTau`：
  // 「这一档是 §6 原口径」必须是一个**显式**的开关，而不是靠把三个参数调成 0 凑出来
  // —— 后者在下一次改默认值时会被静默破坏。
  const supportOff = opts.policyOverride === "pure";
  const minSupport = supportOff ? 0 : opts.minSupport;
  const supportPenalty = supportOff ? 0 : opts.supportPenalty;
  return {
    id,
    policy: supportOff ? { ...policy, policy: "pure" } : policy,
    matchCell(ctx) {
      if (!policy.enabled) return undefined;

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

      const stat = (report.beanFit = report.beanFit || {
        cells: 0, switched: 0, abstained: 0, supportRejected: 0, neighbourhoodApplied: 0,
        costBefore: 0, costAfter: 0, neutralApplied: 0,
        contextBias: opts.contextBias, topBucketCount: opts.topBucketCount,
        neutral: Boolean(neutralOpts),
        // §12.4：策略必须自证。没有这两个字段，「Bean Fit 这一列为什么是空的」
        // 只能靠人回忆跑分时传了什么 —— 那正是 §16 要消灭的「无法复现的结论」。
        policy: policy.policy, policyMode: policy.mode, supportMode: policy.supportMode,
        minSupport, supportPenalty,
      });
      stat.cells += 1;
      if (useNeutral) stat.neutralApplied += 1;

      /** §6 成本 + 中性项。**不含**越界惩罚 —— 惩罚要等 support 算完才能加。 */
      const baseCost = (lab) => weightedBucketCost(kept, lab)
        + (useNeutral ? neutralPenalty(lab, neutralOpts) : 0);

      const scored = pool.map((entry) => ({
        entry,
        base: baseCost(entry.lab),
        support: sourceSupport(kept, entry.lab, opts.supportTau),
      }));

      // 生产答案即使不在池子里也要能参与比较 —— 它在池外说明预筛把它筛掉了，
      // 那就更要显式算一次，否则「Bean Fit 赢了生产」可能是预筛作弊。
      let productionRow = scored.find((row) => row.entry.color === production) || null;
      if (production && !productionRow) {
        const entry = table.find((e) => e.color === production);
        if (entry) {
          productionRow = { entry, base: baseCost(entry.lab), support: sourceSupport(kept, entry.lab, opts.supportTau) };
          scored.push(productionRow);
        }
      }

      // ── 懒计算邻域支持：**可证明不会改变结论时才跳过** ──────────────
      // 惩罚只加不减，且只加在 support < minSupport 的候选上。
      // 所以若「§6 成本最低的那个候选」自身 support 已达标，它的惩罚恒为 0，
      // 而其余候选的成本只可能上升 —— 排序不可能翻转。此时不必付 9 倍像素的代价。
      if (opts.neighbourhoodSupport) {
        let leader = scored[0];
        for (const row of scored) {
          if (row.base < leader.base - 1e-9) leader = row;
        }
        if (leader.support < minSupport) {
          const near = neighbourhoodBuckets(source, bounds, {
            bucketStep: opts.bucketStep,
            topBucketCount: opts.topBucketCount,
            minBucketShare: opts.minBucketShare,
          });
          if (near.length) {
            stat.neighbourhoodApplied += 1;
            for (const row of scored) {
              row.support = Math.max(row.support, sourceSupport(near, row.entry.lab, opts.supportTau));
            }
          }
        }
      }

      const supported = scored.filter((row) => row.support >= minSupport);
      let candidates = scored;
      if (policy.supportMode === "hard") {
        if (!supported.length) {
          // 硬门：这一格里没有任何候选色是源图里真有的。**弃权**，退回生产。
          stat.abstained += 1;
          stat.supportRejected += scored.length;
          return undefined;
        }
        candidates = supported;
        stat.supportRejected += scored.length - supported.length;
      }

      const penaltyOf = (row) => {
        if (policy.supportMode !== "soft") return 0;
        if (row.support >= minSupport) return 0;
        return supportPenalty * ((minSupport - row.support) / minSupport);
      };
      const costOf = (row) => row.base + penaltyOf(row);

      let best = null;
      let bestCost = Infinity;
      for (const row of candidates) {
        const cost = costOf(row);
        if (cost < bestCost - 1e-9
          || (Math.abs(cost - bestCost) <= 1e-9 && best && row.entry.index < best.entry.index)) {
          bestCost = cost;
          best = row;
        }
      }
      if (!best) return undefined;

      const productionCost = productionRow ? costOf(productionRow) : Infinity;
      const biasedProduction = Number.isFinite(productionCost) ? productionCost * opts.contextBias : Infinity;
      let chosen = best;
      let chosenCost = bestCost;
      if (production && biasedProduction <= bestCost) {
        chosenCost = productionCost;
        chosen = productionRow || best;
      }

      stat.costBefore += Number.isFinite(productionCost) ? productionCost : chosenCost;
      stat.costAfter += chosenCost;
      if (!production || chosen.entry.color !== production) stat.switched += 1;

      return chosen.entry.color;
    },
  };
}

export default { createBeanFit, BEAN_FIT_ID, DEFAULT_BEAN_FIT_OPTIONS, BEAN_FIT_MODE_POLICY, deltaE2000 };
