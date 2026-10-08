/**
 * 源图尺寸的**权威链**。
 *
 * 为什么需要它：尺寸有六种来源，可信度差得很远。
 * 「用户从 Pixler 打开的 222×295 工程」和「从一张照片猜出来的长边 104」被一视同仁地
 * 塞进同一个 `generationLongEdge` 时，弱来源就会覆盖强来源 —— B0 之后仍然发生：
 *
 *   导入 222×295 工程 → 工作台挂载 → 无条件写 generationLongEdge = 104 → 尺寸被冲掉
 *
 * 所以尺寸不再是一个裸数字，而是带**来源标签**的值，并且**只能由同级或更强的来源替换**。
 *
 * 权威从高到低：
 *   1. structured-project   结构化工程文件里存的 width/height —— 绝对权威，不得推导
 *   2. manual-calibration   用户手填的格数（「已有图纸直接拼」表单）—— 绝对权威
 *   3. grid-detection       显式网格/格距检测（restore / OCR 识别出 W×H）—— 绝对权威
 *   4. pixel-multiple       稳定的像素倍数（1040×780 + multiple=10 → 104×78）—— 只用于推导
 *   5. logical-heuristic    逻辑宽度启发式 —— 只在没有任何更强几何证据时可用
 *   6. unresolved           还没解析出来 —— **不得**回退成 104×104 / width×width
 *
 * 前三级是**绝对**的：它们给出的就是图纸格数，生成时必须直接使用，不许经过长边、
 * 裁剪比例或像素倍数再算一遍（B0.1 §2 / §3）。后两级只是「推导出的建议值」，
 * 用来给「普通图片生成」的长边提供初值，用户可以随时改。
 *
 * 纯函数，零 DOM —— 可被 Node 直接单测。
 */

/** 六种尺寸来源。字符串值会写进 state 与诊断输出，改动即为破坏性变更。 */
export const SIZE_AUTHORITY = Object.freeze({
  UNRESOLVED: "unresolved",
  LOGICAL_HEURISTIC: "logical-heuristic",
  PIXEL_MULTIPLE: "pixel-multiple",
  GRID_DETECTION: "grid-detection",
  MANUAL_CALIBRATION: "manual-calibration",
  STRUCTURED_PROJECT: "structured-project",
});

/** 从弱到强。索引即权威等级，越大越可信。 */
export const SIZE_AUTHORITY_ORDER = Object.freeze([
  SIZE_AUTHORITY.UNRESOLVED,
  SIZE_AUTHORITY.LOGICAL_HEURISTIC,
  SIZE_AUTHORITY.PIXEL_MULTIPLE,
  SIZE_AUTHORITY.GRID_DETECTION,
  SIZE_AUTHORITY.MANUAL_CALIBRATION,
  SIZE_AUTHORITY.STRUCTURED_PROJECT,
]);

/** 权威等级 ≥ 此值即「绝对」：尺寸直接采用，不再派生。 */
export const SIZE_ABSOLUTE_FROM = SIZE_AUTHORITY.GRID_DETECTION;

/** 图纸格数的合法区间。与 generation-request.mjs 的 10–500 不同：那里是**生成**约束，
 *  这里是**图纸**约束 —— 一个 1 格宽的图纸是合法的，只是不能拿去生成。 */
export const SIZE_DIMENSION_MIN = 1;
export const SIZE_DIMENSION_MAX = 500;

export const SIZE_AUTHORITY_LABELS = Object.freeze({
  [SIZE_AUTHORITY.UNRESOLVED]: "未解析",
  [SIZE_AUTHORITY.LOGICAL_HEURISTIC]: "逻辑尺寸估算",
  [SIZE_AUTHORITY.PIXEL_MULTIPLE]: "像素倍数识别",
  [SIZE_AUTHORITY.GRID_DETECTION]: "网格识别",
  [SIZE_AUTHORITY.MANUAL_CALIBRATION]: "手动标定",
  [SIZE_AUTHORITY.STRUCTURED_PROJECT]: "工程文件",
});

