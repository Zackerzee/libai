/**
 * Auto Tune — Stage B4 §13 的受约束选择器。
 *
 * ── 它是什么，不是什么 ────────────────────────────────────────────────
 * §1 说得很清楚：Auto Tune **不是**「自动找一堆神秘参数」，而是
 *
 *   Source Analysis → Mode Routing → Allowed Candidate Profiles
 *   → Hard Constraint Filter → Quality Comparison → Select One Profile
 *
 * 所以本文件里**没有**任何连续参数搜索、没有 grid search、没有权重打分公式。
 * 它做三件事：硬约束淘汰、字典序排序、最小收益门槛。
 *
 * ── 为什么「标准」是默认赢家（§11 / §23）──────────────────────────────
 * 最重要的不变量是：**没有明确更优的候选，就选 STANDARD**。
 * 这不是保守，是纪律 —— 一个「必须选点不一样的」选择器会持续把用户
 * 推向更复杂、更慢、更容易出错的路径，而收益是 0.001 的 ΔE。
 * 所以：
 *   · `standard` 永远在候选表第一位，且它的相对指标恒为 0（基线就是它自己）
 *   · 挑战者必须在**第一个出现实质差异的判据**上赢过 `epsilon × (1 + 复杂度成本)`
 *   · 赢不了 → 回到 standard，并在报告里写明理由（不是静默回落）
 *
 * ── 为什么是字典序而不是加权分数（§10）────────────────────────────────
 * 加权分数**无法解释**。候选 X 以 0.003 胜出时，报告里只能说「它分更高」。
 * 字典序给出的是一句话：「先看 detailRetention，差 0.01 以内才比下一项」。
 *
 * ── 指标来自 `services/quality-metrics.mjs` ───────────────────────────
 * 与 §6–§10 的跑分器、§13 的评测工具是**同一把尺子**。理由写在那个文件里。
 *
 * 纯逻辑：无 DOM、无 window、无定时器。候选执行通过 `runCandidate` 注入，
 * 所以 node --test 里可以塞一个假执行器，把「选择」这件事单独钉死。
 */

import { classifySource } from "./source-classifier.mjs";
import { resolveRoutedMode } from "./mode-profile.mjs";
import {
  MODE_PROFILES,
} from "./mode-profile.mjs";
import {
  MODE_OBJECTIVES,
  objectiveFor,
  resolveCandidates,
  resolveCandidateRequest,
  standardProfileId,
} from "./auto-tune-profiles.mjs";
import { referenceFor, measureGrid } from "./quality-metrics.mjs";

/* =========================================================
 * 默认限额
 * ======================================================= */

export const AUTO_TUNE_DEFAULTS = Object.freeze({
  /**
   * 预览长边。§5 原话：「longEdge = min(actualLongEdge, 104 or 128)」。
   * 取 104 而不是 128，是因为 §4/§5 的冻结 benchmark 就是 104 ——
   * 预览尺寸与基线尺寸一致，「预览上选出来的赢家」与「基线里的那一列」
   * 才是可对拍的东西。
   */
  previewLongEdge: 104,
  /** 候选数上限。§27：「如果超过：减少候选数量。」 */
  maxCandidates: 4,
  /** 预览阶段总预算（毫秒）。超了就停止评估剩余候选，按当前结果裁定。 */
  previewBudgetMs: 4000,
  /** 单个候选的运行预算。超了记 `runtime-budget` 淘汰（§7-E）。 */
  candidateRuntimeBudgetMs: 4000,
  /**
   * 运行时间容忍度。复杂度成本 = winnerMs/standardMs − 1，钳到 [0, 1]。
   * 最小收益门槛 = epsilon × (1 + 复杂度成本)。
   * §12 明确：runtime 只用于 **tie-break / minimum gain**，绝不进主质量指标。
   */
  runtimeTolerance: 1,
  /** `epsilon: null` 的判据（末位 tie-break）用的绝对门槛，防浮点噪声。 */
  minimumAbsoluteGain: 0.01,
  /** 结构损失硬门槛（§7-D）。单位与 edgeRetention / detailRetention 相同（比例）。 */
  structureLossTolerance: 0.05,
  /** 边缘崩坏硬门槛（§7-F）。比结构门槛宽，因为边缘指标天然更抖。 */
  edgeLossTolerance: 0.10,
  /**
   * §7-G「不许整体崩掉」：perceptualError 相对 standard 的倍数上限与绝对余量。
   * 见 `HARD_CONSTRAINTS` 里 G 条的完整说明。
   */
  perceptualRegressionFactor: 2,
  perceptualRegressionFloor: 1.0,
  /** 只允许生产白名单里的 lab 候选（§26 第一阶段）。 */
  productionOnly: false,
});

/**
 * **第一阶段只给 `auto` 模式启用 Auto Tune**（§26）。
 *
 * 其它模式（人像 / 动漫 / Logo / 像素 …）继续使用固定的 ModeProfile ——
 * 它们已经是「用户明确表态」的结果，再在内部偷偷调一遍，等于把用户的
 * 选择又猜了一次。等 auto 稳定之后才考虑放开。
 */
export const AUTO_TUNE_PRODUCTION_MODES = Object.freeze(["auto"]);

/* =========================================================
 * §7 硬约束
 * ======================================================= */

/**
 * 硬约束。**任一失败直接淘汰**，不看它别的指标多好。
 *
 * §7 的原话是「不要让『平均分高』掩盖硬失败」—— 加权分数最危险的地方就在这里：
 * 一个把用色数顶爆的候选，可以靠其它项的微弱优势拿到最高分。
 *
 * 每条约束的形状与 §12 的 `ROUTING_HARD_RULES` 一致：
 * `id` / `label` / `evidence`（这条约束读了哪些指标）/ `test`。
 * `tests/auto-tune-hard-constraints.test.mjs` 会反查 `evidence` 与实现是否一致。
 */
