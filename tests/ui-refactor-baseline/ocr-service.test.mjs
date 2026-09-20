import { test } from "node:test";
import assert from "node:assert/strict";
import {
  otsuThreshold,
  guessPolarity,
  binarize,
  toGray,
  cropBox,
  scaleForHeight,
} from "../../services/ocr-service.js";

/** 构造灰度数组。 */
const grayFrom = (values) => new Uint8ClampedArray(values);

test("toGray 按三通道均值转灰度", () => {
  const imageData = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
  assert.deepEqual([...toGray(imageData)], [0, 255]);
});

/** 跑一遍完整预处理链：灰度 -> Otsu -> 极性 -> 二值图。 */
const inkCount = (gray, { polarity = null } = {}) => {
  const threshold = otsuThreshold(gray);
  const binary = binarize(gray, { threshold, polarity: polarity || guessPolarity(gray) });
  return [...binary].filter((value) => value === 0).length;
};

test("带噪声的双峰直方图能把两峰干净切开", () => {
  const low = [...new Array(100)].map((_, i) => 38 + (i % 9));
  const high = [...new Array(100)].map((_, i) => 208 + (i % 9));
  // 低峰 100 个像素应全部被判为墨迹
  assert.equal(inkCount(grayFrom([...low, ...high])), 100);
});

test("纯黑字 + 纯白底能切出墨迹（参考实现会整块变白）", () => {
  // 这是"数字导出"图纸最常见的形态。参考实现有两个叠加的缺陷会在这里同时命中：
  // 1. 阈值搜索在类间方差并列时保留最小的 t，正落在墨迹峰上；
  // 2. 二值化用 `v < t` 而搜索约定是 `v <= t`，于是整峰被漏成背景。
  // 结果是一条墨迹都没有，OCR 读不到任何字。
  const gray = grayFrom([...new Array(100).fill(0), ...new Array(100).fill(255)]);
  assert.equal(inkCount(gray), 100);
});

test("深色色块上的白字：浅色墨迹方向正确", () => {
  const gray = grayFrom([...new Array(200).fill(40), ...new Array(50).fill(245)]);
  assert.equal(guessPolarity(gray), "light");
  assert.equal(inkCount(gray), 50);
});

test("otsuThreshold 在退化输入下返回 128", () => {
  assert.equal(otsuThreshold(grayFrom([50, 50, 50, 50])), 128);
});

test("guessPolarity 认出浅底深字", () => {
  const gray = grayFrom([...new Array(180).fill(250), ...new Array(20).fill(20)]);
  assert.equal(guessPolarity(gray), "dark");
});

test("guessPolarity 在纯黑字 + 纯白底（计数并列）时仍判为深字", () => {
  // 参考实现用 ">" 比较直方图并列项，会停在 bg=0，把白底黑字误判成深底浅字。
  const gray = grayFrom([...new Array(100).fill(0), ...new Array(100).fill(255)]);
  assert.equal(guessPolarity(gray), "dark");
});

test("guessPolarity 认出深底浅字（如深色色块上的白字）", () => {
  const gray = grayFrom([...new Array(180).fill(40), ...new Array(20).fill(240)]);
  assert.equal(guessPolarity(gray), "light");
});

test("guessPolarity 在背景居中时按深浅占比推断", () => {
  // 中灰底 + 深字（无浅色墨迹）：背景 128 落在居中区间，走占比分支
  const gray = grayFrom([...new Array(200).fill(128), ...new Array(60).fill(30)]);
  assert.equal(guessPolarity(gray), "dark");
});

test("guessPolarity 在深浅墨迹同时存在时取占比更少的一方作为墨迹", () => {
  const gray = grayFrom([...new Array(200).fill(128), ...new Array(60).fill(30), ...new Array(20).fill(230)]);
  // 深墨 60 像素、浅墨 20 像素 —— 浅墨是少数派，因此判为浅色墨迹
  assert.equal(guessPolarity(gray), "light");
});

test("cropBox 往内收 inset、往外留 pad，并夹在原图范围内", () => {
  const image = { width: 200, height: 100 };
  const crop = cropBox(image, { x0: 40, y0: 20, x1: 140, y1: 80 }, { inset: 5 });
  // inset=5 收内到 45/25/135/75；pad = max(2, round(50 * 0.12)) = 6 再外扩
  assert.equal(crop.cropHeight, 50);
  assert.equal(crop.left, 45 - 6);
  assert.equal(crop.top, 25 - 6);
  assert.equal(crop.width, (135 - 45) + 12);
  assert.equal(crop.height, (75 - 25) + 12);
});

test("cropBox 不越出图片边界", () => {
  const image = { width: 50, height: 50 };
  const crop = cropBox(image, { x0: 0, y0: 0, x1: 50, y1: 50 }, { inset: 0 });
  assert.equal(crop.left, 0);
  assert.equal(crop.top, 0);
  assert.ok(crop.width <= 50);
  assert.ok(crop.height <= 50);
});

test("scaleForHeight 让小字放大到至少 64px 高", () => {
  // 小字靠 minHeight 兜底：高度 10 时按 64/10 = 6.4 倍放大
  assert.equal(scaleForHeight(10), 6.4);
  assert.equal(scaleForHeight(16), 4);
  // 高度 32 时 4 倍已经超过 64，所以取 4 倍上限
  assert.equal(scaleForHeight(32), 4);
  assert.equal(scaleForHeight(80), 4);
});
