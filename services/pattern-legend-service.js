/**
 * 图例检测 + 文字检测 + 文字配对管线（从 perler-bead-manager 后端逐行移植）。
 *
 * 输入约定（与原后端一致）：
 *   image = { width, height, rgb }
 *   其中 rgb 是 RGB 三通道交错的平铺数组（长度 = width*height*3），
 *   类型可以是 Uint8Array 或 Uint8ClampedArray。
 *
 * 本文件移植了 color.ts / legend.ts / text.ts / pairing.ts 四个模块，并新增了
 * analyzeLegend 这层“按上传图大小自适应降采样”的封装（详见文件末尾）。
 *
 * @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box
 * @typedef {{ r: number, g: number, b: number }} RGB
 * @typedef {{ row: number, x0: number, y0: number, x1: number, y1: number }} Swatch
 * @typedef {{ x0: number, y0: number, x1: number, y1: number, ink: "dark" | "light" }} TextWord
 * @typedef {{ box: Box, source: "cell" | "tight" | "around", ink?: "dark" | "light" }} OcrRegion
 */

/* =========================================================================
 * color.ts —— 框内 RGB 中位数（用于取色，抗椒盐噪声）
 * ========================================================================= */

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** 计算 box 区域内 RGB 三通道的中位数（保持 color.ts 语义）。 */
export function medianRgb(rgb, width, box) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * width + x) * 3;
      rs.push(rgb[i]);
      gs.push(rgb[i + 1]);
      bs.push(rgb[i + 2]);
    }
  }
  return { r: median(rs), g: median(gs), b: median(bs) };
}

/* =========================================================================
 * legend.ts —— 图例色块检测（双通道：条带 + 连通域）
 * ========================================================================= */

/** 判定一个像素是否“有色”（图例色块、甚至偏淡的粉/黄都算）。 */
function isColorful(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  return (sat > 0.12 && mx >= 50) || (mx - mn >= 30 && mx >= 50);
}

/**
 * 检测图片中的“图例色块”。
 *
 * 图纸图例布局不固定：
 * - 最常见的是成行的宽色条（文字印在色块内部，如 图纸.jpg 底部三行宽条）；
 * - 也可能是成行/成列的小方块（编号/数量印在色块旁边）；
 * - 还可能是单列竖排的色块。
 *
 * 策略是“双通道 + 合并”：
 * 1. 条带通道（band）：扫描整行都充满若干条“较长且颜色均匀”色带的区域，
 *    这类区域几乎不可能是图案网格，能稳定抓出 图纸.jpg 之类的宽条图例。
 * 2. 连通域通道（fallback）：只有当条带通道没有结果时才启用——
 *    在小方块/单列图例上按“成行或成列、同尺寸、颜色一致”的约束收集色块，
 *    避免把图案区的大片杂色误当图例。
 * @param {{ width: number, height: number, rgb: Uint8Array | Uint8ClampedArray }} img
 * @returns {Swatch[]}
 */
export function detectSwatches(img) {
  const { width: w, height: h, rgb } = img;
  if (w < 8 || h < 8) return [];

  const colorful = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 3;
    colorful[i] = isColorful(rgb[j], rgb[j + 1], rgb[j + 2]) ? 1 : 0;
  }

  const bands = detectBands(rgb, colorful, w, h);
  if (bands.length > 0) return bands;

  // 条带通道失败 -> 退化到连通域通道（方块/单列图例）。
  return detectCompactSwatches(img);
}

/* ============================ 通道 1：条带检测 ============================ */

// 调参说明：主要针对“成行宽色条”的图例；真图（1280px 宽）每条约 150px。
const LONG_RUN = 60; // 一行内“长色带”的最短长度
const MAX_RUN_SPREAD = 100; // 色带内部颜色跨度上限（JPEG 容差）
const SEED_TOLERANCE = 25; // 种子行聚类容差
const EMPTY_ROW_PIXELS = 8; // “空行”的判定阈值
const MIN_BAND_HEIGHT = 12;
const CELL_WIDTH_MIN = 40;
const CELL_WIDTH_MAX = 400;
const MIN_CELLS_IN_BAND = 3; // 至少 3 个色块才算图例行
const GAP_MIN = 3;
const MIN_CELL_WIDTH = 24;
const COLUMN_CLUSTER_RADIUS = 14;
const CONTENT_COLORFUL_RATIO = 0.03;
const CONTENT_TEXT_RATIO = 0.015;
const TEXT_DISTANCE = 160;

