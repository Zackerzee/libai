/**
 * bead-pattern-core.js
 * 拼豆图纸核心算法库 —— 图片转图纸 / 图纸识别
 *
 * 设计目标：
 *   1. 零依赖、零 DOM 访问。输入只接受 Uint8ClampedArray / Uint8Array，
 *      因此微信小程序（Canvas 2D 的 getImageData）和网站 Canvas 可共用同一份代码。
 *   2. 所有函数纯函数，方便丢进 Web Worker / 小程序 Worker 避免卡顿。
 *
 * 算法流程（图片转图纸）：
 *   采样(sampleGrid) -> 背景剔除 -> 色卡匹配(assignPalette) -> 库存约束调剂(全局遗憾值最小)
 *
 * @author 独立实现，算法思路参考拼豆类 App 通用做法
 */

/* ============================================================
 * 一、颜色空间与色差
 * ============================================================ */

/** sRGB -> CIE Lab。用于计算人眼感知一致的色差。 */
export function rgbToLab(r, g, b) {
  // sRGB -> 线性
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;

  // 线性 RGB -> XYZ (D65)
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** 十六进制色值 -> Lab */
export function hexToLab(hex) {
  const h = String(hex).replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** CIE76 色差（Delta E）。数值越小越接近。 */
export function deltaE(labA, labB) {
  const dl = labA[0] - labB[0], da = labA[1] - labB[1], db = labA[2] - labB[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** 加权欧氏 RGB 距离（人眼对绿更敏感）。作为轻量替代方案。 */
export function rgbDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/**
 * 构造色差函数
 * @param {'lab'|'rgb'} mode
 */
function makeDistFn(mode) {
  if (mode === 'rgb') {
    return (r1, g1, b1, c) => rgbDistance(r1, g1, b1, c.r, c.g, c.b);
  }
  return (r1, g1, b1, c) => deltaE(rgbToLab(r1, g1, b1), c.lab);
}

/* ============================================================
 * 二、色卡预处理
 * ============================================================ */

/**
 * 把色卡数组预处理成可快速匹配的结构（预先算 Lab，避免逐像素重复计算）
 * @param {Array<{code:string, hex:string, name?:string}>} palette
 * @returns {Array<{code, hex, name, r, g, b, lab}>}
 */
export function preparePalette(palette) {
  return palette.map((p) => {
    const h = String(p.hex).replace('#', '').trim();
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return { code: p.code, hex: p.hex, name: p.name, r, g, b, lab: rgbToLab(r, g, b) };
  });
}

/* ============================================================
 * 三、采样：把原图降采样成 cols × rows 的格子颜色
 * ============================================================ */

/**
 * 单格采样：取该格对应矩形区域的颜色
 * @param {'majority'|'average'|'center'} algo
 *   majority - 区域内出现最多的颜色（量化后投票）→ 保留清晰边缘、抗噪，适合线稿/卡通
 *   average  - 区域算术平均 → 过渡自然，适合照片
 *   center   - 只取中心像素 → 最快，但易产生噪点
 */
function sampleCell(data, srcW, srcH, x0, y0, x1, y1, algo) {
  if (x1 <= x0 || y1 <= y0) return null;

  if (algo === 'center') {
    const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
    const i = (cy * srcW + cx) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  // ring —— 只取「环带」：跳过中心（色号文字通常印在这里），也裁掉最外圈（网格线/豆子边缘）
  let ringInner = 0, ringOuter = 1, cx0 = 0, cy0 = 0, rx = 1, ry = 1;
  const isRing = algo === 'ring';
  if (isRing) {
    cx0 = (x0 + x1) / 2; cy0 = (y0 + y1) / 2;
    rx = Math.max(1, (x1 - x0) / 2); ry = Math.max(1, (y1 - y0) / 2);
    ringInner = 0.55; ringOuter = 0.95;   // 归一化半径区间（配合 sampleRatio 0.46 使用）
  }

  let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
  // majority / ring 用投票桶：把 RGB 各压到 5 bit（32 级）后统计
  const buckets = (algo === 'majority' || isRing) ? new Map() : null;

  for (let y = y0; y < y1; y++) {
    const rowOff = y * srcW * 4;
    for (let x = x0; x < x1; x++) {
      if (isRing) {
        const dx = (x + 0.5 - cx0) / rx, dy = (y + 0.5 - cy0) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < ringInner || d > ringOuter) continue;   // 中心文字 / 外圈网格线，都跳过
      }
      const i = rowOff + x * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      sr += r; sg += g; sb += b; sa += a; n++;
      if (buckets) {
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const e = buckets.get(key);
        if (e) { e.r += r; e.g += g; e.b += b; e.a += a; e.n++; }
        else buckets.set(key, { r, g, b, a, n: 1 });
      }
    }
  }
  if (n === 0) {
    if (!isRing) return null;
    // 格子太小导致环带没有像素：退化成整块平均，避免整格丢失
    for (let y = y0; y < y1; y++) {
      const rowOff = y * srcW * 4;
      for (let x = x0; x < x1; x++) {
        const i = rowOff + x * 4;
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sa += data[i + 3]; n++;
      }
    }
    if (n === 0) return null;
    return [sr / n, sg / n, sb / n, sa / n];
  }

  if (buckets && buckets.size > 0) {
    let best = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    return [best.r / best.n, best.g / best.n, best.b / best.n, best.a / best.n];
  }
  return [sr / n, sg / n, sb / n, sa / n];
}

/**
 * 降采样成网格
 * @param {Uint8ClampedArray|Uint8Array} data RGBA 像素
 * @param {number} srcW, srcH
 * @param {number} cols, rows
 * @param {object} opts
 *   algo        - 'majority' | 'average' | 'center'
 *   startX/startY/cellSize - 指定裁剪区域（局部采样），缺省为整图
 * @returns {Array<Array<[r,g,b,a]>>} rows × cols，元素为 null 表示空
 */
export function sampleGrid(data, srcW, srcH, cols, rows, opts = {}) {
  const { algo = 'majority', startX = 0, startY = 0, cellSize = null } = opts;
  const grid = new Array(rows);

  if (cellSize != null && cellSize > 0) {
    // 局部采样：按 cellSize 步长取格（对应原 App 的 sampleGrid 分支）
    for (let r = 0; r < rows; r++) {
      grid[r] = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(startX + c * cellSize), y0 = Math.round(startY + r * cellSize);
        grid[r][c] = sampleCell(data, srcW, srcH, x0, y0, x0 + cellSize, y0 + cellSize, algo);
      }
    }
    return grid;
  }

  // 整图缩放
  const sx = srcW / cols, sy = srcH / rows;
  for (let r = 0; r < rows; r++) {
    grid[r] = new Array(cols);
    const y0 = Math.floor(r * sy), y1 = Math.max(y0 + 1, Math.floor((r + 1) * sy));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * sx), x1 = Math.max(x0 + 1, Math.floor((c + 1) * sx));
      grid[r][c] = sampleCell(data, srcW, srcH, x0, Math.min(y0, srcH - 1), x0 === x1 ? x1 + 1 : x1, Math.min(y1, srcH), algo);
    }
  }
  return grid;
}

/* ============================================================
 * 四、背景剔除
 * ============================================================ */

/**
 * 判断一个像素是否应留空（不填豆）
 * @param {object} opts
 *   transparentAsEmpty - alpha 低于阈值视为空（默认 true）
 *   alphaThreshold     - 默认 32
 *   backgroundHex      - 指定背景色（如 '#ffffff'），接近该色则留空
 *   bgTolerance        - 背景色容差（Lab ΔE），默认 12
 */
export function isEmptyPixel(rgb, opts = {}) {
  if (!rgb) return true;
  const {
    transparentAsEmpty = true, alphaThreshold = 32,
    backgroundHex = null, bgTolerance = 12,
  } = opts;
  const [r, g, b, a] = rgb;

  if (transparentAsEmpty && (a === undefined || a < alphaThreshold)) return true;
  if (backgroundHex) {
    const bg = hexToLab(backgroundHex);
    if (deltaE(rgbToLab(r, g, b), bg) <= bgTolerance) return true;
  }
  return false;
}

/* ============================================================
 * 五、色卡匹配 + 库存约束调剂
 * ============================================================ */

/**
 * 为一个颜色找色卡中的候选（按色差升序）
 * @returns {Array<{index:number, code:string, dist:number}>}
 */
function rankCandidates(r, g, b, palette, distFn, topN) {
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    out.push({ index: i, code: palette[i].code, dist: distFn(r, g, b, palette[i]) });
  }
  out.sort((p, q) => p.dist - q.dist);
  return topN ? out.slice(0, topN) : out;
}

