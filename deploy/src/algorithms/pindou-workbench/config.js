/**
 * pindou-workbench 纯算法模块 · 常量表与来源登记
 * ─────────────────────────────────────────────────────────────
 * 审计文档：docs/algorithm-audit-pindou-workbench.md
 * 上游：https://github.com/beads9/pindou-workbench  commit 26e806f
 *
 * 设计纪律（沿用 bgs 批次踩过的坑）：
 *   RAW 树里的叶子是 `tunable(value, meta)` 包装对象；
 *   对外导出的 `PW_CONFIG` 必须**全部是原始值**（数字 / 布尔 / 字符串 / 数组）。
 *   上一批曾把包装对象直接当配置用，导致 `luma > threshold` 之类的比较
 *   静默为 false，整张矩阵变成 null。因此这里用 flatten() 显式拆包，
 *   并配一条单测结构性钉死「PW_CONFIG 的叶子绝不能是对象」。
 */

/** 算法来源标记。每个导出函数都必须能回答「这是上游的，还是本仓库补的」。 */
export const ORIGIN = Object.freeze({
  /** 忠实移植上游：算法、参数、语义均照搬，只做 pure function 化与命名。 */
  UPSTREAM_PORT: "upstream-port",
  /** 上游不存在：README 有宣称但代码没有，或纯为本仓库的新组合而写。 */
  LIBMS_FILL: "libms-fill",
  /** 混合：核心来自上游，外围（参数校验 / 诊断 / 修复）来自本仓库。 */
  MIXED: "mixed",
});

/** 上游元信息。用于 NOTICE 与所有 provenance 标注。 */
export const UPSTREAM = Object.freeze({
  repo: "https://github.com/beads9/pindou-workbench",
  commit: "26e806f",
  file: "app.js",
  licenseDeclared: "MIT",
  licenseFilePresent: false,
  note: "README 声明 MIT，但仓库内无 LICENSE 文件、无版权声明行。因此本模块不逐字复制上游任何代码，只借鉴算法思想并自行重写。",
});

/** 上游的算法区间（实证：整段零 DOM / Canvas / storage 引用）。 */
export const UPSTREAM_ALGORITHM_REGION = Object.freeze({ from: 47, to: 253 });

/** 三档精度预设。上游 `app.js:92–96`。 */
export const PRECISION = Object.freeze({
  FAST: "fast",
  BALANCED: "balanced",
  PRECISE: "precise",
});

/** 采样模式。 */
export const GRID_SAMPLE_MODE = Object.freeze({
  /** 1 格 = 1 像素。上游的唯一行为（采样被委托给 Canvas 缩放）。 */
  POINT: "point",
  /** 格内面积加权均值。libms 补全。 */
  AREA: "area-average",
  /** 格内出现最多的量化色。libms 补全。 */
  DOMINANT: "dominant",
  /** 格内逐通道中位数。libms 补全。 */
  MEDIAN: "median",
});

/** 阈值模式。 */
export const THRESHOLD_MODE = Object.freeze({
  /** 上游：max(floor, median(nonzero) * factor) */
  MEDIAN: "median",
  /** libms / bgs 同源：Otsu（含纯双峰退化回退中值） */
  OTSU: "otsu",
  /** mean + k * std */
  MEAN_STD: "mean-std",
  /** 固定阈值 */
  FIXED: "fixed",
});

/** 背景估计模式。 */
export const BACKGROUND_MODE = Object.freeze({
  /** 上游：边框 margin 的算术平均 */
  BORDER_MEAN: "border-mean",
  /** libms 补全：边框样本 K-means，取占比最大的簇 */
  BORDER_KMEANS: "border-kmeans",
  /** libms 补全：K-means 后再按「离边框最近的簇」优先 */
  BORDER_KMEANS_NEAREST: "border-kmeans-nearest",
});

/** 腐蚀模式。 */
export const ERODE_MODE = Object.freeze({
  /** 标准 3×3 min-filter：9 邻域全为前景才保留 */
  MIN_FILTER: "min-filter",
  /** 上游：sum >= 5 的多数腐蚀（比 min-filter 弱） */
  MAJORITY: "majority",
});

