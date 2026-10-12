import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPixlerProject } from "../services/pixler-exporter.js";
import { importPixlerProject } from "../importers/pixler.mjs";
import { decodeAppliedGrid } from "../services/applied-project-archive.mjs";
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const module = { exports: {} };
runInNewContext(readFileSync(new URL('../vendor/fflate.js',import.meta.url),'utf8'),{module,exports:module.exports,require:createRequire(import.meta.url),Uint8Array,Uint16Array,Uint32Array,Int32Array});
const fflate = globalThis.fflate = module.exports;

const colors = [
  { paletteId: "mard:A01", code: "A01", rgb: [100, 120, 140], name: "保护色" },
  { paletteId: "perler:A01", code: "A01", rgb: [100, 120, 140], name: "同 RGB 不同品牌" },
  { paletteId: "perler:B02", code: "B02", rgb: [200, 190, 180] },
];
const metadata = { enabled: true, strength: 60, algorithmVersion: "v1", paletteKey: "perler-test", baselineRevision: 1, appliedRevision: "1:apply:2", hierarchy: "must not save" };
const fixture = size => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x + y) % 7 === 0 ? null : structuredClone(colors[(x + y) % 3])));
async function mutate(bytes, change) {
  const files = fflate.unzipSync(bytes);
  const sidecar = JSON.parse(new TextDecoder().decode(files["libms-applied-grid.json"]));
  change(sidecar);
  files["libms-applied-grid.json"] = new TextEncoder().encode(JSON.stringify(sidecar));
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  manifest.entries["libms-applied-grid.json"].bytes = files["libms-applied-grid.json"].length;
  files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
  return fflate.zipSync(files);
}

for (const size of [52, 78, 104, 250, 500]) test(`P6 Pixler ${size}: exact identity/null/metadata own roundtrip, input unchanged`, async () => {
  const grid = fixture(size), before = structuredClone(grid);
  const bytes = await buildPixlerProject(grid, { preserveIdentity: true, title: "作品", metadata });
  const { project, report } = await importPixlerProject(bytes, { palette: [{ code: "A01", rgb: [0, 0, 0] }] });
  assert.deepEqual(decodeAppliedGrid(project.appliedGrid), before);
  assert.deepEqual(grid, before);
  assert.equal(project.canvas.width, size);
  assert.equal(project.colors.length, 3);
  assert.equal(project.smartColorTolerance.strength, 60);
  assert.equal(project.smartColorTolerance.hierarchy, undefined);
  assert.equal(report.unresolvedCells, 0);
  assert.equal(report.externalIdentityGuarantee, false);
});

test("P6 Pixler legacy builder remains sidecar-free", async () => {
  const bytes = await buildPixlerProject([[colors[0], null]]);
  assert.equal(fflate.unzipSync(bytes)["libms-applied-grid.json"], undefined);
  const { project, report } = await importPixlerProject(bytes);
  assert.deepEqual(project.grid, [["A01", null]]);
  assert.equal(report.beadSource, "pixler-bead-match");
  assert.equal(project.appliedGrid, undefined);
});

test("P6 Pixler corrupt dictionary RGB, indices, dimensions and metadata are rejected", async () => {
  await assert.rejects(() => buildPixlerProject([[{ ...colors[0], rgb: [100.5, 120, 140] }]], { preserveIdentity: true }), /fractional RGB/);
  const bytes = await buildPixlerProject([[colors[0], colors[1], null]], { preserveIdentity: true, metadata });
  for (const change of [
    s => { s.appliedGrid.cells[0].rgb[0] = 0; },
    s => { s.patternIndices[0] = 2; },
    s => { s.appliedGrid.rows[0][0] = 1; },
    s => { s.appliedGrid.width = 2; },
    s => { s.metadata.strength = 101; },
    s => { s.schemaVersion = 99; },
  ]) await assert.rejects(() => mutate(bytes, change).then(importPixlerProject));
});

test("P6 Pixler distinct full cell metadata stays exact even within same palette identity", async () => {
  const grid = [[colors[0], { ...colors[0], protection: { edge: true } }, null]];
  const { project } = await importPixlerProject(await buildPixlerProject(grid, { preserveIdentity: true }));
  assert.deepEqual(decodeAppliedGrid(project.appliedGrid), grid);
});
