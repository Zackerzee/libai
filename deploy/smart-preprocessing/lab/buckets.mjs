/**
 * Lab 共享层：格内像素 → Lab 分桶 → 加权成本。
 *
 * Stage B4 §6–§10 里，Bean Fit（§6）和 Dual Mode（§7）是同一套「格内像素不只有一个颜色」
 * 的思路的两种用法。**共用这一份实现**是刻意的：两边各写一份分桶，
 * 就会出现「Bean Fit 说这格是 3 个桶、Dual Mode 说是 4 个桶」这种谁都不算错、
 * 但 §11 组合矩阵已经失去意义的局面。这个项目在采样配置上已经立过同样的规矩
 * （`SAMPLING_CONFIG_V2` 导出给背景预览复用）。
 *
 * 本文件纯计算：无 DOM、无 I/O、无随机、无全局可变状态（除了一个以 palette 数组为键的
 * WeakMap 缓存）。deterministic 是硬要求 —— §16 把「deterministic 失败」列为硬失败项。
 *
 * ── 为什么分桶在 Lab 而不是 RGB ────────────────────────────────────────
 * RGB 的欧氏距离不是感知距离：皮肤区里 `#C8907A` 和 `#C08A72` 在 RGB 上差 40，
 * 在感知上几乎一样。分桶如果按 RGB 走，一个平滑肤色区会被切成七八个「不同」的桶，
 * 于是每个桶的权重都被稀释，加权成本退化成近似均值 —— 那正是 §6 要解决的问题本身。
 */

import { rgbToLab, deltaE2000, skinToneScore } from "../palette-engine.mjs";

/** 与采样引擎 `SAMPLING_CONFIG_V2.extraction.alphaThreshold` 同口径。
 *  两处不一致的话，桶的像素集和采样用的像素集就不是同一批。 */
export const LAB_ALPHA_THRESHOLD = 8;

/** 默认分桶步长（Lab 空间）。10 是实测下来的折中：
 *  步长 6 会把 25 像素的格子切出 10+ 个桶（全是噪声），
 *  步长 20 会把「眼睛黑」和「头发深棕」并成一个桶（正好丢掉 §7 要的东西）。 */
export const LAB_BUCKET_STEP = 10;

/* =========================================================
 * 色卡 Lab 表（以 palette 数组为键的 WeakMap 缓存）
 * ======================================================= */

const PALETTE_TABLES = new WeakMap();

/**
 * 把色卡预算成 `{index, code, rgb, lab}` 表，缓存。
 *
 * 过滤口径必须和 `PaletteEngine` 构造器**逐字一致**（`available !== false` +
 * `rgb.length >= 3`）。不一致的后果不是性能，而是正确性：
 * 候选可能选中一个 PaletteEngine 认为不可用的色号，而 maxColors 的口径
 * 是按「实际用到的色号」算的 —— 那就变成 §16 的硬失败。
 *
 * @param {Array<{code:string, rgb:number[]}>} palette
 */
export function paletteLabTable(palette) {
  const list = Array.isArray(palette) ? palette : [];
  const cached = PALETTE_TABLES.get(list);
  if (cached && cached.length === list.length) return cached;
  const table = [];
  list.forEach((color, index) => {
    if (!color || color.available === false) return;
    if (!Array.isArray(color.rgb) || color.rgb.length < 3) return;
    table.push({
      index,
      color,
      code: color.code,
      rgb: [Number(color.rgb[0]), Number(color.rgb[1]), Number(color.rgb[2])],
      lab: rgbToLab(color.rgb),
      group: color.group,
    });
  });
  PALETTE_TABLES.set(list, table);
  return table;
}

/* =========================================================
 * 格内像素遍历
 * ======================================================= */

/**
 * 一个格子覆盖的像素矩形（左闭右开）。边界钳制与 `buildAlphaGrid` 同口径。
 * 抽出来是为了让「分桶」和「逐像素键图」用同一个矩形 —— 两份各算一次，
 * 迟早会出现「桶的像素数」和「键图的长度」对不上，而那种不一致极难定位。
 */
