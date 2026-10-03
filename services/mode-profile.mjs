/**
 * Mode Profile Registry — Stage B4 §2「唯一 Generation Pipeline Contract」
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────
 * B4 §1 只读审计发现，同一个「模式 → 生成配置」的映射散在**三张表**里，
 * 而且彼此不一致：
 *
 *   1. smart-preprocessing/generation-engine-v2.mjs 的 `GenerationProfiles`
 *      —— 生产链路**不可达**：唯一的模式来源没有 `preset` 字段，
 *         `resolveOptions` 于是恒定回落 `GenerationProfiles.photo`。
 *         8 行 × 7 字段 = 56 个值只在 A/B 对比器直调 generateV2 时才生效。
 *         **本文件取代它，该表已删除。**
 *   2. services/generation-pipeline.mjs 的 `GENERATION_MODE_PRESETS`
 *      —— 生产链路活的表。现在它是**本表的视图**（re-export），不再是第二份数据。
 *   3. app.js 的 `buildV25Options` + `mapDetailProtectionValue`
 *      —— 遗留 UI 选择器的映射。现在只做「模式 → 请求参数」的适配，不再自造数值。
 *
 * ── 契约三条（不是风格建议，是硬约束）────────────────────────────────
 *
 *  ① **一个模式一行**，字段与单位全部写在 `MODE_PROFILE_FIELDS` 里，
 *     每个字段必须声明它的**下游读者**。
 *
 *  ② **每个字段都必须有下游读者。** 写了没人读的字段就是死配置 ——
 *     审计抓到 `cleanupStrength` 从 UI 一路走到 `resolveOptions` 然后被丢掉，
 *     于是 8 个模式的清理强度**全部无效**，pixel（10）与 logo（85）行为逐位相同。
 *     `tests/mode-profile-contract.test.mjs` 会逐字段反查消费点。
 *
 *  ③ **路由规则必须声明它依赖哪个证据字段。** 证据缺失 → 该规则不参与，
 *     不拿 0 当证据。审计抓到 `analyzeGenerationImage` 把 `portraitLikeness`
 *     硬编码为 0，而 `auto` 的第一条规则就是 `portraitLikeness >= .65` ——
 *     这条规则在数学上永不触发。现在证据字段不产出，规则就明确地是「惰性的」，
 *     而不是「看起来在工作」。
 *
 * ── 单位口径 ────────────────────────────────────────────────────────
 * 本表的数值字段一律 **0–100**（UI 滑杆口径，也是 store / project-store 的口径）。
 * 引擎侧（`generateV2`）要 0–1，换算**只发生在 `runGenerationPipeline` 一处边界**。
 * 双口径是历史包袱，但把它收敛到一个边界比散落各处的 `/100`、`*100` 安全得多。
 *
 * 纯数据 + 纯函数，无 DOM、无 window —— 可在 Worker / node --test 直接跑。
 */

/** 与 `sampling-engine-v2.mjs` 的 SamplingMode 一一对应。改动即为破坏性变更。 */
export const SAMPLING_STRATEGIES = Object.freeze(["auto", "linear-mean", "center", "dominant", "edge-aware"]);

/**
 * 字段契约。
 *
 * `engineKey` 是**引擎侧的键名**，不是注释 —— 它是可被测试反查的断言目标：
 * `tests/mode-profile-contract.test.mjs` 会断言
 *   ① 每个 `engineKey` 都能在管线源码里找到读取点（否则就是死配置）；
 *   ② `toEngineOptions()` 发出的每个键都被 `generateV2` 的 `resolveOptions` 认得。
 * 两条合起来，就是「写了没人读」这类 bug 的结构性防线。
 */