export const HARD_CONSTRAINTS = Object.freeze([
  {
    id: "A-maxColors",
    label: "用色数不超过上限",
    evidence: ["usedColors"],
    test: (entry, ctx) => {
      const cap = ctx.effectiveMaxColors;
      if (!cap || cap <= 0) return true;      // 0 = 不限额
      return entry.metrics.usedColors <= cap;
    },
    note: "maxColors 为 0 表示不限额。pixel / logo 会把 cap 压到 standard 的用色数（§9 禁止扩色）。",
  },
  {
    id: "B-nullIntegrity",
    label: "空豆完整性（数量与位置都不许变）",
    evidence: ["nullCells", "nullMaskHash"],
    test: (entry, ctx) => {
      if (entry.metrics.nullCells !== ctx.standard.metrics.nullCells) return false;
      return entry.nullMaskHash === ctx.standard.nullMaskHash;
    },
    note: "autoBackground 是取景不变量，所以空豆集合必须逐格相同。数量对了、位置错了同样是失败。",
  },
  {
    id: "C-determinism",
    label: "确定性",
    evidence: [],
    test: (entry, ctx) => ctx.determinismVerified !== false,
    note: "运行时不做重复生成（那会让成本翻倍），所以生产里是 `unverified` 而不是假装 PASS；"
      + "确定性由 tests/auto-tune-determinism.test.mjs 与 §13 评测工具取证。",
  },
  {
    id: "D-structure-loss",
    label: "结构损失不超阈值",
    evidence: ["detailRetention", "flatAreaStability"],
    test: (entry, ctx) => {
      const s = ctx.standard.metrics;
      const t = ctx.limits.structureLossTolerance;
      if (entry.metrics.detailRetention != null && s.detailRetention != null
        && entry.metrics.detailRetention < s.detailRetention - t) return false;
      if (entry.metrics.flatAreaStability != null && s.flatAreaStability != null
        && entry.metrics.flatAreaStability < s.flatAreaStability - t) return false;
      return true;
    },
  },
  {
    id: "E-runtime-budget",
    label: "单候选运行预算",
    evidence: ["runtimeMs"],
    test: (entry, ctx) => entry.runtimeMs <= ctx.limits.candidateRuntimeBudgetMs,
  },
  {
    id: "F-edge-regression",
    label: "边缘不崩坏",
    evidence: ["edgeRetention"],
    test: (entry, ctx) => {
      const s = ctx.standard.metrics;
      if (entry.metrics.edgeRetention == null || s.edgeRetention == null) return true;
      return entry.metrics.edgeRetention >= s.edgeRetention - ctx.limits.edgeLossTolerance;
    },
  },
  {
    id: "G-resemblance",
    label: "整体不许崩掉（色差不得成倍恶化）",
    evidence: ["perceptualError"],
    test: (entry, ctx) => {
      const s = ctx.standard.metrics?.perceptualError;
      const own = entry.metrics.perceptualError;
      if (own == null || s == null || !(s > 0)) return true;
      const cap = s * ctx.limits.perceptualRegressionFactor + ctx.limits.perceptualRegressionFloor;
      return own <= cap;
    },
    note: "§7 说「至少 A–F」，这一条是**必须补上**的第七条。理由是一个实测出来的漏洞："
      + "D 与 F 只看 detailRetention / flatAreaStability / edgeRetention，"
      + "而这三条在「源图没有任何局部细节与边缘」时全是 null 或可被平凡满足 ——"
      + "一张平滑渐变在 48×48 上会被判成「全平区」，于是**一个把整幅图糊成单一颜色的候选**"
      + "在 flatAreaStability 上拿满分（它确实没在平区里造噪点），"
      + "碎片数还从 4.34 掉到 0.43。实测 auto / anime / beginner 三个模式都会选它，"
      + "而 perceptualError 从 7.01 涨到 24.43（3.5 倍）—— 硬约束一条都没响。"
      + "perceptualError 是唯一在所有源图上都有效的「还像不像原图」判据，"
      + "所以它必须是一道**门槛**，而不只是排在最后的排序项（§9 把它在 beginner 里排最后，"
      + "那说的是**排序**，不是「崩了也放行」）。",
  },
]);

/**
 * 逐条跑硬约束。
 *
 * **standard 永远通过**：它的每一条都是「相对自己」，差值为 0。
 * 这不是巧合，是设计 —— §23 要求 standard 一定可用作兜底。
 */
export function checkHardConstraints(entry, ctx) {
  const violations = [];
  for (const rule of HARD_CONSTRAINTS) {
    let ok = true;
    try {
      ok = rule.test(entry, ctx) !== false;
    } catch (error) {
      ok = false;
      violations.push({ id: rule.id, label: rule.label, detail: `约束求值抛错：${error?.message || error}` });
      continue;
    }
    if (!ok) violations.push({ id: rule.id, label: rule.label, detail: null });
  }
  return { ok: violations.length === 0, violations };
}

/* =========================================================
 * §10 字典序排序
 * ======================================================= */

const directionSign = (direction) => (direction === "max" ? 1 : -1);

/** 把「谁更好」归一成带符号的差值：正数 = a 更好。 */
function signedGain(a, b, criterion) {
  const va = a?.[criterion.metric];
  const vb = b?.[criterion.metric];
  if (va == null || vb == null) return 0;     // 缺指标 → 视为打平，不拿 0 当证据
  return (va - vb) * directionSign(criterion.direction);
}

/** 这一层的无差异阈值。`null` → 用绝对门槛。 */
function epsilonOf(criterion, limits) {
  return criterion.epsilon == null ? limits.minimumAbsoluteGain : criterion.epsilon;
}

/**
 * 找出 a 相对 b 的**第一处实质差异**。
 * @returns {null|{index,metric,direction,margin,epsilon}}
 *   打平（所有层都在阈值内）→ null
 */
export function firstMaterialDifference(a, b, objective, limits = AUTO_TUNE_DEFAULTS) {
  for (let i = 0; i < objective.length; i += 1) {
    const criterion = objective[i];
    const gain = signedGain(a.metrics ?? a, b.metrics ?? b, criterion);
    const epsilon = epsilonOf(criterion, limits);
    if (gain > epsilon) return { index: i, metric: criterion.metric, direction: criterion.direction, margin: gain, epsilon };
    if (gain < -epsilon) return { index: i, metric: criterion.metric, direction: criterion.direction, margin: gain, epsilon };
  }
  return null;
}

/**
 * 字典序比较器：-1 = a 更好，1 = b 更好，0 = 打平。
 * 打平时**保持输入顺序** —— 候选表是 standard 在前的，所以打平即 standard 胜。
 */
export function compareCandidates(a, b, objective, limits = AUTO_TUNE_DEFAULTS) {
  const diff = firstMaterialDifference(a, b, objective, limits);
  if (!diff) return 0;
  return diff.margin > 0 ? -1 : 1;
}

/** 稳定排序（打平保持原序 = standard 优先）。 */
export function rankCandidates(entries, objective, limits = AUTO_TUNE_DEFAULTS) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareCandidates(a.entry, b.entry, objective, limits) || (a.index - b.index))
    .map((row) => row.entry);
}

/* =========================================================
 * §11 / §12 最小收益 + 复杂度成本
 * ======================================================= */

/**
 * 复杂度成本：挑战者比 standard 慢多少（比例，钳到 [0, runtimeTolerance]）。
 * §12：「quality gain 很小但 runtime +50% / +100% → 拒绝升级」。
 */
export function complexityCost(entry, standard, limits = AUTO_TUNE_DEFAULTS) {
  const base = Number(standard?.runtimeMs);
  const own = Number(entry?.runtimeMs);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(own)) return 0;
  return Math.max(0, Math.min(limits.runtimeTolerance, own / base - 1));
}

/**
 * 挑战者在这一层上需要的**最小收益**。
 *
 * = `epsilon × (1 + 复杂度成本)`。
 * 慢一倍的候选，门槛也抬一倍（上限由 `runtimeTolerance` 封顶）。
 * 这条规则只影响「够不够格胜出」，**不影响排序本身** —— §12 的要求。
 */