function detectBands(rgb, colorful, w, h) {
  // --- 1. 种子行：一行里有多条“较长且均匀”的色带 -----------------------
  const seeds = [];
  for (let y = 0; y < h; y++) {
    const runs = rowRuns(y, colorful, w);
    let coverage = 0;
    let nUniform = 0;
    for (const [a, b] of runs) coverage += b - a + 1;
    coverage /= w;
    for (const [a, b] of runs) {
      if (b - a + 1 >= LONG_RUN && runSpread(rgb, w, y, a, b) <= MAX_RUN_SPREAD) {
        nUniform++;
      }
    }
    if (nUniform >= 2 && coverage >= 0.3) seeds.push(y);
  }

  // --- 2. 种子行聚类成候选区域 -------------------------------------------
  const clusters = [];
  for (const y of seeds) {
    const last = clusters[clusters.length - 1];
    if (last && y - last.end <= SEED_TOLERANCE) last.end = y;
    else clusters.push({ start: y, end: y });
  }

  // --- 3. 在近空行处切开成“条带” ----------------------------------------
  const bands = [];
  for (const cluster of clusters) {
    let cur = null;
    for (let y = cluster.start; y <= cluster.end; y++) {
      let cnt = 0;
      const base = y * w;
      for (let x = 0; x < w; x++) cnt += colorful[base + x];
      if (cnt >= EMPTY_ROW_PIXELS) {
        if (!cur) cur = { start: y, end: y };
        else cur.end = y;
      } else if (cur) {
        bands.push(cur);
        cur = null;
      }
    }
    if (cur) bands.push(cur);
  }

  // --- 4. 校验条带 --------------------------------------------------------
  const validBands = bands.filter((b) => {
    const height = b.end - b.start + 1;
    let seedCount = 0;
    for (const y of seeds) if (y >= b.start && y <= b.end) seedCount++;
    return height >= MIN_BAND_HEIGHT && seedCount >= 2;
  });
  if (validBands.length === 0) return [];

  // --- 5. 每个条带切分成格 ------------------------------------------------
  const detected = validBands.map((band) => ({
    band,
    cells: splitBandCells(band, colorful, w),
  }));

  // --- 6. 只保留“真图例行”：一格宽度落在合理区间内的格数够多 ------------
  const realBands = detected.filter(
    ({ cells }) =>
      cells.filter(([a, b]) => {
        const width = b - a + 1;
        return width >= CELL_WIDTH_MIN && width <= CELL_WIDTH_MAX;
      }).length >= MIN_CELLS_IN_BAND,
  );
  if (realBands.length === 0) return [];

  // --- 7. 所有条带共享同一套列边界（抑制单行噪声） ------------------------
  const boundaries = alignColumns(realBands, w);

  // --- 8. 内容检查后输出色块 ---------------------------------------------
  const swatches = [];
  for (let bi = 0; bi < realBands.length; bi++) {
    const { band } = realBands[bi];
    for (let ci = 0; ci < boundaries.length - 1; ci++) {
      const x0 = boundaries[ci];
      const x1 = boundaries[ci + 1];
      if (cellHasContent(band, x0, x1, colorful, rgb, w)) {
        swatches.push({ row: bi, x0, y0: band.start, x1, y1: band.end + 1 });
      }
    }
  }
  return swatches;
}

function rowRuns(y, colorful, w) {
  const runs = [];
  const base = y * w;
  let inRun = false;
  let start = 0;
  for (let x = 0; x < w; x++) {
    const c = colorful[base + x];
    if (c && !inRun) {
      inRun = true;
      start = x;
    } else if (!c && inRun) {
      inRun = false;
      runs.push([start, x - 1]);
    }
  }
  if (inRun) runs.push([start, w - 1]);
  return runs;
}

