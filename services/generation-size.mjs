/**
 * Generation Size model — 长边格数（longEdge）+ 有效裁剪比例（ratio）→ width / height
 *
 * 唯一口径：
 *   longEdge  图纸**长边**的格数（10–500）
 *   ratio     height / width（与 app.js 的 sourceRatio() 同口径）
 *   派生      width / height 由这两项算出，调用方不得各自再算一遍
 *
 * 铁律：**ratio 不可用时返回 null，不回退成 width。**
 * 「无依据的 1:1」是历史 bug 的根因（首帧方图），这里从类型上堵死：
 * 拿不到比例就只能拿到 null，调用方必须延后生成。
 *
 * 与「编辑器画布调整」的区别（不要合并这两条链路）：
 *   - 本模块只服务**生成**：尺寸必须保持源图 / 裁剪比例。
 *   - 编辑器画布调整允许宽高独立（222×295 → 220×300），
 *     走 services/grid-resize-service.js + editor 历史命令，不经过这里。
 *
 * 纯计算，无 DOM，可被 Worker / node --test 直接调用。
 */

export const GENERATION_LONG_EDGE_MIN = 10;
export const GENERATION_LONG_EDGE_MAX = 500;

/** >300 起提示「大尺寸」，>400 起提示「超大尺寸」。两档都要用户显式点生成。 */
export const GENERATION_SIZE_LARGE_MIN = 301;
export const GENERATION_SIZE_XLARGE_MIN = 401;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** 由宽高得到 ratio = height / width；任一维非正数返回 null。 */
export function ratioFromDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return h / w;
}

/** 归一化外部传入的比例；非正数 / 非有限值一律视为「不可用」。 */
export function normalizeRatio(ratio) {
  if (ratio == null) return null;
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** 长边格数取整并夹到 [10, 500]；非数字返回 null。 */
export function clampLongEdge(value) {
  if (value == null || value === "") return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return clamp(number, GENERATION_LONG_EDGE_MIN, GENERATION_LONG_EDGE_MAX);
}

/**
 * 由长边格数与比例派生尺寸。
 *
 * @param {number} longEdge 长边格数
 * @param {number} ratio    height / width
 * @returns {{longEdge:number, width:number, height:number}|null}
 *          ratio 不可用时返回 **null**（unresolved），不是方图。
 */
export function deriveGenerationSize(longEdge, ratio) {
  const edge = clampLongEdge(longEdge);
  const normalized = normalizeRatio(ratio);
  if (edge == null || normalized == null) return null;

  // ratio >= 1 表示竖图 / 方图：长边是高度。
  const portrait = normalized >= 1;
  const width = portrait ? Math.round(edge / normalized) : edge;
  const height = portrait ? edge : Math.round(edge * normalized);
  return {
    longEdge: edge,
    width: clamp(width, GENERATION_LONG_EDGE_MIN, GENERATION_LONG_EDGE_MAX),
    height: clamp(height, GENERATION_LONG_EDGE_MIN, GENERATION_LONG_EDGE_MAX),
  };
}

/** 由宽高反推长边格数；宽高任一无效返回 null。 */
export function longEdgeOf(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return clampLongEdge(Math.max(w, h));
}

/** "normal" | "large"（301–400）| "xlarge"（>400） */
export function sizeWarningTier(longEdge) {
  const edge = clampLongEdge(longEdge);
  if (edge == null) return "normal";
  if (edge >= GENERATION_SIZE_XLARGE_MIN) return "xlarge";
  if (edge >= GENERATION_SIZE_LARGE_MIN) return "large";
  return "normal";
}

/** 步进长边（滑杆 / 滚轮 / 方向键共用），结果同样夹在 [10, 500]。 */
export function stepLongEdge(current, delta) {
  const edge = clampLongEdge(current) ?? GENERATION_LONG_EDGE_MIN;
  const step = Number(delta);
  return clampLongEdge(edge + (Number.isFinite(step) ? step : 0));
}
