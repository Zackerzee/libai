/**
 * b4-bench-fixtures.mjs — Stage B4 §4 的固定 benchmark 数据集（A–J 十类）。
 *
 * ── 为什么是「十类」而不是「十张图」──────────────────────────────────
 * §17 要求用肉眼确认这些特征有没有被算法毁掉：
 *   **眼睛 / 回形纹 / 金纹 / 窗格 / 白衣 / 肤色 / 灰白 / 细线**
 * 所以每一类**必须真的含有**它要考察的特征，而且特征是**可定位的**
 * （`probes` 里给出归一化坐标框）。否则「看着还行」就成了一句无法反驳的话。
 *
 * ── 两条硬约束 ─────────────────────────────────────────────────────
 *
 * ① **确定性。** 全部由 `paint(x, y)` 纯函数绘制，无随机、无 DOM、无图片解码。
 *    需要噪声的地方用 `mulberry32(seed)` —— 固定种子，逐位可复现。
 *    同一份定义既喂给 `node --test`，也喂给 `tools/b4-bench.mjs` 和
 *    contact sheet，**保证「测过的图」和「看过的图」是同一张**。
 *
 * ② **逻辑分辨率 64×64，栅格化 ×8 → 512×512 源图。**
 *    1 个逻辑像素 = 8 个源像素；在 104 长边的格网下每格约 4.9 个源像素，
 *    于是一条 1 逻辑像素的线在格网里占 **1–2 格** —— 这正是「细线能不能活下来」
 *    要考察的尺度。逻辑分辨率再小一点，细线就会整条落进一格，测不出东西。
 *
 * ── 不要动这里的坐标 ───────────────────────────────────────────────
 * `probes` 的框和 `paint` 的几何是**同一份事实的两种写法**。改了 `paint`
 * 不改 `probes`，探针就会指着一个已经不存在的位置报「通过」。
 * `tests/b4-bench-baseline.test.mjs` 会钉住本文件的内容哈希。
 */

export const LOGICAL_SIZE = 64;
export const RASTER_SCALE = 8;
export const SOURCE_SIZE = LOGICAL_SIZE * RASTER_SCALE;

/** 固定种子 PRNG。**不要换成 Math.random** —— 那会让基线每次跑都不一样。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgb = (r, g, b) => [Math.round(r), Math.round(g), Math.round(b)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const ring = (x, y, x0, y0, x1, y1) => inBox(x, y, x0, y0, x1, y1) && (x === x0 || x === x1 || y === y0 || y === y1);
const ellipse = (x, y, cx, cy, rx, ry) => {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

/* =========================================================
 * A 人像 —— 肤色 + 眼睛（含高光）+ 头发渐变 + 白衣
 * ======================================================= */
function portrait(x, y) {
  const skin = rgb(238, 200, 172);
  const skinShadow = rgb(204, 162, 134);
  const hairDark = rgb(58, 40, 32);
  const hairLight = rgb(104, 70, 54);
  // 眼睛：4×4 眼白 + 3×2 瞳孔 + 1 格高光。**高光只有 1 逻辑像素** ——
  // 这是最容易被清理抹掉的细节，也是 §17 要盯的第一个点。
  if (x === 26 && y === 31) return rgb(252, 252, 255);
  if (x === 37 && y === 31) return rgb(252, 252, 255);
  if (inBox(x, y, 26, 31, 28, 32) || inBox(x, y, 37, 31, 39, 32)) return rgb(40, 32, 30);
  if (inBox(x, y, 25, 30, 29, 33) || inBox(x, y, 36, 30, 40, 33)) return rgb(248, 246, 244);
  if (inBox(x, y, 29, 45, 35, 45)) return rgb(176, 96, 92);          // 嘴
  if (y >= 53) return rgb(250, 250, 252);                            // 白衣
  const face = ellipse(x, y, 32, 35, 15, 19);
  if (y < 20) return mix(hairDark, hairLight, y / 20);               // 头发渐变
  if (!face) return y < 32 ? mix(hairDark, hairLight, 0.85) : rgb(232, 234, 238);
  return x < 32 ? mix(skinShadow, skin, x / 32) : skin;              // 左暗右亮的肤色
}

/* =========================================================
 * B 动漫 —— 大色块 + 2px 黑描边 + 眼睛高光
 * ======================================================= */
