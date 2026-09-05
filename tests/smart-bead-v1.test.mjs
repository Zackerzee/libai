import assert from "node:assert/strict";
const module = await import("../smart-bead-v1.js");
const engine = globalThis.SmartBeadV1 || module.default;

assert.equal(engine.resolveOptions({ preset: "portrait" }, 52, 52).skinBrightening, 20);
assert.equal(engine.resolveOptions({ preset: "chibi" }, 104, 104).outlineStrength, 80);
assert.equal(engine.clamp(200), 100);
assert.equal(engine.clamp(-2), 0);

const palette = [
  { code: "A", rgb: [220, 180, 160] },
  { code: "B", rgb: [20, 20, 20] },
  { code: "C", rgb: [215, 175, 155] },
];
const base = { width: 3, height: 3, grid: [
  palette[1], palette[1], palette[1],
  palette[1], palette[0], palette[1],
  palette[1], palette[1], palette[1],
] };

const disabled = engine.applyToResult(base, palette, { enabled: false, preset: "portrait" });
assert.deepEqual(disabled.grid, base.grid);

const noCleanup = engine.applyToResult(base, palette, { enabled: true, preset: "standard", blockCleanup: 0 });
assert.equal(noCleanup.grid[4].code, "A");

const cleanupFixture = { width: 3, height: 3, grid: [
  palette[1], palette[2], palette[2],
  palette[2], palette[0], palette[2],
  palette[2], palette[2], palette[2],
] };
const cleaned = engine.applyToResult(cleanupFixture, palette, { enabled: true, preset: "chibi", blockCleanup: 100, detailPreservation: 0 });
assert.equal(cleaned.summary.includes("净化7格"), true);

const edgeCase = { width: 3, height: 3, grid: [
  palette[1], palette[1], palette[1],
  palette[1], palette[0], palette[1],
  palette[1], palette[1], palette[1],
] };
const protectedResult = engine.applyToResult(edgeCase, palette, { enabled: true, preset: "portrait", blockCleanup: 100, detailPreservation: 100 });
assert.equal(protectedResult.grid[4].code, "A");

assert.equal(engine.getSizeProfile(52, 52), "small");
assert.equal(engine.getSizeProfile(78, 78), "medium");
assert.equal(engine.getSizeProfile(104, 104), "large");

console.log("smart-bead-v1 tests passed");
