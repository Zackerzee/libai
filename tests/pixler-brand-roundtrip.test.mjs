import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPixlerProject } from "../services/pixler-exporter.js";
import { importPixlerProject } from "../importers/pixler.mjs";

test("Pixler roundtrip preserves mixed-brand same-code colors and identities", async () => {
  const hama = { paletteId: "hama:H01", code: "H01", rgb: [229, 236, 241] };
  const legacy = { code: "H01", rgb: [255, 255, 255] };
  const { project, report } = await importPixlerProject(await buildPixlerProject([[hama, legacy, null]]));
  assert.deepEqual(project.grid, [["H01", "H01", null]]);
  assert.deepEqual(project.gridPaletteIds, [["hama:H01", "H01", null]]);
  assert.deepEqual(project.colors.find(c => c.paletteId === "hama:H01").rgb, hama.rgb);
  assert.deepEqual(project.colors.find(c => c.paletteId === "H01").rgb, legacy.rgb);
  assert.equal(project.stats.usedColors, 2);
  assert.equal(report.algorithm.brandId, "mixed");
});

test("Pixler roundtrip preserves distinct identities even when RGB is identical", async () => {
  const rgb = [255, 255, 255];
  const { project } = await importPixlerProject(await buildPixlerProject([[
    { paletteId: "hama:H01", code: "H01", rgb }, { paletteId: "mard:H01", code: "H01", rgb },
  ]]));
  assert.deepEqual(project.gridPaletteIds, [["hama:H01", "mard:H01"]]);
  assert.equal(project.colors.length, 2);
});

test("Pixler single-brand export metadata does not mislabel Hama as MARD", async () => {
  const { report } = await importPixlerProject(await buildPixlerProject([
    [{ paletteId: "hama:H01", code: "H01", rgb: [229, 236, 241] }],
  ], { paletteLabel: "Hama Midi 92" }));
  assert.equal(report.algorithm.brandId, "hama");
  assert.equal(report.catalog.label, "Hama Midi 92");
});

test("Pixler MARD 291 catalog does not invent standard-221 series", async () => {
  const { project, report } = await importPixlerProject(await buildPixlerProject([
    [{ paletteId: "mard:H01", code: "H01", rgb: [255, 255, 255] }],
  ], { paletteLabel: "MARD 291" }));
  assert.equal(report.algorithm.brandId, "mard");
  assert.equal(report.algorithm.seriesId, null);
  assert.equal(project.palette.label, "MARD 291");
  assert.equal(project.palette.key, "pixler-import");
});

test("Pixler legacy COCO codes retain catalog without guessing MARD identity", async () => {
  const { project, report } = await importPixlerProject(await buildPixlerProject([
    [{ code: "H01", rgb: [230, 230, 230] }],
  ], { paletteLabel: "COCO 221" }));
  assert.equal(report.algorithm.brandId, "unknown");
  assert.equal(report.algorithm.seriesId, null);
  assert.equal(project.palette.label, "COCO 221");
});
