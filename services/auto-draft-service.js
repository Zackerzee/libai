/**
 * Local crash-recovery drafts for LIBMS Studio.
 *
 * The service deliberately stores a small, versioned project checkpoint rather
 * than the application state. Transient editor state (selection, diagnostics,
 * viewport and undo/redo commands) therefore never leaks into persistence.
 */

export const AUTO_DRAFT_SCHEMA_VERSION = 1;
export const AUTO_DRAFT_STORAGE_KEY = "current-project";

const DEFAULT_DB_NAME = "libms-studio";
const DEFAULT_STORE_NAME = "auto-drafts";

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const positiveInteger = (value) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

function normalizeCell(cell) {
  if (cell == null) return null;
  if (typeof cell === "string") return { paletteId: cell };
  if (typeof cell !== "object") return null;
  const paletteId = cell.paletteId ?? cell.id ?? cell.code;
  if (paletteId == null || String(paletteId).trim() === "") return null;
  return { paletteId: String(paletteId) };
}

/** Build the only payload shape accepted by persistence. */
export function createAutoDraftRecord(project, { now = Date.now } = {}) {
  if (!project || typeof project !== "object") throw new TypeError("草稿工程不能为空");
  const width = positiveInteger(project.width ?? project.canvas?.width);
  const height = positiveInteger(project.height ?? project.canvas?.height);
  const sourceGrid = project.grid ?? project.canonicalGrid;
  if (!width || !height || !Array.isArray(sourceGrid) || sourceGrid.length !== height) {
    throw new TypeError("草稿画布尺寸或矩阵无效");
  }
  const grid = sourceGrid.map((row) => {
    if (!Array.isArray(row) || row.length !== width) throw new TypeError("草稿矩阵宽高不一致");
    return row.map(normalizeCell);
  });
  const timestamp = new Date(now()).toISOString();
  const title = String(project.projectTitle ?? project.projectName ?? project.title ?? "未命名作品").trim() || "未命名作品";
  const paletteId = project.paletteId ?? project.palette?.id ?? project.palette?.key ?? null;
  const source = project.projectSource ?? project.source ?? { type: "unknown" };
  const metadata = project.metadata && typeof project.metadata === "object" ? clone(project.metadata) : {};
  return {
    key: AUTO_DRAFT_STORAGE_KEY,
    version: AUTO_DRAFT_SCHEMA_VERSION,
    savedAt: timestamp,
    dirty: true,
    project: {
      projectTitle: title,
      width,
      height,
      grid,
      paletteId: paletteId == null ? null : String(paletteId),
      source: clone(source),
      metadata,
    },
  };
}

async function createAutoDraftRecordAsync(project, { now, yieldControl, rowsPerSlice }) {
  if (!project || typeof project !== "object") throw new TypeError("草稿工程不能为空");
  const width = positiveInteger(project.width ?? project.canvas?.width);
  const height = positiveInteger(project.height ?? project.canvas?.height);
  const sourceGrid = project.grid ?? project.canonicalGrid;
  if (!width || !height || !Array.isArray(sourceGrid) || sourceGrid.length !== height) {
    throw new TypeError("草稿画布尺寸或矩阵无效");
  }
  const grid = new Array(height);
  for (let y = 0; y < height; y += 1) {
    const row = sourceGrid[y];
    if (!Array.isArray(row) || row.length !== width) throw new TypeError("草稿矩阵宽高不一致");
    grid[y] = row.map(normalizeCell);
    if ((y + 1) % rowsPerSlice === 0 && y + 1 < height) await yieldControl();
  }
  const timestamp = new Date(now()).toISOString();
  const title = String(project.projectTitle ?? project.projectName ?? project.title ?? "未命名作品").trim() || "未命名作品";
  const paletteId = project.paletteId ?? project.palette?.id ?? project.palette?.key ?? null;
  return {
    key: AUTO_DRAFT_STORAGE_KEY,
    version: AUTO_DRAFT_SCHEMA_VERSION,
    savedAt: timestamp,
    dirty: true,
    project: {
      projectTitle: title,
      width,
      height,
      grid,
      paletteId: paletteId == null ? null : String(paletteId),
      source: clone(project.projectSource ?? project.source ?? { type: "unknown" }),
      metadata: project.metadata && typeof project.metadata === "object" ? clone(project.metadata) : {},
    },
  };
}

export function createIndexedDbDraftStorage({
  indexedDB = globalThis.indexedDB,
  dbName = DEFAULT_DB_NAME,
  storeName = DEFAULT_STORE_NAME,
} = {}) {
  if (!indexedDB?.open) throw new Error("当前环境不支持 IndexedDB");
  let databasePromise;
  const database = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开自动草稿数据库"));
      request.onblocked = () => reject(new Error("自动草稿数据库升级被阻止"));
    });
    return databasePromise;
  };
  const transaction = async (mode, action) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = action(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("自动草稿读写失败"));
      tx.onabort = () => reject(tx.error || new Error("自动草稿事务已取消"));
    });
  };
  return {
    get: (key) => transaction("readonly", (store) => store.get(key)),
    put: (record) => transaction("readwrite", (store) => store.put(record)),
    delete: (key) => transaction("readwrite", (store) => store.delete(key)),
  };
}

export function createAutoDraftService({
  storage,
  indexedDB,
  debounceMs = 1800,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  rowsPerSlice = 32,
  yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  const backend = storage || createIndexedDbDraftStorage({ indexedDB });
  let timer = null;
  let pendingProject = null;
  let writeChain = Promise.resolve();

  const enqueue = (project) => {
    writeChain = writeChain.catch(() => undefined)
      .then(() => createAutoDraftRecordAsync(project, { now, yieldControl, rowsPerSlice: Math.max(1, rowsPerSlice) }))
      .then(async (record) => { await backend.put(record); return clone(record); });
    return writeChain;
  };

  const saveNow = async (project = pendingProject) => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pendingProject = null;
    if (!project) return writeChain;
    return enqueue(project);
  };

  const scheduleSave = (project) => {
    pendingProject = project;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { void saveNow().catch(() => {}); }, Math.max(0, debounceMs));
  };

  const load = async () => {
    const record = await backend.get(AUTO_DRAFT_STORAGE_KEY);
    if (!record) return null;
    if (record.version !== AUTO_DRAFT_SCHEMA_VERSION || !record.project) return null;
    return clone(record);
  };

  const getRecoveryMetadata = async () => {
    const record = await load();
    if (!record?.dirty) return null;
    const { project } = record;
    return {
      projectTitle: project.projectTitle,
      width: project.width,
      height: project.height,
      paletteId: project.paletteId,
      savedAt: record.savedAt,
      version: record.version,
    };
  };

  const discard = async () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pendingProject = null;
    await writeChain.catch(() => undefined);
    await backend.delete(AUTO_DRAFT_STORAGE_KEY);
  };

  return {
    scheduleSave,
    saveNow,
    flush: saveNow,
    load,
    getRecoveryMetadata,
    discard,
    clear: discard,
    hasPendingSave: () => pendingProject !== null,
  };
}
