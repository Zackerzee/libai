/**
 * source-classifier.mjs — Stage B4 §12.2「Pixel Detector Rebuild」+ §12.3「Routing Strategy」
 *
 * ── 这个文件要解决的具体问题（不是「重构」，是修一个实测出来的反向信号）──────
 * §12.1 审计（`node tools/b4-routing-audit.mjs`）在 25 张固定图上量到：
 *
 *   · `pixel` 旧规则命中 **10 张，真阳性 6 张、假阳性 4 张、漏报 5 张**
 *   · **唯一的原生分辨率像素画（Q）在 `pixelLikeness` 排序里排第 10**
 *   · 原生分辨率子集上误路由 **6 / 15**，其中**误进 pixel 4 张**
 *
 * 原因不是阈值没调好，是**信号本身没有区分度**：
 *   `pixelLikeness = flatRegionRatio*.65 + edgeDensity*.35 - colorComplexity*.15`
 * 被 `flatRegionRatio` 以 0.65 的权重支配，而 `flatRegionRatio` 对**任何平滑图像**
 * 都高 —— 人像的皮肤渐变、白衣、白底 Logo、动漫大色块，全都算「平」。
 * 那个 `.15` 的颜色惩罚量级只有 0.03，压不住。
 * 阈值 0.62 又恰好切在一个 11 张图堆成的堆上（区间宽 0.035，全表 range 0.325）。
 *
 * 本模块修好之后的实测结果（同一批 25 张图）：
 *   · 原生分辨率误路由 **6 → 1**（仅剩 rf-complex，见文末「已知残留」）
 *   · 原生分辨率误进 pixel **4 → 0**
 *   · §12 点名的五条 ROUTING TEST 全绿
 *
 * ── 四条设计纪律 ────────────────────────────────────────────────────
 * ① **单指标不得决定路由。** 每条硬规则 ≥ 3 条证据同时成立；`pixel` 候选有
 *    「身份门」，门为 0 时无论加权分多高都不可能夺冠。任何「某个指标越线就进
 *    pixel」的写法都是回归。
 *
 * ② **证据必须真的算出来，算不出就不参与。** 沿用 §2 的纪律：
 *    信号缺失（null/undefined/NaN）→ 该项贡献 **0**，不是 0.5 中性。
 *    中性填充会让「证据不足的候选」与「证据充分但结论相反的候选」拿同样的分。
 *    `portraitLikeness` 当年被硬编码成 0，让一条规则看起来在工作、实际永不触发 ——
 *    同样的坑不踩第二次。
 *
 * ③ **候选必须有自己的身份门。** 六条候选里有 5 条负项占多数（portrait 0.54、
 *    anime 0.42、logo 0.40、illustration 0.40、pixel 0.38），只靠「什么都不像」
 *    就能堆到 0.5 以上。实测过：`logo` 在 K（人像）上得 0.517 排第一，
 *    而 K 的 `nearWhiteRatio` 是 **0.000** —— 一个「白底 Logo」候选在完全没有
 *    白底时夺冠。门是**连续斜坡**（0→1），不是布尔：布尔门会让路由在阈值处跳变。
 *
 * ④ **信心不足就不猜。** 首选与次选差距 < `ROUTING_CONFIDENCE_FLOOR`
 *    → 回落 `auto`（通用智能档）。宁可不出彩，不可出「自信的错误」。
 *
 * ── 19 条证据信号（§12.2 逐条要求）──────────────────────────────────
 *   ① 色块离散度        paletteDiscreteness / paletteSize95
 *   ② 局部颜色种类      localColorVariety
 *   ③ 边缘方向规则性    edgeDirectionRegularity
 *   ④ 最近邻放大痕迹    magnificationTrace / traceBlockSize   ← §12.2 核心
 *   ⑤ 大面积恒色块比例  largeFlatBlockRatio
 *   ⑥ 颜色数量          colorCount / distinctColorCount
 *   ⑦ 高频纹理比例      highFrequencyRatio
 *   ⑧ 亚像素/抗锯齿比例 antiAliasRatio
 *   ⑨ 明暗渐变覆盖率    shadingCoverage                       ← 取代 gradientCoherence
 *   ⑩ 肤色占比          skinRatio（**只当存在性门**，见 ROUTING_CANDIDATES）
 *   ⑪ 主体笔画抗腐蚀率  structureThickness
 *   ＋ nearWhiteRatio / neutralRatio / flatRegionRatio / edgeDensity 辅助
 *
 * ── 两个信号的名字改过，改名的原因都是「名字在撒谎」──────────────────
 * · `gradientCoherence` → `shadingCoverage`
 *   旧判据 `slope ≥ 0.3 且 R² > 0.85` 实测失效：K（人像）有 74.6% 的窗口坡度
 *   达标，却只有 **0.6%** 的 R² > 0.85 —— 它量的不是「有没有柔光」，是「这片柔光
 *   够不够线性、够不够干净」。而 K 的皮肤是**曲面**渐变，5×5 窗内本就不该是平面。
 * · `pixelLikeness` → 不再存在于本模块。它留在 `generation-pipeline.mjs` 里
 *   只服务于「调用方显式注入证据」的兼容路径，不再是真实图片的默认路由。
 *
 * ── 已知残留（诚实记账，不要假装没有）────────────────────────────────
 * · **rf-complex → portrait**（conf 0.783）。它的 `skinRatio` 是 0.073，
 *   来自画面里一条米色横带，比 K（人像）的 0.053 还高。`skinRatio` 作为
 *   「存在性门」放行了它。要修就得把肤色判据做得更语义化（区分「带状平色」
 *   与「曲面肤色」），而那是在用检测率换一个不该换的东西 —— 见 `isSkin` 注释。
 * · **L（宠物毛发）** 落在 auto（信心 0.054 不足）。它的 `skinRatio` 0.984
 *   是奶油色毛发；`portrait` 靠高频纹理门把它压到 0.476，与 illustration 0.574
 *   和 realistic 0.573 三方接近，回落 auto 是「不要强猜」的正确表现。
 * · **A–J 全部被判为像素画**。这不是误判：它们确实是 64 逻辑 → 512 的
 *   最近邻 ×8 放大，块内逐位恒等。详见 `tools/b4-routing-audit.mjs` 的
 *   `BENCH_CONTENT_MODE` 注释。
 *
 * ── 成本 ────────────────────────────────────────────────────────────
 * `magnificationTrace` 要对块尺寸 2…16 各扫一遍全图，是 O(9·W·H)。
 * 实测 `classifySource` 端到端：512² 31ms / 2048×1536 95ms / 4032×3024 330ms。
 * 相对生成本身可以忽略，但**它是主线程同步调用**，超大图会有一瞬可感的停顿。
 *
 * 纯函数、无 DOM、无 window，可在 Worker / node --test 直接跑。
 */