/* ────────────────────────────────────────────────────────────────
 * 长边权威（Stage B4 P0）
 *
 * 上面那套 `SIZE_AUTHORITY` 管的是**最终 W×H 谁说了算**。
 * 但「普通图片生成」还有第二个自由度：**长边格数**。它由 UI 草稿推给 bridge，
 * 与 W×H 权威是两件事，所以需要第二套权威 —— 否则「用户点了应用尺寸」
 * 这个事实无处记录，任何异步链都能把它冲掉。
 *
 * 真实缺陷（B4 §0 要修的）：导入源图后，`ensureMultipleDetection()` 会异步识别
 * 像素倍数，settle 之后 `applyLogicalSize()` 与 `scheduleInitialGeneration()`
 * 会**无条件**再写一次草稿并提交。用户若在识别落地之前手填 104 并点「应用尺寸」，
 * 这一票就被静默覆盖 —— 真机复现：`gray-gradient` 导入草稿 10 → 用户填 104 →
 * 出图宽仍是自动识别出来的尺寸。
 *
 * 规则（B4 §0 原文）：
 *   用户一旦显式点击「应用尺寸」，该尺寸成为 `user-explicit`；
 *   后续自动链（pixel-multiple / logical-heuristic / 首帧自动生成）**不得覆盖**。
 *   只有「重新导入新源图」或「用户主动恢复自动尺寸」才清除。
 * ──────────────────────────────────────────────────────────────── */

/** 长边草稿的两种权威。字符串值会写进 DOM dataset，改动即为破坏性变更。 */
export const LONG_EDGE_AUTHORITY = Object.freeze({
  /** 自动链可以写：像素倍数识别 / 逻辑尺寸估算 / 首帧自动生成。 */
  AUTO: "auto",
  /** 用户在「应用尺寸」上显式确认过。自动链一律不得覆盖。 */
  USER_EXPLICIT: "user-explicit",
});

/** 能改变长边权威的四种事件。 */
export const LONG_EDGE_EVENT = Object.freeze({
  /** 用户点了「应用尺寸」。 */
  USER_APPLIED: "user-applied",
  /** 换了一张源图（`resetSourceDimensions("source-replaced")`）。 */
  SOURCE_REPLACED: "source-replaced",
  /** 用户主动点了「自动」档。 */
  RESTORE_AUTO: "restore-auto",
  /** 自动链识别出了一个尺寸。**不改变权威**。 */
  AUTO_DETECTED: "auto-detected",
});

export function isLongEdgeAuthority(value) {
  return value === LONG_EDGE_AUTHORITY.AUTO || value === LONG_EDGE_AUTHORITY.USER_EXPLICIT;
}

/**
 * 权威状态机。**只有** `user-applied` 会升级到 `user-explicit`；
 * 只有 `source-replaced` / `restore-auto` 会降回 `auto`；
 * `auto-detected` 是空操作 —— 识别到什么都不改变「谁说了算」。
 *
 * 未知输入一律按 `auto` 处理（宁可少保护，不可把用户锁在一个他没收过的尺寸上）。
 */
export function resolveLongEdgeAuthority(current, event) {
  const safe = isLongEdgeAuthority(current) ? current : LONG_EDGE_AUTHORITY.AUTO;
  switch (event) {
    case LONG_EDGE_EVENT.USER_APPLIED:
      return LONG_EDGE_AUTHORITY.USER_EXPLICIT;
    case LONG_EDGE_EVENT.SOURCE_REPLACED:
    case LONG_EDGE_EVENT.RESTORE_AUTO:
      return LONG_EDGE_AUTHORITY.AUTO;
    case LONG_EDGE_EVENT.AUTO_DETECTED:
      return safe;
    default:
      return safe;
  }
}

/**
 * 自动链现在能不能写长边草稿 / 提交尺寸。
 *
 * 所有自动写入点（`applyLogicalSize`、`scheduleInitialGeneration`、
 * `ensureMultipleDetection` 的回调）都必须先过这一道 —— 这是本次修复的**唯一开关**。
 */
export function shouldAutoWriteLongEdge(authority) {
  return authority !== LONG_EDGE_AUTHORITY.USER_EXPLICIT;
}

const clampDimension = (value) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  if (number < SIZE_DIMENSION_MIN || number > SIZE_DIMENSION_MAX) return null;
  return number;
};

/** 是不是已知来源。未知字符串一律当 unresolved 处理，绝不静默升级。 */
export function isSizeAuthority(value) {
  return SIZE_AUTHORITY_ORDER.includes(value);
}

/** 权威等级。未知来源按 0（unresolved）算 —— 宁可少信，不可多信。 */
export function authorityRank(authority) {
  const index = SIZE_AUTHORITY_ORDER.indexOf(authority);
  return index === -1 ? 0 : index;
}

/** 该来源给出的尺寸是否「绝对」（直接采用，不走长边/比例派生）。 */
export function isAbsoluteAuthority(authority) {
  return authorityRank(authority) >= authorityRank(SIZE_ABSOLUTE_FROM);
}

/** 尺寸是否已解析。 */
export function isResolvedDimensions(dimensions) {
  return Boolean(dimensions)
    && authorityRank(dimensions.authority) > 0
    && Number(dimensions.width) > 0
    && Number(dimensions.height) > 0;
}