export function cellRect(source, bounds) {
  const sw = source.width;
  const sh = source.height;
  const x0 = Math.max(0, Math.floor(bounds.x0));
  const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil(bounds.x1)));
  const y0 = Math.max(0, Math.floor(bounds.y0));
  const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil(bounds.y1)));
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * 遍历一个格子覆盖的源图像素。**闭包回调而不是返回数组**：
 * 104 格网下每格约 25 像素，500 格网下每格 1 像素，返回数组会给
 * 250000 个格子各分配一个数组 —— GC 压力会把 §18 的性能结论彻底污染。
 *
 * `visit` 收到 `(r, g, b, a, x, y)`，x/y 是绝对源图坐标。
 */
export function forEachCellPixel(source, bounds, visit) {
  const { x0, x1, y0, y1 } = cellRect(source, bounds);
  const sw = source.width;
  const data = source.data;
  for (let y = y0; y < y1; y += 1) {
    const row = y * sw;
    for (let x = x0; x < x1; x += 1) {
      const i = (row + x) * 4;
      visit(data[i], data[i + 1], data[i + 2], data[i + 3], x, y);
    }
  }
}

/* =========================================================
 * Lab 分桶
 * ======================================================= */

const bucketKey = (lab, step) => `${Math.round(lab[0] / step)}|${Math.round(lab[1] / step)}|${Math.round(lab[2] / step)}`;

/**
 * 把一格的像素聚成 Lab 桶。
 *
 * 返回的 `buckets` 已按 `count` 降序、`key` 升序排好 —— 排序键里带 `key`
 * 是 deterministic 的保证：计数相同的时候，如果没有第二排序键，
 * `Array.prototype.sort` 的稳定性会取决于插入顺序，而插入顺序取决于
 * Map 的迭代顺序，那又取决于像素遍历顺序。链路一长就没人能证明它确定。
 *
 * `withPixelMap: true` 额外返回 `pixelKeys`（行主序的桶键数组）+ 尺寸。
 * 这是给 §7 Dual Mode 用的：它要判断「次要色是一块连贯的结构，还是一堆散点」。
 * 判据是「这个桶里有几个像素有同桶的 4 邻」，那需要逐像素的键。
 * 不给这个出口的话，Dual Mode 就得自己重算一遍 Lab —— 两遍 Lab 换算，
 * 而且两遍之间任何一处不一致都会变成「桶计数说 6、连贯性说 3」。
 * Bean Fit 不需要它，所以默认关闭，不付这份内存。
 *
 * @returns {{total:number, opaque:number, buckets:Array<{key:string,count:number,share:number,rgb:number[],lab:number[]}>,
 *            rect:{x0:number,x1:number,y0:number,y1:number,w:number,h:number},
 *            pixelKeys:Array<string>|null}}
 */
export function buildLabBuckets(source, bounds, options = {}) {
  const {
    bucketStep = LAB_BUCKET_STEP,
    alphaThreshold = LAB_ALPHA_THRESHOLD,
    maxBuckets = 64,
    withPixelMap = false,
  } = options;
  const rect = cellRect(source, bounds);
  const acc = new Map();
  const pixelKeys = withPixelMap ? new Array(rect.w * rect.h) : null;
  let total = 0;
  let opaque = 0;
  forEachCellPixel(source, bounds, (r, g, b, a, x, y) => {
    total += 1;
    const slot = (y - rect.y0) * rect.w + (x - rect.x0);
    if (a <= alphaThreshold) {
      if (pixelKeys) pixelKeys[slot] = null;
      return;
    }
    opaque += 1;
    const lab = rgbToLab([r, g, b]);
    const key = bucketKey(lab, bucketStep);
    if (pixelKeys) pixelKeys[slot] = key;
    const entry = acc.get(key);
    if (entry) {
      entry.count += 1;
      entry.r += r; entry.g += g; entry.b += b;
    } else {
      acc.set(key, { key, count: 1, r, g, b });
    }
  });

  let buckets = [...acc.values()];
  // 桶数上限：极端噪声格（比如 J 类的照片噪声）可能切出上百个桶。
  // 按 count 截断比按插入顺序截断更可解释，且截断后仍然 deterministic。
  if (buckets.length > maxBuckets) {
    buckets = buckets
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, maxBuckets);
  }
  const list = buckets
    .map((entry) => {
      const rgb = [
        Math.round(entry.r / entry.count),
        Math.round(entry.g / entry.count),
        Math.round(entry.b / entry.count),
      ];
      return {
        key: entry.key,
        count: entry.count,
        share: opaque ? entry.count / opaque : 0,
        rgb,
        lab: rgbToLab(rgb),
      };
    })
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { total, opaque, buckets: list, rect, pixelKeys };
}