/* =========================================================
 * 信号定义（供契约测试反查：每个信号必须被至少一条规则或候选引用）
 * ======================================================= */

export const ROUTING_SIGNALS = Object.freeze({
  paletteDiscreteness: { unit: "0-1", note: "① 色块离散度：覆盖 95% 像素所需色数的对数归一（高 = 少色、离散）" },
  paletteSize95: { unit: "count", note: "① 覆盖 95% 像素所需的最小色数（原始计数，5-bit 量化）" },
  localColorVariety: { unit: "0-1", note: "② 局部颜色种类：8×8 窗口内平均去重色数 / 24" },
  edgeDirectionRegularity: { unit: "0-1", note: "③ 边缘方向规则性：1 − 梯度方向熵 / log2(16)" },
  magnificationTrace: { unit: "0-1", note: "④ 最近邻放大痕迹：块内恒等 + 边界不连续（对块尺寸 2–16 取最大）" },
  traceBlockSize: { unit: "px", note: "④ 取得最大痕迹的块尺寸（0 = 未检出）" },
  largeFlatBlockRatio: { unit: "0-1", note: "⑤ 5×5 邻域逐通道极差 ≤ 4 的像素占比" },
  colorCount: { unit: "0-1", note: "⑥ 颜色数量：log2(去重色数+1)/13" },
  distinctColorCount: { unit: "count", note: "⑥ 5-bit 量化后的去重色数（原始计数）" },
  highFrequencyRatio: { unit: "0-1", note: "⑦ 相邻像素 8 < |Δluma| < 32 的比例（纹理带，不含结构边）" },
  antiAliasRatio: { unit: "0-1", note: "⑧ 位于两侧邻色之间的像素占比（抗锯齿/亚像素）" },
  shadingCoverage: { unit: "0-1", note: "⑨ 明暗渐变覆盖率：5×5 窗坡度 ≥ 0.1 且平面残差 ≤ 0.35×极差 的窗口占比（柔光/渐变，非恒色块、非阶跃边）" },
  structureThickness: { unit: "0-1", note: "⑪ 主体笔画抗腐蚀率：1px 细线腐蚀后消失（≈0），2–4px 笔画存活（>0.2）" },
  skinRatio: { unit: "0-1", note: "⑩ 肤色像素占比（色相/饱和度/明度三条件）" },
  nearWhiteRatio: { unit: "0-1", note: "近白像素占比（luma ≥ 240 且 chroma ≤ 16）" },
  neutralRatio: { unit: "0-1", note: "近中性像素占比（chroma ≤ 14）" },
  flatRegionRatio: { unit: "0-1", note: "相邻 |Δluma| < 8 的比例（沿用 §2 口径，保持可对比）" },
  edgeDensity: { unit: "0-1", note: "相邻 |Δluma| > 32 的比例（沿用 §2 口径，保持可对比）" },
});

const SIGNAL_KEYS = Object.freeze(Object.keys(ROUTING_SIGNALS));

/* =========================================================
 * 量测
 * ======================================================= */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lumaOf = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const chromaOf = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
