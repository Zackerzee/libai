import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../ui/palette-color-picker.js", import.meta.url), "utf8");
test("replacement picker displays real palette swatches and codes", () => {
  assert.match(source, /getColors\(\)/);
  assert.match(source, /button\.style\.backgroundColor = colorCss\(color\)/);
  assert.match(source, /button\.textContent = color\.code/);
  assert.match(source, /button\.style\.color = colorLabelInk\(color\)/);
  assert.match(source, /input\.removeAttribute\("list"\)/);
});
test("replacement picker retains existing input and dispatches change, never replaces grid", () => {
  assert.match(source, /host\.append\(input\)/);
  assert.match(source, /input\.value = String\(color\.paletteId \|\| color\.code\)/);
  assert.match(source, /input\.dispatchEvent\(new Event\("change"/);
  assert.doesNotMatch(source, /replaceColor\(|applyCellChanges|canonical/);
});
