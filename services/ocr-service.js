/**
 * tesseract.js OCR 封装（浏览器端、CDN 加载、按需初始化）。
 *
 * 设计取舍：
 * 1. 不打包进仓库。tesseract.js + core wasm + eng 语言包合计约 16 MB，对"一个文件夹
 *    就是全部"的静态站太重；改为首次识别时从 CDN 拉取，之后走浏览器缓存。
 *    代价是首次识别需要联网，且部署方的 CSP 必须放行 blob worker（见 _headers）。
 * 2. 只识别图例里的小块文字，所以每一块都要先做预处理：裁剪 → 灰度 → 放大到
 *    至少 64px 高 → 可选 Otsu 二值化。tesseract 在小字上准确率低，放大是收益
 *    最大的一步；二值化只在"背景与墨迹极性明确"时做，彩色底 + 白字这种反而
 *    保留灰度更稳（对应 binarize:false）。
 * 3. worker 复用。每个区域单独 createWorker 会引入数秒开销，识别几十个图例格
 *    完全不可接受，因此整个生命周期只维持一个 worker。
 * 4. 失败要可读。离线、CDN 被拦、CSP 拒绝 worker —— 这些都归到一句人话提示里，
 *    并且绝不影响"手工录入 / CSV 导入 / 站内图纸直读"这三条不依赖 OCR 的路径。
 */

export const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
export const TESSERACT_WORKER_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js";
export const TESSERACT_CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/";
export const TESSERACT_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";
export const TESSERACT_LANG = "eng";
/** 图例只可能出现大写字母、数字与括号，白名单能显著压掉误识别。 */
export const LEGEND_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()";

/* -------------------------------- 图像预处理 -------------------------------- */

/** 大津法二值化阈值；退化时返回 128。 */
export function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }

  // 退化保护（相对参考实现的修正）：
  // 完全双峰的直方图（纯黑字 + 纯白底，即"数字导出"的图纸）会让 [峰1, 峰2) 区间内
  // 所有 t 取得完全相同的类间方差，而上面的循环在并列时保留最小的 t，恰好落在峰1 上，
  // 于是判定为"所有像素都是背景"，二值化后整块变白、OCR 一个字也读不到。
  // 只在阈值退化成单类时回退到 min/max 中点；正常（有噪声的）图片阈值本就在内部，不受影响。
  if (total > 0) {
    let min = 255;
    let max = 0;
    for (let i = 0; i < total; i += 1) {
      if (gray[i] < min) min = gray[i];
      if (gray[i] > max) max = gray[i];
    }
    if (max > min) {
      let below = 0;
      for (let i = 0; i < total; i += 1) if (gray[i] < threshold) below += 1;
      if (below === 0 || below === total) threshold = Math.round((min + max) / 2);
    }
  }
  return threshold;
}

/**
 * 按阈值生成二值图（0 = 墨迹，255 = 背景）。
 *
 * 注意比较用的是 `<=`：`otsuThreshold` 在搜索时把「值 ≤ t」整体当作暗类
 * （wB 累加 hist[t] 之后才算类间方差），所以这里必须用 `<=` 才与搜索约定一致。
 * 参考实现用的是 `<`，两者相差"恰好等于阈值的那一档像素"；对有噪声的照片影响
 * 极小，但对数字导出的干净图纸，阈值常常正落在墨迹峰的峰值上，用 `<` 会把整峰
 * 漏成背景、二值化后一片空白。
 */
export function binarize(gray, { threshold, polarity = "dark" } = {}) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i];
    out[i] = polarity === "dark" ? (value <= threshold ? 0 : 255) : value > threshold ? 0 : 255;
  }
  return out;
}

/**
 * 判断墨迹极性：先看占比最高的灰阶当作背景色。
 * 背景明显偏浅 → 印的是深字；明显偏深 → 印的是浅字（如深色色块上的白字）。
 * 背景居中时退回按深/浅像素占比推断。
 */
export function guessPolarity(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  let bg = 0;
  let bgCount = 0;
  // 并列时取更亮的那个（相对参考实现的修正）：纯黑字 + 纯白底会让 0 与 255 的计数
  // 完全相等，用">"比较会停在 bg=0，把"白底黑字"误判成"深底浅字"，二值化方向整体反掉。
  // 图纸绝大多数是浅底深字，因此并列时偏向更亮的一侧。
  for (let t = 0; t < 256; t += 1) {
    if (hist[t] >= bgCount && hist[t] > 0) { bgCount = hist[t]; bg = t; }
  }
  if (bgCount > 0 && (bg < 96 || bg > 160)) return bg >= 160 ? "dark" : "light";
  const total = gray.length;
  let dark = 0;
  let light = 0;
  for (let i = 0; i < total; i += 1) {
    const value = gray[i];
    if (value < 110) dark += 1;
    else if (value > 205) light += 1;
  }
  const inRange = (fraction) => fraction >= 0.002 && fraction <= 0.55;
  const fDark = dark / total;
  const fLight = light / total;
  if (inRange(fDark) && inRange(fLight)) return fDark <= fLight ? "dark" : "light";
  if (inRange(fDark)) return "dark";
  if (inRange(fLight)) return "light";
  return "dark";
}