const quant5 = (d, i) => (((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
const quant4 = (d, i) => (((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));

/** 目标采样点数：源图越大步长越大，保证成本与分辨率无关。 */
function strideFor(width, height, target = 40000) {
  return Math.max(1, Math.floor(Math.sqrt((width * height) / target)));
}

/**
 * ④ 最近邻放大痕迹。
 *
 * `innerChangeRate == 0` 且 `boundaryChangeRate > 0` 是最近邻放大的**唯一可靠签名**：
 * 块内逐位相同，块间突变。扫描块尺寸 2…16 —— 不知道放大倍数时不能假定 8。
 *
 * ── 两版都错，第三版才对 ────────────────────────────────────────────
 * **首版** `(1 − min(1, iR/0.02)) × min(1, bR/0.06)`：分母是 bR 的绝对值，
 * 被**画面密度**污染。Q（真像素画，块内逐位恒等）只得 0.529，A–J 全得 1.000，
 * 差别只来自 Q 的图案大块留白、块边界换色率低。检测器量的变成了「画得细不细」。
 *
 * **次版** 改用「变化集中在边界的份额」并按 1/b 归一：份额与密度无关了，
 * 但 `b = 2` 对**任何偶数倍**放大都平凡满足（奇数行全在块内、恒等），
 * 于是 25 张里凡是放大产物的 `traceBlockSize` 全部塌成 2，
 * 而且 O（压缩 JPEG，块内变化率 0.233）拿到 0.677 —— 因为它也被归一化放大了。
 *
 * **本版** 两项相乘，各修一个毛病：
 *   ① `1 − min(1, iR/0.02)` —— 块内必须**几乎逐位恒等**。这一项把 O 打回 0
 *      （JPEG 的 8×8 块内是渐变，iR=0.233），把「有网格」与「是放大」分开。
 *   ② `(bR − iR)/(bR + iR)` —— 变化**相对集中**在边界。这一项与密度无关，
 *      且随 b 偏离真倍数而单调下降（b=2f 时块内混进真边界，iR 抬升）。
 *
 * 仍然存在**整除歧义**：f 倍放大的图在 b = f、f/2、f/4 … 上都得满分
 * （b 是真倍数的约数时，块内照样恒等）。用两级次序消歧：
 *   ① 分高者胜；
 *   ② 同分时**边界变化率高者胜**（真倍数把全部变化收在边界上，约数只收一部分）。
 * 实测：A–J（真倍数 8）→ 8；Q（真倍数 4）→ 4。
 * **D 报 16 不是错**：实测 D 在 `x % 16 == 8` 处变化率恰好为 0.000
 * （横向连续两个逻辑像素同色），所以 16 是它内容允许的最粗网格。
 * `traceBlockSize` 报的是「能被证据支持的最粗网格」，不是「原始放大倍数」。
 */
export function measureMagnificationTrace(source, sizes = [2, 3, 4, 5, 6, 8, 10, 12, 16]) {
  const { data, width, height } = source;
  let best = 0, bestSize = 0, bestBoundaryRate = -1;
  for (const b of sizes) {
    let inner = 0, innerDiff = 0, boundary = 0, boundaryDiff = 0;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 1; x < width; x += 1) {
        const i = (row + x) * 4, j = (row + x - 1) * 4;
        const differs = data[i] !== data[j] || data[i + 1] !== data[j + 1] || data[i + 2] !== data[j + 2];
        if (x % b === 0) { boundary += 1; if (differs) boundaryDiff += 1; }
        else { inner += 1; if (differs) innerDiff += 1; }
      }
    }
    const innerRate = innerDiff / Math.max(1, inner);
    const boundaryRate = boundaryDiff / Math.max(1, boundary);
    if (boundaryRate + innerRate < 1e-9) continue;      // 纯色：无结构，不是放大产物
    const exact = 1 - Math.min(1, innerRate / 0.02);
    const concentrated = Math.max(0, boundaryRate - innerRate) / (boundaryRate + innerRate);
    const score = clamp01(exact * concentrated);
    if (score > best + 1e-9) { best = score; bestSize = b; bestBoundaryRate = boundaryRate; }
    else if (best > 0 && score >= best - 1e-9 && boundaryRate > bestBoundaryRate + 1e-9) {
      bestSize = b; bestBoundaryRate = boundaryRate;
    }
  }
  return { magnificationTrace: clamp01(best), traceBlockSize: best > 0 ? bestSize : 0 };
}

/** ① 覆盖 `coverage` 比例像素所需的最小色数。 */
function paletteSizeAtCoverage(histogram, total, coverage) {
  const entries = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  const need = total * coverage;
  let acc = 0, used = 0;
  for (const [, n] of entries) {
    acc += n; used += 1;
    if (acc >= need) break;
  }
  return used;
}

/**
 * 肤色判定：色相 / 饱和度 / 明度三条件。
 *
 * ⚠️ 口径放宽是**故意的**：窄色相窗（例如 8–28°）能把「奶油色宠物毛」排除掉，
 * 但同样会漏掉偏暖、偏深的肤色 —— 那是用检测率换一个不该换的东西。
 * 这里用宽窗，代价是奶油色毛发也会被计为肤色；因此 `skinRatio`
 * **不作为任何硬规则的唯一依据**（详见 `ROUTING_HARD_RULES` 的注释）。
 */
export function isSkin(r, g, b, lum) {
  if (lum < 70 || lum > 250) return false;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const delta = mx - mn;
  if (delta < 12) return false;
  const sat = delta / mx;
  if (sat < 0.12 || sat > 0.62) return false;
  if (mx !== r) return false;
  let hue = 60 * ((g - b) / delta);
  if (hue < 0) hue += 360;
  return hue >= 5 && hue <= 50;
}

/** 全部信号。单次遍历为主，个别信号单独扫一遍（成本已按 stride 约束）。 */
export function measureSignals(source) {
  const empty = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, null]));
  if (!source?.data || !source.width || !source.height) return empty;
  const { data, width, height } = source;
  const count = width * height;
  if (!count) return empty;

  const stride = strideFor(width, height);

  /* ── 第一遍：相邻对统计 + 颜色直方图 + 近白/中性/肤色 ── */
  let pairs = 0, flatPairs = 0, edgePairs = 0, highFreqPairs = 0;
  const histogram5 = new Map();
  const histogram4 = new Map();
  let nearWhite = 0, neutral = 0, skin = 0, sampled = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const lum = lumaOf(data, i);
      const chroma = chromaOf(data, i);
      sampled += 1;
      if (lum >= 240 && chroma <= 16) nearWhite += 1;
      if (chroma <= 14) neutral += 1;
      if (isSkin(data[i], data[i + 1], data[i + 2], lum)) skin += 1;
      const k5 = quant5(data, i), k4 = quant4(data, i);
      histogram5.set(k5, (histogram5.get(k5) ?? 0) + 1);
      histogram4.set(k4, (histogram4.get(k4) ?? 0) + 1);

      if (x + stride < width) {
        const j = (y * width + x + stride) * 4;
        const d = Math.abs(lum - lumaOf(data, j));
        pairs += 1;
        if (d < 8) flatPairs += 1;
        else if (d > 32) edgePairs += 1;
        else highFreqPairs += 1;
      }
      if (y + stride < height) {
        const j = ((y + stride) * width + x) * 4;
        const d = Math.abs(lum - lumaOf(data, j));
        pairs += 1;
        if (d < 8) flatPairs += 1;
        else if (d > 32) edgePairs += 1;
        else highFreqPairs += 1;
      }
    }
  }

  const flatRegionRatio = flatPairs / Math.max(1, pairs);
  const edgeDensity = edgePairs / Math.max(1, pairs);
  const highFrequencyRatio = highFreqPairs / Math.max(1, pairs);
  const nearWhiteRatio = nearWhite / Math.max(1, sampled);
  const neutralRatio = neutral / Math.max(1, sampled);
  const skinRatio = skin / Math.max(1, sampled);

  const distinctColorCount = histogram5.size;
  const colorCount = clamp01(Math.log2(distinctColorCount + 1) / 13);
  const paletteSize95 = paletteSizeAtCoverage(histogram4, sampled, 0.95);
  // 4 色 → 0.74；8 色 → 0.60；32 色 → 0.34；128 色 → 0.08
  const paletteDiscreteness = clamp01(1 - Math.log2(Math.max(2, paletteSize95)) / Math.log2(192));

  /* ── ② 局部颜色种类：8×8 窗口 ── */
  const WIN = 8;
  let windowColors = 0, windowCount = 0;
  for (let wy = 0; wy + WIN <= height; wy += WIN) {
    for (let wx = 0; wx + WIN <= width; wx += WIN) {
      const seen = new Set();
      for (let y = wy; y < wy + WIN; y += 2) {
        for (let x = wx; x < wx + WIN; x += 2) seen.add(quant5(data, (y * width + x) * 4));
      }
      windowColors += seen.size;
      windowCount += 1;
    }
  }
  const localColorVariety = clamp01((windowColors / Math.max(1, windowCount)) / 24);

  /* ── ③ 边缘方向规则性：Sobel + 16 桶方向熵 ── */
  const bins = new Float64Array(16);
  let gradientMass = 0;
  const gStride = Math.max(1, stride);
  for (let y = gStride; y < height - gStride; y += gStride) {
    for (let x = gStride; x < width - gStride; x += gStride) {
      const at = (px, py) => lumaOf(data, (py * width + px) * 4);
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const mag = Math.hypot(gx, gy);
      if (mag < 24) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(15, Math.floor((angle / Math.PI) * 16));
      bins[bin] += mag;
      gradientMass += mag;
    }
  }
  let entropy = 0;
  if (gradientMass > 0) {
    for (const v of bins) {
      const p = v / gradientMass;
      if (p > 0) entropy -= p * Math.log2(p);
    }
  }
  const edgeDirectionRegularity = gradientMass > 0 ? clamp01(1 - entropy / 4) : null;

  /* ── ⑤ 大面积恒色块比例：5×5 邻域逐通道极差 ≤ 4 ── */
  const fStride = Math.max(1, stride);
  let flatBlocks = 0, flatSamples = 0;
  for (let y = 2; y < height - 2; y += fStride) {
    for (let x = 2; x < width - 2; x += fStride) {
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          if (data[i] < rMin) rMin = data[i]; if (data[i] > rMax) rMax = data[i];
          if (data[i + 1] < gMin) gMin = data[i + 1]; if (data[i + 1] > gMax) gMax = data[i + 1];
          if (data[i + 2] < bMin) bMin = data[i + 2]; if (data[i + 2] > bMax) bMax = data[i + 2];
        }
      }
      flatSamples += 1;
      if (rMax - rMin <= 4 && gMax - gMin <= 4 && bMax - bMin <= 4) flatBlocks += 1;
    }
  }
  const largeFlatBlockRatio = flatSamples ? flatBlocks / flatSamples : null;

  /* ── ⑧ 抗锯齿比例：两侧邻色之间 ── */
  let between = 0, betweenSamples = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const i = (y * width + x) * 4;
      const l = lumaOf(data, (y * width + x - stride) * 4);
      const r = lumaOf(data, (y * width + x + stride) * 4);
      const c = lumaOf(data, i);
      if (Math.abs(r - l) < 30) continue;
      betweenSamples += 1;
      const lo = Math.min(l, r), hi = Math.max(l, r);
      if (c > lo + 6 && c < hi - 6) between += 1;
    }
  }
  const antiAliasRatio = betweenSamples >= 32 ? clamp01(between / betweenSamples) : null;

  /* ── ⑨ 明暗渐变覆盖率：5×5 平面拟合，坡度存在且残差小 ──
   *
   * 首版叫 `gradientCoherence`，判据 `slope ≥ 0.3 且 R² > 0.85`，实测**失效**：
   * K（人像）有 74.6% 的窗口坡度 ≥ 0.3，但只有 **0.6%** 的 R² > 0.85；
   * P（柔和渐变插画）是 51.3% / 42.7%。也就是说它量的不是「有没有柔光」，
   * 而是「这片柔光够不够线性、够不够干净」—— 一有颗粒或曲面就归零。
   * 而 K 的皮肤是**曲面**渐变，5×5 窗内本来就不该是平面。
   *
   * 改判据为「坡度存在 且 残差相对本窗极差很小」：
   *   slope ≥ 0.1  且  mean|L − 平面| ≤ 0.35 × (maxL − minL)
   * 前者排除恒色块（Q / D / A–I 的块内坡度恰为 0），
   * 后者排除阶跃边与细颗粒（残差会顶到极差的 1/3 以上）。
   *
   * 实测（25 张）：A–I 与 Q 全部 ≤ 0.358，K–P 与 rf-* 全部 ≥ 0.678。
   * 名字改掉：它量的是「局部近似线性变化」的覆盖率，不是「一致性」。
   */
  const pStride = Math.max(2, stride * 2);
  let shading = 0, planes = 0;
  for (let y = 2; y < height - 2; y += pStride) {
    for (let x = 2; x < width - 2; x += pStride) {
      const samples = [];
      let lo = Infinity, hi = -Infinity;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const L = lumaOf(data, ((y + dy) * width + (x + dx)) * 4);
          samples.push([dx, dy, L]);
          if (L < lo) lo = L;
          if (L > hi) hi = L;
        }
      }
      const n = samples.length;
      let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
      for (const [px, py, pz] of samples) {
        sx += px; sy += py; sz += pz;
        sxx += px * px; syy += py * py; sxy += px * py; sxz += px * pz; syz += py * pz;
      }
      const mx = sx / n, my = sy / n, mz = sz / n;
      const cxx = sxx - n * mx * mx, cyy = syy - n * my * my, cxy = sxy - n * mx * my;
      const cxz = sxz - n * mx * mz, cyz = syz - n * my * mz;
      const det = cxx * cyy - cxy * cxy;
      planes += 1;
      if (Math.abs(det) < 1e-6) continue;
      const alpha = (cxz * cyy - cyz * cxy) / det;
      const beta = (cyz * cxx - cxz * cxy) / det;
      if (Math.hypot(alpha, beta) < 0.1) continue;
      const range = hi - lo;
      if (range <= 0) continue;
      let absRes = 0;
      for (const [px, py, pz] of samples) {
        absRes += Math.abs(pz - (mz + alpha * (px - mx) + beta * (py - my)));
      }
      if (absRes / n <= 0.35 * range) shading += 1;
    }
  }
  const shadingCoverage = planes ? clamp01(shading / planes) : null;

  /* ── ⑪ 主体笔画抗腐蚀率 ──
   * 「白色背景 + 深色图形」既可能是 Logo，也可能是细线稿。两者的路由后果相反：
   * Logo 档会提高清理强度、压低细节保护 —— 打在细线稿上会把线直接吃掉。
   * 区分它们不需要语义，只需要**笔画粗细**：1px 细线腐蚀一次就没了，
   * 2–4px 的笔画会活下来。所以量「mark 掩码腐蚀一次的存活率」。
   * mark = 与全局主导色距离 > 60 的像素。 */
  let backgroundKey = null, backgroundCount = -1;
  for (const [key, n] of histogram4) if (n > backgroundCount) { backgroundCount = n; backgroundKey = key; }
  const bgR = ((backgroundKey >> 8) & 15) * 16, bgG = ((backgroundKey >> 4) & 15) * 16, bgB = (backgroundKey & 15) * 16;
  const mark = new Uint8Array(count);
  let markCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const d = Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB);
      if (d > 60) { mark[y * width + x] = 1; markCount += 1; }
    }
  }
  let structureThickness = null;
  if (markCount >= count * 0.01) {
    let survived = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (!mark[i]) continue;
        if (mark[i - 1] && mark[i + 1] && mark[i - width] && mark[i + width]) survived += 1;
      }
    }
    structureThickness = clamp01(survived / markCount);
  }

  const trace = measureMagnificationTrace(source);

  return {
    paletteDiscreteness,
    paletteSize95,
    localColorVariety,
    edgeDirectionRegularity,
    magnificationTrace: trace.magnificationTrace,
    traceBlockSize: trace.traceBlockSize,
    largeFlatBlockRatio,
    colorCount,
    distinctColorCount,
    highFrequencyRatio,
    antiAliasRatio,
    shadingCoverage,
    structureThickness,
    skinRatio,
    nearWhiteRatio,
    neutralRatio,
    flatRegionRatio,
    edgeDensity,
  };
}