/** 未解析态。带上 reason 便于诊断「为什么没识别出来」。 */
export function createUnresolvedDimensions(reason = "") {
  return Object.freeze({
    width: 0,
    height: 0,
    authority: SIZE_AUTHORITY.UNRESOLVED,
    source: String(reason || ""),
  });
}

/**
 * 校验并冻结一份尺寸。
 *
 * @param {{width:number, height:number, authority:string, source?:string}} input
 * @returns {{width:number, height:number, authority:string, source:string}|null}
 *   null = 输入不可用（尺寸越界 / 来源未知 / 来源是 unresolved）。调用方必须原样丢弃，
 *   **不得**退化成 104×104。
 */
export function normalizeSourceDimensions(input) {
  if (!input || typeof input !== "object") return null;
  const { authority } = input;
  if (!isSizeAuthority(authority) || authority === SIZE_AUTHORITY.UNRESOLVED) return null;
  const width = clampDimension(input.width);
  const height = clampDimension(input.height);
  if (width == null || height == null) return null;
  return Object.freeze({ width, height, authority, source: String(input.source || "") });
}

/**
 * 权威链裁决：新证据能不能替换现有尺寸。
 *
 * 规则只有一条 —— **同级或更强才允许替换**。更弱的证据一律被拒，并把现有尺寸原样退回，
 * 让调用方知道「你的值没被采纳」，而不是让它以为自己写成功了。
 *
 * 同级允许替换：同一个来源类型重新检测出不同结果时（换了一张图、用户重新标定），
 * 新的那次才是有意义的。
 *
 * @returns {{applied:boolean, dimensions:object, blockedBy:string|null}}
 */
export function adoptSourceDimensions(current, next) {
  const fallback = isResolvedDimensions(current)
    ? Object.freeze({
        width: Number(current.width),
        height: Number(current.height),
        authority: isSizeAuthority(current.authority) ? current.authority : SIZE_AUTHORITY.UNRESOLVED,
        source: String(current.source || ""),
      })
    : createUnresolvedDimensions(current?.source || "");
  if (!isResolvedDimensions(next)) return { applied: false, dimensions: fallback, blockedBy: current?.authority || null };
  if (authorityRank(next.authority) < authorityRank(fallback.authority)) {
    return { applied: false, dimensions: fallback, blockedBy: fallback.authority };
  }
  return { applied: true, dimensions: next, blockedBy: null };
}

/**
 * 按权威链选出**最终生成尺寸**。
 *
 * 这是「谁说了算」的唯一实现：绝对权威（工程文件 / 人工标定 / 网格识别）直接返回它的
 * W×H；否则退回调用方给的派生逻辑（普通图片的「长边 + 裁剪比例」）。
 *
 * 放在这里而不是 app.js，是为了让这条优先级能被单测直接钉住 ——
 * 它是 B0.1 的核心不变量，不该只存在于一段没法 import 的 classic script 里。
 *
 * @param {object|null} dimensions 当前尺寸权威值
 * @param {{longEdge:number|null, ratio:number|null, derive:Function}} options
 *   derive(longEdge, ratio) → {longEdge,width,height}|null，普通图片的派生实现
 * @returns {{longEdge:number,width:number,height:number,absolute:boolean,authority:string}|null}
 *   null = 尺寸仍未解析，调用方必须延后生成。
 */
export function resolveSizeFromEvidence(dimensions, { longEdge = null, ratio = null, derive = null } = {}) {
  if (isResolvedDimensions(dimensions) && isAbsoluteAuthority(dimensions.authority)) {
    return {
      longEdge: Math.max(dimensions.width, dimensions.height),
      width: dimensions.width,
      height: dimensions.height,
      absolute: true,
      authority: dimensions.authority,
    };
  }
  const derived = typeof derive === "function" ? derive(longEdge, ratio) : null;
  if (!derived) return null;
  return {
    longEdge: derived.longEdge,
    width: derived.width,
    height: derived.height,
    absolute: false,
    authority: isSizeAuthority(dimensions?.authority) ? dimensions.authority : SIZE_AUTHORITY.UNRESOLVED,
  };
}

/** 给人看的一句话描述。UI 与诊断共用，避免各写一份文案。 */
export function describeSourceDimensions(dimensions) {
  if (!isResolvedDimensions(dimensions)) return "正在识别图纸尺寸…";
  const label = SIZE_AUTHORITY_LABELS[dimensions.authority] || dimensions.authority;
  return `图纸尺寸 ${dimensions.width} × ${dimensions.height} · 来自${label}`;
}