function anime(x, y) {
  const ink = rgb(24, 22, 28);
  const hair = rgb(246, 156, 62);
  const skin = rgb(252, 228, 208);
  const cloth = rgb(78, 132, 214);
  if (x === 23 && y === 34) return rgb(255, 255, 255);               // 眼高光（1 格）
  if (inBox(x, y, 22, 33, 26, 36) || inBox(x, y, 37, 33, 41, 36)) return ink;
  if (y >= 50) {
    if (ring(x, y, 16, 50, 47, 63) || inBox(x, y, 30, 50, 33, 63)) return ink;
    return cloth;
  }
  if (ring(x, y, 12, 8, 51, 29) || (y === 30 && x >= 12 && x <= 51)) return ink;  // 头发描边
  if (inBox(x, y, 13, 9, 50, 29)) return hair;
  if (ring(x, y, 17, 26, 46, 49)) return ink;                        // 脸描边
  if (inBox(x, y, 18, 27, 45, 49)) return skin;
  return rgb(198, 228, 250);
}

/* =========================================================
 * C 插画 —— 大面积平色 + 清晰轮廓（无渐变，考验平色归并）
 * ======================================================= */
function illustration(x, y) {
  const ink = rgb(46, 44, 52);
  if (ellipse(x, y, 48, 14, 9, 9)) return ring(x, y, 39, 5, 57, 23) ? ink : rgb(250, 206, 84);   // 太阳
  if (ring(x, y, 0, 40, 63, 63)) return ink;
  if (y >= 41) return y > 52 ? rgb(96, 152, 92) : rgb(126, 182, 116);                            // 草地
  if (inBox(x, y, 14, 28, 30, 41)) return ring(x, y, 14, 28, 30, 41) ? ink : rgb(238, 232, 216); // 房子
  if (x >= 20 && x <= 24 && y >= 33 && y <= 41) return rgb(150, 92, 66);                          // 门
  if (inBox(x, y, 15, 24, 29, 27)) return ring(x, y, 15, 24, 29, 27) ? ink : rgb(190, 86, 74);   // 屋顶
  return rgb(178, 216, 244);
}

/* =========================================================
 * D 像素画 —— 16 个 4 逻辑像素的硬块，只有 6 色，硬边
 * ======================================================= */
function pixelArt(x, y) {
  const pal = [
    rgb(28, 28, 36), rgb(216, 68, 76), rgb(248, 200, 88),
    rgb(88, 168, 216), rgb(96, 168, 104), rgb(240, 240, 240),
  ];
  const bx = Math.floor(x / 4);
  const by = Math.floor(y / 4);
  // 固定的 16×16 索引图案（写死的图案，不是随机 —— 图案本身要可复现且可辨认）
  const pattern = [
    "0000000000000000", "0111111111111110", "0100000000000010",
    "0102222222222010", "0102000000002010", "0102033333022010",
    "0102030003022010", "0102034543022010", "0102034543022010",
    "0102030003022010", "0102033333022010", "0102000000002010",
    "0102222222222010", "0100000000000010", "0111111111111110",
    "0000000000000000",
  ];
  // ⚠️ 图案里出现的字符决定**实际用色数**，不是 `pal` 的长度。
  // 第一版图案只用到 '0'..'4'，`pal` 有 6 项却只有 5 项被用上 ——
  // 于是「≤ 6 色」这条判据在测一个不存在的颜色。中间两行放了 '5' 才真的是 6 色。
  return pal[Number(pattern[by][bx])];
}

/* =========================================================
 * E Logo —— 纯白底 + 细笔画「文字」+ 圆环（细线 + 高对比）
 * ======================================================= */
function logo(x, y) {
  const ink = rgb(26, 26, 30);
  const brand = rgb(196, 52, 60);
  // 圆环：外径 11，线宽 2 逻辑像素
  const d = Math.hypot(x - 14, y - 32);
  if (d <= 11 && d >= 9.4) return brand;
  if (d <= 6) return brand;
  // 「文字」：4 条 2 像素宽的竖笔画 + 上下横线，模拟粗体字母
  for (let k = 0; k < 4; k += 1) {
    const x0 = 32 + k * 8;
    if (x >= x0 && x <= x0 + 1 && y >= 22 && y <= 42) return ink;
  }
  if (y >= 22 && y <= 23 && x >= 32 && x <= 57) return ink;
  if (y >= 41 && y <= 42 && x >= 32 && x <= 57) return ink;
  return rgb(252, 252, 252);
}

/* =========================================================
 * F 回形纹 —— 金色 1 逻辑像素回形纹 + 深红底（§17 的「回形纹 / 金纹」）
 * ======================================================= */