function runSpread(rgb, w, y, a, b) {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (let x = a; x <= b; x++) {
    const j = (y * w + x) * 3;
    const r = rgb[j], g = rgb[j + 1], bl = rgb[j + 2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (bl < minB) minB = bl;
    if (bl > maxB) maxB = bl;
  }
  return Math.max(maxR - minR, maxG - minG, maxB - minB);
}

function splitBandCells(band, colorful, w) {
  const colCount = new Array(w).fill(0);
  for (let y = band.start; y <= band.end; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) colCount[x] += colorful[base + x];
  }
  const threshold = Math.max(2, (band.end - band.start + 1) * 0.15);

  const gaps = [];
  let inGap = false;
  let gapStart = 0;
  for (let x = 0; x < w; x++) {
    const isGap = colCount[x] < threshold;
    if (isGap && !inGap) {
      inGap = true;
      gapStart = x;
    }
    if (!isGap && inGap) {
      inGap = false;
      if (x - gapStart >= GAP_MIN) gaps.push([gapStart, x - 1]);
    }
  }
  if (inGap && w - gapStart >= GAP_MIN) gaps.push([gapStart, w - 1]);

  let minX = w;
  let maxX = -1;
  for (let x = 0; x < w; x++) {
    if (colCount[x] >= threshold) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (maxX < 0) return [];

  const cells = [];
  let last = minX;
  for (const [ga, gb] of gaps) {
    const mid = Math.round((ga + gb) / 2);
    if (mid - last >= MIN_CELL_WIDTH && gb < maxX) {
      cells.push([last, mid]);
      last = mid + 1;
    }
  }
  if (maxX - last >= MIN_CELL_WIDTH) cells.push([last, maxX]);
  return cells;
}

function alignColumns(realBands, w) {
  const counts = new Map();
  for (const { cells } of realBands) {
    for (let i = 0; i < cells.length - 1; i++) {
      const mid = Math.round((cells[i][1] + cells[i + 1][0]) / 2);
      counts.set(mid, (counts.get(mid) ?? 0) + 1);
    }
  }

  const sorted = [...counts.keys()].sort((a, b) => a - b);
  const clusters = [];
  for (const mid of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && mid - last.end <= COLUMN_CLUSTER_RADIUS) {
      last.end = mid;
      last.n += counts.get(mid);
    } else {
      clusters.push({ start: mid, end: mid, n: counts.get(mid) });
    }
  }

  // 多行时列边界需被至少两行支持，抑制单行噪声。
  const requireSupport = realBands.length >= 2;
  const internal = clusters
    .filter((c) => !requireSupport || c.n >= 2)
    .map((c) => Math.round((c.start + c.end) / 2));

  let left = w;
  let right = -1;
  for (const { cells } of realBands) {
    for (const [a, b] of cells) {
      if (a < left) left = a;
      if (b > right) right = b;
    }
  }
  if (right < 0) right = 0;
  return [left, ...internal, right + 1];
}

