/**
 * 背景处理三模式 —— 阶段 3 的**唯一契约层**。
 *
 * 为什么单独一个文件：这三个模式的面板（ui/generation-panel.js）、宿主映射
 * （app.js buildV25Options）、预检（services/background-preview-service.mjs）
 * 与工作台（ui/workspace.js）都要回答同一个问题「这个模式意味着什么」。
 * 四家各写一份 if/else，迟早出现「面板说保留背景、引擎当真抠背景」这类分叉 ——
 * B2 §17 §18 的 backgroundRemoval/autoBackground 镜像分叉就是这么来的。
 *
 * ── 三个模式的语义（互不相同，不是同义反复）──────────────────────
 *   keep        保留背景：图像所有区域都是内容。原图透明区域用「图片调整」里的
 *               背景色填充（默认白），变成实体豆。不跑任何背景移除。
 *   transparent 保留原图透明区域：原图里以透明像素为主的格留空（null 豆），
 *               不填豆。**这是改造前的既成行为**（采样引擎跳过透明像素 →
 *               空色 → 空豆），默认值必须是它，否则每个上传透明 PNG 的老用户
 *               都会在一夜之间看到行为变化。
 *   auto        自动移除纯色背景：既有可靠性门（background-reliability.mjs）——
 *               只删与边框连通的同色浅底，uncertain/none 一律保持原图。
 *
 * ── 与既有字段的关系 ────────────────────────────────────────────
 * 引擎侧只认两个既有选项（不新增第二套处理器）：
 *   · autoBackground（mode-profile 的既有布尔字段）—— auto 模式时为 true；
 *   · transparentFill（阶段 3 新增的透传键）—— keep 模式时为背景色，
 *     其余模式为 null。
 * 面板/ store 侧的 backgroundRemoval 保留为兼容镜像（= mode === "auto"），
 * 已有读者（smart 报告 / 快照测试）不断链。
 */

export const BACKGROUND_MODES = Object.freeze({
  KEEP: "keep",
  TRANSPARENT: "transparent",
  AUTO: "auto",
});

/** 默认模式：transparent = 与改造前逐位一致（见文件头）。 */
export const DEFAULT_BACKGROUND_MODE = BACKGROUND_MODES.TRANSPARENT;

/** 合法模式 id 集合（顺序即界面展示顺序）。 */
export const BACKGROUND_MODE_IDS = Object.freeze([
  BACKGROUND_MODES.KEEP,
  BACKGROUND_MODES.TRANSPARENT,
  BACKGROUND_MODES.AUTO,
]);

/** 界面文案。面板卡片、预检条、文档共用这一份。 */
export const BACKGROUND_MODE_LIST = Object.freeze([
  {
    id: BACKGROUND_MODES.KEEP,
    title: "保留背景",
    description: "所有区域都生成豆；原图透明区域用「图片调整」的背景色填充",
  },
  {
    id: BACKGROUND_MODES.TRANSPARENT,
    title: "保留原图透明区域",
    description: "原图中的透明区域留空、不填豆，适合贴纸类图案",
  },
  {
    id: BACKGROUND_MODES.AUTO,
    title: "自动移除纯色背景",
    description: "检测并移除与边缘相连的纯色背景；复杂背景不强行删除",
  },
]);

/** 预检条/状态行用的短提示（每个模式一句，说明这一模式到底会动什么）。 */
export const BACKGROUND_MODE_HINTS = Object.freeze({
  [BACKGROUND_MODES.KEEP]: "透明区域将填充为背景色（在「图片调整」中修改，默认白色）",
  [BACKGROUND_MODES.TRANSPARENT]: "透明区域将留空、不填豆；这是默认行为",
  [BACKGROUND_MODES.AUTO]: "生成时检测纯色背景；不确定时保持原图，不强行删除",
});

/** 把任意输入收敛成合法模式 id；不认识的值回落到默认（transparent）。 */
export function normalizeBackgroundMode(value) {
  return BACKGROUND_MODE_IDS.includes(value) ? value : DEFAULT_BACKGROUND_MODE;
}

/**
 * 从一份「设置对象」里读背景模式。**向后兼容**：
 *   1. 有合法 backgroundMode → 用它；
 *   2. 否则 autoBackground === true（B2 时代的单一开关）→ "auto"；
 *   3. 否则 → 默认 transparent。
 * 老存档/旧调用方只带 autoBackground，不得因为不认识新字段就静默改变行为。
 */
export function backgroundModeOf(settings = {}) {
  if (settings && typeof settings === "object") {
    if (BACKGROUND_MODE_IDS.includes(settings.backgroundMode)) return settings.backgroundMode;
    if (settings.autoBackground === true) return BACKGROUND_MODES.AUTO;
  }
  return DEFAULT_BACKGROUND_MODE;
}

/**
 * 模式 → 引擎选项。**这是模式到引擎的唯一翻译处。**
 *
 * @param {string} mode keep / transparent / auto
 * @param {{fillColor?:string|null}} [context] keep 模式的填充色（来自源图变换的
 *   背景色）。只有 keep 模式会用到它。
 * @returns {{autoBackground:boolean, transparentFill:string|null}}
 */
export function resolveBackgroundModeOptions(mode = DEFAULT_BACKGROUND_MODE, { fillColor = null } = {}) {
  const resolved = normalizeBackgroundMode(mode);
  if (resolved === BACKGROUND_MODES.AUTO) {
    // auto：既有链路。可靠性门自己处理透明格（B2 §11），不需要填充。
    return { autoBackground: true, transparentFill: null };
  }
  if (resolved === BACKGROUND_MODES.KEEP) {
    return { autoBackground: false, transparentFill: fillColor || "#ffffff" };
  }
  return { autoBackground: false, transparentFill: null };
}

export default {
  BACKGROUND_MODES,
  BACKGROUND_MODE_IDS,
  BACKGROUND_MODE_LIST,
  BACKGROUND_MODE_HINTS,
  DEFAULT_BACKGROUND_MODE,
  normalizeBackgroundMode,
  backgroundModeOf,
  resolveBackgroundModeOptions,
};
