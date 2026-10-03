/**
 * b4-sheet.mjs — contact sheet 的渲染原语（Stage B4）。
 *
 * 抽出来的理由和 `tests/b4-bench-runner.mjs` 一样：§4/§5 的基线工具和
 * §6–§10 的 Lab 跑分器**必须是同一套渲染**。两边各写一份，
 * 就会出现「基线 sheet 里空豆是浅棋盘、Lab sheet 里是黑的」这种
 * 不影响结论但会让人怀疑图是不是同一张的差异。
 *
 * 纯渲染：不读文件、不写文件、不打印。
 */

import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";

/** 空豆的浅棋盘底色。比透明更清楚 —— 肉眼一眼能看出「这里被清掉了」。 */
const CHECK_LIGHT = 248;
const CHECK_DARK = 236;

/**
 * 网格 → PNG。`cell` 是每颗豆的像素边长。
 *
 * `cell <= 1` 时按 1 处理：`renderGridPng(grid, 0)` 会算出 0 宽的图，
 * 而 `encodePng` 对 0 宽不会报错，只会产出一张打不开的 PNG ——
 * 那种失败会一路漂到「图看不出来」而不是「参数写错了」。
 */
export function renderGridPng(grid, cell = 6) {
  const step = Math.max(1, Math.floor(cell));
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const W = w * step;
  const H = h * step;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const gx = Math.floor(x / step);
      const gy = Math.floor(y / step);
      const i = (y * W + x) * 4;
      const c = grid[gy]?.[gx];
      if (!c) {
        const check = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
        const v = check ? CHECK_DARK : CHECK_LIGHT;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
        continue;
      }
      data[i] = c.rgb[0]; data[i + 1] = c.rgb[1]; data[i + 2] = c.rgb[2]; data[i + 3] = 255;
    }
  }
  return encodePng({ data, width: W, height: H });
}

/**
 * 把若干张等大的网格横向拼起来。
 * @param {Array<{grid:Array}>} panels
 */
export function compositePanels(panels, cell, gap = 6, bg = [252, 252, 252]) {
  if (!panels.length) return null;
  const h = panels[0].grid.length;
  const w = panels[0].grid[0].length;
  const cols = panels.length;
  const W = cols * w * cell + (cols + 1) * gap;
  const H = h * cell + gap * 2;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }
  panels.forEach((panel, index) => {
    const ox = gap + index * (w * cell + gap);
    for (let y = 0; y < h * cell; y += 1) {
      for (let x = 0; x < w * cell; x += 1) {
        const c = panel.grid[Math.floor(y / cell)]?.[Math.floor(x / cell)];
        const i = ((gap + y) * W + (ox + x)) * 4;
        if (!c) {
          const check = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
          const v = check ? 232 : 246;
          data[i] = v; data[i + 1] = v; data[i + 2] = v;
          continue;
        }
        data[i] = c.rgb[0]; data[i + 1] = c.rgb[1]; data[i + 2] = c.rgb[2];
      }
    }
  });
  return { data, width: W, height: H };
}

/**
 * 把已渲染好的图像纵向堆起来（总览 sheet 用）。
 *
 * 每张图宽度必须一致 —— 不一致时**抛**，不裁剪。裁掉右边意味着
 * 「总览图看起来是对的，但最后一列被切了」，而那种图恰好最难发现。
 */
export function stackImages(images, gap = 10, bg = [250, 250, 250]) {
  const list = images.filter(Boolean);
  if (!list.length) return null;
  const width = list[0].width;
  for (const img of list) {
    if (img.width !== width) throw new Error(`stackImages：宽度不一致（${width} vs ${img.width}）`);
  }
  const height = list.reduce((sum, img) => sum + img.height, 0) + (list.length - 1) * gap;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }
  let oy = 0;
  for (const img of list) {
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const src = (y * img.width + x) * 4;
        const dst = ((oy + y) * width + x) * 4;
        data[dst] = img.data[src]; data[dst + 1] = img.data[src + 1];
        data[dst + 2] = img.data[src + 2]; data[dst + 3] = 255;
      }
    }
    oy += img.height + gap;
  }
  return { data, width, height };
}

/**
 * 按**归一化坐标框**裁出一块子网格（§14 的「局部放大 crop」）。
 *
 * `pad` 是额外的格数边距：§14 要求针对眼睛/高光/回形纹/窗格/金纹
 * 额外输出局部放大。这些特征本身只有 1–2 格，不加边距的话
 * 「放大图里只有一颗豆」，看不出它和周围的关系 —— 而关系才是要看的东西。
 */
export function cropGrid(grid, box, pad = 2) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const [nx0, ny0, nx1, ny1] = box;
  const x0 = Math.max(0, Math.floor(nx0 * w) - pad);
  const x1 = Math.min(w - 1, Math.ceil(nx1 * w) - 1 + pad);
  const y0 = Math.max(0, Math.floor(ny0 * h) - pad);
  const y1 = Math.min(h - 1, Math.ceil(ny1 * h) - 1 + pad);
  const out = [];
  for (let y = y0; y <= y1; y += 1) {
    const row = [];
    for (let x = x0; x <= x1; x += 1) row.push(grid[y]?.[x] ?? null);
    out.push(row);
  }
  return out;
}

/** 两格是否同一颗豆。空豆 vs 空豆算相同，空豆 vs 有色算不同。 */
function sameCell(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.code === b.code;
}

/**
 * 逐格比对两张网格，给出计数。
 *
 * 为什么按 `code` 而不是 `rgb`：同一 RGB 在色板里可能是两条不同色号
 * （拼豆实际拿到的豆子不同），`rgb` 相同不代表输出相同。
 *
 * `changed` 是**两个方向**的合计：`baseOnly`（Standard 有豆、对方没有）
 * 与 `otherOnly`（对方有豆、Standard 没有）都是改变。分开报是为了区分
 * 「换了颜色」和「凭空多/少了一颗豆」—— 后者才是视觉退化。
 */
export function compareGrids(base, other) {
  const h = base.length;
  const w = base[0]?.length ?? 0;
  let changed = 0;
  let baseOnly = 0;
  let otherOnly = 0;
  let filled = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = base[y]?.[x];
      const b = other?.[y]?.[x];
      if (a) filled += 1;
      if (sameCell(a, b)) continue;
      changed += 1;
      if (a && !b) baseOnly += 1;
      else if (!a && b) otherOnly += 1;
    }
  }
  return { changed, baseOnly, otherOnly, filled, total: h * w };
}

/**
 * 差异图：以 `base` 为底，把与 `other` **不同**的格涂成高亮色。
 *
 * §30-4 要求「关键夹具无视觉退化」。这个判断不能靠并排看两张图 ——
 * Auto Tune 改档时常常只动几十格（104×104 里 0.2%），并排看是「一模一样」，
 * 而那几十格恰好可能落在边缘或高光上。涂成高亮之后，
 * 「变了几格、变在哪、是换了色还是多了豆」变成一眼可见的事实。
 */
export function diffGrids(base, other, rgb = [255, 0, 200]) {
  return base.map((row, y) => row.map((cell, x) => (
    sameCell(cell, other?.[y]?.[x]) ? cell : { rgb, code: "__diff__" }
  )));
}
