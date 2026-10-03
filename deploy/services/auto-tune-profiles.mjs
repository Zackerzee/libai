/**
 * Auto Tune Profile Registry — Stage B4 §13 §2 / §3 / §4 / §9
 *
 * ── 这个文件是什么 ────────────────────────────────────────────────────
 * §13 的 Auto Tune **不创造新算法**，它只从一组「已验证的候选 Profile」里挑一套。
 * 这个文件就是那组候选的**唯一来源**：Profile 定义、按路由模式的资格表、
 * 每个模式的排序目标、以及「候选之间不许变的字段」。
 *
 * ── 三条硬纪律 ────────────────────────────────────────────────────────
 *
 *  ① **不复制完整配置对象。** 每个 Profile 只写 `overrides`（相对
 *     `MODE_PROFILES[routedMode]` 的**增量**）。复制一整份配置的后果不是报错，
 *     是「模式表改了、候选还是旧值」—— 而那个候选看起来还在正常工作。
 *     `tests/auto-tune-profile-registry.test.mjs` 会断言每个 override 键
 *     都在 `MODE_PROFILE_FIELDS` 里，且值通过 `normalizeModeOverrides` 后**不变**。
 *
 *  ② **候选不许改取景。** §6 要求 preview 与正式生成「保持 crop ratio / background
 *     decision / palette」。取景一变，任何按归一化坐标做的比较都不再成立
 *     （§4/§5 已经量过：beginner 的 subjectCrop 让 10 类里 8 类变了取景）。
 *     所以 `subjectCrop` / `autoBackground` / `strokeProtection` / `accentProtection`
 *     被列为**取景不变量**，任何 Profile 都不许覆盖它们 —— 不是靠纪律，
 *     是靠测试会红。
 *
 *  ③ **REJECT 的算法不许回到搜索空间。** §0 已经裁掉 Spatial Refine /
 *     Conservative Cleanup / Neutral Protection / Dual Mode。这份表里只允许
 *     `bean-fit` 一个 lab 候选，且由 `AUTO_TUNE_LAB_CANDIDATES` 显式列举 ——
 *     想加回来必须同时改这个白名单和它的守卫测试，改不动的是「悄悄加一个」。
 *
 * 纯数据 + 纯函数，无 DOM、无 window。
 */

import { GENERATION_MODES, MODE_PROFILE_FIELDS, MODE_PROFILES } from "./mode-profile.mjs";

/* =========================================================
 * §6 取景不变量 / 可调字段
 * ======================================================= */

/**
 * **候选之间不许变**的字段。
 *
 * 为什么是这四个：它们都会改变「哪块源像素落到哪一格」或「哪些格子是空的」。
 *   subjectCrop      改变取景窗口 → 归一化坐标全部错位
 *   autoBackground   改变空豆集合 → 空豆数、填充率、所有按格平均的指标都变
 *   strokeProtection 改变保护图 → 属于「算法本身」而非「调优旋钮」
 *   accentProtection 同上
 * 前三项由 §6 明确要求「不得改变 source framing / background decision」。
 * stroke/accent 一并列进来，是因为它们同样不是「保守一点 / 激进一点」的旋钮，
 * 而是**换了一套算法**——那属于新增候选，不属于 Auto Tune。
 */
export const FRAMING_INVARIANT_FIELDS = Object.freeze([
  "subjectCrop", "autoBackground", "strokeProtection", "accentProtection",
]);

/**
 * Auto Tune 允许调的字段 —— **就是 ModeProfile 里除取景不变量以外的全部**。
 * 由测试断言「不变量 ∪ 可调字段 == MODE_PROFILE_FIELDS 的键集」，
 * 所以将来给模式表加字段时，这个划分不可能被漏掉。
 */
export const TUNEABLE_FIELDS = Object.freeze(
  Object.keys(MODE_PROFILE_FIELDS).filter((field) => !FRAMING_INVARIANT_FIELDS.includes(field)),
);

/**
 * 允许 Auto Tune 引用的 lab 候选。**只有 bean-fit。**
 *
 * §0 的裁定：Spatial Refine / Conservative Cleanup / Neutral Protection / Dual Mode
 * 全部 REJECT，禁止放回搜索空间。加一个 id 到这里 = 重新打开一个已裁掉的算法，
 * 必须同时改 `tests/auto-tune-profile-registry.test.mjs` 里那条「REJECT 名单
 * 一个都不许出现」的守卫 —— 那道守卫是故意做成「改起来很显眼」的。
 */
