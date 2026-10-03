/**
 * §12 「真实噪声 / 照片型 benchmark」（K–P）的回归守卫。
 *
 * 这一组夹具存在的唯一理由，是**打掉 A–J 上成立、在真实输入上不成立的直觉**。
 * 所以测试必须守住两件事：
 *   ① 每一类的「定义属性」真的成立 —— 否则夹具名不副实，
 *      而审计报告会拿一个名字对不上的数据去下结论。
 *   ② **A–J 与 O 的裁决对照**：A–J 块内变化率恒为 0（最近邻放大），
 *      O 块内变化率 > 0（DCT 量化）。这是 §12.2 像素检测器能不能被证伪的基准。
 *
 * 断言阈值全部取自实测值并留出余量，**不是**「凑一个能过的数」。
 * 每条的注释里写了实测值。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NOISY_PHOTO_CLASSES, NOISY_PHOTO_BY_ID, NOISY_PHOTO_BY_KEY,
  PHOTO_SOURCE_SIZE, buildNoisySource, measureBlockStructure,
} from "./noisy-photo-fixtures.mjs";
import { B4_BENCH_CLASSES, buildBenchGrid, rasterize } from "./b4-bench-fixtures.mjs";

const sources = new Map();
function sourceOf(id) {
  if (!sources.has(id)) sources.set(id, buildNoisySource(NOISY_PHOTO_BY_ID[id]));
  return sources.get(id);
}

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function imageStats(source) {
  const { data } = source;
  let n = 0, sum = 0, sumSq = 0, minL = 255, maxL = 0, sat = 0, chromaSum = 0, skin = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = luma(r, g, b);
    n += 1; sum += L; sumSq += L * L;
    if (L < minL) minL = L;
    if (L > maxL) maxL = L;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    chromaSum += chroma;
    if (chroma > 40) sat += 1;
    if (r > g && g > b && r - b > 40 && L > 90) skin += 1;
  }
  const mean = sum / n;
  return {
    meanL: mean,
    sdL: Math.sqrt(sumSq / n - mean * mean),
    minL, maxL,
    satRatio: sat / n,
    meanChroma: chromaSum / n,
    skinRatio: skin / n,
  };
}

/** 相邻像素亮度差的均值（高频能量）。 */
function hfEnergy(source) {
  const { data, width, height } = source;
  let sum = 0, n = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 1; x < width; x += 1) {
      const i = (y * width + x) * 4, j = (y * width + x - 1) * 4;
      sum += Math.abs(luma(data[i], data[i + 1], data[i + 2]) - luma(data[j], data[j + 1], data[j + 2]));
      n += 1;
    }
  }
  return sum / n;
}

/* =========================================================
 * 结构性断言
 * ======================================================= */

test("§12 K–Q：七类齐备，id 为 K–Q，且与 A–J 不重名", () => {
  assert.equal(NOISY_PHOTO_CLASSES.length, 7);
  assert.deepEqual(NOISY_PHOTO_CLASSES.map((c) => c.id), ["K", "L", "M", "N", "O", "P", "Q"]);
  const benchIds = new Set(B4_BENCH_CLASSES.map((c) => c.id));
  for (const cls of NOISY_PHOTO_CLASSES) {
    assert.ok(!benchIds.has(cls.id), `${cls.id} 与 A–J 撞 id —— A–J 必须原样保留，K–P 只能新增`);
    assert.ok(NOISY_PHOTO_BY_KEY[cls.key], `缺少 key 索引：${cls.key}`);
  }
});

