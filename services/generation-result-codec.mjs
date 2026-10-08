/**
 * Generation result codec — 紧凑结果契约（Stage B3 §28）
 *
 * 为什么需要它：`createGenerationResult()` 产出的是**逐格对象网格**
 * （`{code,rgb,hex} | null`）。104×104 = 10 816 个对象还好，但 500×500 = **250 000 个对象**，
 * 跨线程结构化克隆要逐个重建，光是搬运就能吃掉几百毫秒 —— 而 B3 的全部意义
 * 就是别让主线程干重活。
 *
 * 所以跨线程只传**引用 + 下标**：
 *
 *   palette  [{code,rgb,hex}]   只含这一版图纸真正用到的颜色（几十个）
 *   indices  Int32Array(w*h)    -1 = 空豆(null)，否则是 palette 下标
 *   nullMask 由 indices 派生    （nullCount 只是计数，便于断言）
 *
 * 主线程用 decodeGenerationResult() 还原成 canonical grid。
 * **生产状态永远拿到完整 grid + paletteId，不会退化成 hex-only。**
 *
 * 纯函数、零 DOM —— 两侧共用同一份实现，node --test 可直接验证
 * 「encode→decode 逐格等价」，这是契约不漂移的唯一保证。
 */

export const GENERATION_RESULT_CODEC_VERSION = 1;

/** 空豆下标哨兵。与 grid 的 `null` 一一对应。 */
export const GENERATION_NULL_INDEX = -1;

const toRgbTriple = (rgb) => (Array.isArray(rgb)
  ? [Number(rgb[0]) || 0, Number(rgb[1]) || 0, Number(rgb[2]) || 0]
  : [Number(rgb?.[0]) || 0, Number(rgb?.[1]) || 0, Number(rgb?.[2]) || 0]);

/**
 * 把完整结果压成紧凑形式。
 *
 * @param {object} result createGenerationResult() 的产物
 * @returns {object} 结构化克隆友好的紧凑结果（indices 是 Int32Array，可 Transferable）
 */
export function encodeGenerationResult(result = {}) {
  const width = Number(result.width) || 0;
  const height = Number(result.height) || 0;
  const grid = Array.isArray(result.grid) ? result.grid : [];
  const indices = new Int32Array(width * height);
  const palette = [];
  const indexByCode = new Map();
  let nullCount = 0;

  for (let y = 0; y < height; y += 1) {
    const row = grid[y] || [];
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const cell = row[x];
      if (!cell) {
        indices[at] = GENERATION_NULL_INDEX;
        nullCount += 1;
        continue;
      }
      const code = String(cell.code);
      let index = indexByCode.get(code);
      if (index === undefined) {
        index = palette.length;
        indexByCode.set(code, index);
        palette.push(Object.freeze({
          code,
          rgb: Object.freeze(toRgbTriple(cell.rgb)),
          hex: cell.hex == null ? null : String(cell.hex),
        }));
      }
      indices[at] = index;
    }
  }

  return Object.freeze({
    version: result.version,
    ok: true,
    requestId: result.requestId == null ? null : Number(result.requestId),
    width,
    height,
    palette: Object.freeze(palette),
    indices,
    metrics: result.metrics ?? null,
    // diagnostics 里可能有 Map / TypedArray —— 结构化克隆支持，原样带过去。
    diagnostics: result.diagnostics ?? null,
    pipeline: result.pipeline ?? null,
    codec: GENERATION_RESULT_CODEC_VERSION,
    nullCount,
  });
}

/**
 * 还原成 canonical grid（`{code,rgb,hex} | null`）。
 *
 * 每个格子都是**新对象**：主线程拿到后可以随便改，不会串到 palette 上。
 */
export function decodeGenerationResult(compact = {}) {
  const width = Number(compact.width) || 0;
  const height = Number(compact.height) || 0;
  const palette = Array.isArray(compact.palette) ? compact.palette : [];
  const indices = compact.indices;
  const grid = [];

  for (let y = 0; y < height; y += 1) {
    const row = new Array(width);
    for (let x = 0; x < width; x += 1) {
      const index = indices ? Number(indices[y * width + x]) : GENERATION_NULL_INDEX;
      if (index < 0 || !palette[index]) { row[x] = null; continue; }
      const entry = palette[index];
      row[x] = { code: entry.code, rgb: toRgbTriple(entry.rgb), hex: entry.hex };
    }
    grid.push(row);
  }

  return {
    version: compact.version,
    ok: true,
    requestId: compact.requestId == null ? null : Number(compact.requestId),
    width,
    height,
    grid,
    palette,
    metrics: compact.metrics ?? null,
    diagnostics: compact.diagnostics ?? null,
    pipeline: compact.pipeline ?? null,
    nullCount: Number(compact.nullCount) || 0,
  };
}

/** 紧凑形式是否可用。worker 回包/主线程解码前都要过一遍，避免静默拿到空图纸。 */
export function isEncodedGenerationResult(value) {
  return Boolean(value)
    && value.codec === GENERATION_RESULT_CODEC_VERSION
    && Number.isInteger(Number(value.width))
    && Number.isInteger(Number(value.height))
    && Array.isArray(value.palette)
    && value.indices != null;
}