/** 把 ImageData 转成灰度数组（0-255）。 */
export function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < gray.length; i += 1, j += 4) {
    gray[i] = Math.round((data[j] + data[j + 1] + data[j + 2]) / 3);
  }
  return gray;
}

/**
 * 计算某个框实际要交给 OCR 的裁剪区域。
 * 与参考实现的 prepareCrop 对齐：往内收 inset（避开色块边框与锯齿）、
 * 往外留 pad（避免笔画贴着裁剪边）。
 */
export function cropBox(image, box, { inset = 0, padRatio = 0.12 } = {}) {
  // 契约：box 是 {x0,y0,x1,y1}（左上角 + 右下角坐标），**不是** {x,y,width,height}。
  // 传错形状时下面每个算式都会得到 NaN，一路传到 new OffscreenCanvas(NaN, NaN)，
  // 抛出的却是「Value is not of type 'unsigned long'」—— 完全看不出问题在哪。
  // 这里提前拦下，把错误指到真正的原因上。
  const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = box ?? {};
  if (![bx0, by0, bx1, by1].every(Number.isFinite)) {
    throw new TypeError("cropBox: box 必须是 {x0,y0,x1,y1} 且四个值都是有限数（不是 {x,y,width,height}）");
  }
  const step = Math.max(0, Math.floor(inset));
  const x0 = Math.max(0, Math.floor(bx0) + step);
  const y0 = Math.max(0, Math.floor(by0) + step);
  const x1 = Math.min(image.width, Math.ceil(bx1) - step);
  const y1 = Math.min(image.height, Math.ceil(by1) - step);
  const cropWidth = Math.max(1, x1 - x0);
  const cropHeight = Math.max(1, y1 - y0);
  const pad = Math.max(2, Math.round(cropHeight * padRatio));
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  return {
    left, top,
    width: Math.min(image.width - left, cropWidth + pad * 2),
    height: Math.min(image.height - top, cropHeight + pad * 2),
    cropHeight,
  };
}

/** 按高度至少 64px 计算放大倍数（tesseract 的主要准确率瓶颈就是字太小）。 */
export function scaleForHeight(height, { minHeight = 64, maxFactor = 4 } = {}) {
  return Math.max(minHeight, Math.round(height * maxFactor)) / Math.max(1, height);
}

/* --------------------------------- 服务本体 -------------------------------- */

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function scriptAlreadyLoaded() {
  return typeof window !== "undefined" && Boolean(window.Tesseract?.createWorker);
}

function loadScriptOnce(url, timeout = 30000) {
  if (scriptAlreadyLoaded()) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const existing = [...document.querySelectorAll("script[data-libms-ocr]")].find((node) => node.src === url);
    const script = existing || document.createElement("script");
    const timer = setTimeout(() => reject(new Error("加载 OCR 引擎超时，请检查网络后重试")), timeout);
    const finish = (error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else if (scriptAlreadyLoaded()) resolve(window.Tesseract);
      else reject(new Error("OCR 引擎加载后未就绪"));
    };
    script.addEventListener("load", () => finish(null), { once: true });
    script.addEventListener("error", () => finish(new Error("无法从 CDN 加载 OCR 引擎，可能被网络或内容安全策略拦截")), { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.dataset.libmsOcr = "true";
      document.head.append(script);
    }
  });
}

