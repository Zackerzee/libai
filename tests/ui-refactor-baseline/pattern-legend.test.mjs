import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSwatches,
  detectTextWords,
  planTextRegions,
  analyzeLegend,
} from "../../services/pattern-legend-service.js";

/* ----------------------------- 合成图工具 -----------------------------
 * 原参考测试用 sharp 把 SVG 渲染成 PNG 再 decodeRgb。这里不能用 sharp，
 * 所以把 SVG 的 <rect fill="rgb(...)"> 手工转成等价的像素填充代码：
 * 直接把对应矩形区域的 rgb 平铺数组填成目标颜色。文字类（<text>）用例
 * 无法精确还原，改为“手工绘制字形像素”的等价断言（见深底浅字用例）。
 * DecodedImage 约定：{ width, height, rgb: Uint8ClampedArray(宽*高*3) }。
 */

function makeImage(w, h, bg = [255, 255, 255]) {
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = bg[0];
    rgb[i * 3 + 1] = bg[1];
    rgb[i * 3 + 2] = bg[2];
  }
  return { width: w, height: h, rgb };
}

function fillRect(img, x, y, w, h, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    const base = yy * img.width;
    for (let xx = x0; xx < x1; xx++) {
      const i = (base + xx) * 3;
      img.rgb[i] = color[0];
      img.rgb[i + 1] = color[1];
      img.rgb[i + 2] = color[2];
    }
  }
}

test("detectSwatches: 一行两个饱和色块", () => {
  const w = 220, h = 80;
  const img = makeImage(w, h);
  fillRect(img, 20, 20, 40, 40, [255, 0, 0]);
  fillRect(img, 120, 20, 40, 40, [0, 128, 255]);
  const swatches = detectSwatches(img);
  assert.ok(swatches.length >= 2, `expected >=2 swatches, got ${swatches.length}`);
  assert.equal(new Set(swatches.map((s) => s.row)).size, 1);
  const xs = swatches.map((s) => s.x0);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  for (const s of swatches) {
    assert.ok(s.x1 > s.x0);
    assert.ok(s.y1 > s.y0);
  }
});

test("detectSwatches: 拒绝多色区域", () => {
  // 两个不同饱和色方块横向紧邻（x40-79 红, x80-119 蓝），在 mask 里会 4-连通
  // 合并成一个跨色连通域，spread 高达 255 > 80，被连通域通道的过滤器剔除。
  const w = 220, h = 140;
  const img = makeImage(w, h);
  fillRect(img, 40, 30, 40, 80, [255, 0, 0]);
  fillRect(img, 80, 30, 40, 80, [0, 0, 255]);
  assert.equal(detectSwatches(img).length, 0);
});

test("detectSwatches: 800×200 三行宽色条", () => {
  const w = 800, h = 200;
  const img = makeImage(w, h);
  const colors = [
    [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0],
    [0, 128, 255], [128, 0, 255],
  ];
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < colors.length; c++) {
      const x = 10 + c * 130;
      const y = 10 + row * 60;
      fillRect(img, x, y, 120, 44, colors[c]);
    }
  }
  const swatches = detectSwatches(img);
  assert.ok(swatches.length >= 15, `expected >=15 swatches, got ${swatches.length}`);
  assert.ok(swatches.every((s) => s.y0 >= 8 && s.y1 <= h - 8));
});

test("detectTextWords: 深色色块内部找浅色文字", () => {
  // 等价还原 text.test.ts 的 <rect rgb(40,40,120)> + <text fill=white>A11(202)</text>。
  // sharp 渲染的字形无法精确复刻，这里改用“手工绘制白色字形像素块”作为等价断言：
  // 只要色块内部出现浅色墨迹、且包围盒落在色块范围内即可证明 inside 路径正确。
  const w = 420, h = 120;
  const img = makeImage(w, h);
  fillRect(img, 40, 30, 120, 50, [40, 40, 120]); // 深蓝矩形
  // 在矩形内部手工画一块白色字形像素（模拟白字）。
  fillRect(img, 55, 42, 30, 20, [255, 255, 255]);
  const words = detectTextWords(
    img,
    { x0: 40, y0: 30, x1: 160, y1: 80 },
    { inside: true },
  );
  assert.ok(words.length >= 1, `expected >=1 word, got ${words.length}`);
  assert.equal(words[0].ink, "light");
  assert.ok(words[0].x0 >= 40);
  assert.ok(words[0].x1 <= 160);
  assert.ok(words[0].y0 >= 30);
  assert.ok(words[0].y1 <= 80);
});

test("analyzeLegend: 放大图坐标回换算到原图尺度", () => {
  // 构造 3200 宽的大图（约为 1280 调参前提的 2.5 倍），应触发降采样：
  // scale = 1600/3200 = 0.5，在低分辨率 1600 上检测，框坐标回换算回原图。
  const w = 3200, h = 800;
  const img = makeImage(w, h);
  const colors = [
    [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0],
    [0, 128, 255], [128, 0, 255],
  ];
  // 4× 复刻 800×200 测试布局（x=40+c*520, y=40+row*240, 480×176）。
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < colors.length; c++) {
      fillRect(img, 40 + c * 520, 40 + row * 240, 480, 176, colors[c]);
    }
  }
  const result = analyzeLegend(img);
  assert.equal(result.scale, 0.5);
  assert.equal(result.detectWidth, 1600);
  assert.equal(result.detectHeight, 400);
  assert.ok(result.swatches.length > 0, "should detect swatches on downscaled image");
  // 所有框坐标必须落在原图尺度范围内。
  for (const s of result.swatches) {
    assert.ok(s.x0 >= 0 && s.x0 <= w);
    assert.ok(s.x1 >= 0 && s.x1 <= w);
    assert.ok(s.y0 >= 0 && s.y0 <= h);
    assert.ok(s.y1 >= 0 && s.y1 <= h);
    assert.ok(s.x1 > s.x0 && s.y1 > s.y0);
  }
  // regions 与 swatches 等长，且每个区域的坐标同样回换算到原图。
  assert.equal(result.regions.length, result.swatches.length);
  for (const list of result.regions) {
    assert.ok(list.length >= 1, "每个色块至少有一个 cell 候选区域");
    for (const r of list) {
      assert.ok(r.box.x0 >= 0 && r.box.x1 <= w);
      assert.ok(r.box.y0 >= 0 && r.box.y1 <= h);
    }
  }
});

test("analyzeLegend: scale=1 时与原实现逐字节一致（不引入额外处理）", () => {
  // 一张 800×200 的图（<= maxDetectWidth）应直接在原图上检测，结果与
  // 单独调用 detectSwatches / planTextRegions 完全一致。
  const w = 800, h = 200;
  const img = makeImage(w, h);
  const colors = [
    [255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 255, 0],
    [0, 128, 255], [128, 0, 255],
  ];
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < colors.length; c++) {
      fillRect(img, 10 + c * 130, 10 + row * 60, 120, 44, colors[c]);
    }
  }
  const direct = detectSwatches(img);
  const directRegions = planTextRegions(img, direct);
  const analyzed = analyzeLegend(img);
  assert.equal(analyzed.scale, 1);
  assert.equal(analyzed.swatches.length, direct.length);
  for (let i = 0; i < direct.length; i++) {
    assert.deepEqual(analyzed.swatches[i], direct[i]);
  }
  for (let i = 0; i < directRegions.length; i++) {
    assert.deepEqual(analyzed.regions[i], directRegions[i]);
  }
});