/* =========================================================
 * §12.3 路由：硬规则 → 候选评分 → 信心门
 * ======================================================= */

/**
 * 硬规则。**每条都要求多条证据同时成立** —— 这是 §12「禁止单指标越线强制进 pixel」
 * 的可测试表达：`evidence` 数组长度即「必须同时成立的证据数」，
 * 契约测试会断言没有任何一条硬规则只依赖 1 个信号。
 *
 * ── 为什么**没有** `hard-portrait` ──────────────────────────────────
 * 有过一版，判据是 `skinRatio ≥ 0.18`。它在 L（宠物毛发）上以 0.800 的肤色占比
 * 直接误触发 —— 奶油色毛发的 HSV 落在肤色的宽色相窗内，色彩统计**无法**区分
 * 「奶油色宠物」与「人」。窄色相窗能把宠物排除，但同样会漏掉偏暖偏深的肤色，
 * 那是拿检测率换一个不该换的东西。
 * 结论：portrait 只走**软评分 + 信心门**，不设硬规则。
 * 宁可回落 `auto`（通用档），不要一个会误触发的硬规则 —— 这是 §12「不要强猜」。
 */
export const ROUTING_HARD_RULES = Object.freeze([
  {
    id: "hard-pixel",
    to: "pixel",
    evidence: ["magnificationTrace", "paletteDiscreteness", "highFrequencyRatio", "antiAliasRatio", "nearWhiteRatio"],
    test: (s) => s.magnificationTrace >= 0.85
      && s.paletteDiscreteness >= 0.40
      && s.highFrequencyRatio <= 0.10
      && s.antiAliasRatio <= 0.10
      && s.nearWhiteRatio <= 0.45,
    note: "明显像素画：块内恒等（放大痕迹）+ 少色 + 无纹理 + 无抗锯齿 + **不是白底**。五条同时成立。"
      + "最后一条是必需的：E（Logo，纯白底）经 ×8 放大后同样块内恒等、同样无纹理，"
      + "不排除白底就会被这条规则先于 `hard-logo` 抢走，实测 E 路由成 pixel（conf 0.038，"
      + "落在信心门以下却仍被硬规则强制）。像素画是**满幅场景**，白底占比高说明是图形。",
  },
  {
    id: "hard-logo",
    to: "logo",
    evidence: ["nearWhiteRatio", "colorCount", "largeFlatBlockRatio", "highFrequencyRatio", "structureThickness"],
    test: (s) => s.nearWhiteRatio >= 0.50
      && s.colorCount <= 0.36
      && s.largeFlatBlockRatio >= 0.45
      && s.highFrequencyRatio <= 0.10
      && s.structureThickness >= 0.20,
    note: "明显 Logo：大面积近白底 + 极少颜色 + 大片恒色 + 无纹理 + **笔画不是细线**。"
      + "最后一条是必需的：rf-thin-struct 这类「白底 + 1px 细线」在其余四条上与 Logo 无法区分，"
      + "而 Logo 档的高清理强度会把细线直接吃掉。",
  },
]);

