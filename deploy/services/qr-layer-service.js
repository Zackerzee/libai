/**
 * 二维码素材图层 —— 把一段内容栅格化成「哪些豆格该上色」。
 *
 * ── 与「导出注解二维码」的区别（别搞混）──────────────────────────────
 * app.js 里那段（`applyExportOverlays`）是**注解**：把二维码画在导出图片的右下角，
 * 用来「扫码回到这张图纸」，它不进图纸、不占豆格。
 * 本文件是**素材**：二维码本身就是图案，每个模块由 N×N 颗豆拼成，
 * 拼出来之后手机能扫。两者可以同时存在，互不干扰。
 *
 * ── 这个功能唯一的难点：扫得出来 ────────────────────────────────────
 * 一个「看起来像二维码」的豆拼图案完全可能扫不出来，而且**不报错**——
 * 这是本功能最危险的失效形状。QR 解码器依赖三件事，任何一件不满足就静默失败：
 *
 *  ① **模块边界必须是格边界。** 一格豆不能再切一半，所以「每模块占几格」必须
 *     是正整数，且整个码的原点必须落在整数格上。小数位置会让模块边界错到
 *     半格，解码器的采样点全偏 —— 图上看着还是二维码。
 *     → `qrLayout` 把 `beadPerModule` 和 `x/y` 都锁成整数，这是硬约束不是偏好。
 *
 *  ② **静默区（quiet zone）≥ 4 模块。** QR 规范要求码四周留 4 个模块宽的空白。
 *     豆拼时这段空白要么铺浅色豆、要么留空。留空的话，露出来的底图如果偏深，
 *     解码器找不到码的边界 → 静默失败。
 *     → 默认 `lightMode: "bead"`（铺浅色豆），选 `"empty"` 时面板会明确警告。
 *
 *  ③ **深浅模块要有足够对比度。** 两个都浅（或都深）的配色，人眼看得出「有图案」，
 *     解码器只看到一片噪声。
 *     → `qrContrast` 给出对比度比并判定；不达标只警告不阻断（用户可能有理由）。
 *
 * ── 设计要点 ────────────────────────────────────────────────────────
 *  1. **预览与合并共用同一个栅格化函数**（照 text-layer-service 的规矩）：
 *     画布上看到的豆格，就是「锁定并导出」写进图纸的豆格。只有一个出口
 *     `rasterizeQr`，渲染器和合成器都调它。
 *  2. **编码器可注入**。浏览器用 `window.qrcode`（vendor/qrcode.js，MIT，
 *     由 app.js 的 ensureQrRuntime 注入），测试直接注入同一个工厂。
 *     本文件不 import 任何 node 模块 —— 它在浏览器里跑。
 *  3. **纯函数**。除了一块以参数串为键的缓存，无全局可变状态。
 */

/** 纠错等级。豆拼是手工摆的，容错越高越实用 —— 默认取 H（可恢复 30%）。 */
export const QR_ECC_LEVELS = Object.freeze([
  { id: "L", label: "L · 可恢复 7%", ratio: 0.07 },
  { id: "M", label: "M · 可恢复 15%", ratio: 0.15 },
  { id: "Q", label: "Q · 可恢复 25%", ratio: 0.25 },
  { id: "H", label: "H · 可恢复 30%", ratio: 0.3 },
]);
export const DEFAULT_QR_ECC = "H";

/** QR 规范要求的最小静默区（模块）。低于它解码器可能找不到码的边界。 */
export const QR_QUIET_MODULES = 4;
/** 每模块至少占 1 格 —— 少于 1 格就画不出模块边界。 */
export const QR_MIN_MODULE_BEADS = 1;
/** 深浅模块的对比度下限（相对亮度比，WCAG 式口径）。低于它解码可靠性明显下降。 */
export const QR_MIN_CONTRAST_RATIO = 3;
/** 面板里允许的最大静默区，防止把整个画布铺满。 */
export const QR_QUIET_MAX = 12;

const ECC_IDS = new Set(QR_ECC_LEVELS.map((level) => level.id));