export const AUTO_TUNE_LAB_CANDIDATES = Object.freeze(["bean-fit"]);

/* =========================================================
 * §2 Profile 定义
 * ======================================================= */

const profile = (id, label, overrides = {}, extra = {}) => Object.freeze({
  id,
  label,
  overrides: Object.freeze({ ...overrides }),
  labCandidate: null,
  note: "",
  ...extra,
});

/**
 * 候选 Profile 全集。
 *
 * 每个 id 都带模式前缀（`portrait-standard` 而不是 `standard`）：
 * 报告里要能一眼看出「这一列是人像模式的哪一套」，而 `standard` 这种名字
 * 在一张同时有 5 个模式的表里等于没说。
 *
 * 每个模式的第一个条目**必须是该模式的 `*-standard`**（无覆盖 = 生产行为），
 * 因为 §23 的安全规则要求「没有明确更优候选就选 STANDARD」，
 * 而「STANDARD」在实现上就是「列表里第一个、overrides 为空的那个」。
 * 守卫会断言这条结构性质。
 */
export const AUTO_TUNE_PROFILES = Object.freeze([
  /* ── SMART-GENERAL：路由没把握（routedMode = auto）时的兜底集合 ── */
  profile("smart-standard", "智能·标准"),
  profile("smart-detail-safe", "智能·细节保守", { detailProtection: 85, edgeProtection: 85 }, {
    note: "把保护整体抬一档。对「清理把细线吃掉了」这类失败是最小干预。",
  }),
  profile("smart-bean-fit", "智能·豆色拟合", {}, {
    labCandidate: "bean-fit",
    note: "§12 的 Bean Fit。模式策略表会自己决定跑不跑（pixel / logo 直接 OFF）。",
  }),

  /* ── PORTRAIT ── */
  profile("portrait-standard", "人像·标准"),
  profile("portrait-detail", "人像·细节", { detailProtection: 95, edgeProtection: 80 }, {
    note: "细节档再抬 5、边缘反而放松 5：人像的失败形态是「皮肤被切碎」，不是「边缘不够锐」。",
  }),
  profile("portrait-bean-fit", "人像·豆色拟合", {}, { labCandidate: "bean-fit" }),
  profile("portrait-bean-fit-detail", "人像·豆色拟合+细节", { detailProtection: 95, edgeProtection: 80 }, {
    labCandidate: "bean-fit",
  }),

  /* ── REALISTIC（引擎里叫 photo）── */
  profile("realistic-standard", "写实·标准"),
  profile("realistic-detail-safe", "写实·细节保守", { detailProtection: 80, edgeProtection: 80 }),
  profile("realistic-bean-fit", "写实·豆色拟合", {}, { labCandidate: "bean-fit" }),

  /* ── ILLUSTRATION ── */
  profile("illustration-standard", "插画·标准"),
  profile("illustration-flat-safe", "插画·平区保守", { cleanupStrength: 40, edgeProtection: 92 }, {
    note: "降清理强度 + 抬边缘保护：插画的大片平色最怕被清理出噪点。",
  }),
  profile("illustration-bean-fit", "插画·豆色拟合", {}, { labCandidate: "bean-fit" }),

  /* ── ANIME ── */
  profile("anime-standard", "动漫·标准"),
  profile("anime-detail-safe", "动漫·细节保守", { detailProtection: 96, edgeProtection: 95 }, {
    note: "§4 明确：动漫**不放 Bean Fit**（§12 没有数据支持它在这一档可用）。",
  }),

  /* ── PIXEL / LOGO：§9 明确禁止 Auto Tune 改算法，各只留一个 ── */
  profile("pixel-standard", "像素·标准", {}, {
    note: "§9：禁止 Auto Tune 改算法。像素画逐块保留就是零失真，任何「优化」都只会引入失真。",
  }),
  profile("logo-standard", "Logo·标准", {}, {
    note: "§9：禁止 Auto Tune 扩色。Logo 的失败形态是「颜色多出来」，不是「不够像」。",
  }),

  /* ── BEGINNER：§9 的优先级是稳定 / 低色数 / 低碎片，不追最低 ΔE ── */
  profile("beginner-safe", "小白·安全"),
  profile("beginner-low-color", "小白·低色数", { cleanupStrength: 70, detailProtection: 60 }, {
    note: "§9：小白档不追求最低 ΔE。宁可少几色、少几块，也不要一张碎成渣的图。",
  }),
]);