test("§12 K–P：A–J 未被替换或改动（数量与 id 不变）", () => {
  assert.equal(B4_BENCH_CLASSES.length, 10, "A–J 必须仍是 10 类");
  assert.deepEqual(B4_BENCH_CLASSES.map((c) => c.id),
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
});

test("§12 K–P：源图逐像素求值，尺寸 = 512×512，无放大步骤", () => {
  assert.equal(PHOTO_SOURCE_SIZE, 512);
  for (const cls of NOISY_PHOTO_CLASSES) {
    const s = sourceOf(cls.id);
    assert.equal(s.width, 512, `${cls.id} 宽度`);
    assert.equal(s.height, 512, `${cls.id} 高度`);
    assert.equal(s.data.length, 512 * 512 * 4, `${cls.id} 数据长度`);
    // 不透明：本组全部无 alpha
    for (let i = 3; i < s.data.length; i += 4 * 997) assert.equal(s.data[i], 255, `${cls.id} 出现非不透明像素`);
  }
});

test("§12 K–P：确定性 —— 同一类生成两次逐位相同", () => {
  for (const cls of NOISY_PHOTO_CLASSES) {
    const a = buildNoisySource(cls);
    const b = buildNoisySource(cls);
    let same = true;
    for (let i = 0; same && i < a.data.length; i += 331) if (a.data[i] !== b.data[i]) same = false;
    assert.ok(same, `${cls.id} 两次生成不一致 —— 绘制函数里混进了顺序 RNG 或时间`);
  }
});

/* =========================================================
 * 每类的定义属性
 * ======================================================= */

/** 归一化框内的像素统计。用来检验**声明的探针框**，而不是全幅平均。 */
function regionStats(source, [nx0, ny0, nx1, ny1]) {
  const { data, width, height } = source;
  const x0 = Math.floor(nx0 * width), x1 = Math.ceil(nx1 * width);
  const y0 = Math.floor(ny0 * height), y1 = Math.ceil(ny1 * height);
  let n = 0, skin = 0, sumL = 0, maxL = 0, sumC = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = luma(r, g, b);
      n += 1; sumL += L; sumC += Math.max(r, g, b) - Math.min(r, g, b);
      if (L > maxL) maxL = L;
      if (r > g && g > b && r - b > 40 && L > 90) skin += 1;
    }
  }
  return { n, skinRatio: skin / Math.max(1, n), meanL: sumL / Math.max(1, n), maxL, meanChroma: sumC / Math.max(1, n) };
}

test("§12 K 真实人像照片：脸颊区确实是肤色 + 眼部有镜面高光 + 低饱和背景", () => {
  const src = sourceOf("K");
  const all = imageStats(src);
  const cheek = regionStats(src, [0.40, 0.46, 0.60, 0.56]);
  const eye = regionStats(src, [0.36, 0.35, 0.66, 0.45]);
  // 脸颊探针框内应当**几乎全是**肤色。这是对声明的探针负责，不是对全幅比例负责 ——
  // 全幅肤色占比只有 ~5%（头发遮住上半张脸），拿全幅比例当判据会写出一个
  // 「阈值越低越像人像」的假断言。
  assert.ok(cheek.skinRatio > 0.85, `脸颊框内肤色占比仅 ${(cheek.skinRatio * 100).toFixed(1)}% —— 头发盖住了脸颊或肤色判定失效`);
  assert.ok(eye.maxL >= 245, `眼部框内缺少镜面高光（maxL=${eye.maxL}）`);
  assert.ok(all.satRatio < 0.25, `整体过饱和（satRatio=${all.satRatio.toFixed(3)}）—— 人像不该这样`);
  assert.ok(all.meanL > 60 && all.meanL < 160, `明度不合理（${all.meanL.toFixed(1)}）`);
});

test("§12 L 宠物毛发：方向性高频纹理 + 低对比 + 存在暗部结构（眼睛）", () => {
  const src = sourceOf("L");
  const s = imageStats(src);
  // 实测：hfEnergy 4.80（K 3.09 / P 0.10），minL 24（眼睛），sdL 29.9
  assert.ok(hfEnergy(src) > 3.0, `高频能量不足（${hfEnergy(src).toFixed(2)}）—— 毛发纹理没画出来`);
  assert.ok(s.minL < 60, `缺少暗部（minL=${s.minL}）—— 眼睛/鼻子没画出来`);
  assert.ok(s.sdL > 18, `明度起伏过小（sdL=${s.sdL.toFixed(1)}）`);
});

