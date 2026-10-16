import test from "node:test";
import assert from "node:assert/strict";
import { createProjectVersionService, createIndexedDbVersionStorage, PROJECT_VERSION_KEY } from "../services/project-version-service.js";
const fixture = () => ({ width: 2, height: 1, projectTitle: "手工设计", paletteId: "mard-221", palette: { id: "mard-221", colors: [{ paletteId: "x", code: "H5", rgb: [1, 2, 3] }] }, grid: [[{ paletteId: "x", code: "H5", rgb: [1, 2, 3] }, null]], metadata: { reference: { visible: true }, texts: [{ id: "t1", text: "字" }] }, textObjects: [{ id: "t1" }], referenceLayer: { opacity: .3 }, history: ["no"], selection: { x: 1 } });
function memory() { const records = new Map(); return { records, async get(key) { return structuredClone(records.get(key)); }, async put(value) { records.set(value.key, structuredClone(value)); }, async delete(key) { records.delete(key); } }; }
test("manual checkpoints preserve canonical identity, null, palette and object metadata without history", async () => {
  const service = createProjectVersionService({ storage: memory(), now: () => 0 });
  const original = fixture(); const info = await service.save(original, { label: "第一版" });
  const restored = await service.get(info.id);
  for (const key of ["grid", "palette", "paletteId", "metadata", "textObjects", "referenceLayer"]) assert.deepEqual(restored[key], original[key]);
  assert.equal(restored.projectTitle, original.projectTitle); assert.equal(restored.width, 2);
  assert.equal("history" in restored, false); assert.equal("selection" in restored, false);
  restored.grid[0][0].rgb[0] = 99;
  assert.equal((await service.get(info.id)).grid[0][0].rgb[0], 1);
});
test("save captures immediately, lists newest first and survives a new service instance", async () => {
  const storage = memory(); const service = createProjectVersionService({ storage }); const original = fixture();
  const pending = service.save(original); original.grid[0][0].code = "changed";
  const first = await pending; const second = await service.save(fixture());
  assert.equal((await service.get(first.id)).grid[0][0].code, "H5");
  assert.deepEqual((await createProjectVersionService({ storage }).list()).map((v) => v.id), [second.id, first.id]);
});
test("entry cap, removal and clearing bound local persistence", async () => {
  const service = createProjectVersionService({ storage: memory(), maxVersions: 2 });
  const a = await service.save(fixture()); const b = await service.save(fixture()); await service.save(fixture());
  assert.equal(await service.get(a.id), null); assert.equal((await service.list()).length, 2);
  assert.equal(await service.remove(b.id), true); assert.equal(await service.remove(b.id), false);
  await service.clear(); assert.deepEqual(await service.list(), []);
});
test("oversize checkpoints and invalid dimensions do not overwrite existing snapshots", async () => {
  const storage = memory(); const service = createProjectVersionService({ storage, maxBytes: 1500 }); await service.save(fixture());
  const big = fixture(); big.metadata.large = "x".repeat(5000);
  await assert.rejects(service.save(big), /容量限制/); assert.equal((await service.list()).length, 1);
  await assert.rejects(service.save({ ...fixture(), width: 3 }), /矩阵无效/);
});
test("quota errors are actionable and failed writes do not poison the queue", async () => {
  const storage = memory(); const original = storage.put; let fail = true;
  storage.put = async (record) => { if (fail) { const error = new Error("quota"); error.name = "QuotaExceededError"; throw error; } return original(record); };
  const service = createProjectVersionService({ storage }); await assert.rejects(service.save(fixture()), /空间不足/);
  fail = false; await service.save(fixture()); assert.equal((await service.list()).length, 1);
});
test("unknown local schema is never silently replaced", async () => {
  const storage = memory(); storage.records.set(PROJECT_VERSION_KEY, { key: PROJECT_VERSION_KEY, version: 99, entries: [] });
  await assert.rejects(createProjectVersionService({ storage }).save(fixture()), /不兼容/);
  assert.equal(storage.records.get(PROJECT_VERSION_KEY).version, 99);
});
test("IndexedDB write waits for transaction commit and rejects an abort after request success", async () => {
  let activeTransaction;
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { transaction() {
        const tx = { objectStore() { return { put() {
          const write = {};
          queueMicrotask(() => { write.result = "key"; write.onsuccess(); });
          return write;
        } }; } };
        activeTransaction = tx;
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  const storage = createIndexedDbVersionStorage({ indexedDB });
  let completed = false;
  const first = storage.put({ key: "x" }).then(() => { completed = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(completed, false);
  activeTransaction.oncomplete(); await first; assert.equal(completed, true);
  const second = storage.put({ key: "x" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const quota = new Error("quota"); quota.name = "QuotaExceededError";
  activeTransaction.error = quota; activeTransaction.onabort();
  await assert.rejects(second, { name: "QuotaExceededError" });
});