export function normalizeEcc(value) {
  const id = String(value ?? "").toUpperCase();
  return ECC_IDS.has(id) ? id : DEFAULT_QR_ECC;
}

/** 默认内容。用站点域名而不是「新二维码」—— 空内容生成不出矩阵，默认值必须能直接出图。 */
const DEFAULT_QR_TEXT = "https://www.libms.net";

let seq = 0;
export function createQrLayer(overrides = {}) {
  seq += 1;
  return {
    id: `qr-${Date.now().toString(36)}-${seq}`,
    text: DEFAULT_QR_TEXT,
    ecc: DEFAULT_QR_ECC,
    darkHex: "#1b1b1f",
    darkPaletteId: "",
    lightHex: "#ffffff",
    lightPaletteId: "",
    // "bead" = 静默区与浅色模块都铺浅色豆（默认，扫得出来的保证）
    // "empty" = 只落深色豆，浅色部分留空（让底图透出来，需要底图够浅）
    lightMode: "bead",
    quietModules: QR_QUIET_MODULES,
    // 0 = 自动：按图纸短边取能放下的最大整数
    beadPerModule: 0,
    // 左上角（**含静默区**），整数格。见 qrLayout 的注释：QR 不能用小数位置。
    x: 0,
    y: 0,
    locked: false,
    ...overrides,
  };
}

/* =========================================================
 * 编码器解析
 * ======================================================= */

/**
 * 取二维码编码器工厂。
 * 优先级：显式注入 → `globalThis.qrcode`（vendor/qrcode.js 注入的）。
 * 都没有就返回 null，由调用方给出「组件未加载」而不是抛。
 */
export function resolveQrEncoder({ encoder } = {}) {
  if (typeof encoder === "function") return encoder;
  const global = globalThis.qrcode;
  return typeof global === "function" ? global : null;
}

/** 编码器是否已就绪。渲染器/面板用它决定要不要先等加载。 */
export function qrEncoderReady() {
  return typeof globalThis.qrcode === "function";
}

let runtimePromise = null;
/**
 * 浏览器侧按需注入 vendor/qrcode.js。与 app.js 的 ensureQrRuntime 同一个文件、
 * 同一个全局名，所以两边只会真正加载一次（谁先谁后都行）。
 */
export function loadQrEncoder(href = "./vendor/qrcode.js") {
  if (qrEncoderReady()) return Promise.resolve();
  if (runtimePromise) return runtimePromise;
  runtimePromise = new Promise((resolve, reject) => {
    if (typeof document === "undefined") { runtimePromise = null; reject(new Error("二维码组件不可用（无 document）")); return; }
    const script = document.createElement("script");
    script.src = href;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { runtimePromise = null; reject(new Error("二维码组件加载失败")); };
    document.head.append(script);
  });
  return runtimePromise;
}

/* =========================================================
 * 内容 → 模块矩阵
 * ======================================================= */

/**
 * 把内容编成二维码模块矩阵。
 *
 * @returns {{error:string|null, count:number, version:number, ecc:string,
 *            modules:Uint8Array|null, isDark:(r:number,c:number)=>boolean}}
 *   `error` 非空时 `count` 为 0 —— 调用方据此给出提示，**不抛**。
 *   抛的话「内容太长」会变成一次崩溃，而它是完全正常的用户输入。
 */
export function buildQrMatrix({ text, ecc = DEFAULT_QR_ECC, encoder } = {}) {
  const factory = resolveQrEncoder({ encoder });
  const level = normalizeEcc(ecc);
  const content = String(text ?? "");
  const empty = (error) => ({ error, count: 0, version: 0, ecc: level, modules: null, isDark: () => false });
  if (!factory) return empty("二维码组件未加载");
  if (!content.trim()) return empty("内容为空");

  try {
    // typeNumber 传 0 = 让编码器自动选最小可容纳的版本（1–40）。
    const qr = factory(0, level);
    qr.addData(content);
    qr.make();
    const count = qr.getModuleCount();
    const modules = new Uint8Array(count * count);
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) modules[r * count + c] = qr.isDark(r, c) ? 1 : 0;
    }
    return {
      error: null,
      count,
      version: (count - 17) / 4,
      ecc: level,
      modules,
      isDark: (r, c) => modules[r * count + c] === 1,
    };
  } catch (error) {
    // vendor 抛的是**字符串**不是 Error（`throw 'code length overflow. (...)'`），
    // 所以不能只读 .message —— 那样溢出会被当成「未知错误」。
    const text = String(error?.message ?? error);
    const overflow = /overflow/i.test(text);
    return empty(overflow ? "内容太长，超出二维码容量（已到最大版本 40）" : `二维码生成失败：${text}`);
  }
}

