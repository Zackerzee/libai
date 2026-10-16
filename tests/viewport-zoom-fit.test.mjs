/**
 * 缩放「适配窗口」回归守卫。
 *
 * 口径演变（写清楚，免得下一个人改错）：
 *   1. 早期：下限写死 25%，适配先被 clampZoom 抬到 25%，大图永远露一截在窗口外。
 *   2. 中期：下限降到 MIN_ZOOM=2%，但「常规地板」仍是 20%（小作品不许缩成点）。
 *   3. 现在（2026-10-15，用户「有的图太大 缩到 20% 看不完全图」）：
 *      动态下限 = min(20%, 完整适屏比例)，夹在工程地板 2% 上。
 *      · 小作品（52×52…204×104）适屏远高于 20% → 下限仍是 20%
 *      · 大作品（400×600 ≈ 3.5%、800×1000 ≈ 2.1%）→ 下限让给适屏比例，能看全
 *      · 超过物理极限（如 2000×2000 ≈ 1.05%）→ 只能截断显示，clipped=true
 *
 * 判定口径：
 *   - 任意 (图纸尺寸, 窗口尺寸) 下 fitToViewport() 后图纸必须真的在窗口内 → 硬失败项
 *     （低于 2% 工程地板时例外：返回 clipped=true，UI 提示「总览状态」）
 *   - clampZoom 下限等于 MIN_ZOOM，且不把合法的 0 当无效值 → 硬失败项
 *   - zoomOut 必须能一路走到当前 minZoom() → 硬失败项
 *   - FIT/MANUAL 模式切换必须一处收口（fitToViewport→fit，setZoom/zoomIn/zoomOut/resetZoom→manual）
 *
 * 只测纯函数与纯几何，不碰 DOM：ZoomControls 的档位/滑块映射复用同一组常量，
 * 所以这里的断言同时守住了 UI 侧。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CELL, NORMAL_MIN_ZOOM, MIN_ZOOM, MAX_ZOOM, ZOOM_STEPS, clampZoom,
  zoomToSlider, sliderToZoom, createViewportService,
} from "../services/viewport-service.js";

// 极简 store / 尺寸桩，避免为一条几何断言拉起整个应用
function makeViewport(gridWidth, gridHeight, viewportWidth, viewportHeight) {
  let state = { view: { zoom: 1, panX: 0, panY: 0 } };
  const store = {
    getState: () => state,
    setState: (patch) => { state = { ...state, ...patch, view: { ...state.view, ...(patch.view || {}) } }; },
  };
  const viewport = createViewportService(store, () => ({ viewportWidth, viewportHeight, gridWidth, gridHeight }));
  return { viewport, view: () => store.getState().view };
}
const fitTarget = (gridWidth, gridHeight, vw, vh) =>
  Math.min((vw - 64) / (gridWidth * BASE_CELL), (vh - 64) / (gridHeight * BASE_CELL));

test("clampZoom 下限等于 MIN_ZOOM，且不再把 25% 当硬底", () => {
  assert.equal(clampZoom(0.23), 0.23, "0.23 是合法的适配缩放，不能抬到 0.25");
  assert.equal(clampZoom(0), MIN_ZOOM, "0 是合法输入（滑块最左端），不能被 `|| 1` 吞掉");
  assert.equal(clampZoom(-5), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom("abc"), 1, "非数值才回落到 1");
  assert.ok(MIN_ZOOM < 0.25, "下限必须低于 25%，否则适配会被卡住");
  assert.equal(NORMAL_MIN_ZOOM, 0.2, "常规地板 20%：小作品仍锁 20%");
});

test("动态下限：小作品锁 20%，大作品让位给适屏比例", () => {
  // 小作品：适屏 ≥ 20% → 下限 20%
  for (const [w, h, vw, vh] of [[52, 52, 1140, 559], [104, 104, 1140, 559], [204, 104, 1140, 559]]) {
    const { viewport } = makeViewport(w, h, vw, vh);
    assert.ok(fitTarget(w, h, vw, vh) >= NORMAL_MIN_ZOOM, `${w}×${h} 适屏应高于 20%`);
    assert.equal(viewport.minZoom(), NORMAL_MIN_ZOOM, `${w}×${h} 下限应为 20%`);
  }
  // 大作品：适屏低于 20% → 下限 = 适屏比例
  const big = [
    [400, 600, 900, 486],   // ≈3.52%
    [800, 1000, 900, 486],  // ≈2.11%
  ];
  for (const [w, h, vw, vh] of big) {
    const { viewport } = makeViewport(w, h, vw, vh);
    const target = fitTarget(w, h, vw, vh);
    assert.ok(target < NORMAL_MIN_ZOOM && target > MIN_ZOOM, `${w}×${h} 适屏应落在 2%–20% 之间`);
    assert.ok(Math.abs(viewport.minZoom() - target) < 1e-9, `${w}×${h} 下限应等于适屏比例`);
  }
  // 超过物理极限：下限夹到工程地板 2%
  const { viewport } = makeViewport(2000, 2000, 900, 486);
  assert.equal(viewport.minZoom(), MIN_ZOOM, "2000×2000 适屏 ≈1.05%，下限夹到 2%");
});

test("fitToViewport：图纸必须真的落进窗口（低于工程地板才允许截断）", () => {
  const cases = [
    [52, 52, 1140, 559, false],
    [104, 104, 1140, 559, false],
    [204, 104, 1140, 559, false],
    [180, 180, 1140, 559, false],   // 早期修复的真实场景
    [180, 180, 700, 500, false],
    [200, 200, 640, 480, false],
    [500, 500, 1140, 559, false],   // 手动可输入的最大边长
    [500, 500, 420, 380, false],    // 窄窗口 + 最大图纸
    [400, 600, 900, 486, false],    // 突破 20% 的典型大作品
    [800, 1000, 900, 486, false],   // 贴工程地板的大作品
    [2000, 2000, 900, 486, true],   // 超过物理极限 → 截断
  ];
  for (const [w, h, vw, vh, clipped] of cases) {
    const { viewport, view } = makeViewport(w, h, vw, vh);
    const outcome = viewport.fitToViewport();
    const zoom = view().zoom;
    assert.ok(zoom >= MIN_ZOOM, `${w}×${h}@${vw}x${vh}: 缩放 ${zoom} 不得低于工程地板`);
    assert.equal(outcome.clipped, clipped, `${w}×${h}@${vw}x${vh}: clipped 标记不符`);
    if (!clipped) {
      assert.ok(w * BASE_CELL * zoom <= vw, `${w}×${h}@${vw}x${vh}: 宽 ${w * BASE_CELL * zoom} 超出窗口`);
      assert.ok(h * BASE_CELL * zoom <= vh, `${w}×${h}@${vw}x${vh}: 高 ${h * BASE_CELL * zoom} 超出窗口`);
    } else {
      assert.equal(zoom, MIN_ZOOM, `${w}×${h}@${vw}x${vh}: 截断时锁定工程地板`);
    }
    assert.equal(viewport.zoomMode, "fit", "fitToViewport 后必须回到 FIT 模式");
  }
});

test("fitToViewport 停在完整适屏比例；zoomOut 最低到动态下限且不越界", () => {
  // 小作品：适屏 ≥20% → fit 停在适屏比例，还能继续缩到 20% 常规地板
  {
    const { viewport, view } = makeViewport(52, 52, 1140, 559);
    viewport.fitToViewport();
    const target = fitTarget(52, 52, 1140, 559);
    assert.ok(Math.abs(view().zoom - target) < 1e-9, "小作品 fit 应停在完整适屏比例");
    let guard = 0;
    while (view().zoom > viewport.minZoom() + 1e-9 && guard < 200) { viewport.zoomOut(); guard += 1; }
    assert.equal(view().zoom, viewport.minZoom(), "zoomOut 应能一路走到 minZoom()");
    assert.ok(guard < 200, "zoomOut 不应陷入死循环");
    viewport.zoomOut();
    assert.equal(view().zoom, viewport.minZoom(), "到达下限后再按不得越过");
  }
  // 大作品：适屏 <20% → fit 即动态下限，zoomOut 无路可走也不得越过
  {
    const { viewport, view } = makeViewport(400, 600, 900, 486);
    viewport.fitToViewport();
    assert.ok(Math.abs(view().zoom - viewport.minZoom()) < 1e-9, "大作品 fit 即下限");
    assert.ok(view().zoom < NORMAL_MIN_ZOOM, "大作品下限突破 20% 常规地板");
    viewport.zoomOut();
    assert.equal(view().zoom, viewport.minZoom(), "已在动态下限，zoomOut 不得再降");
  }
});

test("setZoom 也被动态下限钳制，且切到 MANUAL 模式", () => {
  const { viewport, view } = makeViewport(400, 600, 900, 486);
  viewport.setZoom(0.5);
  assert.equal(viewport.zoomMode, "manual");
  viewport.setZoom(0.01);
  assert.equal(view().zoom, viewport.minZoom(), "低于动态下限的输入必须被钳住");
  assert.equal(viewport.zoomMode, "manual", "setZoom 后保持 MANUAL");
  viewport.setZoom(8);
  assert.equal(view().zoom, MAX_ZOOM);
  // 大作品的 manual 下限 < 20%：用户真的可以缩到 3.52% 看整幅
  const { viewport: vp2, view: view2 } = makeViewport(400, 600, 900, 486);
  vp2.setZoom(vp2.minZoom());
  assert.ok(view2().zoom < NORMAL_MIN_ZOOM, "大作品手动缩放可突破 20% 常规地板");
  assert.equal(vp2.zoomMode, "manual");
});

test("FIT/MANUAL 模式一处收口：缩放类操作全部归 manual", () => {
  const { viewport, view } = makeViewport(104, 104, 1140, 559);
  viewport.fitToViewport();
  assert.equal(viewport.zoomMode, "fit");
  viewport.zoomIn();
  assert.equal(viewport.zoomMode, "manual", "zoomIn → manual");
  viewport.fitToViewport();
  viewport.zoomOut();
  assert.equal(viewport.zoomMode, "manual", "zoomOut → manual");
  viewport.fitToViewport();
  viewport.resetZoom();
  assert.equal(viewport.zoomMode, "manual", "resetZoom → manual");
  assert.equal(view().zoom, 1);
  viewport.fitToViewport();
  viewport.setPan(12, 34);
  assert.equal(viewport.zoomMode, "manual", "setPan → manual");
  assert.deepEqual([view().panX, view().panY], [12, 34]);
  viewport.fitToViewport();
  assert.equal(viewport.zoomMode, "fit", "适应窗口随时能回到 FIT");
});

test("档位表首尾贴合缩放下限与上限且严格递增", () => {
  assert.equal(ZOOM_STEPS[0], MIN_ZOOM);
  assert.equal(ZOOM_STEPS[ZOOM_STEPS.length - 1], MAX_ZOOM);
  for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
    assert.ok(ZOOM_STEPS[i] > ZOOM_STEPS[i - 1], `档位必须递增：${ZOOM_STEPS[i - 1]} → ${ZOOM_STEPS[i]}`);
  }
});

test("对数滑块覆盖 2%–800%，往返误差不超过单步的一半", () => {
  assert.equal(sliderToZoom(0), MIN_ZOOM);
  assert.equal(sliderToZoom(100), MAX_ZOOM);
  // 滑块量化到 100 档，每档是 ×(MAX/MIN)^(1/100) ≈ 1.0614 的等比，
  // 所以往返误差的**理论上限**是半个档位 ≈ 3.02%。用 4% 卡住：
  // 既容得下量化，又能在有人把区间改错（例如又塞回 0.25 下限）时报红。
  const stepFactor = Math.pow(MAX_ZOOM / MIN_ZOOM, 1 / 100);
  const bound = (Math.sqrt(stepFactor) - 1) * 1.1;
  assert.ok(bound < 0.05, `单档量化误差 ${(bound * 100).toFixed(2)}% 过大，滑块该加密了`);
  for (const zoom of [MIN_ZOOM, 0.25, 0.5, 1, 2, 8]) {
    const back = sliderToZoom(zoomToSlider(zoom));
    const error = Math.abs(back - zoom) / zoom;
    assert.ok(error < 0.04, `${zoom} 往返后变成 ${back}（偏差 ${(error * 100).toFixed(2)}%）`);
  }
  // 线性刻度下 25% 会落在轨道 3% 处，低倍段挤成一团；对数刻度应把它放到轨道中部
  assert.ok(zoomToSlider(0.25) > 0, "25% 应高于 2% 的滑块下限");
});

test("滑块下限跟随动态下限：大作品左端到适屏比例", () => {
  const floor = 0.0352; // 400×600@900×486 的 minZoom
  assert.equal(sliderToZoom(0, floor), floor, "floor 参数下滑块最左端 = 动态下限");
  assert.equal(sliderToZoom(100, floor), MAX_ZOOM, "右端仍是 800%");
  const back = sliderToZoom(zoomToSlider(floor, floor), floor);
  assert.ok(Math.abs(back - floor) / floor < 0.04, `floor 往返偏差 ${(Math.abs(back - floor) / floor * 100).toFixed(2)}%`);
  // 静态用法（不传 floor）保持默认 2%
  assert.equal(sliderToZoom(0), MIN_ZOOM);
  // 非法 floor 不得把区间压坏
  assert.equal(sliderToZoom(0, 0), MIN_ZOOM, "floor=0 视为未提供");
  assert.equal(sliderToZoom(0, -1), MIN_ZOOM, "负 floor 夹到工程地板");
});

test("focusCell 对安全区内格子不移动，对不可见格子定位且保持 zoom", () => {
  const { viewport, view } = makeViewport(100, 100, 400, 300);
  viewport.setZoom(2);
  const zoom = view().zoom;
  assert.equal(viewport.focusCell(50, 50), false);
  assert.deepEqual(view(), { zoom, panX: 0, panY: 0 });
  assert.equal(viewport.focusCell(99, 99), true);
  assert.equal(view().zoom, zoom);
  const screen = viewport.gridToScreen(99.5, 99.5);
  assert.ok(screen.x >= 60 && screen.x <= 340);
  assert.ok(screen.y >= 45 && screen.y <= 255);
});

test("focusCell 在已有 pan 与高倍 zoom 下仍使用统一坐标转换", () => {
  const { viewport, view } = makeViewport(104, 78, 500, 320);
  viewport.setZoom(6);
  viewport.setPan(-800, 460);
  assert.equal(viewport.focusCell(4, 70, { center: true }), true);
  assert.equal(view().zoom, 6);
  const point = viewport.gridToScreen(4.5, 70.5);
  assert.ok(Math.abs(point.x - 250) < .001);
  assert.ok(Math.abs(point.y - 160) < .001);
});
