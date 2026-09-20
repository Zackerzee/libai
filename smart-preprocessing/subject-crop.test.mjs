import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectSubjectBox,
  cropImageData,
  cropToSubject,
  expandBox,
  floodBackgroundMask,
  DEFAULT_SUBJECT_CROP_CONFIG,
} from "./subject-crop.mjs";

/* ---------- 测试用构造工具 ---------- */

// 造一个 { data, width, height } 形状的图，初始填背景色
function makeImage(W, H, bg = [240, 240, 240]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

// 在图上画一个实心块（RGBA）
function fillRect(img, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
      img.data[i + 3] = color[3] ?? 255;
    }
  }
}

function countFg(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 0) n++;
  return n;
}

/* ---------- 1. 纯色背景 + 中央色块 → 外接框正确 ---------- */
test("纯色背景中央色块：detectSubjectBox 返回精确外接框", () => {
  const img = makeImage(100, 80);
  fillRect(img, 30, 20, 40, 30, [20, 20, 20]); // x[30,70) y[20,50)
  const box = detectSubjectBox(img);
  assert.deepEqual(box, { x: 30, y: 20, width: 40, height: 30 });
});

/* ---------- 2. padding 外扩后被夹到边界（主体贴左边） ---------- */
test("主体贴左边缘（留 2px 背景边）：padding 外扩被夹到 x=0", () => {
  const img = makeImage(100, 80);
  // 主体距左边 2px（背景边），这样主体不会被当成边框背景
  fillRect(img, 2, 20, 40, 30, [20, 20, 20]);
  const res = cropToSubject(img);
  assert.strictEqual(res.sourceBox.x, 2);
  assert.strictEqual(res.box.x, 0); // 向左外扩被夹到 0
  // padding = round(0.04*40)=2，每侧各扩 2px → 宽 = 40 + 2*2 = 44
  assert.strictEqual(res.box.width, 44);
});

/* ---------- 3. padding 外扩后被夹到边界（主体贴上边） ---------- */
test("主体贴上边缘（留 2px 背景边）：padding 外扩被夹到 y=0", () => {
  const img = makeImage(100, 80);
  fillRect(img, 30, 2, 40, 30, [20, 20, 20]); // 距上边 2px
  const res = cropToSubject(img);
  assert.strictEqual(res.box.y, 0);
  assert.strictEqual(res.sourceBox.y, 2);
});

/* ---------- 4. 全背景 → detectSubjectBox 返回 null ---------- */
test("全背景（纯色图）：detectSubjectBox 返回 null", () => {
  const img = makeImage(60, 60, [200, 200, 200]);
  assert.strictEqual(detectSubjectBox(img), null);
});

/* ---------- 5. 全背景 → cropToSubject 原样返回（box 等价于整幅，coverage=0） ---------- */
test("全背景：cropToSubject 原样返回且不抛异常", () => {
  const img = makeImage(60, 60, [200, 200, 200]);
  const res = cropToSubject(img);
  assert.strictEqual(res.box.x, 0);
  assert.strictEqual(res.box.y, 0);
  assert.strictEqual(res.box.width, 60);
  assert.strictEqual(res.box.height, 60);
  assert.strictEqual(res.coverage, 0);
  assert.strictEqual(res.width, 60);
  assert.strictEqual(res.height, 60);
});

/* ---------- 6. 全前景（主体铺满，仅边框被识别为背景）→ 非 null 且很大 ---------- */
test("主体铺满画面（无纯色背景）：返回非空且接近整幅", () => {
  const img = makeImage(100, 100);
  // 用每像素略不同的颜色模拟真实照片（无大片纯色背景）
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      const i = (y * 100 + x) * 4;
      img.data[i] = (x * 2) & 255;
      img.data[i + 1] = (y * 2) & 255;
      img.data[i + 2] = ((x + y) * 2) & 255;
    }
  }
  const box = detectSubjectBox(img, { colorTolerance: 8 });
  assert.ok(box, "应检测到主体框");
  // 边框 1px 环天然被识别为背景（与边框连通），故框略小于整幅属正常；
  // 主体应覆盖绝大部分画面（>78% 每维）
  assert.ok(box.width >= 78 && box.height >= 78, `主体应铺满绝大部分画面，实际 ${box.width}x${box.height}`);
});