/* =========================================================
 * 布局：模块 → 格（本功能的核心不变量）
 * ======================================================= */

/**
 * 图纸短边最多能容纳多少个模块（含静默区）。
 * 面板用它回答「当前图纸最多放多少内容」。
 */
export function qrMaxModules(gridWidth, gridHeight, quietModules = QR_QUIET_MODULES) {
  const q = clampQuiet(quietModules);
  const short = Math.min(Number(gridWidth) || 0, Number(gridHeight) || 0);
  if (short <= 0) return 0;
  return Math.max(0, Math.floor(short / 1) - 2 * q);
}

function clampQuiet(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return QR_QUIET_MODULES;
  return Math.max(0, Math.min(QR_QUIET_MAX, n));
}

/**
 * 计算二维码在格网里的精确占位。
 *
 * ── 为什么 x/y 是「左上角」而不是像文字那样的「中心」 ────────────────
 * 文字的落点是「有墨的格子」，半格偏差看不出来。二维码不行：模块边界必须
 * 落在格边界上，否则解码器采样点全偏。用左上角 + 强制取整，是把这条约束
 * 写进数据模型里，而不是靠调用方记得取整。
 *
 * @returns {{moduleCount:number, quietModules:number, totalModules:number,
 *            beadPerModule:number, spanCells:number, autoBeadPerModule:number,
 *            box:{x0:number,y0:number,x1:number,y1:number},
 *            overflow:{left:boolean,top:boolean,right:boolean,bottom:boolean},
 *            fullyInside:boolean, fits:boolean, tooSmall:boolean}}
 */
export function qrLayout({ moduleCount, quietModules = QR_QUIET_MODULES, gridWidth, gridHeight, x = 0, y = 0, beadPerModule = 0 } = {}) {
  const count = Math.max(0, Math.round(Number(moduleCount) || 0));
  const q = clampQuiet(quietModules);
  const width = Math.max(0, Math.round(Number(gridWidth) || 0));
  const height = Math.max(0, Math.round(Number(gridHeight) || 0));
  const totalModules = count + 2 * q;

  const short = Math.min(width, height);
  const autoBeadPerModule = totalModules > 0 ? Math.max(0, Math.floor(short / totalModules)) : 0;
  const requested = Math.round(Number(beadPerModule) || 0);
  // 0 / 非法 → 自动。自动取不到 1 时保持 0，让 tooSmall 去报错而不是硬凑一个 1
  // （硬凑 1 会画出一个超出画布的码，看起来「生成了」实际根本放不下）。
  const bead = requested > 0 ? Math.max(QR_MIN_MODULE_BEADS, requested) : autoBeadPerModule;

  const spanCells = totalModules * bead;
  const x0 = Math.round(Number(x) || 0);
  const y0 = Math.round(Number(y) || 0);
  const box = { x0, y0, x1: x0 + spanCells - 1, y1: y0 + spanCells - 1 };
  const overflow = {
    left: x0 < 0,
    top: y0 < 0,
    right: box.x1 >= width,
    bottom: box.y1 >= height,
  };
  return {
    moduleCount: count,
    quietModules: q,
    totalModules,
    beadPerModule: bead,
    spanCells,
    autoBeadPerModule,
    box,
    overflow,
    fullyInside: !(overflow.left || overflow.top || overflow.right || overflow.bottom),
    fits: bead >= QR_MIN_MODULE_BEADS && spanCells > 0,
    tooSmall: bead < QR_MIN_MODULE_BEADS,
  };
}