export const AUTO_TUNE_PROFILE_BY_ID = Object.freeze(
  Object.fromEntries(AUTO_TUNE_PROFILES.map((p) => [p.id, p])),
);

/* =========================================================
 * §4 候选资格
 * ======================================================= */

/**
 * 路由模式 → 允许的候选 id（**有序，第一个必须是该模式的 standard**）。
 *
 * 资格是**硬**的：`resolveCandidates()` 只从这张表取，不会「因为某个候选分数高」
 * 就把它拉进来。§4 的几条例外都写在这里：
 *   · pixel / logo 只有一个候选 —— §9「禁止 Auto Tune 改算法 / 扩色」
 *   · anime 不放 bean-fit   —— §4「不允许 Bean Fit，除非 §12 数据明确证明可用」
 *   · illustration 放 bean-fit —— §12 把插画列为 experimental 档，§13 继续测
 */
export const AUTO_TUNE_ELIGIBILITY = Object.freeze({
  auto: Object.freeze(["smart-standard", "smart-detail-safe", "smart-bean-fit"]),
  portrait: Object.freeze(["portrait-standard", "portrait-detail", "portrait-bean-fit", "portrait-bean-fit-detail"]),
  photo: Object.freeze(["realistic-standard", "realistic-detail-safe", "realistic-bean-fit"]),
  illustration: Object.freeze(["illustration-standard", "illustration-flat-safe", "illustration-bean-fit"]),
  anime: Object.freeze(["anime-standard", "anime-detail-safe"]),
  pixel: Object.freeze(["pixel-standard"]),
  logo: Object.freeze(["logo-standard"]),
  beginner: Object.freeze(["beginner-safe", "beginner-low-color"]),
});

/**
 * 第一阶段**生产**可用的 lab 候选白名单。
 *
 * 空数组 = 生产里一个 lab 候选都不跑，Auto Tune 只挑纯 ModeProfile 的候选。
 * 为什么默认空：§12 的原话是「不要接生产，先跑 bench」；§13 的任务是**继续测**。
 * 这份名单由 §13 的评测结果决定 —— 只有当某个模式上 Bean Fit 在 regret 与
 * 人工看图两条都过关，才把 `bean-fit` 加进来。空数组是**结论**，不是占位。
 */
export const PRODUCTION_LAB_CANDIDATES = Object.freeze([]);

/* =========================================================
 * §9 模式目标（字典序，不是加权分数）
 * ======================================================= */

const crit = (metric, direction, epsilon, note) => Object.freeze({ metric, direction, epsilon, note });

/**
 * 每个模式的**字典序**排序目标。
 *
 * §10 明确不要 `score = 0.273*A + 0.194*B + …`。理由不是「权重难调」，
 * 而是加权分数**无法解释**：当候选 X 以 0.003 的优势胜出时，报告里只能说
 * 「它分更高」，说不出「它高在哪」。字典序给出的是一句话：
 * 「先看 detailRetention，差 0.01 以内才比下一项」。
 *
 * `epsilon` 是**无差异阈值**：两个候选在这一项上的差小于它 → 视为打平，看下一项。
 * `epsilon: null` 表示这一项没有阈值（只有前面全部打平时才会用到它，
 * 那时任何差异都算数 —— 用来在完全同分时给出一个确定的顺序）。
 *
 * 顺序不是随便排的：§9 每一项的次序都照抄规范给的优先级。
 */