/** 色板匹配模式。第四阶段要求三档并存。 */
export const PALETTE_MATCH_MODE = Object.freeze({
  /** 上游原版：sqrt(2Δr² + 4Δg² + 3Δb²) */
  ORIGINAL_WEIGHTED_RGB: "original-weighted-rgb",
  /** CIELAB 欧氏距离（ΔE76） */
  LAB: "lab",
  /** CIEDE2000 —— 与 libms palette-engine 口径一致 */
  CIEDE2000: "ciede2000",
});

/** 多尺度融合方式。 */
export const EDGE_FUSE = Object.freeze({
  MAX: "max",
  WEIGHTED_MEAN: "weighted-mean",
  RMS: "rms",
});

/** 管线档位。 */
export const PIPELINE_PROFILE = Object.freeze({
  /** 忠实复刻上游语义（含「不做连通性分析」等特性）。 */
  UPSTREAM: "upstream",
  /** 上游骨架 + 本仓库的修复与可配项。 */
  IMPROVED: "improved",
});

/* ============================================================
 * 可调常量
 * ========================================================== */

const PORT = ORIGIN.UPSTREAM_PORT;
const FILL = ORIGIN.LIBMS_FILL;

let counter = 0;
/**
 * 声明一个可调常量，并记录它与上游的关系。
 * @param {*} value 本仓库实际使用的值
 * @param {{upstream?:*, origin:string, ref?:string, note:string, calibrated?:boolean}} meta
 */
function tunable(value, meta) {
  counter += 1;
  return Object.freeze({
    __pw: true,
    id: counter,
    value,
    // `upstream: null` 是**显式**声明「上游没有这个常量」，与省略该字段等价。
    upstreamValue: meta.upstream === undefined || meta.upstream === null
      ? null
      : Object.freeze(meta.upstream),
    hasUpstream: meta.upstream !== undefined && meta.upstream !== null,
    origin: meta.origin,
    ref: meta.ref || "",
    note: meta.note,
    calibrated: meta.calibrated === true,
  });
}

