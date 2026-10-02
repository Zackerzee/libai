/**
 * background-fixtures.mjs — Stage B2 §13 的 8 类测试数据集（算法层）。
 *
 * 为什么要有这份东西：背景可靠性的结论**必须能被同一组固定输入复现**。
 * 这里用确定性绘制函数生成 10 个夹具（覆盖 §13 的 8 类 + 2 个变体），
 * 每个夹具自带 `expect` —— 测试直接断言 status，而不是「看着差不多」。
 *
 * 全部是纯数据（rgbGrid / alphaGrid / grid），无 DOM、无图片解码，
 * 所以 `node --test` 里可以逐格检查掩码，也能直接喂给 generateV2。
 *
 * 浏览器真机验收（§19）用 `tools/build-background-fixtures.mjs` 把同样的绘制
 * 函数编码成 PNG —— 两侧共用这里的 `paint` 定义，避免「测试过的图」和
 * 「验收的图」不是同一张。
 */

export const OPAQUE = 1;
export const CLEAR = 0;

const WHITE = (v = 250) => ({ r: v, g: v, b: v });
const INK = { r: 34, g: 34, b: 38 };

/** 由 paint(x,y) -> { rgb, alpha } 构造夹具数据。 */
export function buildFixtureData(width, height, paint) {
  const rgbGrid = [];
  const grid = [];
  const alphaGrid = new Uint8Array(width * height).fill(OPAQUE);
  for (let y = 0; y < height; y += 1) {
    const rgbRow = [];
    const gridRow = [];
    for (let x = 0; x < width; x += 1) {
      const spec = paint(x, y) || {};
      const alpha = spec.alpha === CLEAR ? CLEAR : OPAQUE;
      alphaGrid[y * width + x] = alpha;
      const rgb = alpha === OPAQUE && spec.rgb ? spec.rgb : null;
      rgbRow.push(rgb);
      gridRow.push(rgb ? { code: `R${rgb.r}G${rgb.g}B${rgb.b}`, rgb: [rgb.r, rgb.g, rgb.b] } : null);
    }
    rgbGrid.push(rgbRow);
    grid.push(gridRow);
  }
  return { width, height, rgbGrid, alphaGrid, grid };
}

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const onRing = (x, y, x0, y0, x1, y1) => inRect(x, y, x0, y0, x1, y1) && (x === x0 || x === x1 || y === y0 || y === y1);

export const FIXTURE_SIZE = 48;

/* =========================================================
 * 10 个夹具（§13 的 8 类 + 2 个变体）
 * ======================================================= */