function cellHasContent(band, x0, x1, colorful, rgb, w) {
  const height = band.end - band.start + 1;
  const total = (x1 - x0) * height;
  const hist = new Map();
  let colorfulCount = 0;

  for (let y = band.start; y <= band.end; y++) {
    const base = y * w;
    for (let x = x0; x < x1; x++) {
      const i = base + x;
      colorfulCount += colorful[i];
      const j = i * 3;
      const key = ((rgb[j] >> 4) << 8) | ((rgb[j + 1] >> 4) << 4) | (rgb[j + 2] >> 4);
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
  }
  if (colorfulCount / total > CONTENT_COLORFUL_RATIO) return true;

  // 极浅/白色色块：靠“与背景主色差异较大的文字像素”判断有没有内容。
  let bestKey = -1;
  let bestN = 0;
  for (const [k, n] of hist) {
    if (n > bestN) {
      bestN = n;
      bestKey = k;
    }
  }
  if (bestKey < 0) return false;
  const bgR = (bestKey >> 8) << 4;
  const bgG = ((bestKey >> 4) & 15) << 4;
  const bgB = (bestKey & 15) << 4;

  let textCount = 0;
  for (let y = band.start; y <= band.end; y++) {
    const base = y * w;
    for (let x = x0; x < x1; x++) {
      const j = (base + x) * 3;
      const dist =
        Math.abs(rgb[j] - bgR) + Math.abs(rgb[j + 1] - bgG) + Math.abs(rgb[j + 2] - bgB);
      if (dist > TEXT_DISTANCE) textCount++;
    }
  }
  return textCount / total > CONTENT_TEXT_RATIO;
}

/* ==================== 通道 2：连通域（方块/单列图例） ==================== */

function detectCompactSwatches(img) {
  const { width, height, rgb } = img;
  const stride = 2;
  const mw = Math.ceil(width / stride);
  const mh = Math.ceil(height / stride);
  const mask = new Uint8Array(mw * mh);
  const dr = new Uint8Array(mw * mh);
  const dg = new Uint8Array(mw * mh);
  const db = new Uint8Array(mw * mh);

  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      const x = Math.min(mx * stride, width - 1);
      const y = Math.min(my * stride, height - 1);
      const i = (y * width + x) * 3;
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      const mxv = Math.max(r, g, b);
      const mnv = Math.min(r, g, b);
      const sat = mxv === 0 ? 0 : (mxv - mnv) / mxv;
      const bright = mxv >= 50;
      mask[my * mw + mx] = isColorful(r, g, b) && bright ? 1 : 0;
      dr[my * mw + mx] = r;
      dg[my * mw + mx] = g;
      db[my * mw + mx] = b;
    }
  }

  const components = findComponents(mask, dr, dg, db, mw, mh);
  const candidates = components
    .map((c) => {
      const cw = c.maxX - c.minX + 1;
      const ch = c.maxY - c.minY + 1;
      const fill = c.area / (cw * ch);
      const spread = Math.max(c.maxR - c.minR, c.maxG - c.minG, c.maxB - c.minB);
      return { c, cw, ch, fill, spread, area: c.area };
    })
    .filter(
      (x) =>
        x.area >= 12 &&
        x.cw >= 4 &&
        x.ch >= 4 &&
        x.cw <= mw * 0.85 &&
        x.ch <= mh * 0.85 &&
        x.cw * x.ch <= 20000 &&
        x.cw / x.ch >= 0.4 &&
        x.cw / x.ch <= 6.0 &&
        x.fill >= 0.5 &&
        x.spread <= 80,
    )
    .map((x) => ({
      x0: x.c.minX * stride,
      y0: x.c.minY * stride,
      x1: Math.min((x.c.maxX + 1) * stride, width),
      y1: Math.min((x.c.maxY + 1) * stride, height),
      cw: x.cw * stride,
      ch: x.ch * stride,
    }));

  // 按 y 聚成“行”、按 x 聚成“列”。
  const sorted = [...candidates].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rowGroups = [];
  for (const c of sorted) {
    const g = rowGroups.find(
      (r) => Math.abs(r[0].y0 - c.y0) <= Math.max(6, r[0].ch * 0.8),
    );
    if (g) g.push(c);
    else rowGroups.push([c]);
  }

  const byCol = [...candidates].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const colGroups = [];
  for (const c of byCol) {
    const g = colGroups.find(
      (r) => Math.abs(r[0].x0 - c.x0) <= Math.max(6, r[0].cw * 0.8),
    );
    if (g) g.push(c);
    else colGroups.push([c]);
  }

  // 行内尺寸一致性检查：同行候选高度应接近。
  const rowOk = new Set();
  for (const g of rowGroups) {
    if (g.length < 2) continue;
    const medianH = g.map((c) => c.ch).sort((a, b) => a - b)[Math.floor(g.length / 2)];
    const ok = g.filter((c) => Math.abs(c.ch - medianH) <= medianH * 0.5);
    if (ok.length >= 2) for (const c of ok) rowOk.add(c);
  }
  const colOk = new Set();
  for (const g of colGroups) {
    if (g.length < 2) continue;
    const medianW = g.map((c) => c.cw).sort((a, b) => a - b)[Math.floor(g.length / 2)];
    const ok = g.filter((c) => Math.abs(c.cw - medianW) <= medianW * 0.5);
    if (ok.length >= 2) for (const c of ok) colOk.add(c);
  }

  const kept = candidates.filter((c) => rowOk.has(c) || colOk.has(c));
  if (kept.length === 0) return [];

  // 重新为每个保留候选计算行号（用于配对时识别同行）。
  const keptSorted = [...kept].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const finalRows = [];
  for (const c of keptSorted) {
    const g = finalRows.find(
      (r) => Math.abs(r[0].y0 - c.y0) <= Math.max(6, r[0].ch * 0.8),
    );
    if (g) g.push(c);
    else finalRows.push([c]);
  }
  return finalRows.flatMap((g, i) =>
    g
      .sort((a, b) => a.x0 - b.x0)
      .map((c) => ({ row: i, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })),
  );
}

