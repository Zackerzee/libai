/**
 * ui/pattern-import-panel.js
 * 「导入带色号的图纸」面板 —— 从图纸图片识别色号网格，复核后灌入工作台编辑器。
 *
 * 入口：顶栏「新建 / 导入」→「导入现成图纸」（#ws-import-pattern）。
 *
 * 三件事：
 *   1. **自动裁剪**：图纸常带边框、图例、色号统计表。先用 detectGridStep 找网格周期，
 *      再用「相位拟合 + 边界强度最长连续段」定位真正的豆格区，只保留那一段。
 *      判不准就**不裁**（保守失败），交给白底裁边和用户手工校准，绝不把好图裁坏。
 *   2. **识别**：调 vendor/bead-pattern 的 recognizePattern，ring 采样绕开格心色号文字。
 *   3. **复核与灌入**：色号网格画在画布上，待确认格高亮、点格可从候选色改；
 *      确认后用**当前色卡**把色号解析成颜色对象，走 bridge.replaceGridStructure 灌入。
 *
 * 为什么不用交接包自带的 UI 组件：那套组件的样式自成一套（自己的 CSS 变量、
 * 硬编码白底），与本项目的设计令牌与暗色主题冲突，且会把「自动裁剪」做进算法里
 * 而用户看不到裁掉了什么。这里只借它的**算法**，界面按本项目规范自绘。
 */

import {
  recognizePattern,
  detectGridStep,
  preparePalette,
  topCandidates,
} from "../vendor/bead-pattern/bead-pattern-core.js?v=20261016-pattern-import-1";

/** 长边上限。再大的图对「格子才二十几像素」的图纸没有收益，只会拖慢采样。 */
const MAX_SIDE = 1600;
/** 待确认格的判定阈值（top1/top2 色差间隔），与交接包默认一致。 */
const MARGIN_THRESHOLD = 3;
/** 画布上每个豆格的最大像素边长。 */
const CELL_PX_MAX = 30;

/* ============================================================================
 * 自动裁剪：去掉边框 / 图例 / 色号统计表，只留真正的豆格区
 *
 * 四步，每步都能单独判失败，失败就**不裁**（保守失败）：
 *   1. detectGridStep 找网格周期 cell（vendor 核心库，自相关 + 倍周期回退）。
 *   2. 梳齿相位找格子边界：格子边界处必有边（网格线 + 相邻格色差）。
 *      把列/行投影的梯度按「每逢 cell 取一个」的梳齿求和，梳齿压在边界上时最大。
 *      **不能用「格内平均跳变」** —— 细网格线被整幅图的另一边长稀释后几乎看不见，
 *      而梳齿只问「这个相位上总的边能量有多少」，对细线同样有效。
 *   3. 逐格判「是不是纸边」：格内均值与众数（纸边色）相差不超过容差即纸边。
 *      **用格内均值而不是列均值** —— 列均值把格外（图外）的白边一起平均进去，
 *      会把豆格色冲淡到跟纸边分不开。纸边色还必须被图像四角实测确认，
 *      否则（把某个高频豆色当成纸边）会把好图裁坏。
 *   4. 在「非纸边」的格子上求**最大矩形**（直方图 + 单调栈）。
 *      边框只有一两格厚、图例/统计表是零散小块，而豆格区是图上最大的成片结构，
 *      最大矩形必然落在它上面。再补一遍内部空洞（与格外不相连的纸边格
 *      其实是豆格区内部的同色豆，例如一整行白豆），避免把图纸劈成两半。
 * ==========================================================================*/

/** 纸边判定容差（亮度 0-255）。 */
const MARGIN_TOL = 8;

/**
 * 轴方向亮度投影。axis 'x' 得到逐列均值（长度 w），'y' 得到逐行均值（长度 h）。
 * 与 detectGridStep 内部用的是同一个信号，所以梳齿相位和周期检测口径一致。
 * 全透明像素按白计 —— JPEG 没有 alpha，但 PNG 图纸的透明区不能当成黑色拉低均值。
 */
