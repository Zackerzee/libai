import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_DRAFT_SCHEMA_VERSION,
  AUTO_DRAFT_STORAGE_KEY,
  createAutoDraftRecord,
  createAutoDraftService,
} from "../services/auto-draft-service.js";

function memoryStorage() {
  const records = new Map();
  let writes = 0;
  return {
    async get(key) { return records.get(key); },
    async put(value) { writes += 1; records.set(value.key, structuredClone(value)); },
    async delete(key) { records.delete(key); },
    writes: () => writes,
  };
}

const project = (width = 3, height = 2) => ({
  projectTitle: "窗边小猫",
  width,
  height,
  paletteId: "mard-221",
  projectSource: { type: "image", name: "cat.png" },
  metadata: { mode: "anime" },
  grid: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ((x + y) % 3 ? null : { paletteId: "mard:H5", rgb: [1, 2, 3], code: "H5" }))),
  history: { undo: [{ enormous: true }], redo: [] },
  selection: { x1: 0, y1: 0, x2: 1, y2: 1 },
});

test("draft schema stores only stable project checkpoint and palette identity", () => {
  const record = createAutoDraftRecord(project(), { now: () => 0 });
  assert.equal(record.key, AUTO_DRAFT_STORAGE_KEY);
  assert.equal(record.version, AUTO_DRAFT_SCHEMA_VERSION);
  assert.equal(record.savedAt, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(record.project.grid[0][0], { paletteId: "mard:H5" });
  assert.equal("history" in record.project, false);
  assert.equal("selection" in record.project, false);
});

test("debounce coalesces edits and persists the latest stable checkpoint", async () => {
  const storage = memoryStorage();
  const timers = [];
  const service = createAutoDraftService({
    storage,
    setTimer(fn) { const item = { fn, cleared: false }; timers.push(item); return item; },
    clearTimer(item) { item.cleared = true; },
  });
  service.scheduleSave({ ...project(), projectTitle: "第一稿" });
  service.scheduleSave({ ...project(), projectTitle: "第二稿" });
  assert.equal(storage.writes(), 0);
  await timers.at(-1).fn();
  await service.flush();
  assert.equal(storage.writes(), 1);
  assert.equal((await service.load()).project.projectTitle, "第二稿");
});

test("recovery metadata is lightweight and discard clears the draft", async () => {
  const storage = memoryStorage();
  const service = createAutoDraftService({ storage, now: () => 1234 });
  await service.saveNow(project());
  assert.deepEqual(await service.getRecoveryMetadata(), {
    projectTitle: "窗边小猫", width: 3, height: 2, paletteId: "mard-221",
    savedAt: "1970-01-01T00:00:01.234Z", version: AUTO_DRAFT_SCHEMA_VERSION,
  });
  await service.discard();
  assert.equal(await service.load(), null);
});

test("new save requests are serialized and stale writes cannot win", async () => {
  const stored = [];
  let releaseFirst;
  const storage = {
    get: async () => stored.at(-1), delete: async () => {},
    put: async (record) => {
      if (!stored.length) await new Promise((resolve) => { releaseFirst = resolve; });
      stored.push(structuredClone(record));
    },
  };
  const service = createAutoDraftService({ storage });
  const first = service.saveNow({ ...project(), projectTitle: "旧" });
  const second = service.saveNow({ ...project(), projectTitle: "新" });
  while (!releaseFirst) await new Promise((resolve) => setTimeout(resolve, 0));
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(stored.map((item) => item.project.projectTitle), ["旧", "新"]);
});

test("400x400 checkpoint remains valid and excludes per-cell RGB payload", async () => {
  const storage = memoryStorage();
  let yields = 0;
  const service = createAutoDraftService({ storage, rowsPerSlice: 25, yieldControl: async () => { yields += 1; } });
  const large = project(400, 400);
  const saved = await service.saveNow(large);
  assert.equal(saved.project.grid.length, 400);
  assert.equal(saved.project.grid[399].length, 400);
  assert.deepEqual(saved.project.grid[0][0], { paletteId: "mard:H5" });
  assert.equal(JSON.stringify(saved).includes('"rgb"'), false);
  assert.equal((await service.load()).project.grid[399].length, 400);
  assert.ok(yields >= 15, "large snapshots should yield between row slices");
});

test("invalid or future schema is not offered for recovery", async () => {
  const storage = memoryStorage();
  await storage.put({ key: AUTO_DRAFT_STORAGE_KEY, version: 99, dirty: true, project: {} });
  const service = createAutoDraftService({ storage });
  assert.equal(await service.load(), null);
  assert.equal(await service.getRecoveryMetadata(), null);
});

test("a failed write does not poison a later retry", async () => {
  let attempts = 0;
  const storage = memoryStorage();
  const originalPut = storage.put;
  storage.put = async (record) => {
    attempts += 1;
    if (attempts === 1) throw new Error("quota");
    return originalPut(record);
  };
  const service = createAutoDraftService({ storage });
  await assert.rejects(service.saveNow({ ...project(), projectTitle: "失败稿" }), /quota/);
  await service.saveNow({ ...project(), projectTitle: "恢复稿" });
  assert.equal((await service.load()).project.projectTitle, "恢复稿");
});
