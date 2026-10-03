/**
 * noisy-photo-fixtures.mjs — Stage B4 §12 「真实噪声 / 照片型 benchmark」（K–P 六类）。
 *
 * ── 为什么必须有这一组，而不是扩充 A–J ──────────────────────────────────
 * §12.1 审计拿到一条硬结论：**A–J 的源图是「最近邻 ×8 放大产物」**。
 * `b4-bench-fixtures.mjs` 先在 64×64 逻辑网格上求值 `paint()`，再 `rasterize()`
 * 做 8 倍最近邻放大 —— 实测每个 8×8 块的**内部相邻像素变化率恒为 0.0000**
 * （逐位相同）。也就是说 A–J 十类**全部携带像素画放大痕迹**，
 * 包括本不该有的 A 人像、C 插画、E Logo。
 *
 * 后果：任何以「块结构 / 最近邻放大痕迹」为证据的检测器，在 A–J 上都会
 * **对十类全体误报**。拿 A–J 去调 §12.2 的像素检测器，等于拿一张
 * 「全是像素画」的数据集去证明检测器好用。
 *
 * 所以 K–P **不做逻辑网格 + 放大**，而是**逐像素直接求值**（512×512），
 * 与 `real-failures.mjs` 的照片级夹具同一纪律。
 *
 * ── 六类各自要打掉什么错误直觉 ────────────────────────────────────────
 *   K 真实人像照片   皮肤是二维渐变 + 头发有丝状高频 —— 「平坦」不等于「像素画」
 *   L 宠物毛发       全画面高频方向性纹理 —— 「低饱和 + 高频」不等于「噪声」
 *   M 室内弱光       低明度 + 强噪声 + 暖色偏 —— 噪声幅度随明度变化
 *   N 建筑照片       规则窗格阵列（**8 像素级规则网格**）—— 规则网格不等于像素画
 *   O 压缩 JPEG      **真的有 8×8 块结构**，但块内变化率 > 0 —— 专门证伪
 *                    「检测到 8×8 网格就判像素画」这条捷径
 *   P 柔和渐变插画   平滑渐变 + 平色块 + 柔边、零噪声 —— 「像照片」不等于「是照片」
 *
 * O 与 A–J 构成一对**可裁决的对照**：
 *   A–J 块内变化率 == 0（最近邻放大），O 块内变化率 > 0（DCT 量化）。
 *   `tests/noisy-photo-fixtures.test.mjs` 把这条差异钉死。
 *   一个只能看「有没有 8×8 网格」的检测器无法区分二者 —— 那是它的问题，不是数据的。
 *
 * ── 纪律 ──────────────────────────────────────────────────────────────
 * ① **A–J 不得替换、不得修改。** 本文件只新增，`b4-bench-fixtures.mjs` 一行不动。
 * ② 全部由纯函数 `paint(x, y)` 绘制，噪声用**逐像素定值哈希**（不是顺序 RNG），
 *    因此同一张图既可在 Node 侧复现，也不依赖遍历顺序。
 * ③ 逻辑分辨率 = 源分辨率 = 512×512，**没有放大步骤**。
 * ④ 本组**不是**「真实照片」。仓库里没有可再分发的真实照片，全部是程序生成的
 *    照片级模拟。替换为真实 PNG 时保留 `id` 与 `expect` 即可。
 */

export const PHOTO_SOURCE_SIZE = 512;

/* =========================================================
 * 确定性基元
 * ======================================================= */

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/**
 * **必须夹紧到 [0,1]。** 不夹紧的 `t*t*(3-2t)` 在 t>1 时会掉头向下、
 * t=1.5 时回到 0、t>1.5 变负 —— 表现为「渐变画到一半突然翻回起点色」。
 * N 类天空首版就踩了这个：y>0.63S 处天空重新变回顶部的深蓝，画出一条假暗带。
 * 名字叫 smoothstep 却不在 [0,1] 外夹紧，是个陷阱；夹紧写在这里而不是每个调用点。
 */
