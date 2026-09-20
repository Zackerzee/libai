import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = JSON.parse(readFileSync(new URL("./legacy-baseline.json", import.meta.url), "utf8"));
const post = JSON.parse(readFileSync(new URL("./post-refactor-snapshots.json", import.meta.url), "utf8"));
const expected = [...base.cases.map((item) => ({ ...item, fixture: "images.png" })), ...base.additionalFixtures.map((item) => ({ ...item, fixture: "libai-logo.png" }))];

test("browser-captured post-refactor matrices match frozen legacy snapshots", () => {
  assert.equal(post.cases.length, expected.length);
  for (const before of expected) {
    const after = post.cases.find((item) => item.fixture === before.fixture && item.requestedWidth === before.requestedWidth && item.requestedMaxColors === before.requestedMaxColors);
    assert.ok(after, `missing ${before.fixture} ${before.requestedWidth}`);
    for (const field of ["width", "height", "usedColors", "totalBeads", "matrixHash"]) assert.equal(after[field], before[field], `${before.fixture} ${before.requestedWidth} ${field}`);
    assert.deepEqual(after.paletteCodeDistribution, before.paletteCodeDistribution);
    assert.ok(after.usedColors <= after.requestedMaxColors);
    assert.equal(Object.values(after.paletteCodeDistribution).reduce((sum, count) => sum + count, 0), after.totalBeads);
  }
});
