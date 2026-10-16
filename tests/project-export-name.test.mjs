import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExportService } from '../services/export-service.js';

test('project export uses current workspace title, not original image title', async () => {
  let exportedName;
  const service = createExportService({ downloadProjectJson(name) { exportedName = name; } }, {
    getState: () => ({ status: { hasPattern: true }, project: { name: '锦鲤 双喜' } }),
  });
  await service.export('project-json');
  assert.equal(exportedName, '锦鲤 双喜');
});

test('project JSON name and filename agree without an extra project suffix', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(source, /downloadProjectJson\(projectName\)/);
  assert.match(source, /payload\.projectName = String\(projectName \?\? payload\.projectName\)/);
  assert.match(source, /`\$\{filename\}\.json`/);
  assert.doesNotMatch(source, /\$\{payload\.projectName\}-project\.json/);
});