/**
 * 核心：把采样网格分配成色号网格
 *
 * @param {Array<Array>} grid   sampleGrid 的输出
 * @param {Array} palette       preparePalette 的输出
 * @param {object} opts
 *   distanceMode  - 'lab' | 'rgb'
 *   matchMode     - 'nearest'  直接取最近色
 *                   'distinct' 对已大量使用的色号加惩罚，让配色更分散（避免糊成一片）
 *   excludedCodes - 排除的色号数组
 *   inventory     - { 色号: 库存数量 }；启用后超出库存的格子会被调剂到备选色
 *   ignoreCapacity- true 则忽略库存
 *   emptyOpts     - 传给 isEmptyPixel 的背景剔除参数
 *   distinctWeight- distinct 模式惩罚强度，默认 0.35
 *
 * @returns {{grid, colorCount, beadCount, usage, totalError, assignments}}
 *   grid     - rows × cols，元素为色号字符串或 null（空）
 *   usage    - { 色号: 用量 }
 *   assignments - 每格的详细依据（用于 UI 展示「为什么选这个色」）
 */
/**
 * 单格置信度间隔：top2 距离 - top1 距离。
 * 越大表示「这个格子明显更像某个色号」；越小表示与次优色难以区分
 * （拼豆色卡里存在大量视觉极相近的色号，例如 A01 #FAF4C8 与 A02 #FFFFD5）。
 * 只有一个候选时返回 Infinity。
 */
