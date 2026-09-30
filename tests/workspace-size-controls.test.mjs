import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");

test("workspace uses a width slider and shows the derived width by height", () => {
  assert.match(workspace, /id="ws-size-input" type="range"[^>]+aria-label="图纸宽度（豆）"/);
  assert.match(workspace, /id="ws-size-value"/);
  assert.match(workspace, /height = clamp\(Math\.round\(width \* sourceRatio\(\)\), 10, 500\)/);
  assert.match(workspace, /sizeInput\.addEventListener\("input"/);
  assert.doesNotMatch(workspace, /data-size-step=/);
});

test("top size controls keep all presets visible without horizontal scrolling", () => {
  for (const size of ["auto", "52", "78", "104"]) assert.match(workspace, new RegExp(`data-size="${size}"`));
  const topRules = css.slice(css.indexOf(".phase2-workspace .ws-top-controls"), css.indexOf("/* ───────── 右栏"));
  assert.match(topRules, /flex-wrap: wrap/);
  assert.match(topRules, /overflow: visible/);
  assert.doesNotMatch(topRules, /overflow-x:\s*auto/);
  assert.match(topRules, /\.ws-top-size[\s\S]+margin-left: 0/);
});

test("pixel multiple controls expose the recalculated size and limit feedback", () => {
  assert.match(workspace, /data-multiple-step="-1"/);
  assert.match(workspace, /data-multiple-step="1"/);
  assert.match(workspace, /倍数 \$\{effectiveMultiple\(\)\}× · \$\{next\.width\} × \$\{next\.height\}/);
  assert.match(workspace, /已到尺寸上限/);
});
