import test from "node:test";
import assert from "node:assert/strict";
import { sampleGridAdaptive, analyzeImageProfile, extractCellFeatures, cellBounds, IMAGE_PROFILE, IMAGE_PROFILE_WEIGHTS } from "../../smart-preprocessing/sampling-engine-v2.mjs";

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = fn(x, y);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function extractFeatures(img, gw, gh) {
  const grid = [];
  for (let y = 0; y < gh; y++) {
    grid[y] = [];
    for (let x = 0; x < gw; x++) {
      grid[y][x] = extractCellFeatures(img, cellBounds(x, y, img.width, img.height, gw, gh), {});
    }
  }
  return grid;
}

test("profile-photo: continuous gradient detects PHOTO", () => {
  const img = makeImage(32, 32, (x, y) => [x * 8, x * 8, x * 8]);
  const fg = extractFeatures(img, 8, 8);
  const p = analyzeImageProfile(fg, 8, 8);
  assert.equal(p.profile, IMAGE_PROFILE.PHOTO, `gradient should be PHOTO, got ${p.profile}`);
  assert.ok(p.scores.PHOTO > p.scores.ILLUSTRATION, "photo score should dominate");
});

test("profile-illustration: flat color blocks detect ILLUSTRATION", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x < 16 && y < 16) return [20, 20, 20];
    if (x >= 16 && y < 16) return [200, 50, 50];
    if (x < 16 && y >= 16) return [50, 200, 50];
    return [50, 50, 200];
  });
  const fg = extractFeatures(img, 8, 8);
  const p = analyzeImageProfile(fg, 8, 8);
  assert.equal(p.profile, IMAGE_PROFILE.ILLUSTRATION, `color blocks should be ILLUSTRATION, got ${p.profile}`);
});

test("profile-pixel: two-color hard edge detects PIXEL_GRAPHIC", () => {
  const img = makeImage(32, 32, (x, y) => (x < 16 ? [0, 0, 0] : [255, 255, 255]));
  const fg = extractFeatures(img, 8, 8);
  const p = analyzeImageProfile(fg, 8, 8);
  assert.equal(p.profile, IMAGE_PROFILE.PIXEL_GRAPHIC, `two-color should be PIXEL_GRAPHIC, got ${p.profile}`);
});

test("profile weights map exists for all profiles", () => {
  for (const key of Object.values(IMAGE_PROFILE)) {
    assert.ok(IMAGE_PROFILE_WEIGHTS[key], `weights should exist for ${key}`);
    const w = IMAGE_PROFILE_WEIGHTS[key];
    assert.ok(w.linearMean > 0 && w.center > 0 && w.dominant > 0 && w.edgeAware > 0);
  }
});

test("photo-large-stable-region: photo with large dark block produces Dominant", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x < 16) return [x * 8, x * 8, x * 8]; // 渐变
    return [30, 30, 30]; // 大稳定黑块
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  assert.ok(r.imageProfile, "autoProfile should produce imageProfile");
  assert.ok(r.distribution.dominant > 0, `large stable block should produce dominant, got ${JSON.stringify(r.distribution)}`);
});

test("illustration-stable-block: illustration stable region stays Dominant", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x < 16 && y < 16) return [200, 50, 50]; // 大红块
    if (x >= 16 && y < 16) return [20, 20, 20]; // 黑块
    if (x < 16 && y >= 16) return [50, 200, 50]; // 绿块
    return [50, 50, 200]; // 蓝块
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  assert.ok(r.distribution.dominant > r.distribution.linearMean, `illustration should favor dominant, got ${JSON.stringify(r.distribution)}`);
});

test("manual-preset-override: manual preset does NOT trigger autoProfile", () => {
  const img = makeImage(32, 32, (x, y) => [x * 8, x * 8, x * 8]);
  const r = sampleGridAdaptive(img, 8, 8, { preset: "photo" }); // 不传 autoProfile
  assert.equal(r.imageProfile, null, "manual preset should not run autoProfile");
  assert.equal(r.stableRegions, null, "manual preset should not run stable regions");
});