function axisMeans(data, w, h, axis) {
  const n = axis === "x" ? w : h;
  const outer = axis === "x" ? h : w;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = 0; j < outer; j++) {
      const idx = axis === "x" ? (j * w + i) * 4 : (i * w + j) * 4;
      const a = data[idx + 3];
      if (a !== undefined && a < 8) { sum += 255; count++; continue; }
      sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      count++;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

/**
 * 梳齿相位：网格线在投影上是「比左右邻居都暗（或都亮）的尖峰」。
 * 把尖峰强度按「每逢 cell 取一个」的梳齿求和，梳齿压在格线上时总和最大。
 *
 * 为什么用尖峰而不是一阶差分：差分落在格线的哪一侧，取决于格线列自身的亮度 ——
 * 格线列通体发黑时边在豆色侧，格线列被图外白边稀释后边在留白侧，两种图能差出一整格。
 * 「比左右都暗」这个判据只在格线列上成立，两种图都指向格线本身。
 * 亮色格线（白线画在彩豆上）靠对称偏离量兜底。
 */
function combPhase(means, cell) {
  const n = means.length;
  if (n < cell * 2) return 0;
  const spike = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    const left = x > 0 ? means[x - 1] : means[Math.min(1, n - 1)];
    const right = x < n - 1 ? means[x + 1] : means[Math.max(0, n - 2)];
    const dark = Math.max(0, left - means[x]) + Math.max(0, right - means[x]);
    spike[x] = Math.max(dark, Math.abs(means[x] - (left + right) / 2));
  }
  let best = 0, bestScore = -1;
  for (let p = 0; p < cell; p++) {
    let score = 0;
    for (let x = p; x < n; x += cell) score += spike[x];
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * 格内均值的众数 —— 几乎总是纸边色。
 * 格内均值是「这一格所有像素的平均」，纸边格全都等于纸边色且数量可观，
 * 而每个豆格因为颜色不同各自唯一，所以众数稳定落在纸边色上。
 */
function modalMean(means) {
  const tally = new Map();
  for (let i = 0; i < means.length; i++) {
    const key = Math.round(means[i]);
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [key, count] of tally) {
    if (count > bestCount) { bestCount = count; best = key; }
  }
  return best;
}

/**
 * 逐格亮度均值。只统计落在 cell 网格里的完整格。
 * 必须按格算而不是按列算：列均值会把格外（图外）的白边一起平均进去，
 * 把豆格色冲淡到跟纸边分不开，纸边就再也判不出来了。
 * @returns {{cols:number, rows:number, means:Float64Array}|null}
 */
function cellMeans(data, w, h, cell, phaseX, phaseY) {
  const cols = Math.floor((w - phaseX) / cell);
  const rows = Math.floor((h - phaseY) / cell);
  if (cols < 2 || rows < 2) return null;
  const means = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y0 = phaseY + r * cell;
    for (let c = 0; c < cols; c++) {
      const x0 = phaseX + c * cell;
      let sum = 0;
      for (let y = y0; y < y0 + cell; y++) {
        const base = y * w;
        for (let x = x0; x < x0 + cell; x++) {
          const i = (base + x) * 4;
          const a = data[i + 3];
          sum += a < 8 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }
      means[r * cols + c] = sum / (cell * cell);
    }
  }
  return { cols, rows, means };
}

/**
 * 纸边必须真的是一条「带」：投影里要有一段长度 ≥ cell 的连续列/行，均值都落在
 * 纸边色上，而且这段贴在图边（开头在 0、或结尾在 n）。
 *
 * 这一关防的是「众数其实是个豆色」。全幅铺满的图纸里，某个高频豆色的列被格线
 * 切成一条条长度只有 cell-1 的碎片，永远凑不出整带 → 判为没有纸边 → 不启用
 * 颜色判据 → 所有格都算内容 → 最大矩形等于整张格网 → 走「没裁掉东西」出口。
 * 纸边比一格还薄的图同理判为没有纸边，此时只按格网裁掉亚格子的边，也是对的。
 */
function marginBand(means, cell, mode) {
  const n = means.length;
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const ok = i < n && Math.abs(means[i] - mode) <= MARGIN_TOL;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= cell && (start === 0 || i === n)) return true;
      start = -1;
    }
  }
  return false;
}

/**
 * 补洞：与格外（格网边界）不相连的纸边格，说明它在豆格区**内部**，
 * 是「颜色恰好等于纸边色的豆」（例如一整行白豆），不是留白。
 * 不补这一刀的后果：图纸被中间的同色行劈成两半，只裁得下一半。
 */
