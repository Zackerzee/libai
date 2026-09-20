import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBoundaryFamilies, buildBoundaryRings, buildRAG, enforceMaxPaletteColors, growRegions, presetForGridSize, quantizeRegionAware, rgbToOKLab, validateFinalPattern } from "./region-aware-quantizer.mjs";

const palette = [
  { code: "D", rgb: [30, 25, 22] }, { code: "B", rgb: [130, 82, 52] },
  { code: "H", rgb: [210, 160, 110] }, { code: "W", rgb: [240, 238, 232] },
];

test("OKLab conversion is deterministic", () => {
  assert.deepEqual(rgbToOKLab([120, 80, 60]), rgbToOKLab([120, 80, 60]));
});

test("region growing and RAG only connect spatial neighbors", () => {
  const rgbs = [[120, 80, 50], [122, 81, 51], [240, 240, 240], [240, 240, 240]];
  const cells = rgbs.map((rgb) => ({ rgb, oklab: rgbToOKLab(rgb) }));
  const edges = new Float32Array(4);
  const segmented = growRegions(cells, 2, 2, edges, presetForGridSize(2, 2));
  assert.ok(segmented.regions.length >= 2);
  assert.ok(buildRAG(segmented, cells, edges, 2, 2).length >= 1);
});

test("region aware result is deterministic and preserves blanks", () => {
  const source = [[130, 80, 50], [132, 82, 51], null, [210, 160, 110]];
  const first = quantizeRegionAware(source, 2, 2, palette);
  const second = quantizeRegionAware(source, 2, 2, palette);
  assert.deepEqual(first.grid.map((row) => row.map((c) => c?.code || null)), second.grid.map((row) => row.map((c) => c?.code || null)));
  assert.equal(first.grid[1][0], null);
  assert.ok(first.report.usedColorCount <= palette.length);
});

function budgetFixture() {
  const colors = Array.from({ length: 50 }, (_, i) => ({ code: `C${i}`, rgb: [35 + i * 3, 45 + i * 2, 55 + i * 2] }));
  const matrix = Array.from({ length: 100 }, (_, i) => colors[i % colors.length]);
  const cells = matrix.map((color) => ({ rgb: color.rgb, oklab: rgbToOKLab(color.rgb) }));
  return { colors, matrix, cells };
}

test("hard palette budget enforces 38 and 20 colors", () => {
  for (const maxColors of [38, 20]) {
    const { matrix, cells } = budgetFixture();
    enforceMaxPaletteColors(matrix, 10, 10, { maxColors, cells, edgeMap: new Float32Array(100), regionIds: Int32Array.from({ length: 100 }, (_, i) => Math.floor(i / 5)) });
    const validation = validateFinalPattern([matrix], maxColors);
    assert.equal(validation.valid, true);
    assert.ok(validation.actualColors <= maxColors);
  }
});

test("null maxColors performs no hard reduction", () => {
  const { matrix, cells } = budgetFixture();
  const result = enforceMaxPaletteColors(matrix, 10, 10, { maxColors: null, cells });
  assert.equal(result.report.initialColorCount, 50);
  assert.equal(result.report.finalColorCount, 50);
  assert.equal(result.report.removedColors.length, 0);
});

test("hard reduction is deterministic and protects a high-contrast detail before redundant tones", () => {
  const eye = { code: "EYE", rgb: [5, 5, 5] };
  const tones = Array.from({ length: 5 }, (_, i) => ({ code: `B${i}`, rgb: [120 + i * 2, 80 + i * 2, 55 + i * 2] }));
  const make = () => [eye, ...Array.from({ length: 99 }, (_, i) => tones[i % tones.length])];
  const run = () => {
    const matrix = make(); const cells = matrix.map((color) => ({ rgb: color.rgb, oklab: rgbToOKLab(color.rgb) })); const edgeMap = new Float32Array(100); edgeMap[0] = 1;
    enforceMaxPaletteColors(matrix, 10, 10, { maxColors: 3, cells, edgeMap, regionIds: Int32Array.from({ length: 100 }, (_, i) => i === 0 ? 0 : 1), roles: Array.from({ length: 100 }, (_, i) => i === 0 ? "SHADOW" : "BASE") });
    return matrix.map((color) => color.code);
  };
  const first = run(); const second = run();
  assert.deepEqual(first, second);
  assert.equal(first[0], "EYE");
});