/**
 * 一个桶在格内的**连贯性**：有多少像素拥有同桶的 4 邻像素，除以桶的像素数。
 *
 * 这是 §7「不是单个异常像素」的判据，也是「结构价值」里最硬的那一项：
 *   · 散点噪声        → 0（没有像素有同桶邻居）
 *   · 单像素          → 0
 *   · 3×3 实心块      → 8/9 ≈ 0.89
 *   · 1 像素宽的直线  → 1.0（每个像素左右都有邻居）← **刻意不惩罚细线**
 *
 * 为什么不用「外接框填充率」：回形纹、窗格、建筑细线都是 1 像素宽的线，
 * 填充率极低但结构价值极高。用填充率会把它们全判成噪声。
 * 这条口径直接决定 §7 会不会把「眼睛/高光」这类真实细节误杀。
 */
export function bucketCoherence(pixelKeys, rect, key) {
  if (!pixelKeys || !key) return 0;
  const { w, h } = rect;
  let count = 0;
  let linked = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const slot = y * w + x;
      if (pixelKeys[slot] !== key) continue;
      count += 1;
      const left = x > 0 && pixelKeys[slot - 1] === key;
      const right = x + 1 < w && pixelKeys[slot + 1] === key;
      const up = y > 0 && pixelKeys[slot - w] === key;
      const down = y + 1 < h && pixelKeys[slot + w] === key;
      if (left || right || up || down) linked += 1;
    }
  }
  return count ? linked / count : 0;
}

/**
 * 取权重最高的若干桶，并丢掉权重过低的尾桶。
 *
 * 不重新归一化权重 —— 这是刻意的。归一化之后，一个被切碎成 4 个 25% 桶的格子
 * 和一个 100% 平色格会得到同样尺度的成本，「这格更难匹配」这件事就消失了。
 * 成本只用于**同一格内不同候选之间**比较，所以绝对尺度不重要，相对尺度重要。
 */
export function topBuckets(buckets, count = 4, minShare = 0.08) {
  const kept = [];
  for (const bucket of buckets) {
    if (kept.length >= count) break;
    if (bucket.share < minShare && kept.length > 0) break;
    kept.push(bucket);
  }
  return kept;
}

/**
 * 按 CIE76 从色卡表里取离给定 Lab 最近的若干项。
 *
 * 用 CIE76（Lab 平方欧氏距离）做**预筛**，再对短名单算 CIEDE2000。
 * 直接对全色板算 CIEDE2000 的话，10816 格 × 197 色 = 213 万次，
 * 每次约 30 次浮点运算 —— 单这一项就能吃掉秒级预算（§18）。
 *
 * 短名单按 `d2` 升序、`index` 升序，所以结果确定。
 */
export function nearestEntries(lab, table, count) {
  const scored = [];
  for (const entry of table) {
    const dl = lab[0] - entry.lab[0];
    const da = lab[1] - entry.lab[1];
    const db = lab[2] - entry.lab[2];
    scored.push({ entry, d2: dl * dl + da * da + db * db });
  }
  scored.sort((a, b) => a.d2 - b.d2 || a.entry.index - b.entry.index);
  return scored.slice(0, Math.max(1, count)).map((hit) => hit.entry);
}

/** `cost(candidate) = Σ bucket.weight × ΔE2000(bucket.lab, candidate.lab)`（§6 原文）。 */
export function weightedBucketCost(keptBuckets, candidateLab) {
  let cost = 0;
  for (const bucket of keptBuckets) cost += bucket.share * deltaE2000(bucket.lab, candidateLab);
  return cost;
}

/* =========================================================
 * §12.4 源色支持占比（sourceColorSupport）
 * ======================================================= */

