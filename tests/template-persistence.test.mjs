import test from "node:test";
import assert from "node:assert/strict";
import { createAutoDraftRecord, createAutoDraftService } from "../services/auto-draft-service.js";
import { createProjectVersionRecord, createProjectVersionService } from "../services/project-version-service.js";

const fixture = () => ({ width: 2, height: 2, grid: [[{ code: "H1" }, null], [null, null]], templateLockedMask: [[true, false], [false, true]] });
function memory() {
  const records = new Map();
  return { records, async get(key) { return structuredClone(records.get(key)); }, async put(record) { records.set(record.key, structuredClone(record)); } };
}

test("synchronous draft and version records clone the optional lock mask", () => {
  const project = fixture();
  const draft = createAutoDraftRecord(project);
  const version = createProjectVersionRecord(project);
  assert.deepEqual(draft.project.templateLockedMask, project.templateLockedMask);
  assert.deepEqual(version.templateLockedMask, project.templateLockedMask);
  project.templateLockedMask[0][0] = false;
  assert.equal(draft.project.templateLockedMask[0][0], true);
  assert.equal(version.templateLockedMask[0][0], true);
});

test("async drafts and manual versions restore masks with independent returned data", async () => {
  const draftService = createAutoDraftService({ storage: memory(), rowsPerSlice: 1, yieldControl: async () => {} });
  const versionService = createProjectVersionService({ storage: memory() });
  const project = fixture();
  await draftService.saveNow(project);
  const saved = await versionService.save(project);
  project.templateLockedMask[0][0] = false;
  const draft = await draftService.load();
  const version = await versionService.get(saved.id);
  assert.equal(draft.project.templateLockedMask[0][0], true);
  assert.equal(version.templateLockedMask[0][0], true);
  draft.project.templateLockedMask[0][0] = false;
  version.templateLockedMask[0][0] = false;
  assert.equal((await draftService.load()).project.templateLockedMask[0][0], true);
  assert.equal((await versionService.get(saved.id)).templateLockedMask[0][0], true);
});

test("malformed masks reject before storage writes", async () => {
  for (const mask of [null, [], [[true]], [[true, false], [false, 1]], new Array(2), [new Array(2), [true, false]]]) {
    const project = { ...fixture(), templateLockedMask: mask };
    assert.throws(() => createAutoDraftRecord(project), /模板锁定矩阵/);
    assert.throws(() => createProjectVersionRecord(project), /模板锁定矩阵/);
    const storage = memory();
    await assert.rejects(createAutoDraftService({ storage }).saveNow(project), /模板锁定矩阵/);
    await assert.rejects(createProjectVersionService({ storage }).save(project), /模板锁定矩阵/);
    assert.equal(storage.records.size, 0);
  }
});

test("legacy projects do not gain a lock-mask field", async () => {
  const project = fixture();
  delete project.templateLockedMask;
  assert.equal("templateLockedMask" in createAutoDraftRecord(project).project, false);
  assert.equal("templateLockedMask" in createProjectVersionRecord(project), false);
  const service = createAutoDraftService({ storage: memory() });
  await service.saveNow(project);
  assert.equal("templateLockedMask" in (await service.load()).project, false);
});