/**
 * 格 → 模块的**逆映射**。存在的理由只有一个：它是「投影无损」的可执行证明。
 *
 * 只要 `cellToModule(layout, ...)` 能把 `rasterizeQr` 产出的每一格还原回它来自
 * 哪个模块，那么「豆拼二维码能不能被解码器读出来」就退化成两件可分别验证的事：
 *   · 编码器本身合规（vendor，MIT，广泛使用，另有 golden matrix 测试钉住）
 *   · 投影无损（本函数 + tests 里的往返断言）
 * 否则就只能靠「看着像」——那正是本功能最不该接受的证据。
 */
export function cellToModule(layout, gx, gy) {
  if (!layout || layout.beadPerModule <= 0 || layout.spanCells <= 0) return null;
  const rx = gx - layout.box.x0;
  const ry = gy - layout.box.y0;
  if (rx < 0 || ry < 0 || rx >= layout.spanCells || ry >= layout.spanCells) return null;
  const col = Math.floor(rx / layout.beadPerModule);
  const row = Math.floor(ry / layout.beadPerModule);
  const moduleCol = col - layout.quietModules;
  const moduleRow = row - layout.quietModules;
  const quiet = moduleCol < 0 || moduleRow < 0 || moduleCol >= layout.moduleCount || moduleRow >= layout.moduleCount;
  return { row: moduleRow, col: moduleCol, quiet };
}

/* =========================================================
 * 颜色
 * ======================================================= */

export function parseHexColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const hex = match[1];
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

