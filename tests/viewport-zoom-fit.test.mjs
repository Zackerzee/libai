/**
 * 缩放「适配窗口」回归守卫。
 *
 * 为什么需要它：viewport-service 的缩放下限原先是 25%，而 fitToViewport() 算出的
 * 适配缩放会先被 clampZoom 夹到这个下限上。180 豆 × 20px = 3600px，画布区宽约 1140px 时
 * 需要的适配缩放是 0.14——夹到 0.25 之后图纸被画成 2500px，永远有一大半露在窗口外，
 * 用户「缩小到能看全」这个诉求在旧口径下**根本无解**（点 − 到底也只有 25%）。
 * 上限 8 是合理的，下限必须低到能让整幅图纸落进窗口。
 *
 * 判定口径：
 *   - 任意 (图纸尺寸, 窗口尺寸) 组合下 fitToViewport() 后图纸必须真的在窗口内 → 硬失败项
 *   - clampZoom 的下限必须等于 MIN_ZOOM，且不能把合法的 0 当成无效值 → 硬失败项
 *   - zoomOut 必须能一路走到 MIN_ZOOM（旧版固定 ±25 个百分点，在下限附近会卡住）→ 硬失败项
 *
 * 只测纯函数与纯几何，不碰 DOM：ZoomControls 的档位/滑块映射复用同一组常量，
 * 所以这里的断言同时守住了 UI 侧。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CELL, MIN_ZOOM, MAX_ZOOM, ZOOM_STEPS, clampZoom,
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

test("clampZoom 下限等于 MIN_ZOOM，且不再把 25% 当硬底", () => {
  assert.equal(clampZoom(0.23), 0.23, "0.23 是合法的适配缩放，不能抬到 0.25");
  assert.equal(clampZoom(0), MIN_ZOOM, "0 是合法输入（滑块最左端），不能被 `|| 1` 吞掉");
  assert.equal(clampZoom(-5), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom("abc"), 1, "非数值才回落到 1");
  assert.ok(MIN_ZOOM < 0.25, "下限必须低于 25%，否则适配会被卡住");
});

test("fitToViewport 后图纸必须真的落在窗口内", () => {
  const cases = [
    { grid: 52, view: [1140, 559] },
    { grid: 104, view: [1140, 559] },
    { grid: 180, view: [1140, 559] },   // 本次修复的真实场景
    { grid: 180, view: [700, 500] },
    { grid: 200, view: [640, 480] },
    { grid: 500, view: [1140, 559] },   // 手动可输入的最大边长
    { grid: 500, view: [420, 380] },    // 窄窗口 + 最大图纸
  ];
  for (const { grid, view: [vw, vh] } of cases) {
    const { viewport, view } = makeViewport(grid, grid, vw, vh);
    viewport.fitToViewport();
    const zoom = view().zoom;
    const drawnW = grid * BASE_CELL * zoom;
    const drawnH = grid * BASE_CELL * zoom;
    assert.ok(zoom >= MIN_ZOOM, `${grid}@${vw}x${vh}: 缩放 ${zoom} 不得低于下限`);
    assert.ok(drawnW <= vw, `${grid}@${vw}x${vh}: 图纸宽 ${drawnW}px 溢出窗口 ${vw}px`);
    assert.ok(drawnH <= vh, `${grid}@${vw}x${vh}: 图纸高 ${drawnH}px 溢出窗口 ${vh}px`);
  }
});

test("适配之后仍然能继续缩小，且 zoomOut 能走到下限", () => {
  const { viewport, view } = makeViewport(180, 180, 1140, 559);
  viewport.fitToViewport();
  const fitted = view().zoom;
  viewport.zoomOut();
  assert.ok(view().zoom < fitted, `适配后 zoomOut 必须还能变小：${fitted} → ${view().zoom}`);

  let guard = 0;
  while (view().zoom > MIN_ZOOM + 1e-9 && guard < 200) { viewport.zoomOut(); guard += 1; }
  assert.equal(view().zoom, MIN_ZOOM, "zoomOut 应能一路走到 MIN_ZOOM");
  assert.ok(guard < 200, "zoomOut 不应陷入死循环");
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
  for (const zoom of [MIN_ZOOM, 0.05, 0.1, 0.14, 0.25, 0.5, 1, 2, 8]) {
    const back = sliderToZoom(zoomToSlider(zoom));
    const error = Math.abs(back - zoom) / zoom;
    assert.ok(error < 0.04, `${zoom} 往返后变成 ${back}（偏差 ${(error * 100).toFixed(2)}%）`);
  }
  // 线性刻度下 25% 会落在轨道 3% 处，低倍段挤成一团；对数刻度应把它放到轨道中部
  assert.ok(zoomToSlider(0.25) > 15, "25% 不该挤在滑块最左端");
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