/**
 * 「接近某个源色桶」的 ΔE2000 门。
 *
 * 取 10 的依据：CIEDE2000 的 JND 约 2.3，10 已经是「一眼看得出是两个颜色」的量级。
 * 比 10 还远，说「这个候选色就是那个源色」已经不诚实了。
 *
 * ⚠️ 这个值是**实测挑的，不是拍的**。A–J 全语料 3193 个 Bean Fit 改动格里，
 * `sourceSupport` 的分布是：
 *   [0, 1e-9) 286 格 · [1e-9, 0.1) **0 格** · [0.1, 0.25) 1 格 · [0.25, 0.44) 14 格 · [0.44, 0.6) 257 格 …
 * 也就是说 **0.25 落在一条几乎空的带子里**（0.0 与 0.44 之间只有 15 格）。
 * 门开在空带里，意味着「调 ±0.05 不会翻结论」—— 这是它可以被写成常量的前提。
 * 复现脚本见报告 §12.4 的取证段。
 */
export const SUPPORT_TAU = 10;

/**
 * 候选色被**该格源色**支持了多少占比。
 *
 *   support(c) = Σ_{b ∈ kept} share_b × 1[ ΔE2000(bucket_b.lab, c.lab) ≤ τ ]
 *
 * 语义：「如果把这一格都填成 c，c 代表了格内多大比例的源色像素」。
 *
 * ── 为什么需要它（§12.4 的根因）────────────────────────────────────────
 * `weightedBucketCost` 是**加权和**，所以它对「折中色」有系统性偏好：
 * 一个既不太像桶 A、也不太像桶 B 的颜色，只要两边都不太远，加权和就可能
 * 低于「完全像桶 A、离桶 B 很远」的正确答案。
 * 实测（夹具 D 的描边格，桶 = 深底 50% + 红描边 50%）：
 *   生产答案 C62(255,88,93)  成本 30.11  到桶 ΔE [50.9, 9.3]  → support = 0.50
 *   BeanFit  C06(186,12,47)  成本 23.41  到桶 ΔE [35.8, 11.1] → support = **0.00**
 * C06 是一个深红 —— 它**在原图里根本不存在**，是深底与红描边之间被加权和
 * 造出来的中间色阶。这正是 §12 原文禁止的「为了降低局部 ΔE 引入视觉上不存在的新色阶」。
 *
 * ⚠️ 这个口径对生产答案和候选**一视同仁** —— 它不偏向任何一方，只问
 * 「你离源图里的真实颜色有多近」。所以它在 J 类（照片噪声）上会判生产答案错：
 * 生产 CE02(155,184,211) support = 0.00（格内唯一桶是 [128,150,174]），
 * 而 BeanFit 的 CT09(107,132,157) support = 1.00。J 上 Bean Fit 确实是更好的那个。
 *
 * @param {Array<{share:number, lab:number[]}>} keptBuckets `topBuckets()` 的输出
 * @param {number[]} candidateLab
 * @param {number} [tau]
 * @returns {number} 0–1。**不重新归一化**：`kept` 的 share 之和本身可能 < 1
 *   （尾桶被 `minBucketShare` 丢掉了），那时 1.0 是拿不到的 —— 这是对的，
 *   「这格有一部分像素谁也代表不了」本来就该让 support 上限降低。
 */
export function sourceSupport(keptBuckets, candidateLab, tau = SUPPORT_TAU) {
  if (!keptBuckets?.length || !candidateLab) return 0;
  let support = 0;
  for (const bucket of keptBuckets) {
    if (deltaE2000(bucket.lab, candidateLab) <= tau) support += bucket.share;
  }
  return support;
}

/**
 * 一个格子**连同它的 3×3 邻域**的分桶，取权重最高的若干桶。
 *
 * 用途：§12.4 的「没有邻域支持」那一半判据 —— 一个色即使在本格里说得通，
 * 如果整个邻域都找不到它，那它仍然是一个「局部凭空出现的新色阶」。
 *
 * ⚠️ **只在需要时调用**。它要遍历 9 倍于一个格子的像素，而 `rgbToLab` 里有
 * 三次立方根。Bean Fit 的调用点做了懒计算（只有「基础成本最低的候选自身支持不足」
 * 时才问邻域），理由见 `bean-fit.mjs` 里的可证明性说明。
 *
 * 邻域窗口按**格子自身的宽高**外扩一格，不用固定像素数：格网从 104 到 500 时
 * 每格的像素数会差一个数量级，固定像素数会让「邻域」在小格网下退化成半个格子。
 */