function cellMargin(cell) {
  if (!cell.cand || cell.cand.length === 0) return 0;
  if (cell.cand.length === 1) return Infinity;
  return cell.cand[1].dist - cell.cand[0].dist;
}

export function assignPalette(grid, palette, opts = {}) {
  const {
    distanceMode = 'lab',
    matchMode = 'nearest',
    excludedCodes = [],
    inventory = null,
    ignoreCapacity = false,
    emptyOpts = {},
    distinctWeight = 0.35,
  } = opts;

  const distFn = makeDistFn(distanceMode);
  const excluded = new Set(excludedCodes);
  const rows = grid.length, cols = rows ? grid[0].length : 0;
  const total = rows * cols;

  const active = palette.filter((p) => !excluded.has(p.code));
  if (active.length === 0) throw new Error('色卡为空或全部被排除');

  // ---- 第一遍：为每格计算候选排序 + 判定是否留空 ----
  const cells = [];
  let emptyCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = grid[r][c];
      if (isEmptyPixel(px, emptyOpts)) { emptyCount++; continue; }
      const [rr, gg, bb] = px;
      cells.push({ r, c, rgb: [rr, gg, bb], cand: rankCandidates(rr, gg, bb, active, distFn, 0) });
    }
  }

  // ---- distinct 模式：统计倾向，对高频色号加惩罚 ----
  if (matchMode === 'distinct') {
    const tally = new Map();
    for (const cell of cells) {
      const code = cell.cand[0].code;
      tally.set(code, (tally.get(code) || 0) + 1);
    }
    for (const cell of cells) {
      for (const cd of cell.cand) {
        const share = (tally.get(cd.code) || 0) / Math.max(1, cells.length);
        // 用量占比越高，惩罚越大 —— 促使相近色分散到不同色号
        cd.dist *= 1 + distinctWeight * share;
      }
      cell.cand.sort((a, b) => a.dist - b.dist);
    }
  }

  // ---- 第二遍：按候选分配，同时受库存约束 ----
  const useCount = new Map();               // 色号 -> 已用量
  const result = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const assignments = [];
  let totalError = 0;

  const hasCapacity = inventory && !ignoreCapacity;

  // 先按「最优色」统计需求
  for (const cell of cells) {
    const want = cell.cand[0].code;
    cell.want = want;
    cell.rank = 0;
  }

  // 贪心分配：优先满足所有格子的最优选择；超出的进调剂队列
  const deferred = [];
  for (const cell of cells) {
    const want = cell.want;
    if (!hasCapacity) {
      useCount.set(want, (useCount.get(want) || 0) + 1);
      result[cell.r][cell.c] = want;
      totalError += cell.cand[0].dist;
      assignments.push({ r: cell.r, c: cell.c, code: want, rank: 0, dist: cell.cand[0].dist, margin: cellMargin(cell), alt: cell.cand[1] ? cell.cand[1].code : null, reason: 'optimal' });
      continue;
    }
    const cap = inventory[want];
    const used = useCount.get(want) || 0;
    if (cap === undefined || cap === null || used < cap) {
      useCount.set(want, (useCount.get(want) || 0) + 1);
      result[cell.r][cell.c] = want;
      totalError += cell.cand[0].dist;
      assignments.push({ r: cell.r, c: cell.c, code: want, rank: 0, dist: cell.cand[0].dist, margin: cellMargin(cell), alt: cell.cand[1] ? cell.cand[1].code : null, reason: 'optimal' });
    } else {
      deferred.push(cell);   // 最优色库存已满，稍后调剂
    }
  }

  // ---- 库存调剂：全局遗憾值最小 ----
  // 遗憾值(regret) = 备选色色差 - 最优色色差，即「被迫退让所增加的误差」。
  // 每次从所有待调剂格子中挑 regret 最小的执行，直到全部落位。
  if (deferred.length > 0) {
    let guard = deferred.length * Math.max(2, active.length) + 1024;
    while (deferred.length > 0 && guard-- > 0) {
      let bestPick = null;
      for (let i = 0; i < deferred.length; i++) {
        const cell = deferred[i];
        const base = cell.cand[0].dist;
        // 找第一个还有库存的备选
        for (let k = 1; k < cell.cand.length; k++) {
          const alt = cell.cand[k];
          const cap = inventory[alt.code];
          const used = useCount.get(alt.code) || 0;
          const unlimited = cap === undefined || cap === null;
          if (!unlimited && used >= cap) continue;
          const regret = alt.dist - base;
          if (!bestPick || regret < bestPick.regret) {
            bestPick = { idx: i, cell, alt, rank: k, regret, dist: alt.dist };
          }
          break; // 只考虑最近的可用备选，保持贪心
        }
      }
      if (!bestPick) {
        // 所有备选都满了：强制使用最近色（并把超用记入 usage 供上层告警）
        const cell = deferred.shift();
        const alt = cell.cand[0];
        useCount.set(alt.code, (useCount.get(alt.code) || 0) + 1);
        result[cell.r][cell.c] = alt.code;
        totalError += alt.dist;
        // 库存溢出被迫取色 / 遗憾值调剂，均非视觉最优 —— margin 记 0，应纳入复核
        assignments.push({ r: cell.r, c: cell.c, code: alt.code, rank: 0, dist: alt.dist, margin: 0, alt: null, reason: 'forced-overflow' });
        continue;
      }
      const { idx, cell, alt, rank, dist } = bestPick;
      deferred.splice(idx, 1);
      useCount.set(alt.code, (useCount.get(alt.code) || 0) + 1);
      result[cell.r][cell.c] = alt.code;
      totalError += dist;
      assignments.push({ r: cell.r, c: cell.c, code: alt.code, rank, dist, margin: 0, alt: null, reason: 'alternative-regret-min' });
    }
  }

  const usage = {};
  for (const [code, n] of useCount) usage[code] = n;

  return {
    grid: result,
    colorCount: useCount.size,
    beadCount: cells.length,
    emptyCount,
    total,
    usage,
    totalError,
    assignments,   // 每格分配依据，可用于「为什么是这个色」的 UI 解释
  };
}

