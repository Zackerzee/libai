import test from "node:test";
import assert from "node:assert/strict";
import { generateV2, compareGrids, DEFAULT_GENERATION_V2_CONFIG } from "./generation-engine-v2.mjs";
import { MODE_PROFILES } from "../services/mode-profile.mjs";

function makeImage(w, h) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}
function setPixel(img, x, y, r, g, b, a = 255) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

// 简化色板（8 色）
const PALETTE = [
  { code: "C1", rgb: [255, 255, 255] },
  { code: "C2", rgb: [0, 0, 0] },
  { code: "C3", rgb: [255, 0, 0] },
  { code: "C4", rgb: [0, 255, 0] },
  { code: "C5", rgb: [0, 0, 255] },
  { code: "C6", rgb: [255, 255, 0] },
  { code: "C7", rgb: [0, 255, 255] },
  { code: "C8", rgb: [255, 0, 255] },
];

function makeTestSource() {
  const img = makeImage(40, 40);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    // 左上红色，右下蓝色，对角渐变
    setPixel(img, x, y, Math.round(255 * x / 39), Math.round(128), Math.round(255 * y / 39));
  }
  return img;
}

test("generateV2 produces a full grid + diagnostics", () => {
  const source = makeTestSource();
  const result = generateV2({ source, width: 20, height: 20, palette: PALETTE, options: { maxColors: 0 } });
  assert.equal(result.width, 20);
  assert.equal(result.height, 20);
  assert.equal(result.grid.length, 20);
  assert.equal(result.grid[0].length, 20);
  assert.ok(result.diagnostics.samplingMode);
  assert.equal(result.diagnostics.paletteMatcher, "palette-engine");
  assert.ok(result.diagnostics.colorsAfterCleanup > 0);
  assert.ok(result.diagnostics.protectionMap instanceof Float32Array);
});

test("generateV2 is deterministic across 5 runs", () => {
  const source = makeTestSource();
  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = generateV2({ source, width: 20, height: 20, palette: PALETTE, options: { maxColors: 6 } });
    results.push(JSON.stringify(r.grid.map((row) => row.map((c) => (c ? c.code : null)))));
  }
  for (let i = 1; i < results.length; i++) assert.equal(results[i], results[0]);
});

test("maxColors=0 means AUTO (no forced cap) but cleanup still runs", () => {
  const source = makeTestSource();
  const result = generateV2({ source, width: 20, height: 20, palette: PALETTE, options: { maxColors: 0 } });
  assert.equal(result.diagnostics.forcedProtectedMerges, 0);
  assert.equal(result.diagnostics.budgetMerges, 0);
});

test("maxColors cap is enforced when requested", () => {
  const source = makeTestSource();
  const result = generateV2({ source, width: 20, height: 20, palette: PALETTE, options: { maxColors: 4 } });
  const colors = new Set(result.grid.flat().filter(Boolean).map((c) => c.code));
  assert.ok(colors.size <= 4, `expected <=4 colors, got ${colors.size}`);
});

test("compareGrids reports changed cells between legacy and v2", () => {
  const legacy = [[{ code: "C1" }, { code: "C2" }], [{ code: "C1" }, { code: "C2" }]];
  const v2 = [[{ code: "C1" }, { code: "C3" }], [{ code: "C1" }, { code: "C2" }]];
  const cmp = compareGrids(legacy, v2);
  assert.equal(cmp.changedCells, 1);
  assert.equal(cmp.colorCountLegacy, 2);
  assert.equal(cmp.colorCountV2, 3);
});

test("engine defaults are not a mode table, and sampling can still be overridden", () => {
  // Stage B4 §2：引擎里**不再有** GenerationProfiles（那张表生产链路不可达，已删）。
  // 模式表只有一份来源 —— services/mode-profile.mjs。这里顺手断言它还在，
  // 免得「模式表被删干净了」这件事没人发现。
  assert.equal(MODE_PROFILES.pixel.sampling, "center");
  assert.equal(MODE_PROFILES.anime.sampling, "dominant");
  assert.equal(DEFAULT_GENERATION_V2_CONFIG.maxColors, 0);
  // 引擎默认值里不应再出现 preset 这个键 —— 它曾经是「回落到 photo」的入口。
  assert.equal("preset" in DEFAULT_GENERATION_V2_CONFIG, false);
  // 用户可以 Anime 模式 + 手动 Linear Mean
  const source = makeTestSource();
  const r = generateV2({ source, width: 10, height: 10, palette: PALETTE, options: { sampling: "linear-mean" } });
  assert.equal(r.diagnostics.requestedSampling, "linear-mean");
  assert.equal(r.diagnostics.samplingMode, "linear-mean");
});