function fillInteriorHoles(mask, cols, rows) {
  const reachable = new Uint8Array(mask.length);
  const stack = [];
  const seed = (c, r) => {
    const i = r * cols + c;
    if (mask[i] || reachable[i]) return;
    reachable[i] = 1;
    stack.push(i);
  };
  for (let c = 0; c < cols; c++) { seed(c, 0); seed(c, rows - 1); }
  for (let r = 0; r < rows; r++) { seed(0, r); seed(cols - 1, r); }
  while (stack.length) {
    const i = stack.pop();
    const c = i % cols;
    const r = (i - c) / cols;
    if (c > 0) seed(c - 1, r);
    if (c + 1 < cols) seed(c + 1, r);
    if (r > 0) seed(c, r - 1);
    if (r + 1 < rows) seed(c, r + 1);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !reachable[i]) mask[i] = 1;
  return mask;
}

/**
 * 二值矩阵里的最大全 1 矩形（逐行直方图 + 单调栈）。
 * 边框只有一两格厚、图例/统计表是零散小块，而豆格区是图上最大的成片结构，
 * 所以最大矩形必然落在豆格区上 —— 这比「逐轴取最长连续段」更抗图例干扰。
 * @returns {{c0,c1,r0,r1,area}|null} c1/r1 为开区间
 */
function largestRect(mask, cols, rows) {
  const heights = new Int32Array(cols);
  let best = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = mask[r * cols + c] ? heights[c] + 1 : 0;
    }
    const stack = [];
    for (let c = 0; c <= cols; c++) {
      const cur = c === cols ? -1 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= cur) {
        const top = stack.pop();
        const h = heights[top];
        const width = stack.length ? c - stack[stack.length - 1] - 1 : c;
        if (h > 0 && width > 0 && (!best || h * width > best.area)) {
          best = {
            area: h * width,
            c0: stack.length ? stack[stack.length - 1] + 1 : 0,
            c1: c,
            r0: r - h + 1,
            r1: r + 1,
          };
        }
      }
      stack.push(c);
    }
  }
  return best;
}

/**
 * 自动裁剪。返回 null 表示「没把握，别裁」—— 宁可保留原图让用户手工校准。
 * @returns {{x0,y0,x1,y1,cell,removed:{left,top,right,bottom},cells:{cols,rows}}|null}
 */
export function cropToGrid(data, w, h, opts = {}) {
  const cell = detectGridStep(data, w, h, opts.detectOpts || {});
  if (!cell || cell < 2) return null;
  const colProj = axisMeans(data, w, h, "x");
  const rowProj = axisMeans(data, w, h, "y");
  const phaseX = combPhase(colProj, cell);
  const phaseY = combPhase(rowProj, cell);
  const stats = cellMeans(data, w, h, cell, phaseX, phaseY);
  if (!stats) return null;
  const mode = modalMean(stats.means);
  if (mode == null) return null;

  // 投影里凑不出纸边带 → 众数不是纸边色（多半是全幅铺满的图纸），
  // 颜色判据不可信。此时所有格都算内容，最大矩形只会等于整张格网，
  // 由后面的「没裁掉东西」出口拦住。
  const useColor = marginBand(colProj, cell, mode) || marginBand(rowProj, cell, mode);
  const mask = new Uint8Array(stats.cols * stats.rows);
  let any = false;
  for (let i = 0; i < mask.length; i++) {
    const content = !useColor || Math.abs(stats.means[i] - mode) > MARGIN_TOL;
    mask[i] = content ? 1 : 0;
    if (content) any = true;
  }
  if (!any) return null;
  fillInteriorHoles(mask, stats.cols, stats.rows);

  const rect = largestRect(mask, stats.cols, stats.rows);
  if (!rect) return null;
  const x0 = phaseX + rect.c0 * cell;
  const x1 = phaseX + rect.c1 * cell;
  const y0 = phaseY + rect.r0 * cell;
  const y1 = phaseY + rect.r1 * cell;
  if (x1 - x0 < cell * 2 || y1 - y0 < cell * 2) return null;
  // 几乎没有裁掉东西（只剩亚像素边缘）就别动原图。
  if (x0 <= 1 && y0 <= 1 && x1 >= w - 1 && y1 >= h - 1) return null;
  return {
    x0, y0, x1, y1, cell,
    removed: { left: x0, top: y0, right: w - x1, bottom: h - y1 },
    cells: { cols: rect.c1 - rect.c0, rows: rect.r1 - rect.r0 },
  };
}

/* ============================================================================
 * 面板
 * ==========================================================================*/