/* ============================================================
 * 六、一站式：图片数据 -> 图纸
 * ============================================================ */

/**
 * 图片转拼豆图纸
 * @param {Uint8ClampedArray|Uint8Array} data RGBA
 * @param {number} srcW, srcH
 * @param {number} cols, rows
 * @param {Array<{code,hex}>} palette 色卡（未预处理也可以，内部会转）
 * @param {object} opts 同 sampleGrid + assignPalette 的选项
 */
export function imageToPattern(data, srcW, srcH, cols, rows, palette, opts = {}) {
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);
  const grid = sampleGrid(data, srcW, srcH, cols, rows, {
    algo: opts.algo || 'majority',
    startX: opts.startX, startY: opts.startY, cellSize: opts.cellSize,
  });
  return assignPalette(grid, prepared, opts);
}

/* ============================================================
 * 七、智能尺寸推荐
 * ============================================================ */

/**
 * 遍历候选尺寸，输出各尺寸的质量指标，供 UI 推荐最佳网格大小。
 * 指标含义：
 *   colorCount      - 用到的色号数（越少越省事）
 *   beadCount       - 总豆数（越多越精细、也越费时）
 *   density         - 豆数 / 面积
 *   totalDifference - 总色差 × 密度因子（越低越还原）
 */
export function recommendSize(data, srcW, srcH, palette, opts = {}) {
  const { minWidth = 10, maxWidth = 100, step = 1, ...rest } = opts;
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);
  const ratio = srcH / srcW;
  const srcPixels = srcW * srcH;
  const out = [];

  for (let w = minWidth; w <= maxWidth; w += step) {
    const h = Math.max(1, Math.round(w * ratio));
    const grid = sampleGrid(data, srcW, srcH, w, h, { algo: rest.algo || 'majority' });
    const res = assignPalette(grid, prepared, { ...rest, ignoreCapacity: true });
    const densityFactor = srcPixels / (w * h);
    out.push({
      width: w, height: h,
      colorCount: res.colorCount,
      beadCount: res.beadCount,
      density: w > 0 ? res.beadCount / (w * w) : 0,
      totalDifference: res.totalError * densityFactor,
    });
  }
  return out;
}

/* ============================================================
 * 八、图纸识别（规则版）：从已有图纸图片反推色号网格
 * ============================================================ */

/**
 * 检测网格步长（格子像素大小）。
 *
 * 方法：列方向亮度投影 -> 自相关。
 * 把整幅图沿 y 方向投影成一维亮度信号，网格线会形成周期性尖峰；
 * 把信号平移 s 后与自身做相关，当 s 恰好等于格子大小时相关性最高。
 * 相比单点采样，投影能抗噪、对网格线对比度要求更低。
 *
 * @returns {number|null} 最可能的 cellSize；检测失败返回 null（此时应让用户输入）
 */
export function detectGridStep(data, w, h, opts = {}) {
  const { minStep = 4, maxStep = 64 } = opts;

  // 1. 列方向亮度投影
  const col = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    col[x] = s / h;
  }

  // 2. 取梯度而非亮度本身：网格线本质是「边缘」，
  //    梯度信号在网格线处形成尖锐脉冲，比亮度信号周期性更强、更抗色块干扰。
  const sig = new Float64Array(w);
  for (let x = 1; x < w; x++) sig[x] = Math.abs(col[x] - col[x - 1]);

  // 3. 去均值（自相关前必须，否则直流分量会淹没周期）
  let mean = 0;
  for (let x = 0; x < w; x++) mean += sig[x];
  mean /= w;
  for (let x = 0; x < w; x++) sig[x] -= mean;

  // 4. 能量
  let energy = 0;
  for (let x = 0; x < w; x++) energy += sig[x] * sig[x];
  if (energy <= 0) return null;

  // 5. 自相关：s 等于真实周期时相关值最大
  const maxS = Math.min(maxStep, Math.floor(w / 3));
  let best = null;
  const scores = [];
  for (let s = minStep; s <= maxS; s++) {
    let num = 0;
    for (let x = 0; x + s < w; x++) num += sig[x] * sig[x + s];
    const corr = num / energy;
    scores.push({ s, corr });
    if (!best || corr > best.corr) best = { s, corr };
  }
  if (!best) return null;

  // 6. 倍周期回退：周期信号在 2T、3T 处同样高相关。
  //    若最优值的整数因子相关性也够高，说明真实周期是更小的那个。
  let result = best.s;
  for (let k = 2; k <= 5; k++) {
    if (best.s % k !== 0) continue;
    const sub = best.s / k;
    if (sub < minStep) continue;
    const sc = scores.find((o) => o.s === sub);
    if (sc && sc.corr > best.corr * 0.55) { result = sub; break; }
  }

  // 7. 相关性过低说明没有可辨识的网格（例如无网格线的纯色块图）
  return best.corr > 0.25 ? result : null;
}

