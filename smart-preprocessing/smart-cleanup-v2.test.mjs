import test from "node:test";
import assert from "node:assert/strict";
import { smartCleanup, findConnectedComponents, findReplacement } from "./smart-cleanup-v2.mjs";
import { buildProtectionMap, calculateSourceEvidence } from "./detail-protection-v2.mjs";

function makeImage(w, h) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}
function setPixel(img, x, y, r, g, b, a = 255) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

const DARK_BROWN = { code: "D1", rgb: [90, 60, 40] };
const GRAY_BROWN = { code: "D2", rgb: [120, 90, 60] }; // 采样平均产生的杂色
const WHITE = { code: "A1", rgb: [255, 255, 255] };

const getColorKey = (cell) => cell.code;
const getRGB = (cell) => [cell.rgb[0], cell.rgb[1], cell.rgb[2]];

function grid3x3(center, surround) {
  return [
    [{ ...surround }, { ...surround }, { ...surround }],
    [{ ...surround }, { ...center }, { ...surround }],
    [{ ...surround }, { ...surround }, { ...surround }],
  ];
}

function sourceAllDark() {
  const img = makeImage(3, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, 90, 60, 40);
  return img;
}

test("connected components group same-color regions, not global color counts", () => {
  // 两个分离的 D1 区域 + 一个 D2
  const grid = [
    [{ ...DARK_BROWN }, { ...GRAY_BROWN }, { ...DARK_BROWN }],
    [{ ...GRAY_BROWN }, { ...GRAY_BROWN }, { ...GRAY_BROWN }],
    [{ ...DARK_BROWN }, { ...GRAY_BROWN }, { ...DARK_BROWN }],
  ];
  const components = findConnectedComponents(grid, getColorKey);
  const darkComponents = components.filter((c) => c.key === "D1");
  // 四个角 D1 是四个独立 1-cell component（被 D2 隔开），不是 1 个 4-cell
  assert.equal(darkComponents.length, 4);
  assert.ok(components.find((c) => c.key === "D2").cells.length === 5);
});

test("isolated gray-brown noise with no source evidence merges into surrounding dark-brown", () => {
  const grid = grid3x3(GRAY_BROWN, DARK_BROWN);
  const source = sourceAllDark(); // source 中央是深棕，无灰棕证据
  const protection = buildProtectionMap({ grid, width: 3, height: 3, sourceImageData: source, sameCell: (a, b) => a.code === b.code });
  const { grid: out, records } = smartCleanup({
    grid,
    getColorKey,
    getRGB,
    protectionMap: protection.protectionMap,
    getSourceEvidence: (x, y, rgb) => calculateSourceEvidence(source, { x0: x, y0: y, x1: x + 1, y1: y + 1 }, rgb),
  });
  assert.equal(out[1][1].code, "D1", "noise cell should merge to dark-brown");
  assert.ok(records.length >= 1);
  assert.ok(records[0].reason && records[0].componentSize && typeof records[0].replacementCost === "number");
});

test("real highlight (source has bright pixel) survives cleanup", () => {
  const grid = grid3x3(WHITE, DARK_BROWN);
  const source = sourceAllDark();
  setPixel(source, 1, 1, 255, 255, 255); // 真实高光
  const protection = buildProtectionMap({ grid, width: 3, height: 3, sourceImageData: source, sameCell: (a, b) => a.code === b.code });
  assert.ok(protection.protectionMap[4] >= 0.5, "highlight must be protected first");
  const { grid: out } = smartCleanup({
    grid,
    getColorKey,
    getRGB,
    protectionMap: protection.protectionMap,
    getSourceEvidence: (x, y, rgb) => calculateSourceEvidence(source, { x0: x, y0: y, x1: x + 1, y1: y + 1 }, rgb),
  });
  assert.equal(out[1][1].code, "A1", "real highlight must survive");
});

test("findReplacement prefers neighbor colors over global nearest", () => {
  const grid = [
    [{ ...DARK_BROWN }, { ...DARK_BROWN }, { ...DARK_BROWN }],
    [{ ...DARK_BROWN }, { ...GRAY_BROWN }, { ...DARK_BROWN }],
    [{ ...DARK_BROWN }, { ...DARK_BROWN }, { ...DARK_BROWN }],
  ];
  const rep = findReplacement(grid, 1, 1, GRAY_BROWN, getColorKey, getRGB);
  assert.equal(rep.key, "D1");
  assert.equal(rep.count, 8);
});
