import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoDraftRecord, createAutoDraftService } from '../services/auto-draft-service.js';
import { decodeAppliedGrid } from '../services/applied-project-archive.mjs';

const makeProject = (size) => ({
  width: size, height: size, projectTitle: 'Applied draft', paletteId: 'mard-221',
  metadata: { smartColorTolerance: {
    enabled: true, strength: 60, algorithmVersion: 'test-v1', paletteKey: 'mard-221',
  } },
  grid: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) =>
    (x + y) % 3 === 0 ? null : {
      paletteId: x % 2 ? 'mard:A01' : 'perler:A01', code: 'A01', rgb: [24, 176, 76],
    })),
});

test('P6 confirmed Smart drafts preserve exact identity in synchronous archive', () => {
  const project = makeProject(52);
  const record = createAutoDraftRecord(project);
  assert.deepEqual(decodeAppliedGrid(record.project.metadata.appliedGrid), project.grid);
  assert.deepEqual(record.project.metadata.smartColorTolerance, project.metadata.smartColorTolerance);
  project.grid[0][1].rgb[0] = 99;
  assert.equal(decodeAppliedGrid(record.project.metadata.appliedGrid)[0][1].rgb[0], 24);
});

for (const size of [52, 78, 104, 250, 500]) test(`P6 ${size} deferred draft archives exact applied work cooperatively`, async () => {
  let saved, yields = 0;
  const service = createAutoDraftService({
    storage: { put: async (record) => { saved = structuredClone(record); }, get: async () => saved, delete: async () => {} },
    rowsPerSlice: 8, yieldControl: async () => { yields++; },
  });
  const project = makeProject(size);
  await service.saveNow(project);
  const restored = await service.load();
  assert.deepEqual(decodeAppliedGrid(restored.project.metadata.appliedGrid), project.grid);
  assert.ok(yields >= Math.floor((size - 1) / 8));
  assert.deepEqual(restored.project.metadata.smartColorTolerance, project.metadata.smartColorTolerance);
  assert.equal('hierarchy' in restored.project.metadata, false);
});

test('P6 legacy drafts retain identity-only schema without an applied archive', () => {
  const project = makeProject(52);
  delete project.metadata.smartColorTolerance;
  const saved = createAutoDraftRecord(project);
  assert.equal('appliedGrid' in saved.project.metadata, false);
  assert.deepEqual(saved.project.grid[0][1], { paletteId: 'mard:A01' });
});

test('P6 an edit during cooperative draft capture aborts the stale archive and preserves the latest revision', async () => {
  let revision = 1, saved, writes = 0, changed = false;
  const project = makeProject(52);
  project.isCurrent = () => revision === 1;
  const service = createAutoDraftService({
    storage: { put: async record => { saved = structuredClone(record); writes++; }, get: async () => saved, delete: async () => {} },
    rowsPerSlice: 8, yieldControl: async () => {
      if (!changed) { changed = true; project.grid[40][1].rgb[0] = 99; revision++; }
    },
  });
  await assert.rejects(service.saveNow(project), { name: 'AbortError' });
  assert.equal(writes, 0, 'a mixed-time archive must never be persisted');
  await service.saveNow({ ...project, isCurrent: () => revision === 2 });
  assert.equal(writes, 1);
  assert.deepEqual(decodeAppliedGrid(saved.project.metadata.appliedGrid), project.grid);
  assert.equal('isCurrent' in saved.project, false);
});