test("§12 M 室内弱光：低明度 + 强噪声 + 存在过曝区 + 噪声随明度变化", () => {
  const src = sourceOf("M");
  const s = imageStats(src);
  // 实测：meanL 56.6（K–P 最低），sdL 36.7，maxL 197（窗户过曝），hfEnergy 7.66（最高）
  assert.ok(s.meanL < 90, `不够暗（meanL=${s.meanL.toFixed(1)}）—— 这不是弱光`);
  assert.ok(s.maxL > 150, `缺少过曝区（maxL=${s.maxL}）—— 高光保护无从考察`);
  assert.ok(hfEnergy(src) > 4.0, `噪声不足（hfEnergy=${hfEnergy(src).toFixed(2)}）`);

  // 噪声幅度必须随明度下降而增大（真实相机行为）。
  // 分暗/亮两半比较相邻差；若写成恒定噪声，这条会失败。
  const { data, width } = src;
  let darkSum = 0, darkN = 0, lightSum = 0, lightN = 0;
  for (let y = 0; y < 512; y += 3) {
    for (let x = 1; x < width; x += 1) {
      const i = (y * width + x) * 4, j = (y * width + x - 1) * 4;
      const L = luma(data[i], data[i + 1], data[i + 2]);
      const d = Math.abs(L - luma(data[j], data[j + 1], data[j + 2]));
      if (L < 60) { darkSum += d; darkN += 1; } else if (L > 120) { lightSum += d; lightN += 1; }
    }
  }
  const darkNoise = darkSum / Math.max(1, darkN);
  const lightNoise = lightSum / Math.max(1, lightN);
  assert.ok(darkNoise > lightNoise * 1.3,
    `暗部噪声(${darkNoise.toFixed(2)}) 未明显高于亮部(${lightNoise.toFixed(2)}) —— 噪声写成了恒定值`);
});

test("§12 N 建筑照片：规则窗格阵列存在（周期性），但整体仍是照片级（非最近邻放大）", () => {
  const src = sourceOf("N");
  const bs = measureBlockStructure(src);
  // 实测：innerChangeRate 0.923，boundaryChangeRate 0.93 → 没有块结构
  assert.ok(bs.innerChangeRate > 0.5, `块内变化率过低（${bs.innerChangeRate.toFixed(3)}）—— 立面成了硬块`);
  assert.ok(Math.abs(bs.innerChangeRate - bs.boundaryChangeRate) < 0.25,
    "块内与边界变化率差距过大 —— 出现了 8px 网格结构，但建筑照片不该有");

  // 「规则窗格」的**可测含义**是周期性，不是「有长同色游程」。
  // 首版按逐位相等找长游程 → 恒为 0，因为夹具逐像素加了颗粒，
  // 相邻像素永远不可能逐位相同。拿一个在噪声图里**必然为假**的性质当判据，
  // 是在测噪声而不是测结构。
  // 第二版直接对原始亮度做自相关 → 峰落在 lag 8。因为立面本身有大尺度明暗趋势
  // （日光终止线 + 暗角），低频能量把周期性压住了。
  // 正解：**先去趋势（减滑动平均）再自相关**，并跳过 lag < 15 的近邻相关。
  const { data, width } = src;
  const y = Math.round(0.62 * 512);
  const topY = 512 * 0.30, bottomY = 512 * 1.02;
  const tt = (y - topY) / (bottomY - topY);
  const leftX = Math.round(512 * 0.30 + (512 * 0.16 - 512 * 0.30) * tt);
  const rightX = Math.round(512 * 0.74 + (512 * 0.92 - 512 * 0.74) * tt);
  const line = [];
  for (let x = leftX; x <= rightX; x += 1) {
    const i = (y * width + x) * 4;
    line.push(luma(data[i], data[i + 1], data[i + 2]));
  }
  const WIN = 61;
  const detrended = line.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = i - (WIN >> 1); k <= i + (WIN >> 1); k += 1) {
      if (k >= 0 && k < line.length) { sum += line[k]; n += 1; }
    }
    return line[i] - sum / n;
  });
  let variance = 0;
  for (const v of detrended) variance += v * v;
  const expectedPeriod = Math.round((rightX - leftX) / 3);
  let bestLag = 0, bestScore = -1;
  for (let lag = 15; lag < Math.floor(line.length / 2); lag += 1) {
    let acc = 0;
    for (let i = 0; i + lag < detrended.length; i += 1) acc += detrended[i] * detrended[i + lag];
    const score = acc / variance;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  assert.ok(bestScore > 0.35,
    `未检测到周期性结构（去趋势后自相关峰 ${bestScore.toFixed(3)} @ lag ${bestLag}）—— 规则窗格没画出来`);
  assert.ok(Math.abs(bestLag - expectedPeriod) <= 4,
    `自相关峰在 lag ${bestLag}，期望 ${expectedPeriod}（立面宽 / 3）—— 窗格周期与设计不符`);
});