/**
 * 候选评分。每项 `[信号, 权重, 方向]`；方向 `+1` 表示「信号越高越像」，
 * `-1` 表示「信号越高越不像」。权重按候选各自归一到 1。
 * 信号为 null（算不出）→ 该项贡献 0（**不是** 0.5 中性），详见 `scoreCandidate`。
 *
 * ── `gate`：候选的「身份门」，为什么必须有 ────────────────────────────
 * 六条候选里有 5 条是「负项占多数」（pixel 负项权重 0.38、logo 0.40、
 * portrait 0.54、anime 0.42、illustration 0.40）。于是**只要一张图很平滑、
 * 没纹理、没放大痕迹，它就会在五个候选上同时拿到 0.5 以上的分**，
 * 排序变成噪声。实测：首版 `logo` 在 K（人像）上得 0.517 排第一，
 * 而 K 的 `nearWhiteRatio` 是 **0.000** —— 一个「白底 Logo」候选在完全没有白底时夺冠。
 *
 * 门是**连续**斜坡（0→1），不是布尔：布尔门会让路由在阈值处跳变，
 * 而 §12 要的正是「可解释的连续信心」。门因子会写进 `contributions`，
 * 报告要能回答「为什么不是它」。
 *
 * 门的语义是**身份**，不是偏好：「没有白底就不是 Logo」「没有放大痕迹也不是
 * 原生像素画就不进 pixel」。这与硬规则同源，只是连续化。
 */