export const BACKGROUND_FIXTURES = [
  {
    id: "white-logo",
    className: "1 白底黑色 Logo",
    expect: "reliable",
    why: "边框纯白一致、主体深色、边界对比极大 —— 最标准的可安全分离场景。",
    paint: (x, y) => ({ rgb: inRect(x, y, 16, 16, 31, 31) ? INK : WHITE() }),
  },
  {
    id: "blue-logo-saturated",
    className: "2 蓝底 Logo（饱和）",
    expect: "none",
    why: "默认算法只认「够亮 + 够中性」的浅色背景。饱和蓝不是候选 —— 结论必须是「没有纯色背景可分离」，"
      + "既不能抠掉蓝底，也不能把 Logo 当背景删掉。这是**已知能力边界**，不是缺陷。",
    paint: (x, y) => ({ rgb: inRect(x, y, 16, 16, 31, 31) ? { r: 240, g: 200, b: 40 } : { r: 40, g: 70, b: 190 } }),
  },
  {
    id: "pale-blue-logo",
    className: "2b 浅蓝底 Logo（变体）",
    expect: "reliable",
    why: "浅蓝仍落在「够亮够中性」区间内 —— 应该正常分离。补上「蓝底」这一类里真正能处理的那一半。",
    paint: (x, y) => ({ rgb: inRect(x, y, 16, 16, 31, 31) ? { r: 30, g: 40, b: 60 } : { r: 214, g: 230, b: 246 } }),
  },
  {
    id: "white-shirt-outline",
    className: "3 白底白衣人物（有轮廓）",
    expect: "reliable",
    why: "白衬衫与背景同色，但被深色轮廓完全包住 —— 与背景相邻的只有轮廓，"
      + "所以边界分离度很高、内部同色区也不会被 flood 触及。衬衫必须逐格保留（§9）。",
    paint: (x, y) => {
      if (inRect(x, y, 19, 6, 28, 11)) return { rgb: INK };            // 头
      if (onRing(x, y, 15, 13, 32, 40)) return { rgb: INK };           // 轮廓
      if (inRect(x, y, 16, 14, 31, 39)) return { rgb: WHITE() };       // 白衬衫
      return { rgb: WHITE() };
    },
    probe: (x, y) => inRect(x, y, 16, 14, 31, 39),                      // 必须保留为白豆的格
  },
  {
    id: "white-shirt-faint",
    className: "3b 白底浅灰衣人物（无轮廓）",
    expect: "uncertain",
    why: "主体与背景只差 14 级灰、又没有轮廓 —— 分不开。宁可整幅保持原图，也不能啃掉一块。",
    paint: (x, y) => ({ rgb: inRect(x, y, 15, 10, 32, 40) ? { r: 236, g: 236, b: 236 } : WHITE() }),
  },
  {
    id: "gray-gradient",
    className: "4 浅灰渐变背景",
    expect: "uncertain",
    why: "边框从左到右 255 → 150，主流色覆盖率远低于一致性门槛。渐变**不允许**靠放大容差来硬抠（§12）——"
      + "结论只能是保持原图。",
    paint: (x, y) => {
      if (inRect(x, y, 16, 16, 31, 31)) return { rgb: INK };
      const v = Math.round(255 - (x / (FIXTURE_SIZE - 1)) * 105);
      return { rgb: { r: v, g: v, b: v } };
    },
  },
  {
    id: "close-subject",
    className: "5 主体与背景色接近",
    expect: "uncertain",
    why: "主体 236、背景 250，交界 ΔE 只有个位数 —— 边界糊在一起，无法安全判定主体范围。",
    paint: (x, y) => ({ rgb: inRect(x, y, 15, 10, 32, 40) ? { r: 236, g: 236, b: 236 } : WHITE() }),
  },
  {
    id: "inner-same-color",
    className: "6 主体内部有背景同色区域",
    expect: "reliable",
    probe: (x, y) => inRect(x, y, 21, 21, 26, 26),
    why: "深色主体内部有一块与背景同色的区域。它不与边框连通 → 必须原样保留（§10 的洞）。",
    paint: (x, y) => {
      if (inRect(x, y, 21, 21, 26, 26)) return { rgb: WHITE() };       // 内部同色块
      if (inRect(x, y, 14, 14, 33, 33)) return { rgb: INK };           // 深色主体
      return { rgb: WHITE() };
    },
  },
  {
    id: "transparent-png",
    className: "7 透明 PNG",
    expect: "none",
    why: "绝大多数格是透明的，只有中间一块不透明。透明**不是**背景证据（§11）—— "
      + "既不能因为「大量缺失格」就判成检测到背景，也不能把透明区算进候选数。",
    paint: (x, y) => {
      if (inRect(x, y, 14, 14, 33, 33)) return { rgb: { r: 60, g: 120, b: 90 }, alpha: OPAQUE };
      return { rgb: null, alpha: CLEAR };
    },
  },
  {
    id: "corner-touch",
    className: "8 四角同色但主体接触边缘",
    expect: "reliable",
    why: "深色主体上下贯通，把背景切成左右两块 —— 区域数变 2 但仍然是同一片背景。"
      + "不能因为「区域数 > 1」就一律拒绝。",
    paint: (x, y) => ({ rgb: inRect(x, y, 20, 0, 27, FIXTURE_SIZE - 1) ? INK : WHITE() }),
  },
];

export function getFixture(id) {
  return BACKGROUND_FIXTURES.find((fixture) => fixture.id === id) || null;
}

/** 把夹具实例化。 */
export function materializeFixture(fixture) {
  return { ...fixture, data: buildFixtureData(FIXTURE_SIZE, FIXTURE_SIZE, fixture.paint) };
}

/**
 * 把夹具放大成 ImageData 形状的源图（每格 scale×scale 像素），喂给 generateV2。
 * 放大而不是 1 像素 1 格：采样引擎的 `cellBounds` 在 1:1 时会退化成单像素，
 * 放大后「一格 = 一块同色区域」，采样结果与夹具定义严格一致，断言才有意义。
 */
export function rasterizeSource(fixtureData, scale = 4) {
  const { width, height, rgbGrid } = fixtureData;
  const W = width * scale;
  const H = height * scale;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < W; x += 1) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const rgb = rgbGrid[sy][sx];
      const i = (y * W + x) * 4;
      if (!rgb) { data[i + 3] = 0; continue; }
      data[i] = rgb.r;
      data[i + 1] = rgb.g;
      data[i + 2] = rgb.b;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/** 夹具里出现过的所有颜色 → 一份最小色卡（给 generateV2 用）。 */
export function paletteOf(fixtureData) {
  const seen = new Map();
  for (const row of fixtureData.rgbGrid) {
    for (const rgb of row) {
      if (!rgb) continue;
      const code = `R${rgb.r}G${rgb.g}B${rgb.b}`;
      if (!seen.has(code)) seen.set(code, { code, rgb: [rgb.r, rgb.g, rgb.b] });
    }
  }
  return [...seen.values()];
}