test("§12 O 压缩 JPEG：真的有 8×8 块结构，但块内变化率 > 0", () => {
  const bs = measureBlockStructure(sourceOf("O"));
  // 实测：innerChangeRate 0.233，boundaryChangeRate 0.860
  assert.ok(bs.boundaryChangeRate > bs.innerChangeRate * 2.5,
    `块边界未显著集中（inner=${bs.innerChangeRate.toFixed(3)}, boundary=${bs.boundaryChangeRate.toFixed(3)}）—— 8×8 块结构没做出来`);
  assert.ok(bs.innerChangeRate > 0.05,
    `块内变化率为 ${bs.innerChangeRate.toFixed(4)}，太接近 0 —— 会与最近邻放大混淆，失去裁决力`);
  // 三条通道都必须有值：首版蓝通道恒为 0（累加器 undefined + x = NaN），所有指标却「正常」
  const s = sourceOf("O");
  let blueZero = 0, total = 0;
  for (let i = 0; i < s.data.length; i += 4 * 53) { total += 1; if (s.data[i + 2] === 0) blueZero += 1; }
  assert.ok(blueZero / total < 0.02, `蓝通道有 ${(blueZero / total * 100).toFixed(1)}% 为 0 —— 色彩通道塌了`);
});

test("§12 P 柔和渐变插画：平滑渐变 + 近零噪声", () => {
  const src = sourceOf("P");
  const s = imageStats(src);
  // 实测：hfEnergy 0.10（K–P 最低，是 O 的 1/9）
  assert.ok(hfEnergy(src) < 0.6, `噪声过高（hfEnergy=${hfEnergy(src).toFixed(2)}）—— 插画不该有颗粒`);
  assert.ok(s.sdL > 25, `缺少渐变起伏（sdL=${s.sdL.toFixed(1)}）—— 天空渐变没画出来`);
  assert.ok(s.maxL > 220, `缺少亮部（maxL=${s.maxL}）`);
});

/* =========================================================
 * 裁决对照 —— §12.2 的基准
 * ======================================================= */

test("§12 裁决对照：A–J 全部携带最近邻放大痕迹（块内变化率恒为 0）", () => {
  for (const cls of B4_BENCH_CLASSES) {
    const bs = measureBlockStructure(rasterize(buildBenchGrid(cls)));
    assert.equal(bs.innerChangeRate, 0,
      `${cls.id} 的块内变化率是 ${bs.innerChangeRate}，不是 0 —— A–J 的 8× 最近邻放大结构变了，`
      + "以「块结构」为证据的检测器在 A–J 上的行为会整体改变，§12.1 的结论需要重做");
  }
});