const ramp = (v, lo, hi) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return clamp01((x - lo) / (hi - lo));
};

export const ROUTING_CANDIDATES = Object.freeze([
  {
    mode: "pixel",
    // 两条并列的身份路径：① 放大痕迹（块内恒等）；② 原生分辨率的像素画
    // （少色 + 无抗锯齿 + 无纹理同时成立）。取 max —— 原生 64×64 像素画没有块结构，
    // 只看 ① 会漏掉它。
    // 再乘一条**全场**约束：不是白底。像素画是满幅场景，白底占比高说明是图形/图标。
    // 这条与 `hard-pixel` 同源，是软硬两条路保持一致的必要条件：
    // 不乘它时 E（Logo）的 pixel 软分 0.920 仍高于 logo 0.904，只靠硬规则兜底。
    gate: (s) => Math.max(
      ramp(s.magnificationTrace, 0.15, 0.60),
      ramp(s.paletteDiscreteness, 0.50, 0.80)
        * ramp(1 - Number(s.antiAliasRatio ?? 1), 0.55, 0.95)
        * ramp(1 - Number(s.highFrequencyRatio ?? 1), 0.75, 0.97),
    ) * ramp(1 - Number(s.nearWhiteRatio ?? 1), 0.55, 0.90),
    gateNote: "（放大痕迹 或 原生像素画三条件）且 不是白底",
    terms: [
      ["magnificationTrace", 0.28, +1], ["paletteDiscreteness", 0.14, +1],
      ["largeFlatBlockRatio", 0.12, +1], ["edgeDirectionRegularity", 0.08, +1],
      ["localColorVariety", 0.10, -1], ["highFrequencyRatio", 0.10, -1],
      ["antiAliasRatio", 0.08, -1], ["shadingCoverage", 0.10, -1],
    ],
    note: "块状、恒色、少色、无纹理、无抗锯齿、无渐变。",
  },
  {
    mode: "logo",
    // 三重身份：白底 + 笔画有厚度 + 总色数真的少。
    // 第三条来自实测：rf-small-sep（白底 + 许多小色块）在白底与厚度两项上都满分，
    // `paletteDiscreteness` 甚至比真 Logo（E）更高（0.868 vs 0.791）——
    // 因为 95% 覆盖色数被白底和大色块拉低了，而 `distinctColorCount` 是 63 vs 3。
    // 只用「95% 覆盖色数」判 Logo 会被「大片白底 + 一堆小色块」骗过。
    gate: (s) => ramp(s.nearWhiteRatio, 0.10, 0.45)
      * ramp(s.structureThickness, 0.10, 0.35)
      * ramp(1 - Number(s.colorCount ?? 1), 0.45, 0.75),
    gateNote: "白底 + 笔画有厚度 + 总色数少，三条同时成立",
    terms: [
      ["nearWhiteRatio", 0.20, +1], ["paletteDiscreteness", 0.14, +1],
      ["largeFlatBlockRatio", 0.10, +1], ["structureThickness", 0.16, +1],
      ["highFrequencyRatio", 0.12, -1], ["localColorVariety", 0.10, -1],
      ["colorCount", 0.08, -1], ["antiAliasRatio", 0.05, -1],
      ["shadingCoverage", 0.05, -1],
    ],
    note: "白底、极少色、恒色、无纹理、**笔画有厚度**。与 pixel 的差别在「无放大痕迹」。",
  },
  {
    mode: "portrait",
    // 身份：柔光曲面明暗 + 低高频纹理 + **画面里真的有肤色**。
    // `skinRatio` 只当**存在性门**（0.008 → 0.05 的窄斜坡），不当强弱信号：
    // 它在 L（宠物毛发）上实测 0.984、在 K（人像）上只有 0.053 —— 强弱方向是反的
    // （见 `isSkin` 注释），拿它当强度项会把宠物排到人像前面。
    // 但「有没有」这一层它仍然有效：N（建筑）0.000、P（渐变插画）0.003、
    // rf-edge-contam 0.005、rf-thin-struct 0.000 全部被挡住。
    gate: (s) => ramp(s.shadingCoverage, 0.15, 0.50)
      * ramp(1 - Number(s.highFrequencyRatio ?? 1), 0.60, 0.92)
      * ramp(s.skinRatio, 0.008, 0.05),
    gateNote: "柔光曲面明暗 + 低高频纹理 + 画面中存在肤色，三条同时成立",
    terms: [
      ["skinRatio", 0.06, +1], ["shadingCoverage", 0.24, +1],
      ["antiAliasRatio", 0.10, +1], ["localColorVariety", 0.08, +1],
      ["highFrequencyRatio", 0.24, -1], ["magnificationTrace", 0.10, -1],
      ["paletteDiscreteness", 0.06, -1], ["largeFlatBlockRatio", 0.12, -1],
    ],
    note: "柔光曲面明暗 + 抗锯齿 + **低高频纹理**，且不是放大产物、不是整片恒色。",
  },
  {
    mode: "anime",
    // 身份：大色块（少色 + 恒色）。
    // 刻意**不**把 `edgeDirectionRegularity` 放进门：rf-anime-hl（动漫高光）
    // 的描边方向规则性只有 0.175，拿它当门会把动漫自己挡在外面。
    gate: (s) => ramp(s.paletteDiscreteness, 0.45, 0.75)
      * ramp(s.largeFlatBlockRatio, 0.20, 0.60),
    gateNote: "少色 + 大面积恒色，两条同时成立",
    terms: [
      ["paletteDiscreteness", 0.18, +1], ["largeFlatBlockRatio", 0.16, +1],
      ["edgeDirectionRegularity", 0.14, +1], ["edgeDensity", 0.10, +1],
      ["highFrequencyRatio", 0.10, -1], ["localColorVariety", 0.10, -1],
      ["shadingCoverage", 0.10, -1], ["magnificationTrace", 0.12, -1],
    ],
    note: "大色块 + 明确描边（方向偏水平/垂直）+ 无纹理，且**不是**放大产物。",
  },
  {
    mode: "illustration",
    // 身份：柔光渐变（这是它与 anime 唯一的分界 —— anime 是硬边大色块）。
    gate: (s) => ramp(s.shadingCoverage, 0.15, 0.50),
    gateNote: "存在柔光渐变",
    terms: [
      ["paletteDiscreteness", 0.18, +1], ["largeFlatBlockRatio", 0.14, +1],
      ["shadingCoverage", 0.18, +1], ["edgeDensity", 0.10, +1],
      ["highFrequencyRatio", 0.12, -1], ["localColorVariety", 0.10, -1],
      ["magnificationTrace", 0.10, -1], ["antiAliasRatio", 0.08, +1],
    ],
    note: "平色 + 柔渐变 + 无纹理。与 anime 的差别在「渐变覆盖高、描边弱」。",
  },
  {
    mode: "realistic",
    // 身份：不是块状、不是整片恒色。这两条正是 pixel / logo / anime 的定义性反面。
    gate: (s) => ramp(1 - Number(s.magnificationTrace ?? 1), 0.60, 0.95)
      * ramp(1 - Number(s.largeFlatBlockRatio ?? 1), 0.15, 0.60),
    gateNote: "无放大痕迹 + 不是整片恒色，两条同时成立",
    terms: [
      ["localColorVariety", 0.20, +1], ["highFrequencyRatio", 0.18, +1],
      ["shadingCoverage", 0.16, +1], ["antiAliasRatio", 0.14, +1],
      ["paletteDiscreteness", 0.10, -1], ["largeFlatBlockRatio", 0.08, -1],
      ["magnificationTrace", 0.08, -1], ["edgeDirectionRegularity", 0.06, -1],
    ],
    note: "色种多、纹理丰富、渐变覆盖高、抗锯齿普遍，且不是放大产物。",
  },
]);