export const MODE_PROFILE_FIELDS = Object.freeze({
  sampling: {
    unit: "enum",
    values: SAMPLING_STRATEGIES,
    engineKey: "sampling",
    note: "采样策略：auto=逐格自适应（区域感知），其余四种是固定采样",
  },
  detailProtection: {
    unit: "0-100",
    engineKey: "detailProtection",
    note: "细节保护总量；引擎侧 = 值 / 100",
  },
  edgeProtection: {
    unit: "0-100",
    engineKey: "edgeProtection",
    note: "边缘保护量；引擎侧 = 值 / 100",
  },
  cleanupStrength: {
    unit: "0-100",
    engineKey: "cleanupProtectionThreshold",
    note: "清理强度。**引擎侧 = 值 / 100**（强度越高 → 保护阈值越高 → 清理越积极）。"
      + "该阈值同时供 smart-cleanup-v2 与 stroke-mask 使用。",
  },
  preserveEyes: {
    unit: "boolean",
    engineKey: "eyeProtection",
    note: "引擎侧 = 1 / 0",
  },
  preserveHighlights: {
    unit: "boolean",
    engineKey: "highlightProtection",
    note: "引擎侧 = 0.8 / 0",
  },
  preserveMicroDetails: {
    unit: "boolean",
    engineKey: "microDetailProtection",
    note: "引擎侧 = 0.8 / 0",
  },
  subjectCrop: {
    unit: "boolean",
    engineKey: "subjectCrop",
    note: "生成管线第 1 步（可选）：裁到主体",
  },
  autoBackground: {
    unit: "boolean",
    engineKey: "autoBackground",
    note: "生成管线第 4 步（可选）：可靠性门 + 掩码",
  },
  strokeProtection: {
    unit: "boolean",
    engineKey: "strokeProtection",
    note: "生成管线第 6 步（可选）：线稿描边抬保护",
  },
  accentProtection: {
    unit: "boolean",
    engineKey: "accentProtection",
    note: "生成管线第 8 步（可选）：降色时锚点色不主动合并",
  },
});

/** 公开模式（§3 内部模式纪律：界面只暴露这 8 个，且不得出现底层算法名）。 */
export const GENERATION_MODES = Object.freeze([
  "beginner", "auto", "portrait", "anime", "illustration", "pixel", "logo", "photo",
]);

/** 界面文案。放在这里是为了让「模式清单」只有一份来源。 */
export const MODE_LABELS = Object.freeze({
  beginner: "小白一键",
  auto: "智能",
  portrait: "人像",
  anime: "动漫",
  illustration: "插画",
  pixel: "像素",
  logo: "Logo",
  photo: "写实",
});

const BASE_PROFILE = Object.freeze({
  sampling: "auto",
  detailProtection: 70,
  edgeProtection: 70,
  cleanupStrength: 50,
  preserveEyes: true,
  preserveHighlights: true,
  preserveMicroDetails: true,
  subjectCrop: false,
  autoBackground: false,
  strokeProtection: false,
  accentProtection: false,
});

export const MODE_PROFILES = Object.freeze({
  // 小白一键：四个智能辅助全开，保护档偏保守，清理温和。
  beginner: Object.freeze({ ...BASE_PROFILE, detailProtection: 80, edgeProtection: 90, cleanupStrength: 45, subjectCrop: true, autoBackground: true, strokeProtection: true, accentProtection: true }),
  auto: Object.freeze({ ...BASE_PROFILE }),
  portrait: Object.freeze({ ...BASE_PROFILE, sampling: "edge-aware", detailProtection: 90, edgeProtection: 75, cleanupStrength: 35 }),
  anime: Object.freeze({ ...BASE_PROFILE, sampling: "dominant", detailProtection: 90, edgeProtection: 90, cleanupStrength: 45 }),
  illustration: Object.freeze({ ...BASE_PROFILE, sampling: "dominant", detailProtection: 70, edgeProtection: 85, cleanupStrength: 55, preserveEyes: false }),
  pixel: Object.freeze({ ...BASE_PROFILE, sampling: "center", detailProtection: 100, edgeProtection: 100, cleanupStrength: 10 }),
  logo: Object.freeze({ ...BASE_PROFILE, sampling: "dominant", detailProtection: 35, edgeProtection: 95, cleanupStrength: 85, preserveEyes: false, preserveHighlights: false, preserveMicroDetails: false }),
  photo: Object.freeze({ ...BASE_PROFILE, sampling: "linear-mean", detailProtection: 70, edgeProtection: 70, cleanupStrength: 40 }),
});

/**
 * `auto` 模式的路由规则。**按顺序取第一条命中的。**
 *
 * `evidence` 声明这条规则依赖哪个证据字段：字段在 analysis 里不存在（或不是有限数）
 * → 规则直接跳过。这样「没人算的指标」不会靠一个假的 0 让规则看起来在参与。
 *
 * 注：`portraitLikeness` 目前**没有任何生产者**（`analyzeGenerationImage` 不再伪造 0），
 * 所以第一条规则现在是惰性的。等真的人像检测落地、analysis 里出现这个字段，
 * 规则自动生效 —— 不需要改这里一行。
 */