/**
 * @param {object} deps
 * @param {object} deps.bridge              window.LibmsWorkspaceBridge
 * @param {() => Array} deps.getPaletteColors  当前色卡颜色对象数组
 * @param {(msg: string) => void} deps.notify
 * @param {(msg: string) => Promise<boolean>} deps.askConfirmation
 * @param {() => void} deps.afterImport     灌入成功后的工作台收尾（同步面板、适配视口）
 */
export function createPatternImportPanel({ bridge, getPaletteColors, notify, askConfirmation, afterImport }) {
  const wrap = document.querySelector(".workspace-wrap");
  if (!wrap) throw new Error("[pattern-import] 找不到 .workspace-wrap，面板无处挂载");

  const dialog = document.createElement("dialog");
  dialog.className = "ws-help-dialog ws-pattern-import";
  dialog.innerHTML = `
    <div class="ws-help-head"><strong>导入带色号的图纸</strong><button type="button" class="ws-help-close" data-pi-close aria-label="关闭">×</button></div>
    <p class="ws-note">上传一张拼豆图纸图片（色块图 / 带色号文字 / 实拍），自动识别成色号网格。带边框、图例、色号统计的图会自动裁掉多余部分。</p>
    <div class="ws-pi-toolbar">
      <button type="button" class="ws-button ws-button-primary" data-pi-pick>选择图纸图片</button>
      <label><input type="checkbox" data-pi-autocrop checked>自动裁剪边框与图例</label>
      <label><input type="checkbox" data-pi-whitebg checked>白底留空</label>
      <span class="ws-pi-spacer"></span>
      <label class="ws-pi-cell">格子像素<input type="number" data-pi-cell min="3" max="200" step="1" disabled></label>
      <button type="button" class="ws-button" data-pi-reset disabled>重新选择</button>
    </div>
    <p class="ws-pi-status" data-pi-status role="status">请选择一张图纸图片。</p>
    <div class="ws-pi-body" data-pi-body hidden>
      <div class="ws-pi-view">
        <div class="ws-pi-canvas-box"><canvas data-pi-canvas></canvas></div>
        <div class="ws-pi-view-switch">
          <button type="button" class="ws-button" data-pi-view="source">原图与网格</button>
          <button type="button" class="ws-button ws-button-primary" data-pi-view="beads">色号图纸</button>
        </div>
      </div>
      <div class="ws-pi-side">
        <div class="ws-pi-editor" data-pi-editor hidden></div>
        <div class="ws-pi-usage" data-pi-usage hidden></div>
      </div>
    </div>
    <div class="ws-help-foot">
      <button type="button" class="ws-button" data-pi-close>取消</button>
      <button type="button" class="ws-button ws-button-primary" data-pi-confirm disabled>确认导入</button>
    </div>`;
  wrap.append(dialog);

  const $ = (selector) => dialog.querySelector(selector);
  const els = {
    pick: $("[data-pi-pick]"), autocrop: $("[data-pi-autocrop]"), whitebg: $("[data-pi-whitebg]"),
    cell: $("[data-pi-cell]"), reset: $("[data-pi-reset]"), status: $("[data-pi-status]"),
    body: $("[data-pi-body]"), canvas: $("[data-pi-canvas]"),
    sourceView: $('[data-pi-view="source"]'), beadsView: $('[data-pi-view="beads"]'),
    editor: $("[data-pi-editor]"), usage: $("[data-pi-usage]"), confirm: $("[data-pi-confirm]"),
  };
  const ctx = els.canvas.getContext("2d");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  dialog.append(fileInput);

  const state = {
    view: "beads",            // 'source' 原图与网格 | 'beads' 色号图纸
    image: null,              // 裁好的预览图（canvas）
    data: null, w: 0, h: 0,   // 识别用的像素（已裁剪）
    raw: null, rawW: 0, rawH: 0,
    crop: null,
    rec: null,                // recognizePattern 的结果
    grid: null,               // 色号网格（可被手工修改）
    colors: null,             // 每格采样原色
    edits: new Map(),
    selected: null,
    cellPx: 14,
    cellSize: null,           // 手工覆盖的格子像素
    busy: false,
  };

  const setStatus = (message, tone = "") => {
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  };

  /* ---------------------------------------------------------------- 视图 */

  const fitCanvas = (cssW, cssH) => {
    const box = els.canvas.parentElement;
    const avail = Math.max(240, (box.clientWidth || 640) - 2);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(avail, cssW);
    const scale = cssW > 0 ? w / cssW : 1;
    els.canvas.width = Math.round(w * dpr);
    els.canvas.height = Math.round(cssH * scale * dpr);
    els.canvas.style.width = `${w}px`;
    els.canvas.style.height = `${Math.round(cssH * scale)}px`;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    return { w, scale };
  };

  /** 原图与网格：把裁剪结果和检测到的格子画出来，让用户确认裁对了、格数对。 */
  const drawSourceView = () => {
    const { w, h } = state;
    fitCanvas(w, h);
    ctx.clearRect(0, 0, w, h);
    if (state.image) ctx.drawImage(state.image, 0, 0, w, h);
    const cell = state.cellSize;
    if (cell) {
      ctx.save();
      ctx.strokeStyle = "rgba(249, 115, 22, .6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += cell) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
      for (let y = 0; y <= h; y += cell) { ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
      ctx.stroke();
      ctx.restore();
    }
  };

  /** 色号图纸：一格一色，写上色号；待确认格描橙框，手工改过的格打蓝角标。 */
  const drawBeadsView = () => {
    if (!state.grid) return;
    const rows = state.grid.length, cols = state.grid[0].length;
    const box = els.canvas.parentElement;
    const avail = Math.max(240, (box.clientWidth || 640) - 2);
    const px = Math.max(3, Math.min(CELL_PX_MAX, Math.floor(avail / cols)));
    state.cellPx = px;
    const cw = cols * px, ch = rows * px;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.canvas.width = Math.round(Math.min(avail, cw) * dpr);
    els.canvas.height = Math.round(ch * dpr);
    els.canvas.style.width = `${Math.min(avail, cw)}px`;
    els.canvas.style.height = `${ch}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 画布底色：canvas 不认 CSS 变量，图纸本身是作品数据，用纯白即可（与留空格子的浅灰区分）。
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);

    const hexOf = paletteHexMap();
    const uncertain = new Set((state.rec?.uncertain || []).map((u) => `${u.r},${u.c}`));
    const showText = px >= 15 && rows * cols <= 8000;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const code = state.grid[r][c];
        const x = c * px, y = r * px;
        if (!code) {
          ctx.fillStyle = "#f4f4f5";
          ctx.fillRect(x, y, px, px);
          if (px >= 9) {
            ctx.strokeStyle = "#d4d4d8";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 2, y + px - 2);
            ctx.lineTo(x + px - 2, y + 2);
            ctx.stroke();
          }
          continue;
        }
        ctx.fillStyle = hexOf.get(code) || "#cccccc";
        ctx.fillRect(x, y, px, px);
      }
    }

    if (px >= 7) {
      ctx.strokeStyle = "rgba(0,0,0,.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) { ctx.moveTo(c * px + .5, 0); ctx.lineTo(c * px + .5, ch); }
      for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r * px + .5); ctx.lineTo(cw, r * px + .5); }
      ctx.stroke();
    }

    if (showText) {
      ctx.font = `${Math.round(px * 0.34)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const code = state.grid[r][c];
          if (!code) continue;
          ctx.fillStyle = luminance(hexOf.get(code) || "#ffffff") > 140 ? "#111827" : "#ffffff";
          ctx.fillText(code, c * px + px / 2, r * px + px / 2, px - 2);
        }
      }
    }

    if (uncertain.size) {
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = px >= 10 ? 2 : 1;
      for (const key of uncertain) {
        if (state.edits.has(key)) continue;
        const [r, c] = key.split(",").map(Number);
        ctx.strokeRect(c * px + 1, r * px + 1, px - 2, px - 2);
      }
    }
    if (state.edits.size) {
      ctx.fillStyle = "#2563eb";
      for (const key of state.edits.keys()) {
        const [r, c] = key.split(",").map(Number);
        const s = Math.max(3, Math.floor(px * 0.26));
        ctx.fillRect(c * px + px - s, r * px, s, s);
      }
    }
  };

  const draw = () => { if (state.view === "source") drawSourceView(); else drawBeadsView(); };

  const setView = (view) => {
    state.view = view;
    els.sourceView.classList.toggle("ws-button-primary", view === "source");
    els.beadsView.classList.toggle("ws-button-primary", view === "beads");
    draw();
  };

  /* ---------------------------------------------------------------- 辅助 */

  function luminance(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return 255;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function paletteHexMap() {
    return new Map(getPaletteColors().map((color) => [color.code, color.hex]));
  }

  /** 当前色卡里离纯白足够近的色号 —— 开「白底留空」时它们会被当成背景丢掉，必须提示。 */
  function nearWhiteCodes() {
    const white = [100, 0, 0];
    return getPaletteColors()
      .filter((color) => {
        const lab = hexToLabSafe(color.hex);
        return lab ? deltaE(lab, white) <= 12 : false;
      })
      .map((color) => color.code);
  }

  function hexToLabSafe(hex) {
    try {
      const h = String(hex || "").replace("#", "").trim();
      if (h.length !== 6 && h.length !== 3) return null;
      const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
      return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
    } catch { return null; }
  }

  function deltaE(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function rgbToLab(r, g, b) {
    const lin = (v) => { const c = v / 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
    const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /* ---------------------------------------------------------------- 流程 */

  const resetState = () => {
    Object.assign(state, {
      view: "beads", image: null, data: null, w: 0, h: 0,
      raw: null, rawW: 0, rawH: 0, crop: null,
      rec: null, grid: null, colors: null, cellSize: null,
    });
    state.edits.clear();
    state.selected = null;
    els.body.hidden = true;
    els.editor.hidden = true;
    els.usage.hidden = true;
    els.confirm.disabled = true;
    els.reset.disabled = true;
    els.cell.disabled = true;
    els.cell.value = "";
    setStatus("请选择一张图纸图片。");
  };

  const loadFile = (file) => {
    if (!file || !/^image\//.test(file.type)) { setStatus("请选择图片文件（JPG / PNG / WebP）。", "warn"); return; }
    const reader = new FileReader();
    reader.onload = () => loadImageSrc(String(reader.result));
    reader.onerror = () => setStatus("文件读取失败。", "warn");
    reader.readAsDataURL(file);
  };

  const loadImageSrc = (src) => {
    const image = new Image();
    image.onload = () => prepare(image);
    image.onerror = () => setStatus("图片解码失败。", "warn");
    image.src = src;
  };

  /** 降采样 → 自动裁剪 → 识别。识别放在 setTimeout 里，让「识别中」先画出来。 */
  const prepare = (image) => {
    const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const c2 = canvas.getContext("2d", { willReadFrequently: true });
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = "high";
    c2.drawImage(image, 0, 0, w, h);
    state.raw = canvas;
    state.rawW = w; state.rawH = h;
    state.crop = null;
    state.edits.clear();
    state.selected = null;
    recognize(true);
  };

  const recognize = (fromImage = false) => {
    if (!state.raw) return;
    state.busy = true;
    els.confirm.disabled = true;
    setStatus("识别中…");

    // 让状态先渲染，再做同步计算
    setTimeout(() => {
      try {
        let source = state.raw, sw = state.rawW, sh = state.rawH;
        let crop = null;
        if (fromImage && els.autocrop.checked) {
          const data = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
          crop = cropToGrid(data, sw, sh);
        }

        let view = source, vw = sw, vh = sh;
        if (crop) {
          const cut = document.createElement("canvas");
          cut.width = crop.x1 - crop.x0;
          cut.height = crop.y1 - crop.y0;
          const c3 = cut.getContext("2d", { willReadFrequently: true });
          c3.drawImage(source, crop.x0, crop.y0, cut.width, cut.height, 0, 0, cut.width, cut.height);
          view = cut; vw = cut.width; vh = cut.height;
        }
        state.crop = crop;
        state.image = view;
        state.w = vw; state.h = vh;

        const pixelData = view.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, vw, vh);
        const palette = preparePalette(getPaletteColors());
        const emptyOpts = els.whitebg.checked ? { backgroundHex: "#FFFFFF", bgTolerance: 12 } : {};

        const rec = recognizePattern(pixelData.data, vw, vh, palette, {
          cellSize: state.cellSize || null,
          autoTrim: true,
          whiteBalance: "auto",
          sampleAlgo: "ring",
          marginThreshold: MARGIN_THRESHOLD,
          emptyOpts,
        });

        state.rec = rec;
        state.grid = rec.grid.map((row) => row.slice());
        state.colors = rec.colors;
        state.data = pixelData.data;
        state.edits.clear();
        state.selected = null;
        if (!state.cellSize) state.cellSize = rec.detectedCellSize;

        els.body.hidden = false;
        els.reset.disabled = false;
        els.cell.disabled = false;
        els.cell.value = String(rec.detectedCellSize || "");
        els.confirm.disabled = false;
        setView("beads");
        renderUsage();
        renderSummary();
      } catch (error) {
        console.error("[pattern-import] 识别失败", error);
        setStatus(`识别失败：${error.message || error}`, "warn");
        els.body.hidden = true;
        els.confirm.disabled = true;
      } finally {
        state.busy = false;
      }
    }, 30);
  };

  const renderSummary = () => {
    const rec = state.rec;
    if (!rec) return;
    const rows = state.grid.length, cols = state.grid[0].length;
    const openUncertain = (rec.uncertain || []).filter((u) => !state.edits.has(`${u.r},${u.c}`)).length;
    const parts = [`${cols} × ${rows} 格`, `${rec.colorCount} 色`, `${rec.beadCount} 颗`];
    if (openUncertain) parts.push(`待确认 ${openUncertain} 格`);
    if (state.crop) {
      const r = state.crop.removed;
      parts.push(`已裁剪 左${r.left}/上${r.top}/右${r.right}/下${r.bottom} px`);
    }
    let message = parts.join(" · ");
    const warnings = [];
    if (rec.quality?.ratio > 0.3) warnings.push("画面过曝像素较多，这部分颜色已不可恢复，建议换更清晰的图。");
    if (els.whitebg.checked) {
      const whites = nearWhiteCodes();
      if (whites.length) warnings.push(`当前色卡含近白色号（${whites.slice(0, 4).join("、")}${whites.length > 4 ? " 等" : ""}），「白底留空」会把它们当成背景丢掉，可取消勾选后重新识别。`);
    }
    if (rec.uncertainRatio > 0.35) warnings.push("待确认格子偏多，通常是图片偏色或分辨率太低。");
    setStatus(message, warnings.length ? "warn" : "");
    if (warnings.length) {
      els.status.textContent = `${message} —— ${warnings.join(" ")}`;
    }
  };

  /* ---------------------------------------------------------------- 复核 */

  const cellAt = (event) => {
    const rect = els.canvas.getBoundingClientRect();
    if (!state.grid) return null;
    const rows = state.grid.length, cols = state.grid[0].length;
    const c = Math.floor((event.clientX - rect.left) / (rect.width / cols));
    const r = Math.floor((event.clientY - rect.top) / (rect.height / rows));
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    return { r, c };
  };

  els.canvas.addEventListener("click", (event) => {
    if (state.view !== "beads" || !state.grid) return;
    const hit = cellAt(event);
    if (!hit) return;
    state.selected = hit;
    renderEditor();
  });

  const setCell = (r, c, code) => {
    if (!state.grid) return;
    state.grid[r][c] = code;
    state.edits.set(`${r},${c}`, code);
    draw();
    renderUsage();
    renderSummary();
    renderEditor();
  };

  const restoreCell = (r, c) => {
    state.grid[r][c] = state.rec.grid[r][c];
    state.edits.delete(`${r},${c}`);
    draw();
    renderUsage();
    renderSummary();
    renderEditor();
  };

  const renderEditor = () => {
    const sel = state.selected;
    if (!sel || state.view !== "beads") { els.editor.hidden = true; return; }
    const { r, c } = sel;
    const code = state.grid[r][c];
    const sampled = state.colors?.[r]?.[c] || null;
    const assignment = (state.rec?.assignments || []).find((a) => a.r === r && a.c === c);

    const rows = [];
    rows.push(`<div class="ws-pi-kv"><span>位置</span><b>第 ${r + 1} 行 · 第 ${c + 1} 列</b></div>`);
    if (sampled) rows.push(`<div class="ws-pi-kv"><span>采样色</span><b>${sampled}</b></div>`);
    if (assignment?.alt) {
      rows.push(`<div class="ws-pi-kv"><span>次优色号</span><b>${assignment.alt}</b></div>`);
    }

    const candidates = sampled ? topCandidates(sampled, getPaletteColors(), 8, "lab") : [];
    const chips = candidates.map((cd) => `
      <button type="button" class="ws-pi-cand${cd.code === code ? " is-on" : ""}" data-pi-code="${cd.code}">
        <i style="background:${cd.hex}"></i><span>${cd.code}</span><small>${cd.dist.toFixed(1)}</small>
      </button>`).join("");

    els.editor.innerHTML = `
      <div class="ws-pi-editor-head">编辑格子</div>
      ${rows.join("")}
      <div class="ws-pi-cands">${chips || '<p class="ws-note">这一格没有采样色。</p>'}</div>
      <div class="ws-pi-editor-actions">
        <button type="button" class="ws-button" data-pi-empty>设为留空</button>
        <button type="button" class="ws-button" data-pi-restore>恢复自动</button>
      </div>`;
    els.editor.hidden = false;

    els.editor.querySelectorAll("[data-pi-code]").forEach((button) => {
      button.addEventListener("click", () => setCell(r, c, button.dataset.piCode));
    });
    const empty = els.editor.querySelector("[data-pi-empty]");
    const restore = els.editor.querySelector("[data-pi-restore]");
    if (empty) empty.addEventListener("click", () => setCell(r, c, null));
    if (restore) restore.addEventListener("click", () => restoreCell(r, c));
  };

  const renderUsage = () => {
    if (!state.grid) return;
    const tally = new Map();
    for (const row of state.grid) {
      for (const code of row) if (code) tally.set(code, (tally.get(code) || 0) + 1);
    }
    const hexOf = paletteHexMap();
    const list = [...tally.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    els.usage.innerHTML = `
      <div class="ws-pi-usage-head">用量 · ${list.length} 色 / ${[...tally.values()].reduce((s, n) => s + n, 0)} 颗</div>
      <div class="ws-pi-usage-list">${list.map(([code, count]) => `
        <div class="ws-pi-usage-row"><i style="background:${hexOf.get(code) || "#ccc"}"></i><b>${code}</b><span>${count} 颗</span></div>`).join("")}</div>`;
    els.usage.hidden = false;
  };

  /* ---------------------------------------------------------------- 灌入 */

  const confirmImport = async () => {
    if (!state.grid || state.busy) return;
    const current = bridge.getResult();
    if (current.manualEdited) {
      const ok = await askConfirmation("导入图纸会替换当前作品，未保存的手动编辑将丢失。继续吗？");
      if (!ok) return;
    }
    // 色号 → 当前色卡的颜色对象。认不出的色号落成空格，并如实告知，不静默丢弃。
    const byCode = new Map();
    for (const color of getPaletteColors()) {
      byCode.set(String(color.code).toUpperCase(), color);
      if (color.paletteId) byCode.set(String(color.paletteId).toUpperCase(), color);
    }
    let unresolved = 0;
    const grid = state.grid.map((row) => row.map((code) => {
      if (code == null) return null;
      const found = byCode.get(String(code).toUpperCase());
      if (!found) { unresolved++; return null; }
      return found;
    }));
    const height = grid.length;
    const width = height ? grid[0].length : 0;
    if (!width || !bridge.replaceGridStructure({ grid, width, height })) {
      setStatus("导入失败：生成的色号网格无法载入当前画布。", "warn");
      return;
    }
    afterImport?.();
    const note = [`已导入 ${width} × ${height} 图纸`];
    if (state.crop) note.push("已自动裁剪边框与图例");
    if (unresolved) note.push(`${unresolved} 格色号不在当前色卡中，已留空`);
    notify(`${note.join(" · ")}。`);
    dialog.close();
  };

  /* ---------------------------------------------------------------- 事件 */

  els.pick.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
    fileInput.value = "";
  });
  els.reset.addEventListener("click", () => { resetState(); fileInput.click(); });
  els.autocrop.addEventListener("change", () => { if (state.raw) recognize(true); });
  els.whitebg.addEventListener("change", () => { if (state.raw) recognize(true); });
  els.cell.addEventListener("change", () => {
    const value = Math.max(3, parseInt(els.cell.value, 10) || 0);
    state.cellSize = value || null;
    els.cell.value = String(state.cellSize || "");
    if (state.raw) recognize(false);
  });
  els.sourceView.addEventListener("click", () => setView("source"));
  els.beadsView.addEventListener("click", () => setView("beads"));
  els.confirm.addEventListener("click", () => confirmImport());
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-pi-close]")) dialog.close();
  });
  // 点遮罩关闭：dialog 的 click 目标就是 dialog 自身
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!dialog.open) return; draw(); }, 150);
  };
  window.addEventListener("resize", onResize);

  return {
    open() {
      resetState();
      // 容器可见后再算画布尺寸：dialog 关闭时是 display:none，clientWidth 会是 0。
      dialog.showModal();
      fileInput.click();
    },
    close: () => dialog.close(),
    destroy() {
      window.removeEventListener("resize", onResize);
      dialog.remove();
    },
  };
}
