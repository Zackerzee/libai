/**
 * Shiliba Studio — 像素倍数识别
 *
 * 「像素倍数」= 原图里一个逻辑像素由多少真实像素组成。
 *
 * 判据：**边界格点**。
 * 一张像素画被放大 k 倍后，颜色只会**成组**变化——同一逻辑像素内的 k 个像素颜色一致，
 * 所以图上每一处颜色跳变（边界）的位置都必然落在 k 的整数倍上。
 * 反过来，只要存在一个边界不在 k 的整数倍上，k 就不可能是真实倍数。
 *
 * 于是答案 = 「让所有边界都落在整数倍上」的最大 k。
 *
 * 为什么不用「对齐块同色占比」：大面积纯色背景会让任意大的 k 都「块同色」，
 * 倍数会被严重高估（实测纯色底 + 小精灵的图会报 39×）。边界格点没有这个偏置——
 * 纯色区不产生任何边界，也就无法为错误的 k 作证。
 *
 * 为什么不用「边界能量占比」：相邻逻辑像素同色时边界能量为 0，能量分布不均匀，
 * 倍数会被高估到 3k 一类的高能量子集上。
 *
 * 注意：若图本身带一个比 k 更大的周期（例如 6 格棋盘在 k=7 时表现为 42 像素周期），
 * 该周期也是合法解——这是信息本身的歧义。但只要图上存在任何「非周期」细节
 * （棋盘中央的色块、边框、精灵），歧义即被打破。
 *
 * 纯计算 + 一个读图工具，不依赖 DOM 之外的任何东西。
 */

/** 在 [0, n) 上均匀取至多 count 个下标 */
function sampleAxis(n, count) {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const step = n / count;
  return Array.from({ length: count }, (_, i) => Math.min(n - 1, Math.floor(i * step)));
}

/**
 * 找出所有「边界」位置：边界 x 表示第 x-1 列与第 x 列之间存在颜色跳变。
 * 两条互补的判据，覆盖高对比窄特征与低对比宽特征：
 *   · 任一采样行上跳变超过 edgeTol（抓住小精灵这类只占几行的窄特征）
 *   · 超过 softRatio 比例的采样行上跳变超过 softTol（抓住低对比但贯穿整幅的边界）
 */
function findBoundaries(data, width, height, edgeTol, softTol, softRatio, samples) {
  const rowSamples = sampleAxis(height, samples);
  const colSamples = sampleAxis(width, samples);
  const minHits = Math.max(2, Math.ceil(rowSamples.length * softRatio));
  const minHitsY = Math.max(2, Math.ceil(colSamples.length * softRatio));

  const xs = [];
  for (let x = 1; x < width; x += 1) {
    let peak = 0;
    let hits = 0;
    for (let s = 0; s < rowSamples.length; s += 1) {
      const i = (rowSamples[s] * width + x) * 4;
      const j = i - 4;
      const d = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      if (d > peak) peak = d;
      if (d > softTol) hits += 1;
    }
    if (peak > edgeTol || hits >= minHits) xs.push(x);
  }

  const ys = [];
  for (let y = 1; y < height; y += 1) {
    let peak = 0;
    let hits = 0;
    for (let s = 0; s < colSamples.length; s += 1) {
      const i = (y * width + colSamples[s]) * 4;
      const j = i - width * 4;
      const d = Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      if (d > peak) peak = d;
      if (d > softTol) hits += 1;
    }
    if (peak > edgeTol || hits >= minHitsY) ys.push(y);
  }

  return { xs, ys };
}

/** 边界落在 k 的整数倍（容差 tol）上的比例 */
function latticeScore(positions, k, tol) {
  if (!positions.length) return 0;
  let near = 0;
  for (let i = 0; i < positions.length; i += 1) {
    const r = positions[i] % k;
    if (r <= tol || k - r <= tol) near += 1;
  }
  return near / positions.length;
}

/**
 * 从 ImageData 里识别像素倍数。
 *
 * @param {ImageData} imageData
 * @param {{maxK?: number, edgeTol?: number, softTol?: number, softRatio?: number, score?: number, samples?: number}} options
 *   maxK      最多尝试的倍数（默认 64）
 *   edgeTol   单像素 RGB 通道差之和的「显著跳变」阈值（默认 32）
 *   softTol   弱跳变阈值，配合 softRatio 使用（默认 18）
 *   softRatio 弱跳变需覆盖的采样行比例（默认 0.35）
 *   score     边界落格点的比例阈值（默认 0.95，给有损压缩留 5% 离群余量）
 *   samples   每条轴的采样数（默认 64）
 * @returns {number} 识别出的倍数；识别不出（照片、纯色、原生像素）返回 1
 */
export function detectPixelMultiple(imageData, options = {}) {
  const {
    maxK = 64,
    edgeTol = 32,
    softTol = 18,
    softRatio = 0.35,
    score = 0.95,
    samples = 64,
  } = options;
  const width = imageData?.width | 0;
  const height = imageData?.height | 0;
  const data = imageData?.data;
  if (!width || !height || !data || width < 4 || height < 4) return 1;

  const limit = Math.min(maxK, Math.floor(Math.min(width, height) / 2));
  if (limit < 2) return 1;

  const { xs, ys } = findBoundaries(data, width, height, edgeTol, softTol, softRatio, samples);
  const positions = xs.concat(ys);
  // 没有任何边界 → 纯色 / 极平滑渐变，不存在倍数信息
  if (!positions.length) return 1;

  // 从大到小找第一个「全部边界都落在整数倍上」的 k
  for (let k = limit; k >= 2; k -= 1) {
    // k 较小时容差必须为 0，否则 k=2、3 会无条件命中（任意位置距最近倍数都 ≤ 1）
    const tol = k >= 6 ? 1 : 0;
    if (latticeScore(positions, k, tol) >= score) return k;
  }
  return 1;
}

/**
 * 把图片 URL 读成 ImageData。不做降采样——降采样会破坏像素块的周期性，识别会失准。
 * @param {string} url
 * @param {{maxSide?: number}} options 超过 maxSide 时等比缩小（默认 2048，仅防极端大图）
 * @returns {Promise<{imageData: ImageData, naturalWidth: number, naturalHeight: number}>}
 */
export function loadImageData(url, options = {}) {
  const { maxSide = 2048 } = options;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      if (!naturalWidth || !naturalHeight) { reject(new Error("图片尺寸无效")); return; }
      const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      try {
        resolve({ imageData: context.getImageData(0, 0, width, height), naturalWidth, naturalHeight });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = url;
  });
}

/**
 * 由源图尺寸与像素倍数推出逻辑尺寸（作品尺寸）。
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} multiple
 * @param {{min?: number, max?: number, longest?: number}} options
 *   longest 逻辑尺寸最长边上限，超出则等比缩小（默认 200）
 */
export function logicalSize(sourceWidth, sourceHeight, multiple, options = {}) {
  const { min = 10, max = 500, longest = 200 } = options;
  const k = multiple > 0 ? multiple : 1;
  let width = Math.max(1, Math.round(sourceWidth / k));
  let height = Math.max(1, Math.round(sourceHeight / k));
  const long = Math.max(width, height);
  if (long > longest) {
    const ratio = longest / long;
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }
  const clamp = (value) => Math.min(max, Math.max(min, value));
  return { width: clamp(width), height: clamp(height) };
}