/* ============================================================
 * 八之二、拍照退化修复：白平衡校正 + 质量告警
 *
 * 实测背景（MARD 290 色，16x16 网格）：
 *   干净图纸        -> 规则版识别 100%
 *   高斯噪声 σ=10   -> 93~98%   （规则版天然鲁棒）
 *   模糊 rad=2      -> 88~100%  （规则版天然鲁棒）
 *   白平衡偏色      -> 崩溃至 14~16%  ←★ 唯一真正的短板
 *
 * 为什么偏色致命：颜色整体乘性偏移后，每个格子都会系统性找错近邻色号。
 *
 * 为什么不能用「灰度世界」：该算法假设画面平均色为中性灰，
 * 但拼豆图纸大面积是单一彩色（例如整张浅黄），会把本色当成偏色"校正"掉。
 * 实测：相近色场景从 100% 直接掉到 0%。严禁使用。
 *
 * 正确解法：网格线是中性灰，是天然的灰卡锚点。
 * 实测解出的增益精确命中理论值（偏暖 R×1.15/B×0.85 -> 解出 0.87/1.18，
 * 理论 1/1.15=0.87、1/0.85=1.18）。
 * ============================================================ */

/**
 * 用网格线作为中性灰锚点，反解白平衡增益。
 * 网格线像素原本 R=G=B，退化后三通道比例即色偏量。
 * @returns {{kr:number, kb:number, samples:number}|null} 采样不足返回 null
 */
/**
 * 网格线相位检测
 * detectGridStep 只给出周期，不给相位；如果直接按 x % cell === 0 取样，
 * 一旦相位错开一两个像素就会采到色块或白底（实测把白底当灰卡，R 通道完全没校正）。
 * 这里用「投影亮度偏离全局中位数最大」的相位作为网格线所在位置 —— 深线浅线都适用。
 */
/** 列/行方向的亮度投影（axis 'x' 取列投影，'y' 取行投影） */
function gridProjection(data, w, h, axis) {
  const n = axis === 'x' ? w : h;
  const outer = axis === 'x' ? h : w;
  const proj = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < outer; j++) {
      const idx = axis === 'x' ? (j * w + i) * 4 : (i * w + j) * 4;
      s += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    proj[i] = s / outer;
  }
  return proj;
}

/**
 * 网格线相位候选
 * detectGridStep 只给周期不给相位，直接按 x % cell === 0 取样会整体错位。
 * 这里给两个候选：
 *   dark  —— 投影最暗的相位（绝大多数图纸是深色网格线）
 *   contrast —— 偏离全局中位数最大的相位（兼容浅色/白色网格线，或格子留白间隙）
 * 至于哪个才是真网格线，交给后面的色度一致性检验裁定。
 */
function estimateGridPhase(data, w, h, cell, axis) {
  const proj = gridProjection(data, w, h, axis);
  const n = proj.length;
  if (n < cell) return { dark: 0, contrast: 0 };
  const sorted = Array.prototype.slice.call(proj).sort((a, b) => a - b);
  const M = sorted[n >> 1];
  let darkP = 0, minL = Infinity, devP = 0, maxDev = -1;
  for (let p = 0; p < cell; p++) {
    let s = 0, dev = 0, c = 0;
    for (let i = p; i < n; i += cell) { s += proj[i]; dev += Math.abs(proj[i] - M); c++; }
    if (!c) continue;
    const L = s / c, D = dev / c;
    if (L < minL) { minL = L; darkP = p; }
    if (D > maxDev) { maxDev = D; devP = p; }
  }
  return { dark: darkP, contrast: devP };
}