function greekKey(x, y) {
  const gold = rgb(214, 168, 62);
  const goldLight = rgb(240, 210, 120);
  const base = rgb(138, 32, 34);
  const baseDark = rgb(96, 20, 24);
  // 4 个 32×32 单元，每单元一条回形纹（spiral meander），线宽 1 逻辑像素
  const ux = x % 32;
  const uy = y % 32;
  const cx = Math.min(ux, 31 - ux);
  const cy = Math.min(uy, 31 - uy);
  const ringIndex = Math.floor(Math.min(cx, cy) / 4);
  const onRing = (Math.min(cx, cy) % 4) === 0;
  const onOuter = onRing && ringIndex <= 3;
  const isBorder = x === 0 || y === 0 || x === 63 || y === 63;
  if (isBorder) return gold;
  if (onOuter) return ringIndex % 2 === 0 ? gold : goldLight;
  return (ux + uy) % 8 < 4 ? base : baseDark;
}

/* =========================================================
 * G 窗格 —— 1 逻辑像素深色窗框 + 玻璃渐变（§17 的「窗格」）
 * ======================================================= */
function windowGrid(x, y) {
  const frame = rgb(62, 54, 48);
  if (x === 0 || y === 0 || x === 63 || y === 63) return frame;
  if (x % 16 === 0 || y % 16 === 0) return frame;                    // 1px 窗框
  // 玻璃：上暗下亮的浅蓝渐变，外加斜向高光带
  const glass = mix(rgb(176, 206, 228), rgb(232, 244, 252), y / 63);
  const diag = (x + y) % 32;
  return diag < 3 ? rgb(250, 252, 255) : glass;
}

/* =========================================================
 * H 白衣白底 —— 白衬衫压在白底上，只靠 1px 灰轮廓分开（§17 的「白衣」）
 * ======================================================= */
function whiteShirt(x, y) {
  const bg = rgb(250, 250, 250);
  const shirt = rgb(253, 253, 253);
  const outline = rgb(196, 196, 200);
  const tie = rgb(72, 84, 148);
  if (inBox(x, y, 12, 16, 51, 63)) {
    if (ring(x, y, 12, 16, 51, 63)) return outline;                  // 1px 轮廓：唯一的分离证据
    if (x >= 30 && x <= 33 && y >= 24) return tie;
    if (y >= 16 && y <= 22 && (x <= 20 || x >= 43)) return shirt;
    return shirt;
  }
  return bg;
}

/* =========================================================
 * I 灰白渐变 —— 16 级中性灰阶 + 中性肤色块（§17 的「灰白 / 肤色」）
 * ======================================================= */
function grayRamp(x, y) {
  if (y >= 48 && y <= 62 && x >= 24 && x <= 40) {
    return inBox(x, y, 28, 52, 36, 58) ? rgb(214, 176, 152) : rgb(236, 206, 186);  // 肤色块（带一点明暗）
  }
  const step = Math.min(15, Math.floor(x / 4));
  const v = 255 - step * 17;
  return rgb(v, v, v);
}

/* =========================================================
 * J 照片噪声 —— 固定种子的纹理 + 平滑渐变（考验「哪些噪声该被清理」）
 * ======================================================= */
function photoNoise(x, y) {
  const rnd = mulberry32(0x5eed1234 + y * 131 + x);
  const base = mix(rgb(96, 118, 142), rgb(206, 188, 156), y / 63);
  const wobble = Math.sin(x / 7.5) * 14 + Math.cos(y / 5.5) * 11;
  const noise = (rnd() - 0.5) * 34;
  const spot = ellipse(x, y, 22, 22, 7, 7) ? 46 : 0;
  return rgb(base[0] + wobble + noise + spot, base[1] + wobble + noise + spot * 0.8, base[2] + wobble + noise + spot * 0.6);
}

/* =========================================================
 * 数据集
 * ======================================================= */

/**
 * 每类的 `probes` 是**归一化坐标框**（0–1），与 `paint` 的几何一一对应。
 * `expect` 是给人看的判据；`metric` 说明这一框该量什么。
 */