export const MODE_ROUTING_RULES = Object.freeze([
  {
    id: "portrait",
    to: "portrait",
    evidence: ["portraitLikeness"],
    test: (analysis) => analysis.portraitLikeness >= 0.65,
    note: "人像优先：面部/眼睛细节最容易被清理糊掉，必须在其它规则之前判",
  },
  {
    id: "pixel",
    to: "pixel",
    evidence: ["pixelLikeness"],
    test: (analysis) => analysis.pixelLikeness >= 0.62,
    note: "像素画：块状、平坦、低色数",
  },
  {
    id: "illustration",
    to: "illustration",
    evidence: ["flatRegionRatio", "edgeDensity"],
    test: (analysis) => analysis.flatRegionRatio >= 0.58 && analysis.edgeDensity >= 0.12,
    note: "插画：大面积平色 + 明显轮廓",
  },
  {
    id: "photo",
    to: "photo",
    evidence: ["textureScore", "colorComplexity"],
    test: (analysis) => analysis.textureScore >= 0.42 || analysis.colorComplexity >= 0.55,
    note: "写实：纹理丰富或颜色复杂",
  },
]);

/* =========================================================
 * 校验 / 归一
 * ======================================================= */

const clampInt = (value, min, max) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
};

/** 证据字段是否真的存在。**不接受 null / undefined / NaN** —— 那就是「没算」。 */
function hasEvidence(analysis, keys) {
  return keys.every((key) => {
    const value = analysis?.[key];
    return value != null && Number.isFinite(Number(value));
  });
}

/**
 * 解析 `auto` 该路由到哪个模式。非 auto 模式原样返回（模式是用户的显式选择）。
 *
 * ── §12.3 之后：新分类器优先，旧规则降级为「显式证据」兼容路径 ──────────
 * `analysis.routing` 由 `source-classifier.mjs` 的 `classifySource()` 产出
 * （`generation-pipeline.mjs` 的 `runGenerationPipeline` 把它挂进 analysis）。
 * 只要它带着一个合法的引擎模式名，就以它为准 —— 包括它判「信心不足」时
 * 返回的 `"auto"`：那是「不要强猜」的明确表态，不该再被旧规则覆盖回去。
 *
 * `MODE_ROUTING_RULES` **保留**，因为它是「调用方直接注入显式证据」的路径：
 * 契约测试与 `generation-pipeline-consolidation.test.mjs` 都在用
 * `resolveRoutedMode("auto", { pixelLikeness: 0.8 })` 这种形式。
 * 那条路径的 `pixelLikeness` 已知是**反向信号**（§12.1：命中 9 张、真阳性 0 张），
 * 所以它只服务于「显式声明」的调用方，不再是真实图片的默认路由。
 */
export function resolveRoutedMode(mode, analysis = {}) {
  const selected = GENERATION_MODES.includes(mode) ? mode : "auto";
  if (selected !== "auto") return selected;
  const routed = analysis?.routing;
  if (routed && typeof routed.mode === "string" && GENERATION_MODES.includes(routed.mode)) {
    return routed.mode;
  }
  for (const rule of MODE_ROUTING_RULES) {
    if (!hasEvidence(analysis, rule.evidence)) continue;
    if (rule.test(analysis)) return rule.to;
  }
  return "auto";
}

/**
 * 取某个模式的完整档案（深冻结副本）。
 * 未知模式回落 `auto` —— 与历史行为一致，但**会在这里被显式表达**，不再是隐式巧合。
 */
export function resolveModeProfile(mode) {
  const key = GENERATION_MODES.includes(mode) ? mode : "auto";
  return { ...MODE_PROFILES[key] };
}

/**
 * 归一化覆盖项。
 *
 * 纪律：**只校验已知字段，未知字段原样透传。**
 * 契约层（generation-request.mjs）刻意用 `{...overrides}` 而不是白名单，
 * 就是为了「新增选项不被静默丢掉」；这里再收一次白名单等于把那道防线拆了。
 * 未知字段留给下游自己判定 —— 读不懂的字段不参与计算，但也不会被抹掉。
 */
export function normalizeModeOverrides(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const next = { ...source };
  for (const [field, spec] of Object.entries(MODE_PROFILE_FIELDS)) {
    if (!(field in source)) continue;
    const value = source[field];
    if (spec.unit === "enum") {
      // 非法采样策略 → **保持档案自己的值**（下面用 undefined 表示「不覆盖」）。
      // 历史实现是回落到 "auto"，那会在一个显式选了 dominant 的模式上
      // 静默切换成自适应采样 —— 一个错值换另一个错值。
      if (!spec.values.includes(value)) delete next[field];
    } else if (spec.unit === "boolean") {
      next[field] = value === true;
    } else {
      const clamped = clampInt(value, 0, 100);
      if (clamped == null) delete next[field];
      else next[field] = clamped;
    }
  }
  return next;
}