function findComponents(mask, dr, dg, db, w, h) {
  const label = new Int32Array(w * h).fill(0);
  const components = [];
  let next = 1;
  const stack = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || label[start] !== 0) continue;
    const id = next++;
    const comp = {
      minX: w,
      minY: h,
      maxX: 0,
      maxY: 0,
      area: 0,
      minR: 255,
      maxR: 0,
      minG: 255,
      maxG: 0,
      minB: 255,
      maxB: 0,
    };
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop();
      const x = p % w;
      const y = Math.floor(p / w);
      comp.minX = Math.min(comp.minX, x);
      comp.minY = Math.min(comp.minY, y);
      comp.maxX = Math.max(comp.maxX, x);
      comp.maxY = Math.max(comp.maxY, y);
      comp.area++;
      comp.minR = Math.min(comp.minR, dr[p]);
      comp.maxR = Math.max(comp.maxR, dr[p]);
      comp.minG = Math.min(comp.minG, dg[p]);
      comp.maxG = Math.max(comp.maxG, dg[p]);
      comp.minB = Math.min(comp.minB, db[p]);
      comp.maxB = Math.max(comp.maxB, db[p]);
      const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of neigh) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] === 1 && label[ni] === 0) {
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/* =========================================================================
 * text.ts —— 文字词包围盒检测（深色墨迹 / 浅色墨迹）
 * ========================================================================= */

/** 判断单个像素是否为深色墨迹（暗、且非彩色）。 */
function isDarkInk(v, sat) {
  return v < 120 && sat < 0.35;
}

/** 判断单个像素是否为浅色墨迹（很亮、且非彩色，例如深色色块上的白字）。 */
function isLightInk(v, sat) {
  return v > 205 && sat < 0.35;
}

/**
 * 在 region 内检测独立文字“词”的包围盒。
 *
 * 实现：
 * 1. 按亮度 + 饱和度筛出墨迹像素（深色墨迹，或浅色墨迹）。
 * 2. 8 连通聚类成字形，去掉过小的噪点。
 * 3. 同一行（y 方向有重叠）且横向间隙小的字形合并为一个“词”。
 * @param {{ width: number, height: number, rgb: Uint8Array | Uint8ClampedArray }} img
 * @param {Box} region
 * @param {{ inside?: boolean }} [opts]
 * @returns {TextWord[]}
 */
export function detectTextWords(img, region, opts = {}) {
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(img.width, Math.ceil(region.x1));
  const y1 = Math.min(img.height, Math.ceil(region.y1));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return [];

  const w = x1 - x0;
  const h = y1 - y0;
  const ink = new Uint8Array(w * h); // 0 无, 1 深墨, 2 浅墨
  let darkCount = 0;
  let lightCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + (x0 + x)) * 3;
      const r = img.rgb[i];
      const g = img.rgb[i + 1];
      const b = img.rgb[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const v = Math.round((r + g + b) / 3);
      const dark = isDarkInk(v, sat);
      const light = isLightInk(v, sat);
      if (dark) {
        ink[y * w + x] = 1;
        darkCount++;
      } else if (light) {
        ink[y * w + x] = 2;
        lightCount++;
      }
    }
  }

  // 色块内部：自动选择“少数派”极值作为墨迹，避免整块浅色/深色被当成文字。
  let target = 1;
  if (opts.inside) {
    if (darkCount === 0 && lightCount === 0) return [];
    if (lightCount === 0) target = 1;
    else if (darkCount === 0) target = 2;
    else target = lightCount < darkCount ? 2 : 1;
    const total = w * h;
    const chosen = target === 1 ? darkCount : lightCount;
    if (chosen / total > 0.55) return []; // 墨迹占比过高，多半不是文字
  } else {
    // 白底黑字
    if (darkCount === 0) return [];
  }

  const label = new Int32Array(w * h).fill(0);
  const glyphs = [];
  let next = 1;
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (ink[start] === 0 || ink[start] !== target || label[start] !== 0) continue;
    const id = next++;
    label[start] = id;
    stack.push(start);
    let gMinX = w;
    let gMinY = h;
    let gMaxX = 0;
    let gMaxY = 0;
    let n = 0;
    while (stack.length > 0) {
      const p = stack.pop();
      const gx = p % w;
      const gy = Math.floor(p / w);
      n++;
      gMinX = Math.min(gMinX, gx);
      gMaxX = Math.max(gMaxX, gx);
      gMinY = Math.min(gMinY, gy);
      gMaxY = Math.max(gMaxY, gy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (ink[ni] === target && label[ni] === 0) {
            label[ni] = id;
            stack.push(ni);
          }
        }
      }
    }
    if (n >= 5 && gMaxY - gMinY + 1 >= 3) {
      glyphs.push({ minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY, n });
    }
  }
  if (glyphs.length === 0) return [];

  // 先按 y 聚成“行”（y 区间相交的字形属于同一行）。
  glyphs.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
  const lines = [];
  for (const g of glyphs) {
    let line = lines.find(
      (l) => g.minY <= l[l.length - 1].maxY && g.maxY >= l[l.length - 1].minY,
    );
    if (!line) {
      line = [];
      lines.push(line);
    }
    line.push(g);
  }

  // 行内按 x 排序，横向间隙超过阈值则断开成不同的“词”。
  const words = [];
  for (const line of lines) {
    line.sort((a, b) => a.minX - b.minX);
    let cur = { ...line[0] };
    const lineHeight = line.reduce((acc, g) => acc + (g.maxY - g.minY + 1), 0) / line.length;
    for (let i = 1; i < line.length; i++) {
      const gap = line[i].minX - cur.maxX;
      const gapLimit = Math.max(4, Math.min(10, lineHeight * 0.6));
      if (gap <= gapLimit) {
        cur.minX = Math.min(cur.minX, line[i].minX);
        cur.maxX = Math.max(cur.maxX, line[i].maxX);
        cur.minY = Math.min(cur.minY, line[i].minY);
        cur.maxY = Math.max(cur.maxY, line[i].maxY);
        cur.n += line[i].n;
      } else {
        words.push(toWord(cur, x0, y0, target));
        cur = { ...line[i] };
      }
    }
    words.push(toWord(cur, x0, y0, target));
  }

  words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return words;
}