/* ---------- 7. 抗锯齿渐变背景不会漏进主体（种子色 vs 邻居色） ---------- */
test("主体带抗锯齿斜坡：种子色泛洪比邻居色保留更多主体（证明防漏）", () => {
  const W = 100, H = 100;
  const img = makeImage(W, H, [240, 240, 240]); // 均匀浅灰背景
  // 深色主体块（中央）
  const sx = 30, sy = 30, sw = 40, sh = 40;
  fillRect(img, sx, sy, sw, sh, [30, 30, 30]);
  // 在主体四边造一条 15px 的「背景→主体」抗锯齿斜坡（每步约 14 sRGB，< CIEDE2000 容差步长）
  const ramp = 15;
  for (let t = 1; t <= ramp; t++) {
    const k = t / (ramp + 1); // 0..1
    const v = Math.round(240 + (30 - 240) * k);
    // 左 / 右
    for (let y = sy; y < sy + sh; y++) {
      if (sx - t >= 0) { const i = (y * W + (sx - t)) * 4; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; }
      if (sx + sw + t - 1 < W) { const i = (y * W + (sx + sw + t - 1)) * 4; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; }
    }
    // 上 / 下
    for (let x = sx; x < sx + sw; x++) {
      if (sy - t >= 0) { const i = ((sy - t) * W + x) * 4; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; }
      if (sy + sh + t - 1 < H) { const i = ((sy + sh + t - 1) * W + x) * 4; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; }
    }
  }

  const seedMask = floodBackgroundMask(img, { tolerance: 8, useSeedColor: true });
  const nbrMask = floodBackgroundMask(img, { tolerance: 8, useSeedColor: false });
  const seedFg = countFg(seedMask);
  const nbrFg = countFg(nbrMask);
  // 种子色把斜坡挡在主体外、保留更多主体；邻居色顺着斜坡漏进主体、主体被吃掉更多
  assert.ok(seedFg > nbrFg, `种子色应保留更多主体（seedFg=${seedFg} > nbrFg=${nbrFg}）`);

  // 种子色框应「包住」深色方块（抗锯齿斜坡靠近背景那侧被并入背景、靠近主体侧留作前景，属正确行为）；
  // 关键是种子色不会像邻居色那样漏进主体内部把方块吃掉
  const seedBox = detectSubjectBox(img, { colorTolerance: 8 });
  assert.ok(seedBox, "种子色应检出主体框");
  assert.ok(seedBox.x <= sx && seedBox.y <= sy, "种子色框左上不侵入主体内部");
  assert.ok(seedBox.x + seedBox.width >= sx + sw && seedBox.y + seedBox.height >= sy + sh, "种子色框右下不侵入主体内部");
});

/* ---------- 8. cropImageData 不修改原数组（快照比对） ---------- */
test("cropImageData 不修改原 imageData", () => {
  const img = makeImage(50, 50);
  fillRect(img, 10, 10, 20, 20, [10, 10, 10]);
  const snapshot = Uint8ClampedArray.from(img.data);
  const cropped = cropImageData(img, { x: 5, y: 5, width: 20, height: 20 });
  assert.ok(cropped.data !== img.data, "应返回新数组");
  assert.deepEqual([...img.data], [...snapshot], "原数组内容不应改变");
});

/* ---------- 9. cropToSubject 的 coverage 计算 ---------- */
test("cropToSubject 的 coverage = 前景像素 / 总像素", () => {
  const img = makeImage(100, 100);
  fillRect(img, 40, 40, 20, 20, [10, 10, 10]); // 400 前景像素
  const res = cropToSubject(img);
  assert.ok(Math.abs(res.coverage - 400 / 10000) < 1e-9, `coverage 应=0.04，实际 ${res.coverage}`);
});

/* ---------- 10. cropToSubject 返回全新的 Uint8ClampedArray ---------- */
test("cropToSubject 返回全新 data 数组", () => {
  const img = makeImage(80, 80);
  fillRect(img, 20, 20, 30, 30, [10, 10, 10]);
  const res = cropToSubject(img);
  assert.ok(res.data instanceof Uint8ClampedArray);
  assert.ok(res.data !== img.data, "不应复用原引用");
});

/* ---------- 11. 1×1 图像：detectSubjectBox 返回 null（整幅即背景） ---------- */
test("1x1 图像：detectSubjectBox 返回 null", () => {
  const img = makeImage(1, 1, [123, 123, 123]);
  assert.strictEqual(detectSubjectBox(img), null);
});