export const B4_BENCH_CLASSES = [
  {
    id: "A",
    key: "portrait",
    label: "A 人像",
    why: "肤色 + 眼睛（含 1 格高光）+ 头发渐变 + 白衣同时出现，是清理算法最容易过火的场景。",
    paint: portrait,
    probes: [
      { id: "eye-left-highlight", label: "左眼高光", box: [26 / 64, 31 / 64, 27 / 64, 32 / 64], expect: "≈白色（1 逻辑像素）", metric: "亮度" },
      { id: "eye-left", label: "左眼", box: [25 / 64, 30 / 64, 30 / 64, 34 / 64], expect: "有暗色瞳孔，不能整块变成肤色", metric: "暗格数" },
      { id: "skin-cheek", label: "脸颊肤色", box: [30 / 64, 38 / 64, 40 / 64, 44 / 64], expect: "肤色，不能被灰白化", metric: "色相偏移" },
      { id: "hair", label: "头发渐变", box: [22 / 64, 6 / 64, 42 / 64, 14 / 64], expect: "暗棕渐变，不能塌成一块", metric: "色阶数" },
      // 唯一能做「flat」断言的框：逻辑 y≥53 整片都是同一个白（`paint` 里那条
      // `y >= 53` 排在脸之前），所以逻辑网格和 104 格网两侧都是单色。
      // 别的框做不到 —— 逻辑 64 → 格网 104 是 1.625×，任何 1 逻辑像素厚的带子
      // 在格网上都会被劈成两格，混合出过渡色。**这不是夹具的缺陷，是分辨率的
      // 事实**：所以只在真正够厚、够对齐的区域上做 flat 断言。
      { id: "shirt-white", label: "白衣区", box: [4 / 64, 55 / 64, 60 / 64, 63 / 64], flat: true, expect: "白衣是单色白，不能被灰白化或打碎", metric: "色阶数" },
    ],
  },
  {
    id: "B",
    key: "anime",
    label: "B 动漫",
    why: "大平色块 + 2px 黑描边 + 1 格眼高光。描边一断，角色立刻散架。",
    paint: anime,
    probes: [
      { id: "eye-highlight", label: "眼高光", box: [23 / 64, 34 / 64, 24 / 64, 35 / 64], expect: "≈白色（1 逻辑像素）", metric: "亮度" },
      { id: "outline-face", label: "脸部描边", box: [17 / 64, 26 / 64, 47 / 64, 50 / 64], expect: "描边连通、不断线", metric: "暗格占比" },
      { id: "hair", label: "头发平色", box: [16 / 64, 12 / 64, 48 / 64, 26 / 64], expect: "单块橙色，不能碎成多色", metric: "色阶数" },
    ],
  },
  {
    id: "C",
    key: "illustration",
    label: "C 插画",
    why: "大面积平色 + 细轮廓。平色区被无谓打碎会显著增加用色数。",
    paint: illustration,
    probes: [
      { id: "sky", label: "天空平色", box: [4 / 64, 4 / 64, 30 / 64, 18 / 64], expect: "单块平色", metric: "色阶数" },
      { id: "grass", label: "草地", box: [4 / 64, 54 / 64, 60 / 64, 62 / 64], expect: "两层绿，不能塌成一层", metric: "色阶数" },
      { id: "house-outline", label: "房子轮廓", box: [14 / 64, 24 / 64, 31 / 64, 42 / 64], expect: "轮廓连通", metric: "暗格占比" },
    ],
  },
  {
    id: "D",
    key: "pixel",
    label: "D 像素画",
    why: "硬边 + 只有 6 色。任何「平滑」都会立刻毁掉像素感。",
    paint: pixelArt,
    probes: [
      { id: "palette", label: "全图", box: [0, 0, 1, 1], expect: "≤ 6 色（原图只有 6 色）", metric: "用色数" },
      // 顶部黑带（block row 0，整行全黑）。**故意不加 `flat`** ——
      // 逻辑 64 → 格网 104 是 1.625×，1 逻辑像素厚的带子在格网上必然被劈成两格
      // 并混出过渡色。所以这里量的是「算法有没有在黑带里引入抖动」，
      // 靠基线冻结这个数字来守，而不是靠一条做不到的「必须单色」断言。
      { id: "black-band", label: "顶部黑带", box: [8 / 64, 0, 56 / 64, 3 / 64], expect: "黑带内不产生过渡色/抖动", metric: "色阶数" },
    ],
  },
  {
    id: "E",
    key: "logo",
    label: "E Logo",
    why: "纯白底 + 2px 细笔画 + 品牌色圆环。细笔画断了，Logo 就废了。",
    paint: logo,
    probes: [
      { id: "strokes", label: "文字笔画", box: [32 / 64, 22 / 64, 58 / 64, 43 / 64], expect: "4 条竖笔画连通", metric: "暗格占比" },
      { id: "ring", label: "品牌圆环", box: [3 / 64, 21 / 64, 25 / 64, 43 / 64], expect: "圆环闭合，不断弧", metric: "品牌色格数" },
      { id: "background", label: "白底", box: [0, 0, 1, 1], expect: "白底可被识别为背景", metric: "白格占比" },
    ],
  },
  {
    id: "F",
    key: "pattern",
    label: "F 回形纹",
    why: "1 逻辑像素的金色回形纹。§17 点名要看的「回形纹 / 金纹」就是这一类。",
    paint: greekKey,
    probes: [
      { id: "gold", label: "金纹", box: [0, 0, 1, 1], expect: "金色格数不能显著减少（纹样不能被抹平）", metric: "金色格数" },
      { id: "corner", label: "单角回形纹", box: [0, 0, 32 / 64, 32 / 64], expect: "回形纹螺旋可辨", metric: "金色格数" },
    ],
  },
  {
    id: "G",
    key: "window",
    label: "G 窗格",
    why: "1 逻辑像素窗框 + 玻璃渐变。§17 点名要看的「窗格」——框线断一格就不像窗了。",
    paint: windowGrid,
    probes: [
      { id: "frame", label: "窗框", box: [0, 0, 1, 1], expect: "框线连通、不断线", metric: "暗格连通性" },
      { id: "glass", label: "玻璃", box: [2 / 64, 2 / 64, 14 / 64, 14 / 64], expect: "渐变保留，不塌成单色", metric: "色阶数" },
    ],
  },
  {
    id: "H",
    key: "white-shirt",
    label: "H 白衣白底",
    why: "白衬衫压在白底上，只靠 1px 灰轮廓分开。§17 点名要看的「白衣」。",
    paint: whiteShirt,
    probes: [
      { id: "shirt", label: "白衣", box: [14 / 64, 18 / 64, 50 / 64, 62 / 64], expect: "白衣不被当成背景清空", metric: "非空格占比" },
      { id: "tie", label: "领带", box: [29 / 64, 24 / 64, 35 / 64, 62 / 64], expect: "深色领带保留", metric: "暗格数" },
    ],
  },
  {
    id: "I",
    key: "gray-ramp",
    label: "I 灰白渐变",
    why: "16 级中性灰阶。§17 点名要看的「灰白 / 肤色」——中性色最容易被当成背景或被打碎。",
    paint: grayRamp,
    probes: [
      { id: "ramp", label: "灰阶", box: [0, 0, 1, 44 / 64], expect: "灰阶保留，不能塌成两三层", metric: "色阶数" },
      { id: "skin", label: "肤色块", box: [24 / 64, 48 / 64, 41 / 64, 63 / 64], expect: "肤色不被中性化成灰", metric: "色相偏移" },
    ],
  },
  {
    id: "J",
    key: "photo-noise",
    label: "J 照片噪声",
    why: "固定种子的纹理 + 平滑渐变。考验「哪些噪声该被清理、哪些是内容」。",
    paint: photoNoise,
    probes: [
      { id: "subject", label: "主体斑块", box: [15 / 64, 15 / 64, 30 / 64, 30 / 64], expect: "主体斑块保留", metric: "非空格占比" },
      { id: "gradient", label: "背景渐变", box: [48 / 64, 2 / 64, 62 / 64, 20 / 64], expect: "渐变方向保持（上暗下亮）", metric: "明度斜率" },
    ],
  },
];