function medianOf(arr) {
  const a = arr.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function estimateWhiteBalance(data, w, h, cell, opts = {}) {
  const { maxChromaSpread = 0.035, maxSamples = 20000, saturationGuard = 246 } = opts;
  if (!cell || cell < 2) return null;

  const phX = estimateGridPhase(data, w, h, cell, 'x');
  const phY = estimateGridPhase(data, w, h, cell, 'y');

  // 组合候选：dark / contrast 交叉，去重
  const seen = new Set(); const combos = [];
  const push = (px, py) => {
    const k = px + ':' + py;
    if (seen.has(k)) return; seen.add(k); combos.push([px, py]);
  };
  push(phX.dark, phY.dark);
  push(phX.dark, phY.contrast);
  push(phX.contrast, phY.dark);
  push(phX.contrast, phY.contrast);

  let best = null;
  for (const [px, py] of combos) {
    const est = estimateAtPhase(data, w, h, cell, px, py, { maxSamples, saturationGuard, maxChromaSpread });
    if (!est) continue;
    if (est.rejected) { if (!best || (best.rejected && est.chromaSpread < best.chromaSpread)) best = est; continue; }
    if (!best || best.rejected || est.chromaSpread < best.chromaSpread) best = est;
  }
  return best;
}

/** 按给定相位采网格线像素并估计通道增益 */
function estimateAtPhase(data, w, h, cell, phaseX, phaseY, opts) {
  const { maxChromaSpread = 0.035, maxSamples = 20000, saturationGuard = 246 } = opts;
  const onLine = (x, y) =>
    ((x % cell) + cell) % cell === phaseX || ((y % cell) + cell) % cell === phaseY;

  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (onLine(x, y)) total++;
  if (total < 8) return null;
  const stride = Math.max(1, Math.ceil(total / maxSamples));

  const rs = [], gs = [], bs = [], px = [];
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!onLine(x, y)) continue;
      if (k++ % stride !== 0) continue;
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // ★ 饱和像素不能当灰卡：通道被截断后比例失真（白底在暖光下 R 先爆掉，
      //   结果 R 增益估成 1，实测整体校正失效）。
      if (r >= saturationGuard || g >= saturationGuard || b >= saturationGuard) continue;
      rs.push(r); gs.push(g); bs.push(b); px.push([r, g, b]);
    }
  }
  const n = px.length;
  if (n < 8) return null;

  const mr = medianOf(rs), mg = medianOf(gs), mb = medianOf(bs);
  if (mr < 1 || mg < 1 || mb < 1) return null; // 近黑网格线，比例不可靠

  // ★ 关键判据：真网格线是「单一灰阶 × 通道增益」，所有像素色度高度一致。
  //    若无网格线，这些位置落在不同颜色的色块上，色度会明显分散。
  //    色度离散度用中位数绝对偏差（MAD），抗模糊污染。
  const crs = [], cbs = [];
  for (const [r, g, b] of px) {
    const s = r + g + b;
    if (s < 1) continue;
    crs.push((r - g) / s); cbs.push((b - g) / s);
  }
  const mcr = medianOf(crs), mcb = medianOf(cbs);
  const mad = (arr, m) => medianOf(arr.map((v) => Math.abs(v - m)));
  const spread = (mad(crs, mcr) + mad(cbs, mcb)) / 2;
  if (spread > maxChromaSpread) {
    return { kr: 1, kb: 1, samples: n, rejected: 'not-neutral-gridline', chromaSpread: spread };
  }
  return { kr: mg / mr, kb: mg / mb, samples: n, chromaSpread: spread, phase: { x: phaseX, y: phaseY } };
}

/**
 * 兜底方案：残差最小化搜索。
 * 当没有可用网格线（无网格线图纸 / 模糊导致网格线被污染）时使用。
 * 原理：偏色是整体乘性偏移，遍历候选增益，取「所有格子到最近色号的色差之和」最小者。
 *
 * @param {Array} cells 采样好的格子颜色 [[r,g,b,a], ...]
 * @param {Array} prepared 已 preparePalette 的色卡
 * @param {object} opts maxCells 参与搜索的格子数（越大越准越慢）
 * @returns {{kr,kb,residual,base}|null}
 */