const RAW = {
  luma: {
    weights: tunable([0.299, 0.587, 0.114], {
      upstream: [0.299, 0.587, 0.114],
      origin: PORT,
      ref: "app.js:106",
      note: "Rec.601 亮度权重，上游在 Sobel 内层循环里逐像素计算（9 次/像素）。本模块预先算一次 luma 再卷积，结果逐位相同，只是快 9 倍。",
    }),
  },

  sobel3: {
    /** 水平导数核。上游 app.js:107。 */
    kx: tunable([-1, 0, 1, -2, 0, 2, -1, 0, 1], {
      upstream: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
      origin: PORT,
      ref: "app.js:107",
      note: "上游按 (dy+1)*3+(dx+1) 索引，等价于标准 Sobel 水平导数。",
    }),
    /** 垂直导数核。上游 app.js:108。 */
    ky: tunable([-1, -2, -1, 0, 0, 0, 1, 2, 1], {
      upstream: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
      origin: PORT,
      ref: "app.js:108",
      note: "上游按 (dy+1)*3+(dx+1) 索引，等价于标准 Sobel 垂直导数。",
    }),
    radius: tunable(1, { upstream: 1, origin: PORT, ref: "app.js:100–104", note: "3×3 邻域半径。" }),
    /** 边框不参与卷积，恒为 0 —— 上游同样如此（循环从 1 到 h-2）。 */
    borderValue: tunable(0, { upstream: 0, origin: PORT, ref: "app.js:100", note: "" }),
  },

  sobel5: {
    /**
     * 5×5 Sobel 水平核。上游**不存在** 5×5（README 宣称有，代码没有）。
     * 本模块补全：沿用 Sobel 的「一阶差分 × 平滑」构造，扩展到 5 抽头。
     */
    kx: tunable(
      [-1, -2, 0, 2, 1, -4, -8, 0, 8, 4, -6, -12, 0, 12, 6, -4, -8, 0, 8, 4, -1, -2, 0, 2, 1],
      {
        upstream: null,
        origin: FILL,
        ref: "classic 5×5 Sobel",
        note: "上游无此算法。核能量是 3×3 版的约 4.4 倍，因此比较前必须按核能量归一化（见 multi-scale-edge.js）。",
      },
    ),
    radius: tunable(2, { upstream: null, origin: FILL, ref: "", note: "5×5 邻域半径。" }),
  },

  multiScale: {
    /** 参与融合的尺度权重（3×3 与 5×5），融合前各自按稳健分位数归一化。 */
    weights: tunable([0.55, 0.45], {
      upstream: null,
      origin: FILL,
      ref: "",
      note: "上游无多尺度融合。细尺度权重略高，因为拼豆格数少、细边缘更容易丢。",
    }),
    /** 归一化用的稳健分位数（避开极值）。 */
    normalizeQuantile: tunable(0.99, {
      upstream: null,
      origin: FILL,
      ref: "",
      note: "用 99 分位而非最大值，避免单个强边缘把整幅图压暗。",
    }),
    /** 可选的高斯前置尺度。 */
    blurSigmas: tunable([0, 0.8, 1.6], {
      upstream: null,
      origin: FILL,
      ref: "",
      note: "为 0 表示不模糊。真正的「多尺度」= 同一算子在不同模糊层上重复运行。",
    }),
    fuse: tunable(EDGE_FUSE.WEIGHTED_MEAN, {
      upstream: null,
      origin: FILL,
      ref: "",
      note: "max 保留最强响应；weighted-mean 更平滑；rms 介于两者之间。",
    }),
  },

  precision: {
    fast: tunable(
      { edgeThresh: 80, colorThresh: 60, morphIter: 1, feather: 0 },
      { upstream: { edgeThresh: 80, colorThresh: 60, morphIter: 1, feather: 0 }, origin: PORT, ref: "app.js:93", note: "上游 fast 档。界面不可达（generatePattern 硬编码 balanced）。" },
    ),
    balanced: tunable(
      { edgeThresh: 60, colorThresh: 45, morphIter: 2, feather: 1 },
      { upstream: { edgeThresh: 60, colorThresh: 45, morphIter: 2, feather: 1 }, origin: PORT, ref: "app.js:94", note: "上游 balanced 档，也是上游唯一实际生效的档位。" },
    ),
    precise: tunable(
      { edgeThresh: 40, colorThresh: 30, morphIter: 3, feather: 2 },
      { upstream: { edgeThresh: 40, colorThresh: 30, morphIter: 3, feather: 2 }, origin: PORT, ref: "app.js:95", note: "上游 precise 档。界面不可达。" },
    ),
    default: tunable(PRECISION.BALANCED, {
      upstream: PRECISION.BALANCED,
      origin: PORT,
      ref: "app.js:96,428",
      note: "上游默认且硬编码 balanced。本模块保持默认，但三档全部可达（修复 S-6）。",
    }),
  },

  threshold: {
    /** 上游固定乘数：median * 0.8。 */
    medianFactor: tunable(0.8, { upstream: 0.8, origin: PORT, ref: "app.js:120", note: "上游对「非零边缘值的中位数」乘 0.8。" }),
    mode: tunable(THRESHOLD_MODE.MEDIAN, { upstream: THRESHOLD_MODE.MEDIAN, origin: PORT, ref: "app.js:120", note: "上游只有 median 一种。" }),
    histogramBins: tunable(64, { upstream: null, origin: FILL, ref: "", note: "上游 README 宣称「边缘强度直方图」，代码里没有直方图。本模块补上，供 otsu 档与诊断使用。" }),
    meanStdK: tunable(1.5, { upstream: null, origin: FILL, ref: "", note: "mean-std 档的 k 值。" }),
    /** Otsu 在纯双峰直方图上会退化（谷底不唯一），回退取平台中点。 */
    otsuPlateauMidpoint: tunable(true, { upstream: null, origin: FILL, ref: "libms otsuThreshold", note: "与 bgs/color-space.otsuThreshold 同一修正。" }),
  },

  background: {
    /** margin = max(backgroundMinMargin, floor(min(w,h) * marginRatio)) */
    marginRatio: tunable(0.03, { upstream: 0.03, origin: PORT, ref: "app.js:147", note: "" }),
    minMargin: tunable(3, { upstream: 3, origin: PORT, ref: "app.js:147", note: "" }),
    mode: tunable(BACKGROUND_MODE.BORDER_MEAN, {
      upstream: BACKGROUND_MODE.BORDER_MEAN,
      origin: PORT,
      ref: "app.js:169–170",
      note: "上游是边框算术平均。README 宣称「K-means 背景估计」，代码里没有。",
    }),
    k: tunable(3, { upstream: null, origin: FILL, ref: "", note: "补全的边框 K-means 簇数。" }),
    iterations: tunable(12, { upstream: null, origin: FILL, ref: "", note: "补全的边框 K-means 迭代上限。" }),
  },

  morphology: {
    iterations: tunable(2, { upstream: 2, origin: PORT, ref: "app.js:94", note: "来自 balanced 档的 morphIter。" }),
    /** 上游腐蚀判据：3×3 邻域前景数 >= 5。 */
    majorityThreshold: tunable(5, { upstream: 5, origin: PORT, ref: "app.js:201", note: "上游的「腐蚀」其实是多数腐蚀，比标准 min-filter 弱。" }),
    erodeMode: tunable(ERODE_MODE.MAJORITY, { upstream: ERODE_MODE.MAJORITY, origin: PORT, ref: "app.js:201", note: "保持上游语义为默认。" }),
    radius: tunable(1, { upstream: 1, origin: PORT, ref: "app.js:196–200", note: "3×3 结构元。" }),
  },

  feather: {
    /** 上游 config.feather 的三档半径（0/1/2），声明后从未被读取。 */
    radiusByPrecision: tunable({ fast: 0, balanced: 1, precise: 2 }, {
      upstream: { fast: 0, balanced: 1, precise: 2 },
      origin: PORT,
      ref: "app.js:93–96",
      note: "上游声明但从未使用（缺陷 S-7）。本模块把这三档真正接上。",
    }),
    sigma: tunable(1, { upstream: null, origin: FILL, ref: "", note: "高斯 sigma。radius = ceil(2*sigma)。" }),
    /** 羽化产出的连续 alpha 的二值化阈值。 */
    binaryThreshold: tunable(0.5, {
      upstream: null,
      origin: FILL,
      ref: "libms feather-mask.binaryMask",
      note: "羽化后的连续 alpha 需要一个二值回退口径。0.5 是唯一自然选择：低于半覆盖的格子不落豆，避免把半透明过渡带变成一圈虚边。",
    }),
  },

  kmeans: {
    maxIterations: tunable(10, { upstream: 10, origin: PORT, ref: "app.js:232", note: "上游硬编码 10 轮，无收敛判据。" }),
    init: tunable("strided", { upstream: "strided", origin: PORT, ref: "app.js:228–231", note: "上游按 step=floor(len/k) 等距抽样。确定性，无随机种子。" }),
    /** 收敛判据。0 = 不提前退出（与上游逐位一致）。 */
    tolerance: tunable(0, { upstream: 0, origin: ORIGIN.MIXED, ref: "", note: "默认 0 以保持与上游逐位一致；improved 档会显式打开。" }),
    /** 空簇处理：重播种到距质心最远的样本（确定性，不用随机）。 */
    reseedEmptyClusters: tunable(false, { upstream: false, origin: FILL, ref: "", note: "上游不处理空簇。improved 档打开。" }),
  },

  weightedRgb: {
    /** 上游权重：R=2, G=4, B=3。 */
    weights: tunable([2, 4, 3], { upstream: [2, 4, 3], origin: PORT, ref: "app.js:65", note: "固定权重，不含 redmean 的均值项。" }),
  },

  grid: {
    /** 上游界面允许 16–256，并对越界值静默 clamp（缺陷 E-2）。 */
    minSide: tunable(16, { upstream: 16, origin: PORT, ref: "app.js:407–408", note: "只用于**报告**越界，绝不用于改写请求值。" }),
    maxSide: tunable(256, { upstream: 256, origin: PORT, ref: "app.js:407–408", note: "同上。" }),
    /** 上游 colorLimit 默认 16。 */
    defaultColorLimit: tunable(16, { upstream: 16, origin: PORT, ref: "app.js:20,77", note: "16 < 265 恒真，所以上游默认一定走 K-means 分支。" }),
  },

  edgeContamination: {
    /** 判定「边缘污染豆」的 ΔE 上限：与背景色太接近的边界豆视为抠图残留。 */
    maxDeltaE: tunable(12, { upstream: null, origin: FILL, ref: "", note: "本模块新增的「边缘杂色清理」，上游没有。" }),
  },

  highlightProtection: {
    /** 高光判定：局部亮度显著高于邻域、且彩度低。 */
    minRelativeLuma: tunable(1.12, { upstream: null, origin: FILL, ref: "", note: "本模块新增的「眼睛高光保护」，上游没有。" }),
    maxChroma: tunable(0.32, { upstream: null, origin: FILL, ref: "", note: "OKLab 彩度上限。" }),
    minLocalDelta: tunable(6, { upstream: null, origin: FILL, ref: "", note: "与邻域亮度差的下限（0–255 口径）。" }),
  },

  alpha: {
    /** 0 = 完全不读 alpha（上游行为，缺陷 T-1）；>0 则 alpha 小于该值判为背景。 */
    thresholdUpstream: tunable(0, {
      upstream: 0,
      origin: PORT,
      ref: "app.js:47–253（整段无 alpha 读取）",
      note: "上游从未读取 alpha 通道。ref 指向「缺失位置」而非某一行，因为这是一个**否定式**声明。",
    }),
    thresholdFixed: tunable(8, { upstream: null, origin: FILL, ref: "libms 口径", note: "与 libms sampling-engine 的 alphaThreshold 一致。" }),
  },

  sampling: {
    /** improved 档的超采样因子：先在 2× 分辨率上栅格化再聚合。 */
    supersample: tunable(2, { upstream: 1, origin: FILL, ref: "", note: "上游是 1（Canvas 直接缩放到格数）。" }),
    modeUpstream: tunable(GRID_SAMPLE_MODE.POINT, { upstream: GRID_SAMPLE_MODE.POINT, origin: PORT, ref: "app.js:417–425", note: "" }),
    modeImproved: tunable(GRID_SAMPLE_MODE.AREA, { upstream: null, origin: FILL, ref: "", note: "上游 POINT 单点取样会在高频区域产生摩尔纹；improved 档改用格内面积平均。" }),
  },
};