export function neighbourhoodBuckets(source, bounds, options = {}) {
  const {
    bucketStep = LAB_BUCKET_STEP,
    topBucketCount = 4,
    minBucketShare = 0.08,
    alphaThreshold = LAB_ALPHA_THRESHOLD,
  } = options;
  const own = cellRect(source, bounds);
  const dx = own.w;
  const dy = own.h;
  const wide = {
    x0: bounds.x0 - dx,
    y0: bounds.y0 - dy,
    x1: bounds.x1 + dx,
    y1: bounds.y1 + dy,
  };
  const built = buildLabBuckets(source, wide, { bucketStep, alphaThreshold });
  if (!built.opaque) return [];
  return topBuckets(built.buckets, topBucketCount, minBucketShare);
}

/* =========================================================
 * 候选预筛
 * ======================================================= */

/**
 * 从桶出发预筛色卡候选：每个桶取最近的若干色卡，取并集。
 *
 * **为什么不能直接对全色板算加权成本**：色卡 197 色 × 每格 4 个桶 × 250000 格
 * = 1.97 亿次 CIEDE2000。CIEDE2000 每次约 30 次浮点运算，就是几十秒 ——
 * §18 的性能门槛当场破。预筛用 CIE76（Lab 空间的平方欧氏距离，无开方、无三角）
 * 把候选压到 8–16 个，再对这几个算 CIEDE2000。
 *
 * 预筛漏掉真最优的风险是可控的：CIE76 和 CIEDE2000 在 ΔE < 10 的范围内排序几乎一致，
 * 而在 ΔE > 20 的范围内「谁更近」已经不重要了（都明显不匹配）。
 * 用 `poolSize` 留出余量（默认 12，即每个桶取 4 个、最多 12 个候选）。
 */
export function prefilterCandidates(keptBuckets, table, poolSize = 12, perBucket = 4) {
  const picked = new Map();
  for (const bucket of keptBuckets) {
    const nearest = [];
    for (const entry of table) {
      const dl = bucket.lab[0] - entry.lab[0];
      const da = bucket.lab[1] - entry.lab[1];
      const db = bucket.lab[2] - entry.lab[2];
      nearest.push({ entry, d2: dl * dl + da * da + db * db });
    }
    nearest.sort((a, b) => a.d2 - b.d2 || a.entry.index - b.entry.index);
    for (const hit of nearest.slice(0, perBucket)) {
      if (!picked.has(hit.entry.index)) picked.set(hit.entry.index, hit.entry);
    }
  }
  const pool = [...picked.values()];
  // 池子超限时按「离主桶最近」保留，而不是按色卡顺序 —— 后者会把暖色系整段砍掉。
  if (pool.length > poolSize) {
    const primary = keptBuckets[0];
    pool.sort((a, b) => {
      const da = (primary.lab[0] - a.lab[0]) ** 2 + (primary.lab[1] - a.lab[1]) ** 2 + (primary.lab[2] - a.lab[2]) ** 2;
      const db = (primary.lab[0] - b.lab[0]) ** 2 + (primary.lab[1] - b.lab[1]) ** 2 + (primary.lab[2] - b.lab[2]) ** 2;
      return da - db || a.index - b.index;
    });
    pool.length = poolSize;
  }
  return pool;
}

/* =========================================================
 * 杂项
 * ======================================================= */

/** 桶集合的加权重心（Lab）。用于「这格整体大概是什么色」这类判断。 */
export function bucketCentroid(keptBuckets) {
  let l = 0, a = 0, b = 0, w = 0;
  for (const bucket of keptBuckets) {
    l += bucket.lab[0] * bucket.share;
    a += bucket.lab[1] * bucket.share;
    b += bucket.lab[2] * bucket.share;
    w += bucket.share;
  }
  if (!w) return null;
  return [l / w, a / w, b / w];
}

/** Lab 色度。§8 的 neutral 判据就是它。 */
export function labChroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

export { rgbToLab, deltaE2000, skinToneScore };