const smoothstep = (t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** 整数哈希 → [0,1)。用于值噪声与控制流，**不是**逐像素抖动。 */
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 双线性插值值噪声，输出 [0,1)。 */
function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** 分形叠加噪声（fBm），输出约 [0,1)。 */
function fbm(x, y, seed, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, freq = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * 逐像素定值颗粒，输出 [-1,1)。
 * **逐像素定值**而不是顺序 RNG：`paint(x,y)` 必须是 (x,y) 的纯函数，
 * 否则探针的期望值会随遍历顺序漂移。
 */
function grain(x, y, seed) {
  const h = hash2(x, y, seed) * 2 - 1;
  const h2 = hash2(x + 7919, y + 104729, seed) * 2 - 1;
  return h * 0.75 + h2 * 0.25;
}

/** 圆盘覆盖度，带 1px 抗锯齿（软边，不是硬台阶）。 */
function disk(x, y, cx, cy, rx, ry = rx) {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  const px = 1 / Math.max(rx, ry);
  return 1 - smoothstep(Math.min(1, Math.max(0, (d - 1 + px) / (2 * px))));
}

/** 沿给定方向做 3 抽头模糊（近似景深/失焦），确定性、可分离。 */
function blur3(v0, v1, v2, w = 0.25) {
  return v0 * w + v1 * (1 - 2 * w) + v2 * w;
}

/* =========================================================
 * K 真实人像照片
 * ======================================================= */

function photoPortrait(x, y, S) {
  const skin = [232, 190, 164];
  const skinShadow = [168, 122, 100];
  const skinWarm = [238, 168, 146];
  const hair = [46, 34, 30];
  const hairLit = [122, 88, 66];
  const cloth = [58, 66, 84];
  const bgA = [92, 104, 96];
  const bgB = [150, 158, 140];

  const cx = S * 0.5;
  const headCy = S * 0.42;
  const headRx = S * 0.155;
  const headRy = S * 0.205;

  // 背景：大尺度失焦色斑（低频 fBm），模拟浅景深
  const bgT = fbm(x * 0.006, y * 0.006, 11, 3);
  let c = mixRgb(bgA, bgB, bgT);

  // 主体轮廓：头 + 颈 + 肩
  const head = disk(x, y, cx, headCy, headRx, headRy);
  const neck = inBox(x, y, cx - S * 0.058, headCy + headRy * 0.6, cx + S * 0.058, S * 0.63) ? 1 : 0;
  const shoulders = y > S * 0.63 && disk(x, y, cx, S * 0.98, S * 0.42, S * 0.30);

  // 光照：左上方主光 → 二维明暗（不是一维渐变）
  const nx = (x - cx) / headRx, ny = (y - headCy) / headRy;
  const lambert = Math.max(0, 1 - Math.sqrt(nx * nx * 0.65 + ny * ny * 0.35));
  const skinT = 0.30 + 0.62 * lambert;
  const cheek = disk(x, y, cx - headRx * 0.52, headCy + headRy * 0.30, headRx * 0.42);
  const skinPixel = mixRgb(mixRgb(skinShadow, skin, skinT), skinWarm, cheek * 0.42);

  // 头发：暗块 + 沿发流的丝状高频 + 高光带
  const hairFlow = Math.sin((x - cx) * 0.34 + fbm(x * 0.02, y * 0.02, 23, 2) * 7.0);
  const strand = (hairFlow * 0.5 + 0.5) * 0.5 + fbm(x * 0.12, y * 0.05, 29, 3) * 0.5;
  const sheen = Math.max(0, 1 - Math.abs(nx + 0.35) * 2.6) * Math.max(0, 1 - Math.abs(ny + 0.55) * 1.7);
  const hairPixel = mixRgb(hair, hairLit, strand * 0.34 + sheen * 0.62);

  // ⚠️ **顺序是语义**：必须先铺皮肤、再盖头发。
  // 首版把头发写在前面，被 `if (head > 0.5) c = mixRgb(c, skinPixel, head)` 整片覆盖，
  // 渲染出来是一颗光头 —— 而当时所有数值指标（块结构、明度、色度）全部「正常」。
  // 是看图才发现的。改这一块时请同时看图，不要只跑指标。
  if (head > 0.5) c = mixRgb(c, skinPixel, head);
  if (neck > 0.5) c = mixRgb(c, mixRgb(skinShadow, skin, skinT * 0.7), neck * 0.95);
  // 头发体积：比头略大的椭圆 + 发际线以上整片
  const hairVolume = disk(x, y, cx, headCy - headRy * 0.10, headRx * 1.14, headRy * 1.09);
  const hairLine = headCy + headRy * 0.10;
  const crownT = smoothstep((hairLine - y) / (headRy * 0.34));
  const rimT = Math.max(0, hairVolume - head) * 2.0;
  const hairMask = Math.min(1, Math.max(crownT, rimT) * hairVolume * 1.35);
  if (hairMask > 0.01) c = mixRgb(c, hairPixel, hairMask);

  // 眼睛：杏仁形 + 眼白细缝 + 1 处镜面高光（**必须活下来**）
  const eyeY = headCy - headRy * 0.06;
  const eyeDx = headRx * 0.44;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeDx;
    const lid = disk(x, y, ex, eyeY, headRx * 0.20, headRy * 0.085);
    if (lid > 0.5) {
      c = mixRgb(c, [248, 244, 240], 0.9);                       // 眼白
      const iris = disk(x, y, ex, eyeY, headRx * 0.115);
      if (iris > 0.45) c = mixRgb(c, [64, 76, 66], 0.92);        // 虹膜
      const pupil = disk(x, y, ex, eyeY, headRx * 0.055);
      if (pupil > 0.45) c = mixRgb(c, [20, 18, 20], 0.95);       // 瞳孔
      const spec = disk(x, y, ex - headRx * 0.055, eyeY - headRy * 0.028, headRx * 0.030);
      if (spec > 0.35) c = mixRgb(c, [255, 253, 248], spec);     // 镜面高光
    }
  }

  // 嘴唇
  const lips = disk(x, y, cx, headCy + headRy * 0.62, headRx * 0.36, headRy * 0.075);
  if (lips > 0.4) c = mixRgb(c, [178, 96, 96], lips * 0.8);

  // 肩部衣物
  if (shoulders > 0.5 && y > S * 0.66) c = mixRgb(c, cloth, Math.min(1, shoulders) * 0.94);

  // 暗角 + 颗粒（照片级）
  const vx = (x / S - 0.5) * 2, vy = (y / S - 0.5) * 2;
  const vign = 1 - 0.30 * Math.min(1, vx * vx + vy * vy);
  c = [c[0] * vign, c[1] * vign, c[2] * vign];
  const g = grain(x, y, 41) * 5.5;
  return [clamp255(c[0] + g), clamp255(c[1] + g * 0.92), clamp255(c[2] + g * 1.05)];
}

/* =========================================================
 * L 宠物毛发
 * ======================================================= */

function petFur(x, y, S) {
  const furLight = [222, 200, 170];
  const furDark = [124, 94, 66];
  const furCream = [242, 232, 210];
  const noseC = [58, 44, 46];

  // 毛流方向场：以头部为中心向外辐射（真实宠物毛的走向），再叠一点扰动
  // ⚠️ 这一块试错了两版，教训值得留着：
  //   ① 用「平滑旋转场 + sin(相位)」→ 长等值线，画出来是**木纹 / 大理石纹**。
  //   ② 用「辐射场 + sin(相位)」→ 仍出环状纹，因为 sin 的等相位线在极坐标下是圆。
  //   根因不是方向，是**拿 sin 当纹理**：周期函数在低频方向场下必然画出等值线。
  //   正解是**各向异性值噪声** —— 沿毛流低频、横跨毛流高频，把噪声拉成细长条纹。
  //   这才是毛发的画法，也是唯一不依赖「相位场是否恰好合适」的写法。
  const dxc = x - S * 0.50, dyc = y - S * 0.45;
  const theta = Math.atan2(dyc, dxc) + (fbm(x * 0.010, y * 0.010, 71, 2) - 0.5) * 1.5;
  const ca = Math.cos(theta), sa = Math.sin(theta);
  const along = x * ca + y * sa;          // 沿毛流坐标
  const across = -x * sa + y * ca;        // 横跨毛流坐标

  // 各向异性：沿毛流 0.030（低频 → 长），横跨 1.05（高频 → 细）
  const sU = along * 0.030;
  const sV = across * 1.05;
  const fine = valueNoise(sU, sV, 113);
  const finer = valueNoise(sU * 2.4 + 31.7, sV * 2.2, 127);
  const strandBody = fine * 0.66 + finer * 0.34;

  // 每根毛的固有明暗：按「第几根」跳变，沿毛流缓慢变化
  const strandIdx = Math.floor(sV);
  const strandTone = hash2(strandIdx, Math.floor(sU * 0.35), 89) * 0.60
    + valueNoise(sU * 0.20, sV * 0.06, 131) * 0.40;
  // 单根毛会断：沿毛流方向有缺口
  const gap = hash2(strandIdx, Math.floor(sU * 0.55), 97);
  const furT = strandBody * 0.42 + strandTone * 0.46 + (gap < 0.14 ? -0.28 : 0);

  // 双色斑块（奶油底 + 深棕斑），边界不规则
  const patch = fbm(x * 0.0075, y * 0.0075, 97, 4);
  const patchEdge = smoothstep((patch - 0.44) / 0.10);
  let c = mixRgb(mixRgb(furDark, furLight, furT), furCream, patchEdge * 0.80);

  // 头部：比背景更亮、毛更短（保留纹理，不要糊成绒布）
  const headMask = disk(x, y, S * 0.50, S * 0.45, S * 0.30, S * 0.31);
  if (headMask > 0.35) {
    const headFur = mixRgb(mixRgb(furDark, furLight, furT * 0.80 + 0.14), furCream, patchEdge * 0.6);
    c = mixRgb(c, headFur, Math.min(1, headMask) * 0.92);
  }
  // 口鼻部：更亮的短毛区
  const muzzle = disk(x, y, S * 0.50, S * 0.565, S * 0.135, S * 0.095);
  if (muzzle > 0.35) {
    const muzzleFur = mixRgb(furCream, furLight, furT * 0.55);
    c = mixRgb(c, muzzleFur, Math.min(1, muzzle) * 0.88);
  }

  // 头顶高光（毛发的镜面反射）
  const rim = Math.max(0, 1 - Math.abs((x - S * 0.42) / (S * 0.22)));
  c = mixRgb(c, [248, 242, 228], rim * 0.22 * (strandBody * 0.6 + 0.4));

  // 眼睛：小、黑、亮（低对比下的关键结构）
  const eyeY = S * 0.385;
  for (const ex of [S * 0.395, S * 0.605]) {
    const socket = disk(x, y, ex, eyeY, S * 0.052, S * 0.055);
    if (socket > 0.4) c = mixRgb(c, mixRgb(furDark, [70, 60, 52], 0.5), socket * 0.55); // 眼窝阴影
    const eye = disk(x, y, ex, eyeY, S * 0.038, S * 0.044);
    if (eye > 0.4) c = mixRgb(c, [28, 24, 26], eye * 0.96);
    const spec = disk(x, y, ex - S * 0.011, eyeY - S * 0.014, S * 0.011);
    if (spec > 0.3) c = mixRgb(c, [252, 250, 244], spec * 0.94);
  }

  // 鼻子：暗色 + 湿高光
  const nose = disk(x, y, S * 0.50, S * 0.545, S * 0.050, S * 0.038);
  if (nose > 0.4) c = mixRgb(c, noseC, nose * 0.92);
  const wet = disk(x, y, S * 0.487, S * 0.532, S * 0.016, S * 0.010);
  if (wet > 0.3) c = mixRgb(c, [224, 222, 216], wet * 0.6);

  // 景深：四周逐渐失焦
  const r = Math.hypot(x / S - 0.5, y / S - 0.5) * 2;
  const defocus = smoothstep((r - 0.52) / 0.48);
  if (defocus > 0) {
    const soft = mixRgb(furDark, furLight, fbm(x * 0.02, y * 0.02, 103, 2));
    c = mixRgb(c, soft, defocus * 0.88);
  }

  const g = grain(x, y, 109) * 4.0;
  return [clamp255(c[0] + g), clamp255(c[1] + g), clamp255(c[2] + g * 0.9)];
}

/* =========================================================
 * M 室内弱光
 * ======================================================= */

function indoorLowLight(x, y, S) {
  const wallDark = [38, 32, 30];
  const wallLit = [104, 86, 68];
  const floorC = [52, 40, 34];
  const tungsten = [1.0, 0.80, 0.58];   // 暖色偏（乘性）

  // 画面：左上一盏灯，右下深处。灯附近亮，远处暗。
  const lampX = S * 0.24, lampY = S * 0.20;
  const dist = Math.hypot(x - lampX, y - lampY) / (S * 0.85);
  const falloff = Math.max(0, 1 - dist) ** 1.6;

  const wallT = fbm(x * 0.008, y * 0.008, 131, 3);
  let c = mixRgb(wallDark, wallLit, falloff * 0.85 + wallT * 0.15);

  // 地面（下方 1/4），反射更弱
  if (y > S * 0.76) {
    const ft = smoothstep((y - S * 0.76) / (S * 0.24));
    c = mixRgb(c, mixRgb(floorC, wallLit, falloff * 0.35), ft * 0.9);
  }

  // 一块**中性灰**物体（灰椅背）——中性区最容易被「中性化」误伤，必须留下
  const chair = disk(x, y, S * 0.68, S * 0.60, S * 0.16, S * 0.20);
  if (chair > 0.4) {
    const grey = 96 + falloff * 26;
    c = mixRgb(c, [grey, grey, grey * 0.98], chair * 0.9);
  }

  // 窗户/灯罩：过曝区（接近 255，考验高光保护）
  const windowBox = inBox(x, y, S * 0.72, S * 0.08, S * 0.96, S * 0.40) ? 1 : 0;
  if (windowBox) {
    const wf = fbm(x * 0.05, y * 0.05, 137, 2);
    c = mixRgb(c, [246, 240, 224], 0.72 + wf * 0.26);
    if (inBox(x, y, S * 0.835, S * 0.08, S * 0.845, S * 0.40)) c = mixRgb(c, [70, 62, 54], 0.8); // 窗框
  }

  // 暖色偏
  c = [c[0] * tungsten[0], c[1] * tungsten[1], c[2] * tungsten[2]];

  // 传感器噪声：**幅度随明度下降而增大**（真实相机行为，不是恒定噪声）
  const lum = (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 255;
  const amp = 3.0 + (1 - lum) * 14.0;
  const g = grain(x, y, 149) * amp;
  const gc = grain(x, y, 151) * amp * 0.6; // 色度噪声略小
  return [clamp255(c[0] + g + gc), clamp255(c[1] + g), clamp255(c[2] + g - gc)];
}

/* =========================================================
 * N 建筑照片（含**规则窗格阵列** —— 对抗性结构）
 * ======================================================= */

function architecturePhoto(x, y, S) {
  const skyTop = [58, 104, 168];
  const skyBottom = [176, 204, 226];
  const wallLit = [206, 190, 168];
  const wallShade = [118, 106, 96];
  const mullion = [58, 56, 54];
  const glassDark = [64, 78, 92];
  const glassLit = [186, 206, 220];

  const t = y / S;
  let c = mixRgb(skyTop, skyBottom, smoothstep(t / 0.42));
  const cloud = fbm(x * 0.005, y * 0.010, 173, 4);
  if (t < 0.42) c = mixRgb(c, [238, 240, 240], Math.max(0, cloud - 0.52) * 1.5);

  // 建筑立面：一个略带透视的四边形（上边窄、下边宽）
  const topY = S * 0.30, bottomY = S * 1.02;
  const tt = Math.min(1, Math.max(0, (y - topY) / (bottomY - topY)));
  const leftX = lerp(S * 0.30, S * 0.16, tt);
  const rightX = lerp(S * 0.74, S * 0.92, tt);
  if (y >= topY && x >= leftX && x <= rightX) {
    // 墙面：日光/阴影分界（斜向明暗终止线）
    const terminator = (x - leftX) / (rightX - leftX) + (y - topY) / (bottomY - topY) * 0.55;
    const lit = smoothstep(Math.min(1, Math.max(0, (terminator - 0.42) / 0.16)));
    const stucco = fbm(x * 0.06, y * 0.06, 181, 3);
    c = mixRgb(mixRgb(wallShade, wallLit, lit), [255, 250, 240], stucco * 0.10);

    // 窗格阵列：4 行 × 3 列，**严格 8 像素级规则网格**（这正是要证伪的「规则网格 = 像素画」）
    const cols = 3, rows = 4;
    const uw = (rightX - leftX) / cols;
    const uh = (bottomY - topY) / rows;
    const ux = (x - leftX) / uw, uy = (y - topY) / uh;
    const inCell = ux >= 0 && ux < cols && uy >= 0 && uy < rows;
    if (inCell) {
      const fx = ux - Math.floor(ux), fy = uy - Math.floor(uy);
      const mullionW = 3.0 / uw, mullionH = 3.0 / uh;
      const onMullion = fx < mullionW || fx > 1 - mullionW || fy < mullionH || fy > 1 - mullionH;
      if (onMullion) c = mixRgb(c, mullion, 0.92);
      else {
        const glassT = smoothstep(Math.min(1, Math.max(0, (fx - 0.15) / 0.7))) * 0.6
          + (1 - smoothstep(Math.min(1, Math.max(0, (fy - 0.1) / 0.8)))) * 0.4;
        c = mixRgb(c, mixRgb(glassDark, glassLit, glassT), 0.90);
      }
    }
    // 楼层横带（阳台栏杆）
    if (Math.abs(uy - 2.0) < 0.06) c = mixRgb(c, [96, 90, 84], 0.55);
  }

  // 前景：一条暗色窗台/屋檐，压住画面下缘
  if (y > S * 0.955) c = mixRgb(c, [44, 40, 38], 0.9);

  const vx = (x / S - 0.5) * 2, vy = (y / S - 0.5) * 2;
  const vign = 1 - 0.22 * Math.min(1, vx * vx + vy * vy);
  c = [c[0] * vign, c[1] * vign, c[2] * vign];
  const g = grain(x, y, 191) * 3.6;
  return [clamp255(c[0] + g), clamp255(c[1] + g * 0.95), clamp255(c[2] + g * 1.1)];
}

/* =========================================================
 * O 压缩 JPEG / 轻噪声
 *
 * 关键：**真的有 8×8 块结构**，但块内变化率 > 0。
 * 这是与 A–J（块内变化率 == 0）成对的可裁决对照。
 * ======================================================= */

/** 先画一张「未压缩」的柔和场景，再施加 JPEG 类退化。 */
function jpegBaseScene(x, y, S) {
  const sky = mixRgb([92, 130, 176], [206, 220, 232], smoothstep(y / (S * 0.5)));
  const ground = mixRgb([78, 106, 62], [128, 152, 92], fbm(x * 0.01, y * 0.01, 211, 3));
  let c = y < S * 0.52 ? sky : ground;

  // 一棵树（暗块 + 细枝）
  const canopy = disk(x, y, S * 0.34, S * 0.40, S * 0.15, S * 0.13);
  if (canopy > 0.35) c = mixRgb(c, [56, 84, 52], Math.min(1, canopy) * 0.9);
  const trunk = inBox(x, y, S * 0.325, S * 0.50, S * 0.355, S * 0.68);
  if (trunk) c = mixRgb(c, [82, 62, 46], 0.9);
  for (let k = 0; k < 5; k += 1) {
    const by = S * (0.44 + k * 0.045);
    if (Math.abs(y - by) < 1.2 && x > S * 0.30 && x < S * 0.50) c = mixRgb(c, [70, 58, 44], 0.8);
  }

  // 一个浅色主体（会形成强边缘 → 压缩振铃）
  const subj = disk(x, y, S * 0.72, S * 0.62, S * 0.11, S * 0.15);
  if (subj > 0.4) c = mixRgb(c, [228, 216, 196], Math.min(1, subj) * 0.92);
  const subjShadow = disk(x, y, S * 0.66, S * 0.74, S * 0.07, S * 0.06);
  if (subjShadow > 0.4) c = mixRgb(c, [176, 158, 138], 0.6);

  // 一条细亮边（振铃最容易出现的结构）
  if (Math.abs(x - S * 0.72) < 1.5 && y > S * 0.45 && y < S * 0.80) c = mixRgb(c, [246, 244, 236], 0.85);

  const g = grain(x, y, 223) * 2.4;
  return [clamp255(c[0] + g), clamp255(c[1] + g), clamp255(c[2] + g)];
}

/**
 * JPEG 类退化（无真实编解码器，用等效退化组合）：
 *   ① 4:2:0 色度子采样近似 —— 色度通道 2×2 平均
 *   ② 8×8 块内 DCT 量化近似 —— 残差按量化步长取整
 *   ③ 强边缘振铃 —— 3 抽头过冲
 *   ④ 轻微色彩漂移
 */
function applyJpegArtifacts(x, y, S) {
  const at = (px, py) => jpegBaseScene(
    Math.min(S - 1, Math.max(0, px)),
    Math.min(S - 1, Math.max(0, py)),
    S,
  );

  // ① 色度 2×2 子采样
  const bx = Math.floor(x / 2) * 2, by = Math.floor(y / 2) * 2;
  // ⚠️ 累加器必须是**定长 3 元**数组。
  // 首版写成 `[[0,0],[0,0],[0,0]]` 然后 `acc[0][2] += x` —— 索引 2 在 `[0,0]` 上不存在，
  // `undefined + x` 得到 NaN，`cb[2]` 变成 NaN，蓝通道恒为 0：
  // `clamp255(NaN)` 里 `NaN < 0` 和 `NaN > 255` 都是 false，最后 `NaN | 0` **返回 0**。
  // 结果整张图变酸绿，而所有数值指标都「正常」。用定长数组，让这类错误直接 NaN 到脸上。
  const chromaSum = [0, 0, 0];
  for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const p = at(bx + ox, by + oy);
    const lum = p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
    chromaSum[0] += p[0] - lum;
    chromaSum[1] += p[1] - lum;
    chromaSum[2] += p[2] - lum;
  }
  const cb = [chromaSum[0] / 4, chromaSum[1] / 4, chromaSum[2] / 4];

  const p0 = at(x, y);
  const luma = p0[0] * 0.2126 + p0[1] * 0.7152 + p0[2] * 0.0722;

  // ② 8×8 块内残差量化：块均值保留，残差按步长取整
  const inX = x % 8, inY = y % 8;
  let blockMean = 0;
  for (const [ox, oy] of [[0, 0], [3, 3], [5, 2], [1, 6]]) {
    const p = at((x - inX) + ox, (y - inY) + oy);
    blockMean += p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
  }
  blockMean /= 4;
  const step = 5.5;                       // 量化步长：粗到会产生可见块，但**不抹平**
  const residual = luma - blockMean;
  const quantised = Math.round(residual / step) * step;
  const lumaOut = blockMean + quantised;

  // ③ 强边缘振铃：在块边界附近引入过冲
  const edgeProbe = Math.abs(at(x + 3, y)[0] - at(x - 3, y)[0])
    + Math.abs(at(x, y + 3)[0] - at(x, y - 3)[0]);
  const ring = edgeProbe > 70
    ? ((inX === 0 || inX === 7 || inY === 0 || inY === 7) ? 9 : -3.5)
    : 0;

  // ④ 色彩漂移
  const out = [
    lumaOut + cb[0] + ring + 2.0,
    lumaOut + cb[1] + ring + 0.5,
    lumaOut + cb[2] + ring - 1.5,
  ];
  return [clamp255(out[0]), clamp255(out[1]), clamp255(out[2])];
}

/* =========================================================
 * P 柔和渐变插画（「像照片」但不是照片）
 * ======================================================= */

function softGradientIllustration(x, y, S) {
  const skyTop = [64, 92, 158];
  const skyMid = [198, 156, 178];
  const skyLow = [248, 208, 158];
  const hillFar = [126, 138, 166];
  const hillNear = [58, 72, 104];
  const sun = [255, 236, 196];

  // 天空：两段平滑渐变（二维，带一点横向偏移）
  const t = y / S;
  const lateral = fbm(x * 0.0035, y * 0.0035, 251, 2) * 0.16;
  let c;
  if (t < 0.55) c = mixRgb(skyTop, skyMid, smoothstep((t + lateral * 0.3) / 0.55));
  else c = mixRgb(skyMid, skyLow, smoothstep((t - 0.55 + lateral * 0.2) / 0.45));

  // 太阳：柔和光晕（无硬边）
  const dSun = Math.hypot(x - S * 0.68, y - S * 0.44) / (S * 0.20);
  const glow = Math.max(0, 1 - dSun) ** 2.2;
  c = mixRgb(c, sun, glow * 0.85);
  if (dSun < 0.22) c = mixRgb(c, [255, 250, 232], 0.9);

  // 远山（柔边，不是描边）
  const farTop = S * 0.62 + Math.sin(x * 0.008) * S * 0.05 + fbm(x * 0.01, 0, 263, 2) * S * 0.035;
  if (y > farTop) {
    const edge = smoothstep(Math.min(1, Math.max(0, (y - farTop) / (S * 0.045))));
    c = mixRgb(c, hillFar, edge * 0.92);
  }
  // 近山（更暗，柔边）
  const nearTop = S * 0.78 + Math.sin(x * 0.006 + 1.7) * S * 0.045;
  if (y > nearTop) {
    const edge = smoothstep(Math.min(1, Math.max(0, (y - nearTop) / (S * 0.035))));
    c = mixRgb(c, hillNear, edge * 0.95);
  }

  // 水面倒影带：横向平滑条纹（严格平滑，零噪声）
  if (y > S * 0.90) {
    const band = Math.sin((y - S * 0.90) * 0.28) * 0.5 + 0.5;
    c = mixRgb(c, mixRgb(hillNear, skyLow, band * 0.55), 0.75);
  }

  // 极轻的暗角；**不加颗粒** —— 「零噪声」是这一类的定义特征
  const vx = (x / S - 0.5) * 2, vy = (y / S - 0.5) * 2;
  const vign = 1 - 0.10 * Math.min(1, vx * vx + vy * vy);
  return [clamp255(c[0] * vign), clamp255(c[1] * vign), clamp255(c[2] * vign)];
}

/* =========================================================
 * Q 真实像素画
 *
 * ── 为什么必须有这一张，而 D 不能替代 ────────────────────────────────
 * §12 的路由判据要求「真实 pixel fixture → pixel」。A–J 里的 D 看起来是
 * 现成的答案，但它**不能**用：`b4-bench-fixtures.mjs` 是 64 逻辑 → 512 源的
 * 最近邻 ×8 放大，所以 D 的每个 8×8 块内部逐位恒等 —— 它和 A/B/C/E/H
 * 在「是不是放大产物」这件事上**没有任何区别**。拿 D 当像素画正样本，
 * 等于承认「所有 A–J 都是像素画」，而那正是 §12.1 要修的反向信号。
 *
 * 本类在**原生分辨率**下绘制：1 逻辑像素 = 4 源像素，硬边、无抗锯齿、无颗粒。
 * 于是它既是 `magnificationTrace` 的正样本（b=4 时块内恒等），
 * 又能与「照片被放大」区分开 —— 后者块内是渐变，本类块内是恒色。
 * ======================================================= */

const PIXEL_PALETTE = [
  [22, 24, 34], [72, 58, 96], [148, 92, 168], [236, 132, 172],
  [252, 214, 176], [248, 248, 248], [72, 152, 216], [252, 196, 72],
];

/** 128×128 逻辑图案，索引到 PIXEL_PALETTE。写死的图案，不是随机。 */
function pixelPattern(lx, ly) {
  const cx = 64, cy = 66;
  const dx = lx - cx, dy = ly - cy;
  const body = Math.hypot(dx, dy * 0.92) <= 44;                 // 身体
  const head = Math.hypot(dx, (ly - 40) * 1.05) <= 34;          // 头
  const earL = Math.hypot(lx - 38, ly - 22) <= 13;
  const earR = Math.hypot(lx - 90, ly - 22) <= 13;
  const belly = Math.hypot(dx, (ly - 84) * 1.2) <= 24;
  const eyeL = Math.hypot(lx - 52, ly - 42) <= 7;
  const eyeR = Math.hypot(lx - 76, ly - 42) <= 7;
  const pupilL = Math.hypot(lx - 53, ly - 43) <= 3.4;
  const pupilR = Math.hypot(lx - 77, ly - 43) <= 3.4;
  const muzzle = Math.hypot(dx, ly - 58) <= 15;
  const nose = Math.hypot(dx, ly - 54) <= 5;
  const stripe = inBox(lx, ly, 30, 96, 98, 103);
  const bootL = inBox(lx, ly, 40, 104, 56, 118);
  const bootR = inBox(lx, ly, 72, 104, 88, 118);

  if (bootL || bootR) return 1;
  if (eyeL || eyeR) {
    if (pupilL || pupilR) return 0;
    return 5;
  }
  if (nose) return 0;
  if (muzzle) return 4;
  if (stripe) return 7;
  if (belly) return 4;
  if (head || earL || earR) return 2;
  if (body) return 1;
  return 6;                                                     // 背景
}

function pixelArtNative(x, y, S) {
  const logical = Math.floor(x / 4);
  const lx = Math.min(127, logical);
  const ly = Math.min(127, Math.floor(y / 4));
  const c = PIXEL_PALETTE[pixelPattern(lx, ly)];
  return [c[0], c[1], c[2]];
}

/* =========================================================
 * 数据集
 * ======================================================= */

/**
 * 每类的 `probes` 是归一化坐标框（0–1）。
 * `metric` 说明该量什么；`expect` 是给人看的判据。
 */
export const NOISY_PHOTO_CLASSES = [
  {
    id: "K",
    key: "real-portrait",
    label: "K 真实人像照片",
    why: "皮肤是二维渐变、头发是丝状高频。用来打掉「平坦 + 低边密度 = 像素画」这条捷径。",
    paint: photoPortrait,
    probes: [
      // 框必须**真的罩住**眼睛。首版写成 [0.36,0.30,0.64,0.40]（y 到 0.40），
      // 而镜面高光实测在 y=0.404 —— 差 1 像素，框里最亮只有 228 而不是 253。
      // 探针框与几何是同一份事实的两种写法，改 paint 必须同时改这里。
      { id: "eye-specular", label: "眼部镜面高光", box: [0.36, 0.35, 0.66, 0.45], expect: "高光小亮点必须保留", metric: "最亮格占比" },
      { id: "cheek-skin", label: "脸颊肤色", box: [0.40, 0.46, 0.60, 0.56], expect: "肤色不被灰白化", metric: "色相偏移" },
      { id: "hair-strand", label: "头发丝状纹理", box: [0.36, 0.22, 0.64, 0.32], expect: "丝状明暗起伏保留，不能塌成一块", metric: "明度标准差" },
    ],
  },
  {
    id: "L",
    key: "pet-fur",
    label: "L 宠物毛发",
    why: "全画面方向性高频纹理 + 低饱和。打掉「高频 = 噪声该被清掉」。",
    paint: petFur,
    probes: [
      { id: "eye", label: "眼睛", box: [0.34, 0.30, 0.66, 0.42], expect: "低对比下的眼睛不能被抹掉", metric: "暗格数" },
      { id: "fur-texture", label: "毛发纹理", box: [0.10, 0.55, 0.40, 0.80], expect: "方向性纹理保留，不能糊成平色", metric: "明度标准差" },
      { id: "nose", label: "鼻子高光", box: [0.44, 0.50, 0.56, 0.58], expect: "湿高光保留", metric: "最亮格占比" },
    ],
  },
  {
    id: "M",
    key: "indoor-lowlight",
    label: "M 室内弱光",
    why: "低明度 + 强噪声 + 暖色偏 + 一块中性灰 + 一处过曝。同时考验噪声处理与中性保护。",
    paint: indoorLowLight,
    probes: [
      { id: "neutral-chair", label: "中性灰椅背", box: [0.60, 0.46, 0.76, 0.70], expect: "中性灰不能被中性化算法抹平", metric: "色度" },
      { id: "window-blowout", label: "过曝窗", box: [0.74, 0.10, 0.94, 0.38], expect: "过曝区保留为亮区", metric: "明度" },
      { id: "shadow-noise", label: "暗部", box: [0.05, 0.70, 0.30, 0.95], expect: "暗部噪声可被抑制但结构不能丢", metric: "明度标准差" },
    ],
  },
  {
    id: "N",
    key: "architecture",
    label: "N 建筑照片",
    why: "立面有**严格 8 像素级规则窗格阵列**。这是「规则网格 ⇒ 像素画」这条捷径的直接反例。",
    paint: architecturePhoto,
    probes: [
      { id: "window-grid", label: "窗格阵列", box: [0.20, 0.36, 0.88, 0.92], expect: "规则窗格不被当成像素画放大痕迹", metric: "分类结果" },
      { id: "sky-gradient", label: "天空渐变", box: [0.05, 0.02, 0.95, 0.20], expect: "天空渐变保留", metric: "色阶数" },
      { id: "mullion", label: "窗框细线", box: [0.16, 0.30, 0.92, 1.0], expect: "细窗框连通", metric: "暗格占比" },
    ],
  },
  {
    id: "O",
    key: "jpeg-noise",
    label: "O 压缩 JPEG / 轻噪声",
    why: "**真的有 8×8 块结构**，但块内变化率 > 0（DCT 量化），与 A–J 的最近邻放大（块内变化率 == 0）成对。",
    paint: applyJpegArtifacts,
    probes: [
      { id: "block-structure", label: "8×8 块结构", box: [0.0, 0.0, 1.0, 1.0], expect: "块内变化率 > 0（区别于最近邻放大）", metric: "块内变化率" },
      { id: "subject", label: "浅色主体", box: [0.60, 0.46, 0.84, 0.78], expect: "主体轮廓保留，振铃不能造出假结构", metric: "非空格占比" },
      { id: "ringing", label: "强边缘振铃带", box: [0.68, 0.44, 0.78, 0.82], expect: "振铃不产生成片假色块", metric: "色阶数" },
    ],
  },
  {
    id: "P",
    key: "soft-gradient-illustration",
    label: "P 柔和渐变插画",
    why: "平滑渐变 + 平色块 + 柔边、**零噪声**。「像照片」不等于「是照片」；也是「大面积平色 ⇒ 像素画」的反例。",
    paint: softGradientIllustration,
    probes: [
      { id: "sky-gradient", label: "天空双段渐变", box: [0.05, 0.02, 0.95, 0.45], expect: "两段渐变保留，不能塌成两三层", metric: "色阶数" },
      { id: "sun-glow", label: "太阳光晕", box: [0.55, 0.32, 0.82, 0.56], expect: "柔和光晕不被硬边化", metric: "色阶数" },
      { id: "hills", label: "远近山柔边", box: [0.05, 0.58, 0.95, 1.0], expect: "远/近山两层保留", metric: "色阶数" },
    ],
  },
  {
    id: "Q",
    key: "native-pixel-art",
    label: "Q 真实像素画",
    why: "原生分辨率、1 逻辑像素 = 4 源像素、硬边无抗锯齿无颗粒。是 §12 路由判据「真实 pixel fixture → pixel」的正样本；D 因是 ×8 放大产物，不能充当。",
    paint: pixelArtNative,
    probes: [
      { id: "palette", label: "全图", box: [0, 0, 1, 1], expect: "≤ 8 色（调色板只有 8 项）", metric: "用色数" },
      { id: "block", label: "块结构", box: [0, 0, 1, 1], expect: "4×4 块内逐位恒等（magnificationTrace 正样本）", metric: "块内变化率" },
      { id: "eye", label: "眼睛", box: [0.34, 0.26, 0.66, 0.40], expect: "眼白与瞳孔保留", metric: "暗格数" },
    ],
  },
];

export const NOISY_PHOTO_BY_KEY = Object.freeze(
  Object.fromEntries(NOISY_PHOTO_CLASSES.map((c) => [c.key, c])),
);
export const NOISY_PHOTO_BY_ID = Object.freeze(
  Object.fromEntries(NOISY_PHOTO_CLASSES.map((c) => [c.id, c])),
);

/**
 * 逐像素求值 → 源图 RGBA。**没有逻辑网格、没有放大** —— 这是与 A–J 的关键差别。
 * @param {object} cls  NOISY_PHOTO_CLASSES 的一项
 * @param {number} [size] 源图边长，默认 512
 */
export function buildNoisySource(cls, size = PHOTO_SOURCE_SIZE) {
  const S = size;
  const data = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const rgb = cls.paint(x, y, S);
      const i = (y * S + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { data, width: S, height: S };
}

/**
 * 8×8 块结构量测 —— **A–J 与 O 的裁决依据**。
 *
 * 为什么按「块内相邻像素是否逐位相同」而不是「有没有 8px 网格」：
 * 最近邻放大产生的是**块内恒等**（变化率恰好 0），DCT 量化产生的是
 * **块内近似恒定但非恒等**（变化率 > 0）。只看网格存在性的检测器
 * 无法区分二者，会把 O 和 A–J 一起判成像素画。
 *
 * @returns {{innerChangeRate:number, boundaryChangeRate:number, blockGridAlignment:number}}
 */
export function measureBlockStructure(source) {
  const { data, width, height } = source;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
  };
  let inner = 0, innerChanged = 0, boundary = 0, boundaryChanged = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const changed = at(x - 1, y) !== at(x, y);
      if (x % 8 === 0) { boundary += 1; if (changed) boundaryChanged += 1; }
      else { inner += 1; if (changed) innerChanged += 1; }
    }
  }
  const innerChangeRate = innerChanged / Math.max(1, inner);
  const boundaryChangeRate = boundaryChanged / Math.max(1, boundary);
  return {
    innerChangeRate,
    boundaryChangeRate,
    // 1 = 变化**只**发生在 8 的倍数边界（最近邻放大的签名）
    blockGridAlignment: boundaryChangeRate > 0 ? 1 - innerChangeRate / boundaryChangeRate : 0,
  };
}

export default {
  PHOTO_SOURCE_SIZE,
  NOISY_PHOTO_CLASSES,
  NOISY_PHOTO_BY_KEY,
  NOISY_PHOTO_BY_ID,
  buildNoisySource,
  measureBlockStructure,
};