export const MODE_OBJECTIVES = Object.freeze({
  // 1 面部/细节保持 · 2 肤色保真 · 3 边缘保持 · 4 整体色差 · 5 碎化
  portrait: Object.freeze([
    crit("detailRetention", "max", 0.010, "§9-1 面部/细节保持"),
    crit("skinError", "min", 0.50, "§9-2 肤色保真（平均 ΔE，允许差 0.5）"),
    crit("edgeRetention", "max", 0.010, "§9-3 边缘保持"),
    crit("perceptualError", "min", 0.05, "§9-4 整体色差"),
    crit("fragmentation", "min", null, "§9-5 碎化"),
  ]),
  // 1 整体色差 · 2 影调/细节保持 · 3 边缘保持 · 4 碎化
  photo: Object.freeze([
    crit("perceptualError", "min", 0.05, "§9-1 整体色差"),
    crit("tonalError", "min", 0.30, "§9-2 影调保持（只看明暗）"),
    crit("detailRetention", "max", 0.010, "§9-2 细节保持"),
    crit("edgeRetention", "max", 0.010, "§9-3 边缘保持"),
    crit("fragmentation", "min", null, "§9-4 碎化"),
  ]),
  // 1 边缘保持 · 2 细节保持 · 3 平区稳定 · 4 碎化 · 5 整体色差
  anime: Object.freeze([
    crit("edgeRetention", "max", 0.008, "§9-1 边缘保持"),
    crit("detailRetention", "max", 0.010, "§9-2 细节保持"),
    crit("flatAreaStability", "max", 0.010, "§9-3 平区稳定（不许在平色里造噪点）"),
    crit("fragmentation", "min", 0.50, "§9-4 碎化"),
    crit("perceptualError", "min", null, "§9-5 整体色差"),
  ]),
  // 1 整体色差 · 2 区域一致性 · 3 细节保持 · 4 碎化
  illustration: Object.freeze([
    crit("perceptualError", "min", 0.05, "§9-1 整体色差"),
    crit("flatAreaStability", "max", 0.010, "§9-2 区域一致性（平区不许被切碎）"),
    crit("detailRetention", "max", 0.010, "§9-3 细节保持"),
    crit("fragmentation", "min", null, "§9-4 碎化"),
  ]),
  // 兜底集合：不知道内容是什么。§9 没给 SMART 的目标，所以这里的排序原则是
  // **「不许变差」优先于「变得更好」** —— 路由没把握时，赌一个「更聪明」的候选
  // 换来的期望收益最低、下行风险最高。
  //
  // 为什么 fragmentation 排第一：实测（§13 评测，25 张夹具）里
  // 「保护整体抬一档」这一档在**所有** auto 路由的夹具上把碎化翻倍
  // （L 14.79→20.43、O 4.44→10.36、rf-anime-hl 4.99→9.89、N 17.57→22.19），
  // 孤立像素同步翻倍。它换来的 edgeRetention 只有 +0.05。
  // 一个把图切得更碎的候选，不该因为「轮廓更锐」就赢 —— 那是过度处理，
  // 也正是 §12 在 Conservative Cleanup 上看到的同一种失败形态。
  auto: Object.freeze([
    crit("fragmentation", "min", 0.50, "兜底：先保证图没被切碎"),
    crit("edgeRetention", "max", 0.010, "兜底：轮廓"),
    crit("detailRetention", "max", 0.010, "兜底：细节"),
    crit("flatAreaStability", "max", 0.010, "兜底：平区稳定"),
    crit("perceptualError", "min", null, "兜底：整体色差（末位 tie-break）"),
  ]),
  // §9：稳定 · 低色数 · 低碎片 · 低风险，**不追求最低 ΔE**
  //
  // ⚠️ **「稳定」必须排在「低色数」前面**，这不是口味问题。
  // 一开始这里的第一判据是 `usedColors`，结果一条把整幅图糊成纯色的候选
  // 在 beginner 上**胜出**了 —— 它的用色数是 1、碎化 0、孤立像素 0，
  // 按 §9 那四项字面意义它确实「最好」，可它把图毁了。
  // 而且硬约束 D 拦不住它：`structureLossTolerance` 是 0.05，
  // 糊色只要没把 detailRetention 打掉 5% 就能过。
  // 修法是把 §9 自己列在第一位的「稳定」放回第一位：
  // 先用 detailRetention / flatAreaStability 保证图**还在**，
  // 再谈色数、碎片、风险。实测这条一改，纯色候选立刻落到第 2 名之后。
  beginner: Object.freeze([
    crit("detailRetention", "max", 0.010, "§9-1 稳定：细节先保住（图不能被压平）"),
    crit("flatAreaStability", "max", 0.010, "§9-1 稳定：平区不许被切碎"),
    crit("usedColors", "min", 0.50, "§9-2 低色数"),
    crit("fragmentation", "min", 0.50, "§9-3 低碎片"),
    crit("tinyRegions", "min", 1.00, "§9-4 低风险（小碎块）"),
    crit("perceptualError", "min", null, "§9 明确排在最后：不追求最低 ΔE"),
  ]),
  // §9：禁止改算法。目标表留一条「任何指标都不许退化」，纯为了给评测器一个确定的
  // 排序口径；实际上 pixel / logo 的候选集只有一个，排序永远不会被用到。
  pixel: Object.freeze([
    crit("perceptualError", "min", 0.001, "§9 像素画：逐块保留即零失真，任何变化都是退化"),
    crit("usedColors", "min", null, "§9 禁止扩色"),
  ]),
  logo: Object.freeze([
    crit("usedColors", "min", 0.001, "§9 Logo：禁止扩色"),
    crit("perceptualError", "min", null, "§9 其余指标只做兜底"),
  ]),
});