test("§12 裁决对照：只看「有没有 8px 网格」区分不了 A–J 与 O", () => {
  const d = measureBlockStructure(rasterize(buildBenchGrid(B4_BENCH_CLASSES.find((c) => c.id === "D"))));
  const o = measureBlockStructure(sourceOf("O"));
  // 两者都有块边界集中现象……
  assert.ok(d.boundaryChangeRate > 0.05, "D 应有块边界（最近邻放大）");
  assert.ok(o.boundaryChangeRate > 0.05, "O 应有块边界（DCT 量化）");
  // ……但只有 A–J 的块内是**恒等**的。这是唯一可靠的判别量。
  assert.equal(d.innerChangeRate, 0);
  assert.ok(o.innerChangeRate > 0.05);
  assert.ok(o.innerChangeRate - d.innerChangeRate > 0.05,
    "内变化率之差太小 —— 判别量失去余量");
});

test("§12 K–Q：除 Q 外，没有任何一类是「最近邻放大产物」", () => {
  // Q 是**故意**的放大产物（原生像素画，1 逻辑像素 = 4 源像素），是 §12 路由判据
  // 「真实 pixel fixture → pixel」的正样本，单独由下一个测试守。
  // 其余六类必须块内变化率 > 0，否则它们其实被放大过，不能当照片型夹具。
  for (const cls of NOISY_PHOTO_CLASSES) {
    if (cls.id === "Q") continue;
    const bs = measureBlockStructure(sourceOf(cls.id));
    assert.ok(bs.innerChangeRate > 0.1,
      `${cls.id} 块内变化率仅 ${bs.innerChangeRate.toFixed(4)} —— 它其实被放大过，不能当照片型夹具`);
  }
});

test("§12 Q 真实像素画：是有效的 magnificationTrace 正样本（b=4 块内恒等）", () => {
  const src = sourceOf("Q");
  // 块内逐位恒等：这是 D 做不到的事被拿来当判据的那一条。
  // 4×4 块（1 逻辑像素 = 4 源像素）内，任何相邻像素差必须是 0。
  let innerDiff = 0;
  for (let y = 0; y < 512; y += 1) {
    for (let x = 1; x < 512; x += 1) {
      if (x % 4 === 0) continue;                 // 跳过块边界
      const i = (y * 512 + x) * 4, j = i - 4;
      if (src.data[i] !== src.data[j] || src.data[i + 1] !== src.data[j + 1]
        || src.data[i + 2] !== src.data[j + 2]) innerDiff += 1;
    }
  }
  assert.equal(innerDiff, 0, `4px 块内有 ${innerDiff} 处像素差 —— 像素画必须是硬边放大，不能有渐变或抗锯齿`);
  // 但块**边界**上必须有变化，否则整幅是一块平色。
  // 实测：2064 / 65024 = 3.17%，覆盖 444 行（每行都有结构）。
  let boundaryDiff = 0;
  for (let y = 0; y < 512; y += 1) {
    for (let x = 4; x < 512; x += 4) {
      const i = (y * 512 + x) * 4, j = i - 4;
      if (src.data[i] !== src.data[j] || src.data[i + 1] !== src.data[j + 1]
        || src.data[i + 2] !== src.data[j + 2]) boundaryDiff += 1;
    }
  }
  assert.ok(boundaryDiff > 1200,
    `块边界变化仅 ${boundaryDiff} 处（实测 2064）—— 图案太单调，判别力不足`);
  // 用色数 ≤ 8：调色板只有 8 项，多余的颜色说明绘制里混进了插值
  const seen = new Set();
  for (let i = 0; i < src.data.length; i += 4) {
    seen.add((src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2]);
  }
  assert.ok(seen.size <= 8, `Q 出现 ${seen.size} 种颜色 —— 超过调色板 8 项，说明绘制里混进了插值`);
});