export function requiredGain(criterion, entry, standard, limits = AUTO_TUNE_DEFAULTS) {
  return epsilonOf(criterion, limits) * (1 + complexityCost(entry, standard, limits));
}

/* =========================================================
 * §11 / §23 裁定
 * ======================================================= */

/**
 * 从已接受（通过硬约束）的候选里选一个。
 *
 * 返回的 `reason` 是**可读的一句话**，不是代号 —— 报告与日志直接用它。
 * `decision` 是机器可读的分类，供 §25 的失败分类使用。
 */
export function selectProfile({ entries, routedMode, limits = AUTO_TUNE_DEFAULTS }) {
  const objective = objectiveFor(routedMode);
  const standardId = standardProfileId(routedMode);
  const standard = entries.find((e) => e.profileId === standardId) || entries[0];
  const accepted = entries.filter((e) => e.accepted);

  if (!standard) {
    return { selectedProfileId: null, reason: "候选表里没有 standard", decision: "no-standard", objective, ranked: [], standard: null };
  }
  // ── standard 被硬约束淘汰时怎么办 ──────────────────────────────────
  // 先说清楚：**standard 是可能被淘汰的，而且不是「实现有 bug」**。
  // 六条约束里 A（用色数上限）和 E（单候选预算）是**绝对**判据，
  // 不是相对 standard 的 —— standard 本身太慢、或用了比上限更多的颜色，
  // 都会真真切切地违规。只有 B/D/F 三条是「相对 standard」，它们才不可能淘汰 standard。
  //
  // 处理方式：把 standard **放回池子里参与排序**，而不是无条件选它。
  //   · 挑战者没有实质更优 → standard 胜（§23：默认赢家 + 永远有输出）
  //   · 挑战者既合规又实质更优 → 选挑战者（它才是真正符合约束的那个）
  // 反过来「因为 standard 被淘汰就闭眼选它」是错的：那会在
  // 「standard 超预算、挑战者不超」时，故意挑一个超预算的跑。
  const pool = accepted.includes(standard) ? accepted : [standard, ...accepted];
  const ranked = rankCandidates(pool, objective, limits);
  const leader = ranked[0];

  if (leader.profileId === standardId) {
    return {
      selectedProfileId: standardId,
      decision: "standard-is-best",
      reason: "没有候选在目标判据上实质性优于 STANDARD",
      objective, ranked, standard,
    };
  }

  const diff = firstMaterialDifference(leader, standard, objective, limits);
  if (!diff) {
    return {
      selectedProfileId: standardId,
      decision: "no-material-gain",
      reason: `${leader.profileId} 在所有目标判据上都没有实质差异 → 回到 STANDARD`,
      objective, ranked, standard,
    };
  }
  if (diff.margin < 0) {
    // 排序说 leader 更好，但相对 standard 的第一处差异是 leader 更差 —— 不可能同时成立，
    // 说明目标表里有互相矛盾的判据（例如同一个指标出现两次、方向不同）。
    // 这种「实现错误」必须显式暴露，不能悄悄回落。
    return {
      selectedProfileId: standardId,
      decision: "objective-conflict",
      reason: `目标表自相矛盾：排序把 ${leader.profileId} 排第一，但它相对 STANDARD 在第一处差异（${diff.metric}）上更差`,
      objective, ranked, standard,
    };
  }

  const criterion = objective[diff.index];
  const need = requiredGain(criterion, leader, standard, limits);
  if (diff.margin < need) {
    const cost = complexityCost(leader, standard, limits);
    return {
      selectedProfileId: standardId,
      decision: "below-minimum-gain",
      reason: `${leader.profileId} 在 ${diff.metric} 上只赢 ${diff.margin.toFixed(4)}，低于门槛 ${need.toFixed(4)}`
        + `（复杂度成本 +${(cost * 100).toFixed(0)}%）→ 继续用 STANDARD`,
      objective, ranked, standard,
      detail: { metric: diff.metric, margin: diff.margin, required: need, complexityCost: cost },
    };
  }

  return {
    selectedProfileId: leader.profileId,
    decision: `better-on:${diff.metric}`,
    reason: `${leader.profileId} 在 ${diff.metric} 上赢 ${diff.margin.toFixed(4)}（门槛 ${need.toFixed(4)}）`,
    objective, ranked, standard,
    detail: { metric: diff.metric, margin: diff.margin, required: need, complexityCost: complexityCost(leader, standard, limits) },
  };
}

/* =========================================================
 * 尺寸 / 预算派生
 * ======================================================= */

/**
 * 预览尺寸：`min(实际长边, previewLongEdge)`，保持比例（§5 / §6）。
 *
 * 保持比例这件事不能靠「反正 generateV2 会自己算」—— 尺寸是**入参**，
 * 传一个比例不对的尺寸进去，取景就变了，候选之间也就不可比了。
 */
export function previewSizeFor(size, previewLongEdge = AUTO_TUNE_DEFAULTS.previewLongEdge, minEdge = 10) {
  const w = Math.max(1, Math.round(Number(size?.width) || 0));
  const h = Math.max(1, Math.round(Number(size?.height) || 0));
  const longEdge = Math.max(w, h);
  if (!longEdge || longEdge <= previewLongEdge) return { width: w, height: h, scaled: false };
  const scale = previewLongEdge / longEdge;
  return {
    width: Math.max(minEdge, Math.round(w * scale)),
    height: Math.max(minEdge, Math.round(h * scale)),
    scaled: true,
  };
}

/**
 * 预览的 maxColors —— **比例策略**（§6）。
 *
 * 为什么按长边比例而不是面积比例：maxColors 是「颜色数量」的上限，
 * 而颜色数量随分辨率大致是**线性**增长的（像素多了，能分辨出的色阶才多），
 * 面积比例会把 24 色在 104 档压成 1 色，所有候选一起被挤成一个色 ——
 * 那不是「保守」，是**把比较本身毁掉**。
 *
 * 下限 2：1 色上限会让每个候选输出同一张纯色图，指标全等，
 * 排序退化成「谁在列表前面」—— 一个看起来正常、实际什么都没测的假结果。
 *
 * ⚠️ 这是近似。**权威的 maxColors 强制发生在引擎自己的预算阶段（第 5 步）**，
 * 对最终尺寸生效；这里的缩放只服务于「候选之间可比」。
 */
export function previewMaxColors(maxColors, previewSize, targetSize) {
  const cap = Number(maxColors) || 0;
  if (cap <= 0) return 0;
  const previewLong = Math.max(previewSize?.width || 0, previewSize?.height || 0);
  const targetLong = Math.max(targetSize?.width || 0, targetSize?.height || 0);
  if (!previewLong || !targetLong || previewLong >= targetLong) return cap;
  return Math.max(2, Math.round(cap * (previewLong / targetLong)));
}