/** 没有专属目标表的模式用 `auto` 的兜底目标。 */
export function objectiveFor(routedMode) {
  return MODE_OBJECTIVES[routedMode] || MODE_OBJECTIVES.auto;
}

/* =========================================================
 * 解析
 * ======================================================= */

const isMode = (mode) => GENERATION_MODES.includes(mode);

/**
 * 某个路由模式下的候选清单。
 *
 * @param {string} routedMode 路由之后的模式（不是用户选的模式）
 * @param {{ production?: boolean }} [options]
 *   `production: true` 时过滤掉不在 `PRODUCTION_LAB_CANDIDATES` 里的 lab 候选。
 * @returns {Array<{id,label,mode,baseProfile,overrides,labCandidate,note}>}
 */
export function resolveCandidates(routedMode, { production = false } = {}) {
  const mode = isMode(routedMode) ? routedMode : "auto";
  const ids = AUTO_TUNE_ELIGIBILITY[mode] || AUTO_TUNE_ELIGIBILITY.auto;
  const baseProfile = MODE_PROFILES[mode];
  return ids
    .map((id) => AUTO_TUNE_PROFILE_BY_ID[id])
    .filter(Boolean)
    .filter((p) => !production || p.labCandidate == null || PRODUCTION_LAB_CANDIDATES.includes(p.labCandidate))
    .map((p) => Object.freeze({
      id: p.id,
      label: p.label,
      mode,
      baseProfile,
      overrides: p.overrides,
      labCandidate: p.labCandidate,
      note: p.note,
    }));
}

/** 该模式的「STANDARD」候选 id —— 就是资格表里的第一个。 */
export function standardProfileId(routedMode) {
  const mode = isMode(routedMode) ? routedMode : "auto";
  return (AUTO_TUNE_ELIGIBILITY[mode] || AUTO_TUNE_ELIGIBILITY.auto)[0];
}

/**
 * 把候选解析成**可以直接喂给 `resolveGenerationPipeline` 的 overrides**。
 *
 * 只产出「相对基线档案的增量」—— 基线由 `MODE_PROFILES[routedMode]` 提供，
 * 这里再复制一份就回到了纪律①要防的那件事。
 * `labCandidate` 单独放在第二个返回值里，因为它**不是** ModeProfile 字段，
 * 不能混进 overrides（混进去会被 `toEngineOptions` 静默丢掉，然后
 * 「候选明明挂了 Bean Fit、结果和 standard 逐位相同」）。
 */
export function resolveCandidateRequest(candidate) {
  const overrides = { ...candidate.overrides };
  return {
    profileId: candidate.id,
    mode: candidate.mode,
    overrides,
    labCandidate: candidate.labCandidate ?? null,
  };
}

const browserApi = {
  FRAMING_INVARIANT_FIELDS,
  TUNEABLE_FIELDS,
  AUTO_TUNE_LAB_CANDIDATES,
  PRODUCTION_LAB_CANDIDATES,
  AUTO_TUNE_PROFILES,
  AUTO_TUNE_PROFILE_BY_ID,
  AUTO_TUNE_ELIGIBILITY,
  MODE_OBJECTIVES,
  objectiveFor,
  resolveCandidates,
  resolveCandidateRequest,
  standardProfileId,
};
if (typeof window !== "undefined") window.LibmsAutoTuneProfiles = browserApi;

export default browserApi;