/* ---------- 12. 1×1 图像：cropToSubject 原样返回 ---------- */
test("1x1 图像：cropToSubject 原样返回整幅", () => {
  const img = makeImage(1, 1, [123, 123, 123]);
  const res = cropToSubject(img);
  assert.strictEqual(res.width, 1);
  assert.strictEqual(res.height, 1);
  assert.strictEqual(res.coverage, 0);
  assert.deepEqual(res.box, { x: 0, y: 0, width: 1, height: 1 });
});

/* ---------- 13. 2000×2000 大图（全背景）不爆栈、返回 null ---------- */
test("2000x2000 全背景：不爆栈，detectSubjectBox 返回 null", () => {
  const W = 2000, H = 2000;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 128; data[i * 4 + 1] = 128; data[i * 4 + 2] = 128; data[i * 4 + 3] = 255; }
  const img = { data, width: W, height: H };
  assert.strictEqual(detectSubjectBox(img), null);
});

/* ---------- 14. 2000×2000 大图（含主体）：不爆栈、检出正确 ---------- */
test("2000x2000 含主体：不爆栈，detectSubjectBox 正确", () => {
  const W = 2000, H = 2000;
  const img = makeImage(W, H, [230, 230, 230]);
  fillRect(img, 800, 800, 400, 400, [15, 15, 15]);
  const box = detectSubjectBox(img);
  assert.deepEqual(box, { x: 800, y: 800, width: 400, height: 400 });
});

/* ---------- 15. expandBox：基本外扩 ---------- */
test("expandBox 基本外扩", () => {
  const box = expandBox({ x: 10, y: 10, width: 20, height: 20 }, 5, 100, 100);
  assert.deepEqual(box, { x: 5, y: 5, width: 30, height: 30 });
});

/* ---------- 16. expandBox：夹到宽度边界 ---------- */
test("expandBox 夹到宽度边界", () => {
  // x0=max(0,95-10)=85, x1=min(100,95+10+10)=100 => width=15
  const box = expandBox({ x: 95, y: 10, width: 10, height: 10 }, 10, 100, 100);
  assert.strictEqual(box.x, 85);
  assert.strictEqual(box.width, 15);
});

/* ---------- 17. expandBox：夹到高度边界且宽高≥1 ---------- */
test("expandBox 夹到高度边界且宽高≥1", () => {
  const box = expandBox({ x: 10, y: 95, width: 10, height: 10 }, 10, 100, 100);
  assert.strictEqual(box.y, 85);
  assert.strictEqual(box.height, 15);
  assert.ok(box.width >= 1 && box.height >= 1);
});

/* ---------- 18. detectSubjectBox 框必在图像范围内、宽高≥1 ---------- */
test("detectSubjectBox 返回的框必在图像范围内且宽高≥1", () => {
  const img = makeImage(120, 90);
  fillRect(img, 5, 5, 110, 80, [40, 40, 40]);
  const box = detectSubjectBox(img);
  assert.ok(box.x >= 0 && box.y >= 0);
  assert.ok(box.x + box.width <= 120);
  assert.ok(box.y + box.height <= 90);
  assert.ok(box.width >= 1 && box.height >= 1);
});

/* ---------- 19. padding 实际外扩到比 sourceBox 大 ---------- */
test("cropToSubject 的 box 比 sourceBox 大（含边距）", () => {
  const img = makeImage(100, 100);
  fillRect(img, 40, 40, 20, 20, [10, 10, 10]);
  const res = cropToSubject(img);
  assert.ok(res.box.width > res.sourceBox.width, "box 应比 sourceBox 宽");
  assert.ok(res.box.height > res.sourceBox.height, "box 应比 sourceBox 高");
  assert.deepEqual(res.sourceBox, { x: 40, y: 40, width: 20, height: 20 });
});

/* ---------- 20. cropToSubject：主体贴角 + padding 被夹在图像内 ---------- */
test("主体贴右下角时 padding 被夹在图像内", () => {
  const img = makeImage(100, 100);
  fillRect(img, 80, 80, 20, 20, [10, 10, 10]);
  const res = cropToSubject(img);
  assert.strictEqual(res.box.x + res.box.width, 100);
  assert.strictEqual(res.box.y + res.box.height, 100);
  assert.ok(res.box.x >= 0 && res.box.y >= 0);
});

/* ---------- 21. 默认配置存在 ---------- */
test("DEFAULT_SUBJECT_CROP_CONFIG 含 colorTolerance / paddingRatio", () => {
  assert.strictEqual(DEFAULT_SUBJECT_CROP_CONFIG.colorTolerance, 8);
  assert.strictEqual(DEFAULT_SUBJECT_CROP_CONFIG.paddingRatio, 0.04);
});