export const B4_BENCH_BY_KEY = Object.freeze(
  Object.fromEntries(B4_BENCH_CLASSES.map((c) => [c.key, c])),
);

/** 把 paint 展开成逻辑网格（rgbGrid，无 alpha —— 本数据集全部不透明）。 */
export function buildBenchGrid(cls) {
  const rows = [];
  for (let y = 0; y < LOGICAL_SIZE; y += 1) {
    const row = [];
    for (let x = 0; x < LOGICAL_SIZE; x += 1) row.push({ rgb: cls.paint(x, y) });
    rows.push(row);
  }
  return { width: LOGICAL_SIZE, height: LOGICAL_SIZE, rgbGrid: rows };
}

/** 逻辑网格 → 源图 RGBA（最近邻放大，确定性）。 */
export function rasterize(grid, scale = RASTER_SCALE) {
  const W = grid.width * scale;
  const H = grid.height * scale;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    const sy = Math.min(grid.height - 1, Math.floor(y / scale));
    for (let x = 0; x < W; x += 1) {
      const sx = Math.min(grid.width - 1, Math.floor(x / scale));
      const color = grid.rgbGrid[sy][sx].rgb;
      const i = (y * W + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/**
 * 源图 → 源图自己的调色板（去重后的出现色）。
 * 给「原图对照列」用：contact sheet 的左起第一列必须是**原图**，
 * 否则「算法把颜色改坏了」这句话没有参照物。
 */
export function sourcePalette(grid) {
  const seen = new Map();
  for (const row of grid.rgbGrid) {
    for (const cell of row) {
      const [r, g, b] = cell.rgb;
      const code = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      if (!seen.has(code)) seen.set(code, { code, rgb: [r, g, b], group: "src" });
    }
  }
  return [...seen.values()];
}