export function estimateWhiteBalanceSearch(cells, prepared, opts = {}) {
  const { maxCells = 300, lo = 0.75, hi = 1.32 } = opts;
  const pool = cells.filter((c) => c && c[3] !== 0);
  if (pool.length < 8) return null;

  // 均匀抽样控制开销（150x150 图纸有 2 万+ 格子，全部参与会非常慢）
  const stride = Math.max(1, Math.ceil(pool.length / maxCells));
  const sample = pool.filter((_, i) => i % stride === 0);

  const residual = (kr, kb) => {
    let sum = 0;
    for (const c of sample) {
      const lab = rgbToLab(
        Math.max(0, Math.min(255, c[0] * kr)),
        Math.max(0, Math.min(255, c[1])),
        Math.max(0, Math.min(255, c[2] * kb))
      );
      let best = Infinity;
      for (let i = 0; i < prepared.length; i++) {
        const d = deltaE(lab, prepared[i].lab);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum;
  };

  const grid = (a, b, step) => {
    let best = null;
    for (let kr = a; kr <= b + 1e-9; kr += step) {
      for (let kb = a; kb <= b + 1e-9; kb += step) {
        const v = residual(kr, kb);
        if (!best || v < best.v) best = { kr, kb, v };
      }
    }
    return best;
  };

  const base = residual(1, 1);
  const c1 = grid(lo, hi, 0.08);                                    // 粗搜
  const c2 = grid(Math.max(lo, c1.kr - 0.08), Math.min(hi, c1.kr + 0.08), 0.02); // 细搜
  const best = c2.v < c1.v ? c2 : c1;
  if (Math.abs(best.kr - 1) < 0.03 && Math.abs(best.kb - 1) < 0.03) return null; // 本就中性
  return { kr: best.kr, kb: best.kb, residual: best.v, base, method: 'search' };
}

/** 应用白平衡增益，返回新的 RGBA 数组（不修改入参） */
export function applyWhiteBalance(data, kr, kb) {
  const out = new Uint8ClampedArray(data);
  if (kr === 1 && kb === 1) return out;
  for (let i = 0; i < data.length; i += 4) {
    out[i] = data[i] * kr;
    out[i + 2] = data[i + 2] * kb;
  }
  return out;
}

/**
 * 检测通道饱和比例 —— 饱和意味着信息永久丢失，不可恢复。
 * 实测：浅黄 #FFFFD5 在 R×1.15 下 R 通道溢出到 255，
 * 反向还原后误差仍达 33，任何算法（含 ML）都无法恢复。
 * @returns {{ratio:number, clipped:number, total:number}}
 */
export function detectSaturation(data, threshold = 252) {
  let clipped = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    if (data[i] >= threshold || data[i + 1] >= threshold || data[i + 2] >= threshold) clipped++;
  }
  return { ratio: total ? clipped / total : 0, clipped, total };
}

/**
 * 从图纸图片识别色号网格（规则版，无 ML 依赖）
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} w, h
 * @param {Array<{code,hex}>} palette
 * @param {object} opts
 *   cellSize - 已知格子像素大小则直接传入（跳过自动检测）
 *   autoTrim - 自动裁掉四周空白（默认 true）
 *   whiteBalance - 'auto' 用网格线锚点校正（默认）| 'off' 关闭
 *   distanceMode, emptyOpts
 * @returns 额外含 whiteBalance（增益与告警）、quality（饱和检测）
 */
export function recognizePattern(data, w, h, palette, opts = {}) {
  const {
    cellSize: forcedSize = null, autoTrim = true,
    distanceMode = 'lab', emptyOpts = {}, whiteBalance = 'auto',
    // 采样策略：average 纯色块 / ring 带色号文字（避开中心）/ majority 实拍抗噪
    sampleAlgo = 'average',
    sampleRatio = sampleAlgo === 'ring' ? 0.46 : 0.3,
  } = opts;
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);

  let step = forcedSize || detectGridStep(data, w, h, opts);
  if (!step) throw new Error('未能自动检测网格步长，请手动传入 cellSize');

  // —— 白平衡增益估计（网格线锚点法）——
  // 注意：这里只估计增益，不直接改图。是否采用由后面的「自适应择优」决定。
  let est = null;
  let wbInfo = { applied: false };
  if (whiteBalance === 'auto') {
    est = estimateWhiteBalance(data, w, h, step, opts.whiteBalanceOpts);
    if (est) {
      const kr = Math.max(0.6, Math.min(1.7, est.kr));
      const kb = Math.max(0.6, Math.min(1.7, est.kb));
      const plausible = kr > 0.7 && kr < 1.45 && kb > 0.7 && kb < 1.45;
      if (est.rejected || !plausible || (Math.abs(kr - 1) <= 0.02 && Math.abs(kb - 1) <= 0.02)) {
        wbInfo = {
          applied: false, kr: est.rejected ? 1 : kr, kb: est.rejected ? 1 : kb,
          samples: est.samples,
          skipped: est.rejected || (!plausible ? 'out-of-range' : 'already-neutral'),
        };
        est = null; // 不可用
      } else {
        est = { kr, kb, samples: est.samples, chromaSpread: est.chromaSpread };
      }
    }
  }
  const quality = detectSaturation(data);

  // 自动裁剪：统计非背景像素的包围盒（用原图，白底判定最稳定）
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (autoTrim) {
    const colHas = new Array(w).fill(false), rowHas = new Array(h).fill(false);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!isEmptyPixel([data[i], data[i + 1], data[i + 2], data[i + 3]], emptyOpts)) {
          colHas[x] = true; rowHas[y] = true;
        }
      }
    }
    while (x0 < w && !colHas[x0]) x0++;
    while (x1 > x0 && !colHas[x1 - 1]) x1--;
    while (y0 < h && !rowHas[y0]) y0++;
    while (y1 > y0 && !rowHas[y1 - 1]) y1--;
  }

  const cols = Math.max(1, Math.round((x1 - x0) / step));
  const rows = Math.max(1, Math.round((y1 - y0) / step));

  // 逐格取中心区域平均色（避开网格线）—— 只采样一次
  const gridRaw = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cx = x0 + Math.round((c + 0.5) * step);
      const cy = y0 + Math.round((r + 0.5) * step);
      const half = Math.max(1, Math.floor(step * sampleRatio));
      row.push(sampleCell(data, w, h, cx - half, cy - half, cx + half, cy + half, sampleAlgo));
    }
    gridRaw.push(row);
  }

  // 网格线法不可用（无网格线 / 模糊污染）时，回退到残差搜索法
  let wbMethod = est ? 'gridline' : null;
  if (!est && whiteBalance === 'auto') {
    const s = estimateWhiteBalanceSearch(gridRaw.flat(), prepared, opts.whiteBalanceOpts);
    if (s) {
      est = { kr: s.kr, kb: s.kb, samples: 0 };
      wbMethod = 'search';
      wbInfo = { applied: false, samples: 0 };
    }
  }

  // —— 自适应择优 ——
  // ★ 关键：校正并不总是有益。实测浅黄系在偏暖下，通道饱和已造成不可逆损失，
  //   强行校正反而把颜色推到更错的位置（35.5% -> 4.3%）。
  //   因此两个版本都算一遍，取总色差（totalError）更小的那个。
  const assignOpts = { distanceMode, ignoreCapacity: true, emptyOpts };
  const resRaw = assignPalette(gridRaw, prepared, assignOpts);

  let res = resRaw;
  let gridUsed = gridRaw;          // 最终参与匹配的采样色（供 UI 展示「原色 vs 匹配色」）
  if (est) {
    const { kr, kb } = est;
    const gridWB = gridRaw.map((row) =>
      row.map((c) => (c ? [c[0] * kr, c[1], c[2] * kb, c[3]] : c))
    );
    const resWB = assignPalette(gridWB, prepared, assignOpts);
    if (resWB.totalError < resRaw.totalError) {
      res = resWB;
      gridUsed = gridWB;
      wbInfo = {
        applied: true, kr, kb, samples: est.samples, method: wbMethod,
        chromaSpread: est.chromaSpread,
        errorGain: resRaw.totalError - resWB.totalError,
      };
      // 仅在确实校正且饱和严重时提示：这类损失不可恢复，建议重拍
      if (quality.ratio > 0.3) quality.warning = 'saturation_loss';
    } else {
      wbInfo = {
        applied: false, kr, kb, samples: est.samples, method: wbMethod,
        skipped: 'no-improvement',
        errorDelta: resWB.totalError - resRaw.totalError,
      };
    }
  } else {
    quality.warning = undefined;
  }

  // —— 不确定格子清单：交给模型复核 / 或让用户在 UI 上确认 ——
  // 判据：top1 与 top2 的色差间隔过小（色卡内存在大量视觉极相近色号），
  // 或因库存约束被调剂（margin=0）。
  const { marginThreshold = 3 } = opts;
  const uncertain = [];
  for (const a of res.assignments || []) {
    if (a.margin === 0 || a.margin < marginThreshold) {
      uncertain.push({
        r: a.r, c: a.c, code: a.code, alt: a.alt,
        margin: a.margin === Infinity ? null : a.margin,
        dist: a.dist, reason: a.reason,
      });
    }
  }

  return {
    ...res,
    colors: gridToHexGrid(gridUsed),   // rows×cols，每格实际参与匹配的采样色 '#rrggbb'（留空为 null）
    detectedCellSize: step,
    sampleAlgo,
    offset: { x: x0, y: y0 },
    whiteBalance: wbInfo,
    quality,
    uncertain,
    uncertainRatio: res.assignments && res.assignments.length
      ? uncertain.length / res.assignments.length : 0,
  };
}