/**
 * 模式 → 完整生成配置。**这是模式表的唯一出口。**
 *
 * @param {string} mode                 用户选的模式（8 个公开模式之一）
 * @param {object} [imageAnalysis]      `analyzeGenerationImage` 的输出（auto 路由用）
 * @param {object} [overrides]          手动覆盖项（面板滑杆 / 请求 overrides）
 * @returns {{mode:string, routedMode:string, analysis:object} & Record<string, any>}
 */
export function resolveGenerationPipeline(mode = "auto", imageAnalysis = null, overrides = {}) {
  const selectedMode = GENERATION_MODES.includes(mode) ? mode : "auto";
  const analysis = imageAnalysis && typeof imageAnalysis === "object" ? { ...imageAnalysis } : {};
  const routedMode = resolveRoutedMode(selectedMode, analysis);
  return {
    mode: selectedMode,
    routedMode,
    analysis,
    ...MODE_PROFILES[routedMode],
    ...normalizeModeOverrides(overrides),
  };
}

/**
 * **不是**模式字段，但必须原样透传给引擎的辅助配置。
 *
 * 这些由调用方以 overrides 传进来（例如 B2 的背景阈值覆盖
 * `{ autoBackground: true, backgroundConfig: { maxColorDelta: 18 } }`）。
 * `toEngineOptions` 只从档案里挑已知字段，所以必须显式把它们带上 ——
 * 漏掉任何一个，那个覆盖就会被**静默丢弃**（B4 §2 实测踩过一次：
 * `backgroundConfig` 被吃掉，B2 的可调阈值全部失效）。
 *
 * 完整清单来自 `generateV2` 的 `resolveOptions`：任何它读、而模式表不产出的键，
 * 都要出现在这里。
 */
export const ENGINE_PASSTHROUGH_KEYS = Object.freeze([
  "strokeProtectionGain",
  "subjectCropConfig",
  "backgroundConfig",
  "strokeConfig",
  "accentConfig",
]);

/**
 * 把 0–100 的档案值换算成引擎侧 0–1 的 `generateV2` 选项。
 *
 * **唯一的单位换算边界。** 放这里而不是散在调用方，是为了让
 * 「谁在什么口径下说话」有一个可测试的答案。
 */
export function toEngineOptions(profile, { maxColors = 0, onPhase } = {}) {
  const to01 = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number / 100)) : fallback;
  };
  const options = {
    sampling: profile.sampling,
    detailProtection: to01(profile.detailProtection, 0.7),
    edgeProtection: to01(profile.edgeProtection, 0.7),
    // 清理强度越高 → 保护阈值越高 → 清理越积极（smart-cleanup-v2 里
    // `avgProtection >= threshold` 即跳过，所以阈值高 = 跳过少 = 清得多）。
    cleanupProtectionThreshold: to01(profile.cleanupStrength, 0.5),
    highlightProtection: profile.preserveHighlights ? 0.8 : 0,
    eyeProtection: profile.preserveEyes ? 1 : 0,
    microDetailProtection: profile.preserveMicroDetails ? 0.8 : 0,
    subjectCrop: profile.subjectCrop === true,
    autoBackground: profile.autoBackground === true,
    strokeProtection: profile.strokeProtection === true,
    accentProtection: profile.accentProtection === true,
    maxColors: Number(maxColors) || 0,
    onPhase: typeof onPhase === "function" ? onPhase : undefined,
  };
  for (const key of ENGINE_PASSTHROUGH_KEYS) {
    if (profile[key] !== undefined) options[key] = profile[key];
  }
  return options;
}

const browserApi = {
  MODE_PROFILES,
  MODE_PROFILE_FIELDS,
  MODE_ROUTING_RULES,
  MODE_LABELS,
  GENERATION_MODES,
  SAMPLING_STRATEGIES,
  ENGINE_PASSTHROUGH_KEYS,
  resolveModeProfile,
  resolveRoutedMode,
  resolveGenerationPipeline,
  normalizeModeOverrides,
  toEngineOptions,
};
if (typeof window !== "undefined") window.LibmsModeProfile = browserApi;

export default browserApi;
