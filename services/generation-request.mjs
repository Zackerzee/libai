/**
 * Generation request contract — Worker-ready boundary
 *
 * 目的：把「生成」从「一堆散落在 app.js 里的参数」收敛成一个**可序列化的契约**，
 * 让同一条链路既能跑在主线程（当前），也能原样丢进 Web Worker（后续）。
 *
 * 三条纪律：
 *   1. 请求 / 结果 / 错误都是**纯数据**（structured-clone 安全），不含函数、DOM、类实例。
 *   2. 每个请求带唯一 `requestId`；调用方用 `isStaleGeneration()` 判断结果是否已过期。
 *   3. 尺寸必须是**已解析**的整数宽高 —— 契约层不接受 `null` / 比例。
 *      「比例 → 尺寸」的推导属于 services/generation-size.mjs，在这里之前完成。
 *
 * 纯计算，无 DOM，可在 Worker / node --test 里直接调用。
 */

export const GENERATION_CONTRACT_VERSION = 1;

export const GENERATION_REQUEST_KIND = "generate";

export const GENERATION_SIZE_MIN = 10;
export const GENERATION_SIZE_MAX = 500;

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const isPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
};

/* =========================================================
 * requestId
 * ======================================================= */

/** 单调递增的请求号。传上一次的值，拿到下一个。 */
export function nextGenerationId(previous = 0) {
  const base = Number.isInteger(previous) && previous >= 0 ? previous : 0;
  return base + 1;
}

/**
 * 结果是否已过期。
 * 口径是「不相等即过期」：只有当前最新请求的结果才允许写回状态。
 */
export function isStaleGeneration(requestId, latestRequestId) {
  return Number(requestId) !== Number(latestRequestId);
}

/* =========================================================
 * Request
 * ======================================================= */

/**
 * 构造并冻结一个生成请求。
 *
 * @param {object} input
 * @param {number} input.requestId
 * @param {{data:Uint8ClampedArray|Uint8Array, width:number, height:number}} input.image 源图 ImageData 形状
 * @param {{width:number, height:number, longEdge?:number, ratio?:number}} input.size
 * @param {string} input.mode              生成模式（beginner / auto / portrait / ...）
 * @param {Array<{code:string, rgb:number[]|object, hex?:string, name?:string}>} input.palette
 * @param {number} [input.maxColors]
 * @param {object} [input.overrides]       采样 / 保护等覆盖项
 */
export function createGenerationRequest(input = {}) {
  const { requestId, image, size, mode, palette, maxColors = 0, overrides = {} } = input;
  return Object.freeze({
    version: GENERATION_CONTRACT_VERSION,
    kind: GENERATION_REQUEST_KIND,
    requestId: Number(requestId),
    image: Object.freeze({
      data: image?.data,
      width: Number(image?.width),
      height: Number(image?.height),
    }),
    size: Object.freeze({
      width: Number(size?.width),
      height: Number(size?.height),
      longEdge: size?.longEdge == null ? null : Number(size.longEdge),
      ratio: size?.ratio == null ? null : Number(size.ratio),
    }),
    mode: String(mode ?? "auto"),
    palette: Object.freeze((palette || []).map((color) => Object.freeze({
      code: String(color?.code ?? ""),
      rgb: Array.isArray(color?.rgb)
        ? [Number(color.rgb[0]), Number(color.rgb[1]), Number(color.rgb[2])]
        : [Number(color?.rgb?.[0]), Number(color?.rgb?.[1]), Number(color?.rgb?.[2])],
      hex: color?.hex == null ? null : String(color.hex),
      name: color?.name == null ? null : String(color.name),
    }))),
    maxColors: Number(maxColors) || 0,
    overrides: Object.freeze({ ...(overrides || {}) }),
  });
}

/**
 * 严格校验请求形状。不合法就抛 —— 这是编程错误，不是运行时故障。
 * @returns {true}
 */