/* ============================================================
 * 九、导出工具
 * ============================================================ */

/** [r,g,b] -> '#rrggbb' */
export function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 采样网格 -> HEX 二维（留空为 null） */
export function gridToHexGrid(grid) {
  return grid.map((row) => row.map((px) => {
    if (!px) return null;
    const a = px[3];
    if (a !== undefined && a < 8) return null;
    return rgbToHex(px[0], px[1], px[2]);
  }));
}

/**
 * 列出某一格的候选色号（UI 里点格子改色用）
 * @param {[number,number,number]|string} color RGB 数组或 '#rrggbb'
 * @param {Array} palette 原始色卡或 preparePalette 结果
 * @param {number} k 取前 k 个
 * @param {'lab'|'rgb'} distanceMode
 * @returns {Array<{code, hex, name, dist}>}
 */
export function topCandidates(color, palette, k = 5, distanceMode = 'lab') {
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);
  let r, g, b;
  if (typeof color === 'string') {
    const h = String(color).replace('#', '').trim();
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    [r, g, b] = color;
  }
  const distFn = makeDistFn(distanceMode);
  return rankCandidates(r, g, b, prepared, distFn, k)
    .map((it) => ({ code: it.code, hex: prepared[it.index].hex, name: prepared[it.index].name, dist: it.dist }));
}

/** 统计用量并排序（色号升序 / 用量降序） */
export function summarize(usage, palette, sortBy = 'count') {
  const meta = new Map(palette.map((p) => [p.code, p]));
  const list = Object.entries(usage).map(([code, count]) => ({
    code, count, hex: meta.get(code)?.hex || null, name: meta.get(code)?.name || null,
  }));
  if (sortBy === 'count') list.sort((a, b) => b.count - a.count);
  else list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return list;
}

/** 网格 -> 纯二维色号数组（便于 JSON 存储/传输） */
export function gridToCodes(grid) { return grid.map((row) => row.map((v) => v)); }

export default {
  rgbToLab, hexToLab, deltaE, rgbDistance,
  preparePalette, sampleGrid, isEmptyPixel, assignPalette,
  imageToPattern, recommendSize, detectGridStep, recognizePattern,
  summarize, gridToCodes, rgbToHex, gridToHexGrid, topCandidates,
};