/* =========================================================
 * §17 / §18 缓存
 * ======================================================= */

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 源图指纹。大图按 stride 抽样，目标约 200k 字节。 */
export function sourceFingerprint(source, targetSamples = 200000) {
  const data = source?.data;
  if (!data?.length) return "empty";
  const stride = Math.max(1, Math.ceil(data.length / targetSamples));
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += stride) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${data.length.toString(16)}-${stride}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function paletteFingerprint(palette) {
  return fnv1a((palette || []).map((c) => `${c?.code}:${c?.rgb?.join?.(",") ?? ""}`).join("|"));
}

/**
 * 调用方 overrides 的稳定指纹。
 *
 * ── 为什么它必须在缓存键里（§18）────────────────────────────────────
 * 缓存里存的是**一整张网格**，而那张网格是「调用方 overrides ⊕ 候选增量」
 * 的产物。少这一项会出现下面这个形状：
 *
 *   用户把「细节保护」从 70 拖到 90 → 点生成 → 缓存命中 →
 *   返回**上一组参数**的图纸 → 用户看到的是「滑杆没反应」。
 *
 * 这比选错 Profile 严重得多：选错只是不够好，这是明确的错误输出。
 * 而 §18 列的「background decision」也一并被覆盖 —— 去背景意图落在
 * `overrides.autoBackground` 上，它就在这个指纹里，不需要额外槽位。
 *
 * 只序列化原始值；键排序保证与书写顺序无关；数组/对象深度与长度封顶，
 * 免得将来有人塞进一个大对象把键撑爆。
 */
export function overridesFingerprint(overrides) {
  if (!overrides || typeof overrides !== "object") return "";
  const parts = [];
  for (const key of Object.keys(overrides).sort()) {
    // 候选名是**调优器自己**加的维度，不属于调用方输入 ——
    // 它进了键的话，每个候选都会各miss一次，缓存等于没有。
    if (key === "labCandidate") continue;
    parts.push(`${key}=${fingerprintValue(overrides[key])}`);
  }
  return parts.join(",");
}

function fingerprintValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undef";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "nan";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return value.length > 64 ? `${value.slice(0, 64)}~${value.length}` : value;
  if (Array.isArray(value)) {
    const head = value.slice(0, 8).map(fingerprintValue).join(";");
    return `[${head}${value.length > 8 ? `;+${value.length - 8}` : ""}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const head = keys.slice(0, 16).map((k) => `${k}:${fingerprintValue(value[k])}`).join(";");
    return `{${head}${keys.length > 16 ? `;+${keys.length - 16}` : ""}}`;
  }
  return typeof value;   // function / symbol：不参与指纹
}

/**
 * 缓存键（§17 / §18）。
 *
 * §18 要求以下变化必须失效：source / crop / palette / maxColors /
 * background decision / mode / target size policy。全部在键里。
 *
 * 关于 background decision：它由 (source, crop, autoBackground) **唯一决定**，
 * 而这三项已经在键里；`backgroundDecision` 这个槽位是留给**用户手动做过
 * 背景处理**的场景（那时它不再由上面三项决定）。
 *
 * `overridesHash` 是**调用方参数**的指纹（模式档案 + 四个保护档 + 去背景意图…）。
 * 少了它，拖滑杆再生成会命中旧缓存、返回旧参数的图纸 —— 见
 * `overridesFingerprint` 的注释。
 *
 * **不在键里的东西**（§17 明确要求不能因为改它们就重跑）：
 * 缩放 / 面板开关 / 选中项 / 图层显示 / 任何纯 UI 状态。
 */
export function tuneCacheKey(input = {}) {
  return [
    input.sourceHash ?? "?",
    input.cropKey ?? "none",
    input.paletteHash ?? "?",
    input.maxColors ?? 0,
    input.backgroundDecision ?? "auto",
    input.overridesHash ?? "",
    input.mode ?? "auto",
    input.targetWidth ?? 0,
    input.targetHeight ?? 0,
    input.previewLongEdge ?? AUTO_TUNE_DEFAULTS.previewLongEdge,
    input.signature ?? "",
  ].join("|");
}

/** 极简 LRU。默认只留 4 条 —— 每条含一张预览网格，不是无限增长的东西。 */
export function createTuneCache({ max = 4 } = {}) {
  const store = new Map();
  return {
    get size() { return store.size; },
    has(key) { return store.has(key); },
    get(key) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      store.delete(key);
      store.set(key, value);   // 触达即刷新
      return value;
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      store.set(key, value);
      while (store.size > max) store.delete(store.keys().next().value);
      return value;
    },
    clear() { store.clear(); },
  };
}

/* =========================================================
 * 错误
 * ======================================================= */

export class AutoTuneCancelledError extends Error {
  constructor(message = "生成已取消") {
    super(message);
    this.name = "AbortError";
  }
}

export class AutoTuneStaleError extends Error {
  constructor(message = "已丢弃过期结果") {
    super(message);
    this.name = "StaleGenerationError";
  }
}

/* =========================================================
 * 工具
 * ======================================================= */

/** 空豆掩码指纹。空豆「数量对、位置错」也是一种失败，所以要有位置级的指纹。 */
export function nullMaskHash(grid) {
  let hash = 0x811c9dc5;
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) continue;
      hash ^= (y * 31 + x) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 生产闸门（§26）：第一阶段只给这些模式启用。 */
export function isAutoTuneEnabledFor(mode) {
  return AUTO_TUNE_PRODUCTION_MODES.includes(mode);
}

/* =========================================================
 * 调优器
 * ======================================================= */

/**
 * @param {object} deps
 * @param {(req:{size,overrides,labCandidate,requestId,onPhase}) => Promise<{grid,width,height,timingMs,diagnostics}>} deps.runCandidate
 *   执行一个候选。**注入**而不是内部 import 生成链路：
 *   ① node --test 里可以塞假执行器，把「选择」这件事单独钉死；
 *   ② 生产里它走 Worker，而 Worker 的契约不归本文件管。
 * @param {(source)=>object} [deps.analyze] 路由证据。默认 `classifySource().routing` 的宿主。
 * @param {() => number} [deps.now]
 * @param {object} [deps.limits]
 * @param {object} [deps.cache] `createTuneCache()` 的产物
 */
export function createAutoTuner({
  runCandidate,
  analyze = null,
  now = () => Date.now(),
  limits = {},
  cache = null,
} = {}) {
  if (typeof runCandidate !== "function") throw new TypeError("createAutoTuner 需要 runCandidate");
  const resolvedLimits = { ...AUTO_TUNE_DEFAULTS, ...limits };
  const evidenceOf = analyze || ((source) => ({ routing: classifySource(source).routing }));

  let latestRequestId = null;
  let current = null;          // { requestId, cancelled }
  let lastReport = null;

  /**
   * 请求是否还活着（§19）。
   *
   * ⚠️ 判据是**传进来的那个 `mine`**，不是模块级的 `current`。
   *
   * 这里踩过一个很隐蔽的坑：`cancel()` 会把 `current` 置为 null（表示
   * 「现在没有任务在跑」），而原来这里读的就是 `current` —— 于是取消之后
   * `current` 是 null，`current && current.cancelled` 短路成 false，
   * **取消检查整个失效**。表现是：用户点了取消，正在跑的那个候选确实被
   * Worker 掐掉了，但调优循环醒过来之后 `assertAlive` 说「一切正常」，
   * 接着启动下一个候选 —— 界面在继续生成。
   *
   * 所以每次 `tune()` 都要把自己的请求对象捕获下来，检查它身上的标记。
   * `mine` 这个变量原本就在，只是从来没被用过 —— 注释写着「捕获」，
   * 实现却读了另一个东西，这种「注释对、代码错」比没注释更危险。
   */
  const assertAlive = (requestId, mine) => {
    if (mine && mine.cancelled) throw new AutoTuneCancelledError();
    if (latestRequestId != null && Number(requestId) !== Number(latestRequestId)) throw new AutoTuneStaleError();
  };

  /**
   * 跑一次调优。
   *
   * @param {object} input
   * @param {{data,width,height}} input.source 源图（ImageData 形状）
   * @param {string} [input.mode] 用户选的模式（默认 auto）
   * @param {{width,height}} input.size 目标尺寸（**已解析**的整数宽高）
   * @param {Array} input.palette
   * @param {number} [input.maxColors]
   * @param {object} [input.overrides] 调用方自己的覆盖项（会与候选增量合并）
   * @param {number} [input.requestId]
   * @param {string} [input.cropKey] 裁剪变换的指纹（§18）
   * @param {string} [input.backgroundDecision]
   * @param {(phase:string)=>void} [input.onPhase]
   */
  async function tune(input = {}) {
    const {
      source, mode = "auto", size, palette, maxColors = 0,
      overrides = {}, requestId = 1, cropKey = null, backgroundDecision = null,
      onPhase = null, useCache = true,
    } = input;
    const started = now();
    latestRequestId = Number(requestId);
    current = { requestId: Number(requestId), cancelled: false };
    const mine = current;

    const evidence = evidenceOf(source);
    const routedMode = resolveRoutedMode(mode, evidence);
    const candidates = resolveCandidates(routedMode, { production: resolvedLimits.productionOnly });
    const standardId = standardProfileId(routedMode);
    const previewSize = previewSizeFor(size, resolvedLimits.previewLongEdge);
    const previewCap = previewMaxColors(maxColors, previewSize, size);

    const key = tuneCacheKey({
      sourceHash: sourceFingerprint(source),
      cropKey,
      paletteHash: paletteFingerprint(palette),
      maxColors,
      backgroundDecision,
      mode,
      targetWidth: size?.width,
      targetHeight: size?.height,
      previewLongEdge: resolvedLimits.previewLongEdge,
      signature: `${resolvedLimits.productionOnly ? "prod" : "all"}`,
      overridesHash: overridesFingerprint(overrides),
    });

    const base = {
      version: 1,
      requestId: Number(requestId),
      mode,
      routedMode,
      // `standardProfileId` 放进 base，**每个分支都要有它**（§15 的报告契约）。
      // 只在成功路径上加会漏掉 single-candidate / standard-failed / 缓存命中前
      // 那几个提前返回的分支 —— 消费方（评测器、探针）读它会拿到 undefined，
      // 而 undefined 在报告里长得像「没有 standard」，其实是「这个分支忘了加」。
      standardProfileId: standardId,
      previewSize,
      targetSize: { width: size?.width, height: size?.height },
      previewMaxColors: previewCap,
      maxColors,
      candidates: [],
      selectedProfileId: null,
      selectedProfile: null,
      reusedPreview: false,
      cached: false,
      reason: "",
      decision: "",
      runtimeMs: 0,
      cacheKey: key,
      // ── Stage C0 §15：把 Worker 结果反序列化的耗时接出来 ──────────────
      // 在这之前，commit profile 的 `decodeMs(workerClient)` 在**智能模式下恒为 null**。
      // 不是 worker 没计时 —— `generation-worker-client.mjs` 每次都会把
      // `decodeGenerationResult(envelope)` 的耗时挂在返回值上；是这条链路把它丢了：
      // 预览候选的返回值只被取走了 grid/width/height/diagnostics，
      // 正式那一轮的返回值也一样，报告里根本没有这个字段，
      // 于是 app.js 的 `runAutoTuneV2` 没有东西可往 `processImageV2` 带。
      // 后果是 §14 的性能表在智能模式下永远缺一格：没人能判断
      // 「结构化克隆 + 反序列化」到底占了多少。
      //
      // 口径：**真正产出最终网格的那一次运行**的反序列化耗时。
      //   · decodeMsSource === "final"      重跑正式生成 → 正式那一次
      //   · decodeMsSource === "preview"    预览尺寸 == 目标尺寸、直接复用赢家网格 → 预览赢家那一次
      //   · decodeMsSource === "cache-hit"  整轮命中缓存，这次调用里**没有发生**任何反序列化
      // 之所以还要一个 source：null 有两种完全不同的含义（「没量到」和「本来就没有」），
      // 只看 null 分不出来，而性能报告最怕的就是分不出来的空格。
      decodeMs: null,
      decodeMsSource: null,
    };

    // 只有一个候选（pixel / logo）= §9 明确禁止 Auto Tune 改算法。
    // 直接返回，让调用方走普通生成 —— 跑一次预览再跑一次正式是纯浪费。
    if (candidates.length <= 1) {
      const only = candidates[0];
      const report = {
        ...base,
        skipped: "single-candidate",
        selectedProfileId: only?.id ?? null,
        selectedProfile: only ? resolveCandidateRequest(only) : null,
        reason: `${routedMode} 只有一个候选（§9 禁止 Auto Tune 改算法）→ 直接使用它`,
        decision: "single-candidate",
        runtimeMs: Math.round(now() - started),
      };
      lastReport = report;
      return report;
    }

    if (useCache && cache) {
      const hit = cache.get(key);
      if (hit) {
        // 缓存命中：这一轮没有跑任何 worker，也就**没有发生反序列化**。
        // 不能沿用缓存里那个旧数字 —— 那会把「上一次生成的开销」记到这一次头上，
        // 正是 §15 要消灭的那种归因漂移。显式写 null + source，让读表的人一眼看懂。
        const report = { ...hit, cached: true, runtimeMs: Math.round(now() - started), decodeMs: null, decodeMsSource: "cache-hit" };
        lastReport = report;
        return report;
      }
    }

    onPhase?.("tune-analyze");
    const reference = referenceFor(source, previewSize.width, previewSize.height);
    const entries = [];
    let elapsedPreview = 0;
    let lastCandidateMs = 0;

    for (let i = 0; i < candidates.length && i < resolvedLimits.maxCandidates; i += 1) {
      assertAlive(requestId, mine);
      const candidate = candidates[i];
      const isStandard = candidate.id === standardId;

      // 预算早停：standard 永远要跑（它是兜底基线），其余的按预算裁。
      if (!isStandard && i > 0 && elapsedPreview + lastCandidateMs > resolvedLimits.previewBudgetMs) {
        for (let j = i; j < candidates.length && j < resolvedLimits.maxCandidates; j += 1) {
          entries.push({
            profileId: candidates[j].id,
            label: candidates[j].label,
            accepted: false,
            rejectReason: "runtime-budget",
            violations: [],
            metrics: null,
            runtimeMs: null,
            note: "预览预算耗尽，未评估（§27）",
          });
        }
        break;
      }

      const request = resolveCandidateRequest(candidate);
      onPhase?.("tune-preview");
      const t0 = now();
      let result;
      try {
        result = await runCandidate({
          size: previewSize,
          // **候选增量必须覆盖调用方档案。** 调用方传进来的 overrides 是
          // 「用户面板 + 模式表」的完整一份，候选增量是在它之上的小改动；
          // 顺序反了的话增量会被整份档案盖掉 —— 表现是「所有候选输出逐位相同」，
          // 一个看起来像「算法没效果」的假结论。
          overrides: { ...overrides, ...request.overrides },
          labCandidate: request.labCandidate,
          // 预览的 maxColors 是**按比例缩过**的那一个（§6），
          // 不是目标尺寸的原始值 —— 传错会让小图被大图的额度绑死。
          maxColors: previewCap,
          requestId,
          phase: "preview",
        });
      } catch (error) {
        if (error?.name === "AbortError" || error?.name === "StaleGenerationError") throw error;
        entries.push({
          profileId: candidate.id,
          label: candidate.label,
          accepted: false,
          rejectReason: "candidate-error",
          violations: [],
          metrics: null,
          runtimeMs: null,
          error: String(error?.message || error),
        });
        lastCandidateMs = Math.round(now() - t0);
        elapsedPreview += lastCandidateMs;
        continue;
      }
      assertAlive(requestId, mine);
      const runtimeMs = Number.isFinite(Number(result?.timingMs)) ? Number(result.timingMs) : Math.round(now() - t0);
      lastCandidateMs = Math.max(0, Math.round(now() - t0));
      elapsedPreview += lastCandidateMs;

      const metrics = measureGrid(result.grid, reference);
      entries.push({
        profileId: candidate.id,
        label: candidate.label,
        grid: result.grid,
        width: result.width,
        height: result.height,
        // 赢家的诊断要能透出去 —— `state.smartFeatures` / 背景预检结论都靠它。
        // 只在赢家那一条上带出去（`stripEntry` 不带），所以不会让报告膨胀。
        diagnostics: result.diagnostics ?? null,
        // Stage C0 §15：同样只在赢家那一条上带出去（stripEntry 是显式白名单，不会漏到 candidates 里）。
        decodeMs: Number.isFinite(Number(result?.decodeMs)) ? Number(result.decodeMs) : null,
        nullMaskHash: nullMaskHash(result.grid),
        metrics,
        runtimeMs,
        accepted: true,
        rejectReason: null,
        violations: [],
      });
    }

    const standard = entries.find((e) => e.profileId === standardId);
    // ⚠️ 判据是 **`standard.metrics`**，不是 `standard`。
    //
    // 只看 `!standard` 会漏掉最要紧的那一种失败：standard **执行抛了**。
    // 那时 `entries` 里确实有一条 `profileId === standardId` 的条目，
    // 但它的 `metrics` 是 null、`grid` 是 undefined。让这种条目混过去会发生三件坏事：
    //   ① `ctx.standard.metrics` 是 null → 硬约束 A 求值抛错（被 catch 成 violation），
    //      D/F 拿到 null 直接放行 —— 基线不存在，约束全部失去意义；
    //   ② `selectProfile` 里 `signedGain` 对 null 指标返回 0（「缺指标视为打平」，
    //      那条规则本身是对的），于是这条**根本没跑出来的**条目在所有判据上打平，
    //      排序稳定 → 它排第一 → 报告写 `standard-is-best`。一个假结论；
    //   ③ 紧接着 `winner.grid` 是 undefined → 走「正式生成」分支 → **再抛一次同样的错**。
    // 所以这里必须要求 standard **有可用的度量**。
    if (!standard || !standard.metrics) {
      // standard 没跑起来（执行器抛了）。没有基线就没有比较，只能回落。
      const report = {
        ...base,
        candidates: entries.map(stripEntry),
        selectedProfileId: standardId,
        selectedProfile: resolveCandidateRequest(
          candidates.find((c) => c.id === standardId) || candidates[0],
        ),
        reason: "STANDARD 候选执行失败，无法比较 → 回落 STANDARD",
        decision: "standard-failed",
        runtimeMs: Math.round(now() - started),
      };
      lastReport = report;
      return report;
    }

    // pixel / logo 禁止扩色（§9）：把 maxColors 压到 standard 的用色数。
    const forbidColorGrowth = routedMode === "pixel" || routedMode === "logo";
    const effectiveMaxColors = forbidColorGrowth && !previewCap
      ? standard.metrics.usedColors
      : previewCap;

    const ctx = {
      limits: resolvedLimits,
      standard,
      effectiveMaxColors,
      determinismVerified: resolvedLimits.determinismVerified ?? null,
    };
    for (const entry of entries) {
      if (!entry.accepted) continue;
      const check = checkHardConstraints(entry, ctx);
      entry.accepted = check.ok;
      entry.violations = check.violations;
      entry.rejectReason = check.ok ? null : check.violations.map((v) => v.id).join("+");
    }

    const selection = selectProfile({ entries, routedMode, limits: resolvedLimits });
    const winner = entries.find((e) => e.profileId === selection.selectedProfileId) || standard;

    // §5：预览尺寸 == 目标尺寸时，赢家的预览网格**就是**最终结果。
    // 可复用的前提是确定性（同输入同输出）—— 由 §13 的 determinism 测试与
    // 评测工具取证；这里只是省掉一次等价的重跑。
    let finalGrid = null;
    let reused = false;
    let finalMs = 0;
    let finalWidth = winner.width ?? size.width;
    let finalHeight = winner.height ?? size.height;
    let finalDiagnostics = winner.diagnostics ?? null;
    // Stage C0 §15：跟着「最终网格是哪一次跑出来的」一起决定。
    let finalDecodeMs = null;
    let finalDecodeMsSource = null;
    if (winner.grid && previewSize.width === Number(size.width) && previewSize.height === Number(size.height)) {
      finalGrid = winner.grid;
      reused = true;
      // 复用预览网格 → 最终网格就是预览赢家跑出来的那张，它的反序列化耗时才是这次生成的。
      finalDecodeMs = Number.isFinite(Number(winner.decodeMs)) ? Number(winner.decodeMs) : null;
      finalDecodeMsSource = "preview";
    } else {
      assertAlive(requestId, mine);
      onPhase?.("tune-final");
      const t1 = now();
      const finalCandidate = candidates.find((c) => c.id === winner.profileId) || candidates[0];
      const request = resolveCandidateRequest(finalCandidate);
      const finalResult = await runCandidate({
        size: { width: Number(size.width), height: Number(size.height) },
        overrides: { ...overrides, ...request.overrides },
        labCandidate: request.labCandidate,
        // 正式生成用**原始** maxColors —— 引擎自己的预算阶段对目标尺寸生效，
        // 那是权威口径；预览的比例缩放只服务于「候选之间可比」。
        maxColors,
        requestId,
        phase: "final",
      });
      finalMs = Math.max(0, Math.round(now() - t1));
      finalGrid = finalResult.grid;
      // 尺寸与诊断必须取**正式那一次**的，不能沿用预览的 ——
      // 预览是 104 档、正式是目标档，混用会让诊断里的尺寸相关字段对不上。
      finalWidth = finalResult.width ?? finalWidth;
      finalHeight = finalResult.height ?? finalHeight;
      finalDiagnostics = finalResult.diagnostics ?? null;
      finalDecodeMs = Number.isFinite(Number(finalResult.decodeMs)) ? Number(finalResult.decodeMs) : null;
      finalDecodeMsSource = "final";
    }
    assertAlive(requestId, mine);

    const report = {
      ...base,
      skipped: null,
      candidates: entries.map(stripEntry),
      selectedProfileId: winner.profileId,
      selectedProfile: resolveCandidateRequest(
        candidates.find((c) => c.id === winner.profileId) || candidates[0],
      ),
      decision: selection.decision,
      reason: selection.reason,
      // standardProfileId 在 base 里，这里不重复写 —— 一份数据只在一处定义。
      reusedPreview: reused,
      finalRuntimeMs: finalMs,
      previewRuntimeMs: elapsedPreview,
      runtimeMs: Math.round(now() - started),
      grid: finalGrid,
      width: finalWidth,
      height: finalHeight,
      // 赢家的引擎诊断。`state.smartFeatures` / `state.smartReport` 靠它，
      // 缺了它的话「智能模式」下这四个开关的报告会全空。
      diagnostics: finalDiagnostics,
      // Stage C0 §15：反序列化耗时 + 它的来源。app.js 的 runAutoTuneV2 把它带到
      // `processImageV2` 的返回值上，commit profile 的 `decodeMs(workerClient)` 才不再是 null。
      decodeMs: finalDecodeMs,
      decodeMsSource: finalDecodeMsSource,
    };
    lastReport = report;
    if (useCache && cache && finalGrid) {
      // 缓存的是**选择结果 + 赢家网格**，不是全部候选网格 ——
      // 选择结果由键唯一决定，重放时不需要再看其它候选。
      cache.set(key, { ...report, grid: finalGrid });
    }
    return report;
  }

  const stripEntry = (entry) => ({
    profileId: entry.profileId,
    label: entry.label,
    accepted: entry.accepted,
    rejectReason: entry.rejectReason,
    violations: entry.violations,
    metrics: entry.metrics,
    runtimeMs: entry.runtimeMs,
    nullMaskHash: entry.nullMaskHash ?? null,
    note: entry.note ?? null,
    error: entry.error ?? null,
  });

  return {
    tune,
    get lastReport() { return lastReport; },
    get latestRequestId() { return latestRequestId; },
    limits: resolvedLimits,
    /** 取消当前调优（§19）。执行器那边的真终止由调用方负责。 */
    cancel(reason = "生成已取消") {
      const running = current;
      const had = Boolean(running && !running.cancelled);
      // 标记打在 `running` 这个对象上 —— `tune()` 里捕获的 `mine` 就是它，
      // 所以正在跑的那一轮能在下一个检查点看到「我被取消了」。
      if (running) running.cancelled = true;
      current = null;
      // 取消痕迹写进报告：`tune()` 会抛 AbortError，不会再覆盖 lastReport，
      // 所以这条记录能留到排障的时候。带上 requestId 才知道取消的是哪一轮。
      if (had) {
        lastReport = {
          ...(lastReport || {}),
          cancelled: true,
          cancelReason: reason,
          requestId: running.requestId,
        };
      }
      return had;
    },
  };
}

/* =========================================================
 * §22 Regret
 * ======================================================= */

/**
 * `AutoTuneRegret = OracleBestQuality − SelectedQuality`（§22）。
 *
 * 用字典序表达：**第一处出现实质差异的判据 + 差距**。
 * `epsilonUnits` 是差距除以那一层的无差异阈值 —— 跨指标可比，
 * 而且能一句话说清：「oracle 赢在第 2 层，赢了 3.4 个 epsilon」。
 *
 * ── `hit` 的口径（这里踩过一个坑，值得写下来）──────────────────────────
 * `hit` 量的**不是**「有没有选中 oracle 那一套 Profile」，而是
 * **「质量有没有损失」**。两者在 oracle 与选中项只在阈值内不同时是**不一样**的：
 *   · 阈值内 → 质量无损失 → 这是**命中**，regret 0
 *   · 阈值外 → 质量有损失 → 未命中，regret > 0
 *
 * 一开始 `!diff`（= 所有判据都在阈值内）被写成了 `hit: false`，
 * 于是一个「选了另一套 Profile 但质量完全一样」的夹具被记成未命中，
 * 而且 `levelsApart` 被写成 `objective.length`（=「差了一整张表」）。
 * 那会把 `hitRate` 变成「精确命中率」，看起来像 §22 的指标，其实不是 ——
 * §21 的要求是「**尽量接近** Oracle」，不是「必须一模一样」。
 */
export function computeRegret(oracle, selected, objective, limits = AUTO_TUNE_DEFAULTS) {
  if (!oracle || !selected) {
    return { comparable: false, hit: false, metric: null, margin: null, epsilonUnits: null, levelsApart: null };
  }
  if (oracle.profileId === selected.profileId) {
    return { comparable: true, hit: true, metric: null, margin: 0, epsilonUnits: 0, levelsApart: 0 };
  }
  const diff = firstMaterialDifference(oracle, selected, objective, limits);
  // `!diff` = 所有判据都在阈值内 = 两者质量不可区分 → 命中。
  // `diff.margin <= 0` = 第一处实质差异上 oracle 反而更差 → 更不该算未命中
  // （正常输入下不会出现，但它是「oracle 其实没赢」的诚实表达，不能记成损失）。
  if (!diff || diff.margin <= 0) {
    return { comparable: true, hit: true, metric: null, margin: 0, epsilonUnits: 0, levelsApart: 0 };
  }
  return {
    comparable: true,
    hit: false,
    metric: diff.metric,
    direction: diff.direction,
    margin: Math.abs(diff.margin),
    epsilonUnits: Number((Math.abs(diff.margin) / Math.max(1e-9, epsilonOf(objective[diff.index], limits))).toFixed(3)),
    // 1-based：「差几层」说的是第 1 层、第 2 层，不是第 0 层。
    levelsApart: diff.index + 1,
  };
}

/** 一组 regret 的汇总。 */
export function summarizeRegret(regrets) {
  const usable = regrets.filter((r) => r?.comparable);
  if (!usable.length) {
    return { n: 0, hitRate: null, meanEpsilonUnits: null, worstEpsilonUnits: null, worstMetric: null, meanLevelsApart: null };
  }
  const hits = usable.filter((r) => r.hit).length;
  const eps = usable.map((r) => r.epsilonUnits ?? 0);
  const levels = usable.map((r) => r.levelsApart ?? 0);
  let worstIndex = 0;
  for (let i = 1; i < eps.length; i += 1) if (eps[i] > eps[worstIndex]) worstIndex = i;
  return {
    n: usable.length,
    hitRate: Number((hits / usable.length).toFixed(4)),
    meanEpsilonUnits: Number((eps.reduce((a, b) => a + b, 0) / usable.length).toFixed(3)),
    worstEpsilonUnits: Number(eps[worstIndex].toFixed(3)),
    worstMetric: usable[worstIndex].metric,
    meanLevelsApart: Number((levels.reduce((a, b) => a + b, 0) / usable.length).toFixed(2)),
  };
}

/* =========================================================
 * §25 失败分类
 * ======================================================= */

export const TUNE_FAILURE_CLASSES = Object.freeze([
  "routing-error",
  "candidate-error",
  "metric-error",
  "threshold-error",
  "runtime-budget",
  "fixture-problem",
]);

/**
 * 选错时必须**分类**，不能一句「Auto Tune failed」（§25）。
 *
 * 规则按顺序取第一条命中的，每条都声明它依赖哪些字段 ——
 * 与 §12 的 `ROUTING_HARD_RULES` 同一种写法，便于测试反查。
 */
export const TUNE_FAILURE_RULES = Object.freeze([
  {
    id: "fixture-problem",
    evidence: ["candidates"],
    test: (ctx) => !ctx.candidates?.length,
    note: "一个候选都没有：夹具或路由证据本身坏了，不是选择器的问题",
  },
  {
    id: "routing-error",
    evidence: ["expectedMode", "routedMode"],
    test: (ctx) => ctx.expectedMode != null && ctx.routedMode != null && ctx.expectedMode !== ctx.routedMode,
    note: "路由就没对 —— 后面选什么都白搭。§13 不修路由（§0.8），只负责报出来",
  },
  {
    id: "runtime-budget",
    evidence: ["candidates", "oracleProfileId"],
    test: (ctx) => ctx.oracleProfileId != null
      && ctx.candidates.some((c) => c.profileId === ctx.oracleProfileId && c.rejectReason === "runtime-budget"),
    note: "oracle 那一套**因为预算没被评估**。这是 §27 的直接后果，属于可接受但必须记账的一类",
  },
  {
    id: "candidate-error",
    evidence: ["candidates", "oracleProfileId"],
    test: (ctx) => ctx.oracleProfileId != null
      && ctx.candidates.some((c) => c.profileId === ctx.oracleProfileId && c.rejectReason === "candidate-error"),
    note: "oracle 那一套执行失败了（异常），不是被约束淘汰的",
  },
  {
    id: "threshold-error",
    evidence: ["selectedProfileId", "oracleProfileId", "standardProfileId"],
    test: (ctx) => ctx.selectedProfileId === ctx.standardProfileId && ctx.oracleProfileId !== ctx.standardProfileId,
    note: "oracle 不是 standard，但选择器回落到了 standard —— 最小收益门槛太紧",
  },
  {
    id: "metric-error",
    evidence: ["selectedProfileId", "oracleProfileId"],
    test: (ctx) => ctx.selectedProfileId !== ctx.oracleProfileId,
    note: "候选都在，约束也过了，但排序选错了 —— 指标或目标表的权重次序有问题",
  },
]);

export function classifyTuneFailure(ctx = {}) {
  for (const rule of TUNE_FAILURE_RULES) {
    let hit = false;
    try {
      hit = rule.test(ctx) === true;
    } catch {
      hit = false;
    }
    if (hit) return { class: rule.id, note: rule.note };
  }
  return { class: null, note: "选择与 oracle 一致" };
}

/* =========================================================
 * Oracle
 * ======================================================= */

/**
 * Oracle：**离线跑完所有允许候选**，取「指标 + 人工 QA」最优的那一套（§21）。
 *
 * ── 两个刻意的限制 ────────────────────────────────────────────────────
 *  ① **只在不被硬约束淘汰的候选里挑。** 一个把 maxColors 顶爆、或把细节
 *     打掉一半的候选，不可能是「最优输出」—— §7 说得很清楚：硬约束失败
 *     **直接淘汰**，与它别的指标多好无关。让 oracle 越过硬约束去挑，
 *     regret 就会把「选择器正确地拒绝了违规候选」记成「选择器选错了」。
 *  ② **只看指标。** 人工 QA 是 §24 的 contact sheet 的职责，由评测工具
 *     把 oracle 标在图旁边让人去核。**不许**让 oracle 偷看人工结论再回头
 *     改指标 —— 那会让 regret 永远为 0，指标也就失去了意义。
 *     实测就有反例：rf-complex 上纯指标 oracle 选了 bean-fit（0.08 ΔE 的收益），
 *     而看图那一版在天空渐变里明显更脏。这正是 §21 把 oracle 定义成
 *     「指标 **+ 人工 QA**」而不是「指标」的原因。
 */
export function oracleBest(entries, routedMode, limits = AUTO_TUNE_DEFAULTS) {
  const objective = objectiveFor(routedMode);
  const usable = entries.filter((e) => e.metrics && !e.error && e.accepted !== false);
  if (!usable.length) return null;
  return rankCandidates(usable, objective, limits)[0];
}

const browserApi = {
  AUTO_TUNE_DEFAULTS,
  AUTO_TUNE_PRODUCTION_MODES,
  HARD_CONSTRAINTS,
  TUNE_FAILURE_CLASSES,
  TUNE_FAILURE_RULES,
  checkHardConstraints,
  firstMaterialDifference,
  compareCandidates,
  rankCandidates,
  complexityCost,
  requiredGain,
  selectProfile,
  previewSizeFor,
  previewMaxColors,
  sourceFingerprint,
  paletteFingerprint,
  tuneCacheKey,
  overridesFingerprint,
  createTuneCache,
  nullMaskHash,
  isAutoTuneEnabledFor,
  createAutoTuner,
  computeRegret,
  summarizeRegret,
  classifyTuneFailure,
  oracleBest,
  objectiveFor,
  MODE_OBJECTIVES,
  MODE_PROFILES,
};
if (typeof window !== "undefined") window.LibmsAutoTune = browserApi;

export default browserApi;