export function createOcrService(options = {}) {
  const {
    scriptUrl = TESSERACT_SCRIPT_URL,
    workerPath = TESSERACT_WORKER_PATH,
    corePath = TESSERACT_CORE_PATH,
    langPath = TESSERACT_LANG_PATH,
    lang = TESSERACT_LANG,
    loadScript = loadScriptOnce,
  } = options;

  let workerPromise = null;
  let worker = null;

  const isReady = () => Boolean(worker);

  /** 创建（或复用）worker。首次调用会下载引擎与语言包，耗时较长。 */
  function prepare({ onProgress = () => {} } = {}) {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      onProgress({ stage: "loading-engine", message: "正在加载 OCR 引擎…" });
      const Tesseract = await loadScript(scriptUrl);
      if (!Tesseract?.createWorker) throw new Error("OCR 引擎不可用");
      onProgress({ stage: "loading-language", message: "正在加载语言包（首次约 10 MB，之后走缓存）…" });
      const instance = await Tesseract.createWorker(lang, 1, {
        workerPath,
        corePath,
        langPath,
        logger: (entry) => {
          if (entry?.status === "loading language traineddata" || entry?.status === "downloading") {
            onProgress({ stage: "loading-language", message: `正在下载语言包 ${Math.round((entry.progress || 0) * 100)}%` });
          }
        },
      });
      worker = instance;
      onProgress({ stage: "ready", message: "OCR 引擎已就绪" });
      return instance;
    })().catch((error) => {
      // 失败后清空缓存，允许用户重试而不是永久卡在 rejected 状态。
      workerPromise = null;
      worker = null;
      throw error;
    });
    return workerPromise;
  }

  /**
   * 预处理单个区域并交给 OCR。
   *
   * `source` 必须来自 `createCropSource`：一张图要识别几十个区域，逐次把整幅
   * ImageData 画进新 canvas 会成为主要开销，所以源画布只建一次、反复复用。
   */
  async function recognizeBox(source, box, { inset = 0, binarize: useBinarize = true, polarity = null, psm = 7 } = {}) {
    const instance = await prepare();
    const crop = cropBox(source, box, { inset });
    const factor = scaleForHeight(crop.cropHeight);
    const targetWidth = Math.max(8, Math.round(crop.width * factor));
    const targetHeight = Math.max(8, Math.round(crop.height * factor));

    const target = createCanvas(targetWidth, targetHeight);
    const context = target.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source.canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, targetWidth, targetHeight);

    const targetData = context.getImageData(0, 0, targetWidth, targetHeight);
    const gray = toGray(targetData);
    if (useBinarize) {
      const threshold = otsuThreshold(gray);
      const ink = polarity || guessPolarity(gray);
      const binary = binarize(gray, { threshold, polarity: ink });
      const pixels = targetData.data;
      for (let i = 0, j = 0; i < binary.length; i += 1, j += 4) {
        pixels[j] = binary[i]; pixels[j + 1] = binary[i]; pixels[j + 2] = binary[i]; pixels[j + 3] = 255;
      }
      context.putImageData(targetData, 0, 0);
    }

    const blob = await new Promise((resolve, reject) => {
      if (typeof target.convertToBlob === "function") target.convertToBlob({ type: "image/png" }).then(resolve, reject);
      else target.toBlob((value) => (value ? resolve(value) : reject(new Error("裁剪区域编码失败"))), "image/png");
    });

    await instance.setParameters({
      tessedit_char_whitelist: LEGEND_WHITELIST,
      tessedit_pageseg_mode: String(psm),
      preserve_interword_spaces: "1",
    });
    const result = await instance.recognize(blob);
    const words = (result?.data?.words || []).map((word) => ({
      text: String(word.text || "").trim(),
      confidence: Number(word.confidence) || 0,
      x: word.bbox?.x0 ?? 0,
      y: word.bbox?.y0 ?? 0,
      width: (word.bbox?.x1 ?? 0) - (word.bbox?.x0 ?? 0),
      height: (word.bbox?.y1 ?? 0) - (word.bbox?.y0 ?? 0),
    })).filter((word) => word.text);
    words.sort((a, b) => a.y - b.y || a.x - b.x);
    const text = words.map((word) => word.text).join(" ").trim();
    const confidence = words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 0;
    return { text, words, confidence };
  }

  async function terminate() {
    const instance = worker;
    worker = null;
    workerPromise = null;
    if (instance && typeof instance.terminate === "function") {
      try { await instance.terminate(); } catch { /* 关闭失败无所谓 */ }
    }
  }

  return { prepare, recognizeBox, terminate, isReady };
}

/** 把整幅 ImageData 一次性画进一张源画布，供 recognizeBox 反复裁剪复用。 */
export function createCropSource(imageData) {
  const canvas = createCanvas(imageData.width, imageData.height);
  canvas.getContext("2d", { willReadFrequently: true }).putImageData(imageData, 0, 0);
  return { canvas, width: imageData.width, height: imageData.height };
}

/** 把文件/图片元素读成 ImageData（限制最长边，避免超大图吃满内存）。 */
export async function imageDataFromSource(source, { maxSide = 6000 } = {}) {
  let bitmap = null;
  let width = 0;
  let height = 0;
  if (source instanceof File || source instanceof Blob) {
    bitmap = await createImageBitmap(source);
    width = bitmap.width;
    height = bitmap.height;
  } else {
    bitmap = source;
    width = source.naturalWidth || source.width;
    height = source.naturalHeight || source.height;
  }
  if (!width || !height) throw new Error("图片尺寸不可用");
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  if (typeof bitmap.close === "function") bitmap.close();
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  return { imageData, width: targetWidth, height: targetHeight };
}