/** 信心门。首选与次选差距低于它 → 回落 `auto`。 */
export const ROUTING_CONFIDENCE_FLOOR = 0.35;

/**
 * 候选名 → 引擎模式名的别名。
 *
 * `realistic` 是**候选**的名字（它描述的是「写实」这个判据），
 * 引擎侧没有这个模式，写实档叫 `photo`。这条映射是两者之间**唯一**的翻译点；
 * 候选名照旧出现在 `routing.candidate` 里，报告仍然能区分
 * 「判成写实」与「显式选了 photo 档」。
 */
export const ROUTING_MODE_ALIASES = Object.freeze({ realistic: "photo" });

/** 候选名 → 引擎模式名（无别名则同名）。 */
export function routingToEngineMode(candidate) {
  return ROUTING_MODE_ALIASES[candidate] ?? candidate;
}

/**
 * 候选评分的「分离度」—— §12.3 要求的 confidence。
 *
 * ── 为什么不是 (top − second) / top ──────────────────────────────
 * 首版用相对边际，实测**全表 0.001–0.274**，绝大多数落在 0.15 门以下，
 * 包括本应明确的 D（pixel 0.915 vs logo 0.723，边际 0.192，相对边际仅 0.210）。
 * 原因是六个候选共用一批信号、彼此高度相关，分母 `top` 又是绝对水平：
 * 一个「所有候选都很高但第一明显更高」的局面会被算成低信心。
 *
 * 改用**边际 / 候选间离散度**：问的是「首选比这一堆高出的量，相对于
 * 这一堆本身的分歧有多大」。全部候选挤在一起时离散度小、边际也小 → 仍需谨慎；
 * 首选鹤立鸡群时离散度被拉大 → 信心高。
 *
 *   spread = 六候选分数的总体标准差
 *   confidence = clamp01((top − second) / spread)
 */