export function validateGenerationRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("GenerationRequest 不能为空");
  if (request.version !== GENERATION_CONTRACT_VERSION) {
    throw new TypeError(`GenerationRequest 版本不支持：${request.version}`);
  }
  if (request.kind !== GENERATION_REQUEST_KIND) {
    throw new TypeError(`GenerationRequest.kind 不支持：${request.kind}`);
  }
  if (!isPositiveInteger(request.requestId)) throw new TypeError("GenerationRequest.requestId 必须是正整数");

  const image = request.image;
  if (!image || !image.data || !isPositiveInteger(image.width) || !isPositiveInteger(image.height)) {
    throw new TypeError("GenerationRequest.image 必须是 {data,width,height}");
  }
  if (Number(image.data.length) !== Number(image.width) * Number(image.height) * 4) {
    throw new TypeError("GenerationRequest.image.data 长度与宽高不匹配");
  }

  const size = request.size;
  if (!size || !isPositiveInteger(size.width) || !isPositiveInteger(size.height)) {
    throw new TypeError("GenerationRequest.size 必须是已解析的整数宽高");
  }
  for (const key of ["width", "height"]) {
    const value = Number(size[key]);
    if (value < GENERATION_SIZE_MIN || value > GENERATION_SIZE_MAX) {
      throw new RangeError(`GenerationRequest.size.${key} 超出 ${GENERATION_SIZE_MIN}–${GENERATION_SIZE_MAX}：${value}`);
    }
  }

  if (typeof request.mode !== "string" || !request.mode) throw new TypeError("GenerationRequest.mode 必须是非空字符串");
  if (!Array.isArray(request.palette) || !request.palette.length) throw new TypeError("GenerationRequest.palette 不能为空");
  for (const color of request.palette) {
    if (typeof color.code !== "string" || !color.code) throw new TypeError("调色板色号缺失");
    if (!Array.isArray(color.rgb) || color.rgb.length !== 3 || !color.rgb.every(isFiniteNumber)) {
      throw new TypeError(`调色板 ${color.code} 的 rgb 非法`);
    }
  }
  if (!isFiniteNumber(request.maxColors) || Number(request.maxColors) < 0) {
    throw new TypeError("GenerationRequest.maxColors 必须是非负数");
  }
  if (!request.overrides || typeof request.overrides !== "object") {
    throw new TypeError("GenerationRequest.overrides 必须是对象");
  }
  return true;
}

/* =========================================================
 * Result / Error
 * ======================================================= */

const toRgbArray = (rgb) => (Array.isArray(rgb)
  ? [Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0]
  : [Number(rgb?.[0]) || 0, Number(rgb?.[1]) || 0, Number(rgb?.[2]) || 0]);

const rgbToHex = (rgb) => `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** 把引擎返回的格子规范成 {code,rgb,hex} | null —— 保证结果可结构化克隆。 */
export function normalizeGenerationCell(cell) {
  if (cell == null) return null;
  const code = cell.code ?? cell.paletteId ?? null;
  if (code == null || String(code) === "") return null;
  const rgb = toRgbArray(cell.rgb);
  return { code: String(code), rgb, hex: cell.hex ? String(cell.hex) : rgbToHex(rgb) };
}

export function createGenerationResult(input = {}) {
  const { requestId, grid = [], width, height, diagnostics = null, pipeline = null, milliseconds = 0 } = input;
  const normalizedGrid = grid.map((row) => row.map(normalizeGenerationCell));
  const usedColors = new Set();
  for (const row of normalizedGrid) for (const cell of row) if (cell) usedColors.add(cell.code);
  return Object.freeze({
    version: GENERATION_CONTRACT_VERSION,
    ok: true,
    requestId: Number(requestId),
    width: Number(width),
    height: Number(height),
    grid: normalizedGrid,
    diagnostics,
    pipeline,
    metrics: Object.freeze({
      milliseconds: Math.round(Number(milliseconds) || 0),
      cells: Number(width) * Number(height),
      usedColors: usedColors.size,
    }),
  });
}

export function createGenerationError(input = {}) {
  const { requestId = null, error = null, message = null } = input;
  return Object.freeze({
    version: GENERATION_CONTRACT_VERSION,
    ok: false,
    requestId: requestId == null ? null : Number(requestId),
    name: String(error?.name || "GenerationError"),
    message: String(message ?? error?.message ?? "生成失败"),
  });
}