function toWord(g, ox, oy, target) {
  return {
    x0: ox + g.minX,
    y0: oy + g.minY,
    x1: ox + g.maxX + 1,
    y1: oy + g.maxY + 1,
    ink: target === 1 ? "dark" : "light",
  };
}

/* =========================================================================
 * pairing.ts —— “布局无关”的图例文字配对
 * ========================================================================= */

// 一个文字候选：bbox + 墨迹极性
// interface Word { box: Box; ink: "dark" | "light"; }

const ROW_VPAD_FRAC = 0.55; // 周边窗口在垂直方向额外扩出的比例（按行高）
const ROW_HPAD_FRAC = 1.6; // 周边窗口在水平方向额外扩出的比例（按行高）
const MIN_HPAD = 28;

/**
 * 计算每个色块应该拿去 OCR 的区域。
 *
 * @returns 与 swatches 等长的数组；每个元素是该色块的候选区域（按阅读顺序）。
 * @param {{ width: number, height: number, rgb: Uint8Array | Uint8ClampedArray }} img
 * @param {Swatch[]} swatches
 * @returns {OcrRegion[][]}
 */
export function planTextRegions(img, swatches) {
  const rows = groupRows(swatches);
  const result = swatches.map(() => []);

  const rowBands = rows.map(({ swatches: s }) => {
    const top = Math.min(...s.map((x) => x.y0));
    const bottom = Math.max(...s.map((x) => x.y1));
    return { swatches: s, top, bottom, height: bottom - top };
  });

  // 1) 收集每行周边的深色文字，暂不归属（垂直上可能属于相邻行）。
  const allAround = [];
  for (let ri = 0; ri < rowBands.length; ri++) {
    const band = rowBands[ri];
    const vPad = Math.max(6, Math.round(band.height * ROW_VPAD_FRAC));
    const hPad = Math.max(MIN_HPAD, Math.round(band.height * ROW_HPAD_FRAC));
    const first = band.swatches[0];
    const last = band.swatches[band.swatches.length - 1];
    const region = {
      x0: Math.max(0, first.x0 - hPad),
      y0: Math.max(0, band.top - vPad),
      x1: Math.min(img.width, last.x1 + hPad),
      y1: Math.min(img.height, band.bottom + vPad),
    };
    for (const w of detectTextWords(img, region)) {
      if (!overlapsAnySwatch(w, band.swatches)) {
        allAround.push({ word: { box: w, ink: w.ink }, row: ri });
      }
    }
  }

  // 2) 垂直归属到最近行带，再按“色块间中点半区”水平归属到具体色块。
  const used = new Set();
  const aroundBySwatch = swatches.map(() => []);
  for (const item of allAround) {
    const cy = (item.word.box.y0 + item.word.box.y1) / 2;
    let bestRi = item.row;
    let bestD = Infinity;
    for (let ri = 0; ri < rowBands.length; ri++) {
      const b = rowBands[ri];
      const d = cy < b.top ? b.top - cy : cy > b.bottom ? cy - b.bottom : 0;
      if (d < bestD) {
        bestD = d;
        bestRi = ri;
      }
    }
    const band = rowBands[bestRi];
    const owner = assignByHalfSpan(band.swatches, item.word.box);
    if (owner >= 0) {
      const idx = swatches.indexOf(band.swatches[owner]);
      if (idx >= 0 && !used.has(item.word)) {
        used.add(item.word);
        aroundBySwatch[idx].push(item.word);
      }
    }
  }

  // 3) 同一色块、同一文字行的周边文字合成一个区域（避免把 A10(202)
  //    拆成单字碎片后逐个 OCR）。
  for (let i = 0; i < aroundBySwatch.length; i++) {
    for (const line of groupTextLines(aroundBySwatch[i])) {
      result[i].push({
        box: unionBox(line.map((w) => w.box)),
        source: "around",
        ink: majorityInk(line),
      });
    }
  }

  // 4) 色块内部文字：整块色块总是作为第一个候选（覆盖“文字印在色块内部”），
  //    内部文字按行合成紧致框作为候选（可恢复整块 OCR 丢失的前缀/括号）。
  for (let i = 0; i < swatches.length; i++) {
    const s = swatches[i];
    result[i].unshift({ box: s, source: "cell" });
    const insideWords = detectTextWords(img, s, { inside: true }).map((w) => ({
      box: w,
      ink: w.ink,
    }));
    for (const line of groupTextLines(insideWords)) {
      result[i].push({
        box: unionBox(line.map((w) => w.box)),
        source: "tight",
        ink: majorityInk(line),
      });
    }
  }

  // 5) 去重 + 排序：同一色块的区域按 y/x 阅读序，便于后续解析合并。
  for (let i = 0; i < result.length; i++) {
    result[i] = dedupeRegions(result[i]);
    result[i].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  }
  return result;
}

