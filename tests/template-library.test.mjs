import test from "node:test";
import assert from "node:assert/strict";
import { createTemplateLibrary, TEMPLATE_LIBRARY_KEY } from "../services/template-library.mjs";

const fixture = (code = "H1") => ({ format: "libms-template", version: 1, name: "画布母版", width: 2, height: 1, grid: [[{ code, rgb: [1, 2, 3] }, null]], paletteKey: "mard" });
function memory() {
  const records = new Map();
  return { records, async get(key) { return structuredClone(records.get(key)); }, async put(record) { records.set(record.key, structuredClone(record)); } };
}

test("same names create independent records and capture data before enqueue", async () => {
  const storage = memory();
  const service = createTemplateLibrary({ storage });
  const template = fixture();
  const pending = service.save(template, { name: "母版" });
  template.grid[0][0].rgb[0] = 99;
  const first = await pending;
  const second = await service.save(fixture(), { name: "母版" });
  assert.notEqual(first.id, second.id);
  first.template.grid[0][0].rgb[0] = 77;
  const list = await service.list();
  list[1].template.grid[0][0].rgb[0] = 55;
  assert.equal((await service.get(first.id)).template.grid[0][0].rgb[0], 1);
  assert.equal((await createTemplateLibrary({ storage }).list()).length, 2);
});

test("update requires explicit confirmation and exact id, retaining only previous version", async () => {
  let time = 0;
  const service = createTemplateLibrary({ storage: memory(), now: () => time++ });
  const original = await service.save(fixture("H1"), { name: "原版" });
  await assert.rejects(service.save(fixture("H2"), { updateId: original.id }), /确认/);
  await assert.rejects(service.save(fixture("H2"), { updateId: "missing", confirmed: true }), /不存在/);
  await service.save(fixture("H2"), { name: "二版", updateId: original.id, confirmed: true });
  const latest = await service.save(fixture("H3"), { name: "三版", updateId: original.id, confirmed: true });
  assert.equal(latest.createdAt, original.createdAt);
  assert.equal(latest.previous.template.grid[0][0].code, "H2");
  assert.equal("previous" in latest.previous, false);
  const restored = await service.restorePrevious(original.id);
  assert.equal(restored.template.grid[0][0].code, "H2");
  assert.equal(restored.name, "二版");
  assert.equal(restored.createdAt, original.createdAt);
  await assert.rejects(service.restorePrevious(original.id), /没有上一版本/);
});

test("rename, copy and deletion preserve independent data", async () => {
  const service = createTemplateLibrary({ storage: memory() });
  const first = await service.save(fixture());
  const renamed = await service.rename(first.id, " 重命名 ");
  assert.equal(renamed.name, "重命名");
  const copy = await service.copy(first.id);
  assert.equal(copy.name, "重命名 副本");
  assert.notEqual(copy.id, first.id);
  await service.save(fixture("H2"), { updateId: first.id, confirmed: true });
  assert.equal((await service.get(copy.id)).template.grid[0][0].code, "H1");
  assert.equal(await service.remove(first.id), true);
  assert.equal(await service.remove(first.id), false);
  assert.equal(await service.get(first.id), null);
  assert.equal((await service.get(copy.id)).template.grid[0][1], null);
});

test("failed writes do not report success or change stored records and queue recovers", async () => {
  const storage = memory();
  const service = createTemplateLibrary({ storage });
  const saved = await service.save(fixture());
  const put = storage.put;
  storage.put = async () => { const error = new Error("quota"); error.name = "QuotaExceededError"; throw error; };
  await assert.rejects(service.save(fixture("H2"), { updateId: saved.id, confirmed: true }), /空间不足/);
  await assert.rejects(service.remove(saved.id), /空间不足/);
  assert.equal((await service.get(saved.id)).template.grid[0][0].code, "H1");
  assert.equal((await service.get(saved.id)).previous, undefined);
  storage.put = put;
  assert.equal(await service.remove(saved.id), true);
});

test("unknown schema and invalid input leave stored data intact", async () => {
  const storage = memory();
  storage.records.set(TEMPLATE_LIBRARY_KEY, { key: TEMPLATE_LIBRARY_KEY, version: 99, entries: [] });
  const service = createTemplateLibrary({ storage });
  await assert.rejects(service.save(fixture()), /不兼容/);
  await assert.rejects(service.save(null), /合法/);
  assert.equal(storage.records.get(TEMPLATE_LIBRARY_KEY).version, 99);
});

test("canonical validation rejects malformed saves and stored current or previous templates", async () => {
  const storage = memory();
  const service = createTemplateLibrary({ storage });
  const saved = await service.save(fixture(), { name: "资料库名称" });
  assert.equal(saved.name, "资料库名称");
  assert.equal(saved.template.name, "画布母版");
  await assert.rejects(service.save({ ...fixture(), width: 3 }), /尺寸/);
  const record = storage.records.get(TEMPLATE_LIBRARY_KEY);
  record.entries[0].template.grid[0][0].rgb[0] = 999;
  const corrupted = structuredClone(record);
  await assert.rejects(service.list(), /数据损坏/);
  await assert.rejects(service.save(fixture()), /数据损坏/);
  assert.deepEqual(storage.records.get(TEMPLATE_LIBRARY_KEY), corrupted);
  record.entries[0].template = fixture();
  record.entries[0].previous = { name: "上版", template: { ...fixture(), width: 3 } };
  await assert.rejects(service.get(saved.id), /数据损坏/);
});

test("Web Locks serialize manifest updates across service instances", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let lockChain = Promise.resolve();
  const names = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request(name, action) {
      names.push(name);
      const pending = lockChain.then(action);
      lockChain = pending.catch(() => undefined);
      return pending;
    },
  } } });
  try {
    const storage = memory();
    const first = createTemplateLibrary({ storage });
    const second = createTemplateLibrary({ storage });
    await Promise.all([first.save(fixture()), second.save(fixture())]);
    assert.equal((await first.list()).length, 2);
    assert.deepEqual([...new Set(names)], ["libms-mother-template-library"]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});

test("cached thumbnails follow copies and previous versions; old entries remain readable", async () => {
  const storage = memory();
  const service = createTemplateLibrary({ storage });
  const thumbnail = "data:image/png;base64,aGVsbG8=";
  const original = await service.save(fixture(), { thumbnail });
  assert.equal((await service.copy(original.id)).thumbnail, thumbnail);
  const updated = await service.save(fixture("H2"), { updateId: original.id, confirmed: true });
  assert.equal(updated.thumbnail, "");
  assert.equal(updated.previous.thumbnail, thumbnail);
  assert.equal((await service.restorePrevious(original.id)).thumbnail, thumbnail);
  const record = storage.records.get(TEMPLATE_LIBRARY_KEY);
  delete record.entries[0].thumbnail;
  assert.equal((await service.get(record.entries[0].id)).thumbnail, "");
});

test("invalid or oversized thumbnail rejects without writing", async () => {
  const storage = memory();
  const service = createTemplateLibrary({ storage });
  for (const thumbnail of [null, 123, "https://example.com/a.png", "data:image/jpeg;base64,aGVsbG8=", "data:image/png;base64,", "data:image/png;base64,???", "data:image/png;base64," + "a".repeat(2 * 1024 * 1024)]) {
    await assert.rejects(service.save(fixture(), { thumbnail }), /缩略图/);
  }
  assert.equal(storage.records.size, 0);
});