test("low-coverage contaminated boundary sample is traced and stabilized from the interior", () => {
  const width = 8; const height = 8; const brown = [126, 76, 43];
  const source = Array.from({ length: width * height }, () => brown);
  source[3] = [205, 202, 145];
  const coverageMap = new Array(source.length).fill(1); coverageMap[3] = 0.35;
  const samplingProvenance = source.map((rgb, index) => ({ sourceSamplingRectangle: { x: index % width * 3, y: Math.floor(index / width) * 3, width: 3, height: 3 }, sourceRgb: rgb, sourceAlpha: 255, foregroundCoverage: coverageMap[index] }));
  const result = quantizeRegionAware(source, width, height, [
    { code: "DARK", rgb: [78, 43, 26] }, { code: "BROWN", rgb: brown }, { code: "LIGHT", rgb: [176, 119, 70] }, { code: "GREEN", rgb: [108, 145, 78] },
  ], { coverageMap, samplingProvenance });
  const trace = result.tracePixel(3, 0);
  assert.equal(trace.gridCoordinate.x, 3);
  assert.equal(trace.contourBand, 0);
  assert.ok(trace.replacementHistory.some((entry) => entry.stage === "boundary-sample-stabilization"));
  assert.ok(Array.isArray(trace.candidateBeadColors));
  assert.ok(Array.isArray(trace.neighborBeadCodes));
  assert.equal(result.report.boundaryAfter.boundaryOutlierCount, 0);
});

test("Max38 does not increase outliers on a source-consistent boundary", () => {
  const width = 12; const height = 12;
  const palette = Array.from({ length: 44 }, (_, i) => ({ code: `T${i}`, rgb: [70 + i * 3, 42 + i * 2, 24 + i] }));
  palette.push({ code: "GREEN", rgb: [55, 150, 72] });
  const cells = Array.from({ length: width * height }, (_, index) => {
    const x = index % width; const y = Math.floor(index / width); const rgb = x === 0 || y === 0 || x + 1 === width || y + 1 === height ? [122, 73, 42] : palette[index % 44].rgb;
    return { rgb, oklab: rgbToOKLab(rgb) };
  });
  const rings = buildBoundaryRings(cells, width, height);
  const matrix = cells.map((cell, index) => rings[index] === 0 ? palette[18] : palette[index % 44]);
  const before = analyzeBoundaryFamilies(matrix, cells, width, height, rings);
  enforceMaxPaletteColors(matrix, width, height, { maxColors: 38, cells, boundaryRings: rings, regionIds: Int32Array.from({ length: matrix.length }, (_, i) => i) });
  const after = analyzeBoundaryFamilies(matrix, cells, width, height, rings);
  assert.ok(new Set(matrix.map((color) => color.code)).size <= 38);
  assert.ok(after.boundaryOutlierCount <= before.boundaryOutlierCount);
  assert.ok(after.components[0].finalConsistency >= before.components[0].finalConsistency);
});

function contourFixture(withDecoration = false) {
  const width = 104; const height = 104; const source = new Array(width * height).fill(null); const coverageMap = new Array(width * height).fill(0);
  for (let y = 10; y < 94; y += 1) for (let x = 10; x < 94; x += 1) {
    const outer = x === 10 || y === 10 || x === 93 || y === 93;
    const decoration = withDecoration && x >= 48 && x <= 53 && y <= 13;
    source[y * width + x] = decoration ? [224, 174, 48] : outer ? [194, 187, 144] : [126 + ((x + y) % 3) * 8, 76 + ((x + y) % 3) * 5, 43];
    coverageMap[y * width + x] = outer ? 0.36 : 1;
  }
  const palette = [
    { code: "DARK_BROWN", rgb: [72, 39, 22] }, { code: "BROWN", rgb: [126, 76, 43] }, { code: "LIGHT_BROWN", rgb: [178, 119, 68] },
    { code: "YELLOW", rgb: [226, 175, 45] }, { code: "GREEN", rgb: [54, 145, 70] }, { code: "BLUE", rgb: [55, 90, 180] }, { code: "GRAY", rgb: [155, 158, 157] },
  ];
  return { width, height, source, coverageMap, palette };
}

test("104x104 anti-aliased outer contour cannot introduce an unsupported hue family", () => {
  const fixture = contourFixture(false);
  const result = quantizeRegionAware(fixture.source, fixture.width, fixture.height, fixture.palette, { coverageMap: fixture.coverageMap, maxColors: 6 });
  assert.equal(result.report.contour.contourOutlierCount, 0);
  assert.equal(result.report.contour.shortContourRuns, 0);
  assert.ok(result.report.usedColorCount <= 6);
  const contourCodes = result.contourDebug.sequences.flat().map((index) => result.grid[Math.floor(index / fixture.width)][index % fixture.width].code);
  assert.equal(contourCodes.some((code) => ["GREEN", "BLUE", "GRAY"].includes(code)), false);
});

test("a source-supported yellow contour decoration survives contour run cleanup", () => {
  const fixture = contourFixture(true);
  const result = quantizeRegionAware(fixture.source, fixture.width, fixture.height, fixture.palette, { coverageMap: fixture.coverageMap });
  const decorationCodes = Array.from({ length: 6 }, (_, offset) => result.grid[10][48 + offset]?.code);
  assert.ok(decorationCodes.filter((code) => code === "YELLOW").length >= 3);
  assert.equal(result.report.contour.contourOutlierCount, 0);
});
