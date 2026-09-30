/**
 * 文字素材图层 —— 把一段文字栅格化成「哪些豆格该上色」。
 *
 * 设计要点（决定了整个功能的正确性）：
 *
 *  1. **预览与合并共用同一个栅格化函数**。文字图层在画布上显示的那批格子，
 *     和「向下合并」真正写进图纸的格子，必须来自同一次计算。否则就会出现
 *     「看着在中间、合下去偏了半格」这类只能靠肉眼发现的错位。
 *     所以这里只有 rasterizeText 一个出口，渲染器和合并按钮都调它。
 *
 *  2. **在「1 格 = 1 像素」的离屏画布上栅格化**。豆格天然就是像素格：
 *     把图纸宽高当作画布宽高，文字画上去后按 alpha 通道取「有墨」的格子，
 *     就得到了精确的落豆位置。不需要任何坐标换算，也就没有换算误差。
 *
 *  3. **坐标用格（可含小数）而不是像素**。拖动时中心点连续移动，取整交给
 *     栅格化那一步，手感才顺。
 *
 *  4. 只依赖 DOM 的 canvas，不依赖页面结构，可单独测（可用 options.canvas 注入）。
 */

/**
 * 字体表。除「复古像素」用站点自带的本地字体（OFL-1.1，见 vendor/fusion-pixel/）外，
 * 其余一律走**系统字体栈**，不引入任何外部字体依赖——
 * 这个站点全程不依赖境外 CDN 兜底，为了一个文字功能再加一份 web font 不划算。
 * 非 macOS 平台上这些中文字体名会落空，浏览器按栈顺序回退到后面的通用族，仍能正常显示。
 */
export const TEXT_FONTS = [
  { id: "system", label: "系统默认", stack: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: "pixel", label: "复古像素", stack: '"Fusion Pixel 12px Monospaced Simplified Chinese", ui-monospace, Menlo, monospace' },
  { id: "cute", label: "可爱卡通", stack: '"Yuanti SC", "Hiragino Maru Gothic ProN", "PingFang SC", system-ui, sans-serif' },
  { id: "bold", label: "硬朗粗体", stack: '"PingFang SC Semibold", "Microsoft YaHei", system-ui, sans-serif', weight: 800 },
  { id: "serif", label: "优雅衬线", stack: '"Songti SC", "SimSun", "Times New Roman", serif' },
  { id: "brush", label: "毛笔书法", stack: '"Kaiti SC", STKaiti, KaiTi, cursive' },
  { id: "hand", label: "浪漫手写", stack: '"Xingkai SC", STXingkai, "Yuanti SC", cursive' },
];

export const TEXT_SCALE_RANGE = { min: 20, max: 300, step: 5 };
export const TEXT_ROTATION_RANGE = { min: -180, max: 180, step: 1 };
// 短边占比决定默认字号：同一段文字在 52 格和 500 格的图纸上观感一致。
const BASE_SIZE_RATIO = 0.18;
const LINE_HEIGHT_RATIO = 1.18;
// alpha ≥ 128 才算「有墨」，避免抗锯齿边缘把相邻格子也点亮成一圈毛边。
const INK_ALPHA = 128;

export function fontFor(id) {
  return TEXT_FONTS.find((font) => font.id === id) || TEXT_FONTS[0];
}

let seq = 0;
export function createTextLayer(overrides = {}) {
  seq += 1;
  return {
    id: `text-${Date.now().toString(36)}-${seq}`,
    text: "新文字素材",
    font: "system",
    color: "",
    paletteId: "",
    bold: false,
    italic: false,
    scale: 100,
    spacing: 0,
    rotation: 0,
    x: 0,
    y: 0,
    ...overrides,
  };
}

/** 默认字号（格）：跟着图纸短边走，保证「换尺寸后文字大小观感不变」。 */
export function baseFontSize(gridWidth, gridHeight) {
  const short = Math.min(Number(gridWidth) || 0, Number(gridHeight) || 0);
  if (!short) return 8;
  return Math.max(4, Math.round(short * BASE_SIZE_RATIO));
}

