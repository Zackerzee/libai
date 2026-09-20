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

test("generation adapter forwards width and maxColors to the existing bridge", async () => {
  const store = createProjectStore({ canvas: { width: 78 }, palette: { maxColors: 38 } });
  let calledWith;
  const bridge = { async generate(options) { calledWith = options; return { width: 78, height: 74, usedColors: 10, totalBeads: 3979, paletteKey: "mard-221", colors: [], sourceUrl: "data:image/png;base64,fixture" }; }, getResult() { return null; } };
  const result = await createGenerationService(bridge, store).generate();
  assert.deepEqual(calledWith, { width: 78, height: 50, maxColors: 38, overwriteApproved: false });
  assert.equal(result.width, 78);
  assert.equal(store.getState().stats.totalBeads, 3979);
});

test("view codes and export preview codes are independent state", () => {
  const store = createProjectStore();
  store.setState({ view: { mode: "pattern", showCodes: true } });
  assert.equal(store.getState().view.showCodes, true);
  assert.equal(store.getState().exportSettings.preview.showCodes, false);
});
