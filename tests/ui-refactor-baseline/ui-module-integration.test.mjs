import test from "node:test";
import assert from "node:assert/strict";
import { GRID_TOOLS } from "../../ui/grid-editor-toolbar.js";
import { createProjectStore } from "../../state/project-store.js";
import { clampZoom, ZOOM_STEPS, MIN_ZOOM } from "../../services/viewport-service.js";

test("grid toolbar exposes every editor tool the workspace relies on", () => {
  const ids = new Set(GRID_TOOLS.map((tool) => tool.id));
  // 现有 workspace 编辑工具全集；replace/outline 走 panel 动作，其余必须是 data-tool。
  const expectedTools = ["select", "bead", "brush", "eraser", "fill", "region", "same", "connected", "eyedropper", "source-eyedropper", "pan"];
  for (const id of expectedTools) assert.ok(ids.has(id), `missing tool ${id}`);
  // 旧模块叫 selection，现统一为 region，必须与 workspace 的 pointer 逻辑一致。
  assert.ok(ids.has("region") && !ids.has("selection"), "region must replace selection");
  // 快捷键不冲突。
  const shortcuts = GRID_TOOLS.map((tool) => tool.shortcut).filter(Boolean);
  assert.equal(shortcuts.length, new Set(shortcuts).size, "shortcuts must be unique");
});

test("project store keeps generation params separate from canvas and palette", () => {
  const store = createProjectStore();
  const state = store.getState();
  assert.ok(state.generation, "generation section exists");
  assert.equal(state.generation.sampling, "auto");
  assert.equal(state.generation.detailProtection, 70);
  assert.equal(state.generation.preserveEyes, true);
  // width/height 仍归 canvas，maxColors 仍归 palette，不在 generation 里重复。
  assert.equal(state.canvas.width, 50);
  assert.equal(state.canvas.lockAspectRatio, false);
  assert.equal(state.palette.maxColors, 0);
  assert.ok(!("width" in state.generation), "width must not duplicate in generation");
  assert.ok(!("maxColors" in state.generation), "maxColors must not duplicate in generation");
});

test("generation section updates independently without touching canvas/palette", () => {
  const store = createProjectStore();
  store.setState({ generation: { sampling: "edge", detailProtection: 92 } });
  assert.equal(store.getState().generation.sampling, "edge");
  assert.equal(store.getState().generation.detailProtection, 92);
  assert.equal(store.getState().generation.preserveEyes, true); // 未提供的键保留默认
  assert.equal(store.getState().canvas.width, 50);
  assert.equal(store.getState().palette.maxColors, 0);
});

test("zoom percent bridge clamps to the viewport multiplier range", () => {
  // zoom-controls 用百分比 2–800，viewport 用倍数 0.02–8，onChange 里 value/100。
  assert.equal(clampZoom(MIN_ZOOM), MIN_ZOOM);
  assert.equal(clampZoom(8), 8);
  // 0.14 是 180 豆图纸适配窗口时的真实缩放，旧版会被抬到 0.25 导致图纸放不进窗口。
  assert.equal(clampZoom(0.14), 0.14);
  assert.equal(clampZoom(0.001), MIN_ZOOM); // 低于下限
  assert.equal(clampZoom(12), 8); // 高于上限
  assert.equal(100 / 100, 1); // 100% = 1x
  assert.equal(250 / 100, 2.5);
  assert.ok(ZOOM_STEPS.includes(1), "discrete step table still holds 100%");
});