/** 把垂直方向相交的文字词聚成“同一行”。 */
function groupTextLines(words) {
  if (words.length === 0) return [];
  const sorted = [...words].sort(
    (a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0,
  );
  const lines = [];
  for (const w of sorted) {
    const line = lines.find((l) => {
      const top = Math.min(...l.map((x) => x.box.y0));
      const bottom = Math.max(...l.map((x) => x.box.y1));
      return w.box.y0 <= bottom && w.box.y1 >= top;
    });
    if (line) line.push(w);
    else lines.push([w]);
  }
  return lines;
}

function unionBox(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

function majorityInk(words) {
  let dark = 0;
  for (const w of words) if (w.ink === "dark") dark++;
  return dark >= words.length - dark ? "dark" : "light";
}

function overlapsAnySwatch(w, swatches) {
  const cx = (w.x0 + w.x1) / 2;
  const cy = (w.y0 + w.y1) / 2;
  return swatches.some(
    (s) => cx >= s.x0 && cx <= s.x1 && cy >= s.y0 && cy <= s.y1,
  );
}

/** 用“相邻色块中点半区”把文字水平归属给某个色块。 */
function assignByHalfSpan(rowSwatches, box) {
  const cx = (box.x0 + box.x1) / 2;
  const boundaries = [];
  for (let i = 0; i < rowSwatches.length; i++) {
    const s = rowSwatches[i];
    if (i === 0) {
      boundaries.push(s.x0 - (rowSwatches.length > 1 ? (rowSwatches[1].x0 - s.x1) / 2 : 0));
    } else {
      boundaries.push((rowSwatches[i - 1].x1 + s.x0) / 2);
    }
  }
  boundaries.push(
    rowSwatches[rowSwatches.length - 1].x1 +
      (rowSwatches.length > 1
        ? (rowSwatches[rowSwatches.length - 1].x0 - rowSwatches[rowSwatches.length - 2].x1) / 2
        : 0),
  );
  for (let i = 0; i < rowSwatches.length; i++) {
    if (cx >= boundaries[i] && cx <= boundaries[i + 1]) return i;
  }
  // 兜底：最近中心
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rowSwatches.length; i++) {
    const s = rowSwatches[i];
    const d = Math.abs(cx - (s.x0 + s.x1) / 2);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function groupRows(swatches) {
  const map = new Map();
  for (const s of swatches) {
    const arr = map.get(s.row) ?? [];
    arr.push(s);
    map.set(s.row, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, sw]) => ({
      row,
      swatches: sw.sort((a, b) => a.x0 - b.x0),
    }));
}

function dedupeRegions(regions) {
  const out = [];
  for (const r of regions) {
    const dup = out.find((o) => boxesClose(o.box, r.box));
    if (!dup) out.push(r);
  }
  return out;
}

function boxesClose(a, b) {
  const dx = Math.min(Math.abs(a.x0 - b.x0), Math.abs(a.x1 - b.x1));
  const dy = Math.min(Math.abs(a.y0 - b.y0), Math.abs(a.y1 - b.y1));
  return dx <= 2 && dy <= 2;
}

/* =========================================================================
 * analyzeLegend —— 新增：按上传图大小自适应降采样后再检测（原实现无此层）
 * ========================================================================= */

/**
 * 把框坐标从“检测所用小图”换算回“原图”尺度。
 * x0/y0 向下取整、x1/y1 向上取整，并夹到原图范围内。
 */
function scaleBox(box, scale, width, height) {
  const x0 = Math.min(width, Math.max(0, Math.floor(box.x0 / scale)));
  const y0 = Math.min(height, Math.max(0, Math.floor(box.y0 / scale)));
  const x1 = Math.min(width, Math.max(0, Math.ceil(box.x1 / scale)));
  const y1 = Math.min(height, Math.max(0, Math.ceil(box.y1 / scale)));
  return { x0, y0, x1, y1 };
}

/**
 * 盒式（区域平均）降采样：把大图缩小到 detectWidth×detectHeight。
 * 用平均而非最近邻，可平滑 JPEG/抗锯齿噪声，且保持彩色/亮度统计稳定。
 */
function downscaleImage(image, dw, dh) {
  const src = image.rgb;
  const sw = image.width;
  const sh = image.height;
  const out = new Uint8ClampedArray(dw * dh * 3);
  const sxStep = sw / dw;
  const syStep = sh / dh;
  for (let oy = 0; oy < dh; oy++) {
    const y0 = Math.floor(oy * syStep);
    const y1 = Math.min(sh, Math.floor((oy + 1) * syStep));
    for (let ox = 0; ox < dw; ox++) {
      const x0 = Math.floor(ox * sxStep);
      const x1 = Math.min(sw, Math.floor((ox + 1) * sxStep));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const base = y * sw;
        for (let x = x0; x < x1; x++) {
          const i = (base + x) * 3;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      }
      const o = (oy * dw + ox) * 3;
      out[o] = n ? r / n : 0;
      out[o + 1] = n ? g / n : 0;
      out[o + 2] = n ? b / n : 0;
    }
  }
  return { width: dw, height: dh, rgb: out };
}

/**
 * 分析图例：在“贴合调参前提”的低分辨率上跑检测，再把框坐标换算回原图。
 *
 * 原因：原实现调参常量（LONG_RUN=60、CELL_WIDTH_MIN=40 等）是针对约 1280px
 * 宽的图纸调的；用户可能上传 4000px 的大图，直接跑会既慢又不准。所以：
 * - image.width <= maxDetectWidth：scale=1，直接用原图（结果与逐字节一致）；
 * - 否则按 scale = maxDetectWidth/image.width 缩小后检测，再回换算坐标。
 *
 * @param {{ width: number, height: number, rgb: Uint8Array | Uint8ClampedArray }} image
 * @param {{ maxDetectWidth?: number }} [options]
 * @returns {{ swatches: Swatch[], regions: OcrRegion[][], scale: number, detectWidth: number, detectHeight: number }}
 */
export function analyzeLegend(image, { maxDetectWidth = 1600 } = {}) {
  let scale = 1;
  let small = image;
  let detectWidth = image.width;
  let detectHeight = image.height;

  if (image.width > maxDetectWidth) {
    scale = maxDetectWidth / image.width;
    detectWidth = Math.max(1, Math.round(image.width * scale));
    detectHeight = Math.max(1, Math.round(image.height * scale));
    small = downscaleImage(image, detectWidth, detectHeight);

    const swatches = detectSwatches(small);
    const regions = planTextRegions(small, swatches);

    const outSwatches = swatches.map((s) => ({
      row: s.row,
      ...scaleBox(s, scale, image.width, image.height),
    }));
    const outRegions = regions.map((list) =>
      list.map((r) => ({
        box: scaleBox(r.box, scale, image.width, image.height),
        source: r.source,
        ...(r.ink !== undefined ? { ink: r.ink } : {}),
      })),
    );

    return { swatches: outSwatches, regions: outRegions, scale, detectWidth, detectHeight };
  }

  // scale === 1：直接在原图上检测，不经过任何换算，保证与原实现逐字节一致。
  const swatches = detectSwatches(image);
  const regions = planTextRegions(image, swatches);
  return { swatches, regions, scale: 1, detectWidth: image.width, detectHeight: image.height };
}
