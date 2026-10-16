import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = appSource.indexOf("let availablePalettePreferencesLoaded = false;");
const end = appSource.indexOf("function getEditorPalette()", start);
assert.ok(start >= 0 && end > start, "extract actual available-color production functions");
const code = appSource.slice(start, end);
const colors = [{ paletteId: "a", code: "H5", rgb: [1, 2, 3] }, { paletteId: "b", code: "H6", rgb: [1, 2, 3] }, { code: "H7", rgb: [4, 5, 6] }];
function harness(saved = null, shared = new Map()) {
  if (saved !== null) shared.set("libms.available-palettes.v1", JSON.stringify(saved));
  let currentKey = "brand-one";
  const context = vm.createContext({ structuredClone, console, getCurrentPalette: () => colors, getCurrentPaletteKey: () => currentKey,
    localStorage: { getItem: (key) => shared.get(key) ?? null, setItem: (key, value) => shared.set(key, value) }, setStatus() {} });
  context.window = context;
  vm.runInContext(fs.readFileSync(new URL("../state/store.js", import.meta.url), "utf8"), context);
  vm.runInContext(code, context);
  return { context, shared, switchPalette(key) { currentKey = key; } };
}
const ids = (palette) => Array.from(palette, (color) => color.paletteId || color.code);
test("actual browser store is window.libmsStore and null means complete palette", () => {
  const { context: c } = harness();
  assert.ok(c.window.libmsStore.getState().paletteState.availableColorsByPalette);
  assert.equal(c.getAvailablePaletteIds(), null);
  assert.deepEqual(ids(c.getGenerationPaletteColors()), ["a", "b", "H7"]);
  c.setAvailablePaletteIds(["a"]); c.setAvailablePaletteIds(null);
  assert.deepEqual(ids(c.getGenerationPaletteColors()), ["a", "b", "H7"]);
});
test("empty palette preference means none and cannot silently generate using all colors", () => {
  const { context: c } = harness(); c.setAvailablePaletteIds([]);
  assert.equal(c.getAvailablePaletteIds().length, 0);
  assert.throws(() => c.getGenerationPaletteColors(), /至少选择一种/);
});
test("same RGB remains separate by palette identity and invalid IDs cannot enter generation", () => {
  const { context: c } = harness();
  const result = c.setAvailablePaletteIds(["b", "b", "unknown"]);
  assert.equal(result.count, 1); assert.deepEqual(ids(c.getGenerationPaletteColors()), ["b"]);
  c.setAvailablePaletteIds(["a", "b"]);
  assert.deepEqual(ids(c.getGenerationPaletteColors()), ["a", "b"]);
  c.setAvailablePaletteIds(["unknown"]);
  assert.throws(() => c.getGenerationPaletteColors(), /至少选择一种/);
  assert.equal(colors.length, 3);
});
test("preferences persist locally, stay isolated by palette and never modify canonical grid", () => {
  const h = harness(); const c = h.context;
  const before = JSON.stringify(c.libmsStore.getState().gridState);
  c.setAvailablePaletteIds(["a"]); h.switchPalette("brand-two");
  assert.equal(c.getAvailablePaletteIds(), null); c.setAvailablePaletteIds(["H7"]);
  h.switchPalette("brand-one"); assert.deepEqual(ids(c.getGenerationPaletteColors()), ["a"]);
  const reopened = harness(null, h.shared).context;
  assert.deepEqual(ids(reopened.getGenerationPaletteColors()), ["a"]);
  assert.equal(JSON.stringify(c.libmsStore.getState().gridState), before);
});
test("corrupt local preferences cannot block opening a workbench", () => {
  const shared = new Map([["libms.available-palettes.v1", "broken-json"]]);
  const { context: c } = harness(null, shared);
  assert.equal(c.getAvailablePaletteIds(), null);
  assert.deepEqual(ids(c.getGenerationPaletteColors()), ["a", "b", "H7"]);
});