export function relativeLuminance(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 深/浅模块的对比度诊断。
 *
 * 两个判据缺一不可：
 *   · **对比度比**（相对亮度比）够大 —— 否则解码器分不清深浅；
 *   · **极性正确** —— 深色必须比浅色更暗。反过来（浅底深空）在 QR 里是
 *     合法的「反色码」，但很多解码器不认，豆拼场景没必要冒这个险，所以单独提示。
 */
export function qrContrast(darkHex, lightHex) {
  const dark = relativeLuminance(darkHex);
  const light = relativeLuminance(lightHex);
  if (dark == null || light == null) return { ratio: null, ok: true, inverted: false, reason: "颜色未解析，跳过对比度校验" };
  const ratio = (Math.max(dark, light) + 0.05) / (Math.min(dark, light) + 0.05);
  const rounded = Math.round(ratio * 100) / 100;
  const inverted = dark > light;
  if (inverted) return { ratio: rounded, ok: false, inverted: true, reason: "深色模块比浅色模块还亮，解码器可能不认这种反色码" };
  if (rounded < QR_MIN_CONTRAST_RATIO) return { ratio: rounded, ok: false, inverted: false, reason: `深浅对比度 ${rounded}:1，低于 ${QR_MIN_CONTRAST_RATIO}:1，扫码可靠性会明显下降` };
  return { ratio: rounded, ok: true, inverted: false, reason: `对比度 ${rounded}:1` };
}

/* =========================================================
 * 栅格化
 * ======================================================= */

const DEFAULT_DARK_HEX = "#1b1b1f";
const DEFAULT_LIGHT_HEX = "#ffffff";

/**
 * 把二维码图层栅格化成豆格列表。**唯一出口** —— 画布预览与导出合成都调它。
 *
 * @returns {{cells:Array<{x:number,y:number}>, paintLayers:Array<object>,
 *            matrix:object|null, layout:object|null, error:string|null, warnings:string[]}}
 */
export function rasterizeQr(layer, gridWidth, gridHeight, options = {}) {
  const width = Math.max(1, Math.round(Number(gridWidth) || 0));
  const height = Math.max(1, Math.round(Number(gridHeight) || 0));
  const matrix = buildQrMatrix({ text: layer?.text, ecc: layer?.ecc, encoder: options.encoder });
  if (matrix.error || !matrix.count) {
    return { cells: [], paintLayers: [], matrix: null, layout: null, error: matrix.error, warnings: [] };
  }
  const layout = qrLayout({
    moduleCount: matrix.count,
    quietModules: layer?.quietModules,
    gridWidth: width,
    gridHeight: height,
    x: layer?.x,
    y: layer?.y,
    beadPerModule: layer?.beadPerModule,
  });

  const warnings = [];
  if (layout.tooSmall) {
    return { cells: [], paintLayers: [], matrix, layout, error: `图纸太小：${layout.totalModules} 个模块放不进 ${width}×${height} 格`, warnings };
  }
  if (!layout.fullyInside) warnings.push("二维码超出图纸范围，超出的部分不会落到豆格上");

  const darkCells = [];
  const lightCells = [];
  const { beadPerModule: bead, quietModules: q, moduleCount: count, box } = layout;
  const lightBeaded = String(layer?.lightMode ?? "bead") !== "empty";

  for (let row = 0; row < layout.totalModules; row += 1) {
    for (let col = 0; col < layout.totalModules; col += 1) {
      const moduleRow = row - q;
      const moduleCol = col - q;
      const inCode = moduleRow >= 0 && moduleRow < count && moduleCol >= 0 && moduleCol < count;
      const isDark = inCode && matrix.isDark(moduleRow, moduleCol);
      // 静默区与浅色模块同属「浅色区」，唯一区别是 lightMode=empty 时两者都不落豆。
      if (!isDark && !lightBeaded) continue;
      const target = isDark ? darkCells : lightCells;
      const gx0 = box.x0 + col * bead;
      const gy0 = box.y0 + row * bead;
      for (let dy = 0; dy < bead; dy += 1) {
        const gy = gy0 + dy;
        if (gy < 0 || gy >= height) continue;
        for (let dx = 0; dx < bead; dx += 1) {
          const gx = gx0 + dx;
          if (gx < 0 || gx >= width) continue;
          target.push({ x: gx, y: gy });
        }
      }
    }
  }

  const paintLayers = [];
  const add = (role, color, paletteId, cells) => {
    if (cells.length) paintLayers.push({ role, color, paletteId: paletteId || "", opacity: 1, cells });
  };
  add("dark", layer?.darkHex || DEFAULT_DARK_HEX, layer?.darkPaletteId, darkCells);
  if (lightBeaded) add("light", layer?.lightHex || DEFAULT_LIGHT_HEX, layer?.lightPaletteId, lightCells);

  const merged = new Map();
  for (const paintLayer of paintLayers) for (const cell of paintLayer.cells) merged.set(`${cell.x},${cell.y}`, cell);
  return { cells: [...merged.values()], paintLayers, matrix, layout, error: null, warnings };
}

const cache = new Map();
const CACHE_LIMIT = 48;
export function rasterizeQrCached(layer, gridWidth, gridHeight, options = {}) {
  if (!layer) return { cells: [], paintLayers: [], matrix: null, layout: null, error: null, warnings: [] };
  const key = [
    layer.text, layer.ecc, layer.darkHex, layer.darkPaletteId, layer.lightHex, layer.lightPaletteId,
    layer.lightMode, layer.quietModules, layer.beadPerModule, layer.x, layer.y, gridWidth, gridHeight,
  ].join("\u0001");
  const hit = cache.get(key);
  if (hit) return hit;
  const value = rasterizeQr(layer, gridWidth, gridHeight, options);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/* =========================================================
 * 面板读数
 * ======================================================= */

/**
 * 面板要显示的全部诊断。集中在这里而不是散在面板里 —— 面板只负责画，
 * 判据只负责算，否则「图上显示能扫、实际扫不出」这种事没人能定位。
 */
export function qrDiagnostics(layer, gridWidth, gridHeight, options = {}) {
  const width = Math.max(1, Math.round(Number(gridWidth) || 0));
  const height = Math.max(1, Math.round(Number(gridHeight) || 0));
  const matrix = buildQrMatrix({ text: layer?.text, ecc: layer?.ecc, encoder: options.encoder });
  const contrast = qrContrast(layer?.darkHex || DEFAULT_DARK_HEX, layer?.lightHex || DEFAULT_LIGHT_HEX);
  const capacity = qrMaxModules(width, height, layer?.quietModules);
  const base = {
    error: matrix.error,
    warnings: [],
    moduleCount: matrix.count,
    version: matrix.version,
    ecc: matrix.ecc,
    capacity,
    contrast,
    lightMode: String(layer?.lightMode ?? "bead"),
    beadCount: 0,
    darkBeads: 0,
    lightBeads: 0,
    layout: null,
  };
  if (matrix.error || !matrix.count) return base;

  const raster = rasterizeQr(layer, width, height, options);
  const layout = raster.layout;
  const dark = raster.paintLayers.find((entry) => entry.role === "dark");
  const light = raster.paintLayers.find((entry) => entry.role === "light");
  const warnings = [...raster.warnings];
  if (!contrast.ok) warnings.push(contrast.reason);
  if (base.lightMode === "empty") warnings.push("浅色区留空：底图必须足够浅，否则解码器找不到码的边界");
  if (layer?.quietModules != null && Math.round(Number(layer.quietModules)) < QR_QUIET_MODULES) {
    warnings.push(`静默区只有 ${Math.round(Number(layer.quietModules))} 模块，低于规范的 ${QR_QUIET_MODULES} 模块，扫码可能失败`);
  }
  return {
    ...base,
    error: raster.error,
    warnings,
    layout,
    beadCount: raster.cells.length,
    darkBeads: dark?.cells.length || 0,
    lightBeads: light?.cells.length || 0,
  };
}

/* =========================================================
 * 导出合成
 * ======================================================= */

function closestPaletteColor(hex, palette, fallbackId) {
  const list = (palette || []).filter((color) => Array.isArray(color.rgb));
  const fallback = (palette || []).find((color) => color.paletteId === fallbackId || color.code === fallbackId);
  const rgb = parseHexColor(hex);
  if (!rgb) return fallback || null;
  return list.reduce((best, color) => {
    const distance = color.rgb.reduce((sum, value, index) => sum + (value - rgb[index]) ** 2, 0);
    return !best || distance < best.distance ? { color, distance } : best;
  }, null)?.color || fallback || null;
}

/**
 * 把**已锁定**的二维码图层叠加到一份网格副本上；编辑器底版不动。
 * 与 `composeLockedTextGrid` 同一契约：只并锁定层、只写副本、越界裁剪。
 *
 * @param {Array} grid
 * @param {Array} layers
 * @param {Array} palette
 * @param {{rasterize?:Function, encoder?:Function}} options
 */
export function composeLockedQrGrid(grid, layers = [], palette = [], { rasterize = rasterizeQrCached, encoder } = {}) {
  if (!Array.isArray(grid) || !grid.length) return grid;
  // 一个锁定层都没有 → 原样返回同一个网格，连一次深拷贝都不做。
  // 导出路径每次都会调它，无锁定层是常态（大部分图纸没有二维码），
  // 让这条路径零成本比省一行代码更值。
  if (!layers.some((layer) => layer?.locked)) return grid;
  const output = grid.map((row) => row.slice());
  const height = output.length;
  const width = output[0]?.length || 0;
  for (const layer of layers) {
    if (!layer?.locked) continue;
    const { paintLayers } = rasterize(layer, width, height, { encoder });
    for (const group of paintLayers) {
      const exact = group.paletteId && palette.find((color) => color.paletteId === group.paletteId);
      const target = exact || closestPaletteColor(group.color, palette, group.paletteId);
      if (!target) continue;
      for (const { x, y } of group.cells) {
        if (x >= 0 && x < width && y >= 0 && y < height) output[y][x] = target;
      }
    }
  }
  return output;
}

/** 图层摘要文案：给图层列表用。 */
export function qrLayerLabel(layer, index) {
  const text = String(layer?.text ?? "").replace(/\s+/g, " ").trim();
  const shown = !text ? "（空内容）" : text.length > 12 ? `${text.slice(0, 12)}…` : text;
  return `二维码 ${index + 1}: "${shown}"`;
}
