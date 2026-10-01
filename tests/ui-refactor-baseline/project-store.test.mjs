import test from "node:test";
import assert from "node:assert/strict";
import { createProjectStore } from "../../state/project-store.js";
import { createGenerationService } from "../../services/generation-service.js";

test("project store updates a section without replacing the Color Grid source", () => {
  const store = createProjectStore(); const updates = [];
  const unsubscribe = store.subscribe((_state, patch) => updates.push(patch));
  store.setState({ palette: { maxColors: 38 } });
  assert.equal(store.getState().palette.maxColors, 38);
  assert.equal(store.getState().palette.id, "mard-221");
  assert.equal(store.getState().canvas.width, 50);
  assert.equal(updates.length, 1);
  unsubscribe(); store.setState({ view: { showCodes: true } });
  assert.equal(updates.length, 1);
});

test("generation adapter forwards maxColors but never invents a size from the canvas snapshot", async () => {
  const store = createProjectStore({ canvas: { width: 78 }, palette: { maxColors: 38 } });
  let calledWith;
  const bridge = { async generate(options) { calledWith = options; return { width: 78, height: 74, usedColors: 10, totalBeads: 3979, paletteKey: "mard-221", colors: [], sourceUrl: "data:image/png;base64,fixture" }; }, getResult() { return null; } };
  const result = await createGenerationService(bridge, store).generate();
  // canvas.* 是生成结果的回写命名空间，不是入参：不显式给尺寸就一个都不转发，
  // 让 bridge 自己按「长边 + 有效比例」派生（否则上一版图纸尺寸会冲掉顶栏的选择）。
  assert.deepEqual(calledWith, { maxColors: 38, overwriteApproved: false });
  assert.equal(result.width, 78);
  assert.equal(store.getState().stats.totalBeads, 3979);
  // 回写仍然照常：canvas 记录这一版实际多少格。
  assert.equal(store.getState().canvas.width, 78);
  assert.equal(store.getState().canvas.height, 74);
});

test("generation adapter forwards an explicitly requested size", async () => {
  const store = createProjectStore({ canvas: { width: 78, height: 74 } });
  let calledWith;
  const bridge = { async generate(options) { calledWith = options; return { width: 222, height: 295, usedColors: 1, totalBeads: 1, paletteKey: "mard-221", colors: [] }; }, getResult() { return null; } };
  await createGenerationService(bridge, store).generate({ width: 222, height: 295 });
  assert.deepEqual(calledWith, { width: 222, height: 295, maxColors: 0, overwriteApproved: false });
});

test("view codes and export preview codes are independent state", () => {
  const store = createProjectStore();
  store.setState({ view: { mode: "pattern", showCodes: true } });
  assert.equal(store.getState().view.showCodes, true);
  assert.equal(store.getState().exportSettings.preview.showCodes, false);
});