/* ============================================================
 * 拆包 / 冻结 / 元数据
 * ========================================================== */

function isTunable(node) {
  return Boolean(node && typeof node === "object" && node.__pw === true);
}

function deepFreezeArray(value) {
  return Object.freeze(value.slice());
}

/** 把 RAW 树拆成「全叶子为原始值」的冻结对象。 */
function flatten(node) {
  if (isTunable(node)) {
    const value = node.value;
    if (Array.isArray(value)) return deepFreezeArray(value);
    if (value && typeof value === "object") return Object.freeze({ ...value });
    return value;
  }
  if (Array.isArray(node)) return deepFreezeArray(node);
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, child] of Object.entries(node)) out[key] = flatten(child);
    return Object.freeze(out);
  }
  return node;
}

/** 生成 'path.to.leaf' → 元数据的登记表。 */
function buildMeta(node, path = "", out = {}) {
  if (isTunable(node)) {
    out[path] = Object.freeze({
      value: node.value,
      upstreamValue: node.upstreamValue,
      origin: node.origin,
      ref: node.ref,
      note: node.note,
      calibrated: node.calibrated,
      hasUpstreamCounterpart: node.hasUpstream === true,
    });
    return out;
  }
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) {
      buildMeta(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
}

/** 本模块实际使用的常量。**所有叶子都是原始值。** */
export const PW_CONFIG = flatten(RAW);

/** 常量来源登记表。`PW_CONFIG_META['sobel3.kx']` → { value, upstreamValue, origin, ref, note } */
export const PW_CONFIG_META = Object.freeze(buildMeta(RAW));

/** 只列出上游真实存在的常量（INTEGRITY：用于「port 覆盖度」诊断）。 */
export function upstreamConstants() {
  const out = {};
  for (const [path, meta] of Object.entries(PW_CONFIG_META)) {
    if (meta.hasUpstreamCounterpart) out[path] = meta.upstreamValue;
  }
  return Object.freeze(out);
}

/** 只列出上游不存在的常量（即本仓库补全项）。 */
export function libmsFilledConstants() {
  const out = {};
  for (const [path, meta] of Object.entries(PW_CONFIG_META)) {
    if (!meta.hasUpstreamCounterpart) out[path] = { value: meta.value, note: meta.note };
  }
  return Object.freeze(out);
}

/**
 * 取指定精度档的参数。
 * @param {string} precision
 */
export function resolvePrecision(precision) {
  const key = Object.prototype.hasOwnProperty.call(PW_CONFIG.precision, precision) ? precision : PW_CONFIG.precision.default;
  return Object.freeze({ name: key, ...PW_CONFIG.precision[key] });
}