/** 组装 canvas 的 font 简写。加粗是「比字体本身更粗」，不是无脑 700。 */
export function fontCss(layer, sizePx) {
  const font = fontFor(layer?.font);
  const base = font.weight || 400;
  const weight = layer?.bold ? Math.max(700, base) : base;
  return `${layer?.italic ? "italic " : ""}${weight} ${sizePx}px ${font.stack}`;
}

let scratch = null;
function scratchCanvas(width, height) {
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== width || scratch.height !== height) { scratch.width = width; scratch.height = height; }
  return scratch;
}

/**
 * 把文字栅格化成豆格列表。
 *
 * @param {object} layer 文字图层（text / font / bold / italic / scale / rotation / x / y）
 * @param {number} gridWidth  图纸宽（格）
 * @param {number} gridHeight 图纸高（格）
 * @param {{canvas?: HTMLCanvasElement, measure?: boolean}} options
 *   canvas  注入离屏画布（测试用）；默认复用模块内的一块 scratch canvas
 *   measure 额外返回文字自身的未旋转尺寸（用于画选中框）
 * @returns {{cells: Array<{x:number,y:number}>, width:number, height:number}}
 */
export function rasterizeText(layer, gridWidth, gridHeight, options = {}) {
  const width = Math.max(1, Math.round(Number(gridWidth) || 0));
  const height = Math.max(1, Math.round(Number(gridHeight) || 0));
  const empty = { cells: [], width: 0, height: 0 };
  const text = String(layer?.text ?? "");
  if (!text.trim()) return empty;
  const canvas = options.canvas || scratchCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return empty;

  const size = Math.max(3, Math.round(baseFontSize(width, height) * (Number(layer.scale) || 100) / 100));
  const lineHeight = Math.max(size, Math.round(size * LINE_HEIGHT_RATIO));
  const lines = text.split("\n");

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  // x / y 是文字**中心**在格坐标下的位置。绕中心旋转，所以拖到哪转到哪都自洽。
  ctx.translate(Number(layer.x) || 0, Number(layer.y) || 0);
  if (Number(layer.rotation)) ctx.rotate((Number(layer.rotation) || 0) * Math.PI / 180);
  ctx.font = fontCss(layer, size);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${Number(layer.spacing) || 0}px`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000000";
  let widest = 0;
  lines.forEach((line, index) => {
    const offset = (index - (lines.length - 1) / 2) * lineHeight;
    ctx.fillText(line, 0, offset);
    widest = Math.max(widest, ctx.measureText(line).width);
  });
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, width, height);
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] >= INK_ALPHA) cells.push({ x, y });
    }
  }
  return { cells, width: widest, height: lines.length * lineHeight };
}

/**
 * 带缓存的栅格化。渲染器每帧、面板每次读数都会问一次，
 * 但参数只在拖动/改设置时才变，所以按参数串缓存一次就能省掉绝大部分重复计算。
 */
const cache = new Map();
const CACHE_LIMIT = 48;
export function rasterizeTextCached(layer, gridWidth, gridHeight) {
  if (!layer) return { cells: [], width: 0, height: 0 };
  const key = [
    layer.text, layer.font, layer.bold, layer.italic, layer.scale, layer.spacing, layer.rotation,
    layer.x, layer.y, gridWidth, gridHeight,
  ].join("\u0001");
  const hit = cache.get(key);
  if (hit) return hit;
  const value = rasterizeText(layer, gridWidth, gridHeight);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/** 一组豆格的外接框；空集合返回 null。 */
export function cellsBox(cells) {
  if (!cells?.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { x, y } of cells) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** 点是否落在图层上（用于画布上点选/拖动已有图层）。 */
export function layerContainsCell(layer, gridWidth, gridHeight, x, y) {
  const { cells } = rasterizeTextCached(layer, gridWidth, gridHeight);
  return cells.some((cell) => cell.x === x && cell.y === y);
}

/** 图层摘要文案：给图层列表用，和参考稿的 `图层 1: "新文字素材"` 一致。 */
export function layerLabel(layer, index) {
  const text = String(layer?.text ?? "").replace(/\s+/g, " ").trim() || "（空文字）";
  const shown = text.length > 12 ? `${text.slice(0, 12)}…` : text;
  return `图层 ${index + 1}: "${shown}"`;
}