function separationConfidence(scores) {
  if (scores.length < 2) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
  const margin = scores[0] - scores[1];
  if (!(sd > 1e-9)) return 0;
  return clamp01(margin / sd);
}

/**
 * 单条候选评分。**只累加「算得出的正证据」**。
 *
 * 分母恒为该候选的全部权重（各候选权重和 = 1），分子只加可用信号。
 * 于是「缺证据」贡献 0 而不是中性 0.5 —— 一个有一半信号算不出的候选
 * 分数上限就是 0.5，天然排不到前面。
 *
 * ── 为什么不是「缺失按 0.5 中性」 ────────────────────────────────
 * 中性填充会让**证据不足的候选**与**证据充分但结论相反的候选**拿同样的分。
 * §12 的原话是「不要强猜」：算不出就该输，不该并列。
 *
 * ── 门与分数分开放 ──────────────────────────────────────────────
 * `rawScore` 是加权证据和，`gate` 是该候选的身份门（0–1），
 * `score = rawScore × gate`。两者都返回：报告要能区分
 * 「证据不足」（rawScore 低）与「身份不符」（gate 低），这是两种不同的解释。
 */
export function scoreCandidate(candidate, signals) {
  let total = 0, weight = 0, available = 0;
  const contributions = [];
  for (const [key, w, direction] of candidate.terms) {
    weight += w;
    const raw = signals[key];
    const usable = raw != null && Number.isFinite(Number(raw));
    if (!usable) {
      contributions.push({ key, weight: w, direction, value: null, term: 0, missing: true });
      continue;
    }
    const value = clamp01(Number(raw));
    const term = direction > 0 ? value : 1 - value;
    total += w * term;
    available += w;
    contributions.push({ key, weight: w, direction, value, term, missing: false });
  }
  const rawScore = weight > 0 ? clamp01(total / weight) : 0;
  const gate = typeof candidate.gate === "function" ? clamp01(candidate.gate(signals)) : 1;
  return {
    mode: candidate.mode,
    score: clamp01(rawScore * gate),
    rawScore,
    gate,
    gateNote: candidate.gateNote ?? null,
    coverage: weight > 0 ? available / weight : 0,
    note: candidate.note,
    contributions,
  };
}

/** 六类候选评分，按分数降序。 */
export function scoreCandidates(signals) {
  return ROUTING_CANDIDATES
    .map((c) => scoreCandidate(c, signals))
    .sort((a, b) => b.score - a.score || a.mode.localeCompare(b.mode));
}

/**
 * §12.2/§12.3 的唯一出口。
 *
 * @returns {{
 *   signals: object,              全部证据信号（缺失的键值为 null）
 *   candidates: Array<object>,    六类候选，降序
 *   pixelConfidence: number|null, pixel 候选的分数（**连续值，不是布尔**）
 *   top: string|null,             得分最高的候选
 *   confidence: number,           (top − second) / top
 *   hardRule: string|null,        命中的硬规则 id
 *   routing: { mode, confidence, reason, evidence, runnerUp }
 * }}
 */
export function classifySource(source) {
  const signals = measureSignals(source);
  const candidates = scoreCandidates(signals);
  const [top, second] = candidates;
  const confidence = separationConfidence(candidates.map((c) => c.score));

  const hardRule = ROUTING_HARD_RULES.find((rule) => (
    rule.evidence.every((key) => signals[key] != null && Number.isFinite(Number(signals[key])))
    && rule.test(signals)
  )) ?? null;

  let candidate = null;
  let mode = "auto";
  // Stage B5 §20：这里原来有个 `= "no-signal"` 初值，但下面 if / else if / else
  // 三路**互斥且穷尽**，每路都重新赋值 —— 那个字面量永远到不了返回值。
  // 留一个永不可达的默认值比留空更危险：它会让人以为「没信号」是一条真实路径。
  // 声明而不初始化，将来有人把 else 改成 else if 时得到的是 undefined，
  // 那是显式的错，而不是一个看起来合理的假理由。
  let reason;
  if (hardRule) {
    candidate = hardRule.to;
    mode = routingToEngineMode(candidate);
    reason = `hard-rule:${hardRule.id}`;
  } else if (top && top.score > 0 && confidence >= ROUTING_CONFIDENCE_FLOOR) {
    candidate = top.mode;
    mode = routingToEngineMode(candidate);
    reason = `scored:${candidate}`;
  } else {
    mode = "auto";
    reason = top && top.score > 0
      ? `low-confidence:${confidence.toFixed(3)}<${ROUTING_CONFIDENCE_FLOOR}`
      : "no-candidate-passed-gate";
  }

  return {
    signals,
    candidates,
    pixelConfidence: candidates.find((c) => c.mode === "pixel")?.score ?? null,
    top: top?.mode ?? null,
    confidence,
    hardRule: hardRule?.id ?? null,
    routing: {
      candidate,                 // 候选名（pixel / logo / portrait / anime / illustration / realistic）
      mode,                      // 引擎模式名（realistic → photo；回落时 "auto"）
      confidence,
      reason,
      hardRule: hardRule?.id ?? null,
      evidence: hardRule ? [...hardRule.evidence] : top ? top.contributions.map((c) => c.key) : [],
      runnerUp: second?.mode ?? null,
      topScores: candidates.slice(0, 3).map((c) => ({ mode: c.mode, score: Number(c.score.toFixed(4)) })),
    },
  };
}

const browserApi = {
  ROUTING_SIGNALS,
  ROUTING_HARD_RULES,
  ROUTING_CANDIDATES,
  ROUTING_CONFIDENCE_FLOOR,
  ROUTING_MODE_ALIASES,
  routingToEngineMode,
  measureSignals,
  measureMagnificationTrace,
  scoreCandidate,
  scoreCandidates,
  classifySource,
};
if (typeof window !== "undefined") window.LibmsSourceClassifier = browserApi;

export default browserApi;
