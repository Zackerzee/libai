/** Manual local checkpoints. Not an engineering-file format or a second history. */
export const PROJECT_VERSION_SCHEMA = 1;
export const PROJECT_VERSION_KEY = "manual-project-versions";
const clone = (value) => structuredClone(value);

export function createProjectVersionRecord(project) {
  if (!project || typeof project !== "object") throw new TypeError("版本工程不能为空");
  const width = Number(project.width ?? project.canvas?.width);
  const height = Number(project.height ?? project.canvas?.height);
  const source = project.grid ?? project.canonicalGrid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || !Array.isArray(source) || source.length !== height
      || source.some((row) => !Array.isArray(row) || row.length !== width)) {
    throw new TypeError("版本画布尺寸或矩阵无效");
  }
  const result = { width, height, grid: clone(source), projectTitle: String(project.projectTitle ?? project.projectName ?? project.title ?? "未命名作品") };
  for (const key of ["paletteId", "palette", "projectSource", "source", "metadata", "reference", "referenceLayer", "textObjects", "textObjectState"]) {
    if (project[key] !== undefined) result[key] = clone(project[key]);
  }
  return result;
}

/** Separate database avoids upgrading/blocking the existing auto-draft database. */
export function createIndexedDbVersionStorage({ indexedDB = globalThis.indexedDB } = {}) {
  let connection;
  const open = () => {
    if (!indexedDB?.open) throw new Error("当前环境不支持本地版本存储");
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("libms-studio-manual-versions", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("versions", { keyPath: "key" });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => { connection = null; reject(request.error || new Error("本地版本数据库打开失败")); };
      request.onblocked = () => { connection = null; reject(new Error("本地版本数据库被其他页面占用")); };
    });
    return connection;
  };
  const transact = async (mode, operation) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("versions", mode);
      const request = operation(transaction.objectStore("versions"));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || request.error || new Error("本地版本存储事务失败"));
      transaction.onerror = () => reject(transaction.error || request.error || new Error("本地版本存储失败"));
    });
  };
  return {
    get: (key) => transact("readonly", (store) => store.get(key)),
    put: (record) => transact("readwrite", (store) => store.put(record)),
    delete: (key) => transact("readwrite", (store) => store.delete(key)),
  };
}

export function createProjectVersionService({ storage, indexedDB, maxVersions = 20, maxBytes = 20 * 1024 * 1024, now = Date.now } = {}) {
  const backend = storage || createIndexedDbVersionStorage({ indexedDB });
  const limit = Math.max(1, Math.floor(Number(maxVersions) || 20));
  const byteLimit = Math.max(1, Number(maxBytes) || 20 * 1024 * 1024);
  let chain = Promise.resolve();
  let sequence = 0;
  const enqueue = (action) => {
    // Serialize manifest updates across tabs when the browser provides Web Locks.
    const pending = chain.then(() => globalThis.navigator?.locks?.request
      ? globalThis.navigator.locks.request("libms-manual-project-versions", action)
      : action());
    chain = pending.catch(() => undefined);
    return pending;
  };
  const read = async () => {
    const record = await backend.get(PROJECT_VERSION_KEY);
    if (!record) return [];
    if (record.version !== PROJECT_VERSION_SCHEMA || !Array.isArray(record.entries)) throw new Error("本地版本数据不兼容，未覆盖已有数据");
    return clone(record.entries);
  };
  const info = ({ project, ...entry }) => ({ ...entry, width: project.width, height: project.height, projectTitle: project.projectTitle });
  const persist = async (entries) => {
    try { await backend.put({ key: PROJECT_VERSION_KEY, version: PROJECT_VERSION_SCHEMA, entries }); }
    catch (error) {
      const failure = new Error(error?.name === "QuotaExceededError" ? "本地存储空间不足，请删除旧版本后重试" : "本地版本保存失败，请重试");
      failure.cause = error;
      throw failure;
    }
  };
  return {
    save(project, { label = "手动版本" } = {}) {
      // Capture before enqueue: edits while storage is opening must not change this checkpoint.
      let snapshot;
      try { snapshot = createProjectVersionRecord(project); } catch (error) { return Promise.reject(error); }
      return enqueue(async () => {
        const timestamp = Number(now());
        const entry = { id: `${timestamp}-${globalThis.crypto?.randomUUID?.() || ++sequence}`, label: String(label).trim() || "手动版本", savedAt: new Date(timestamp).toISOString(), project: snapshot };
        const entries = [entry, ...await read()].slice(0, limit);
        const bytes = () => new TextEncoder().encode(JSON.stringify(entries)).byteLength;
        while (entries.length > 1 && bytes() > byteLimit) entries.pop();
        if (bytes() > byteLimit) throw new Error("此版本超过本地版本容量限制，未保存");
        await persist(entries);
        return info(entry);
      });
    },
    list: () => enqueue(async () => (await read()).map(info)),
    get: (id) => enqueue(async () => clone((await read()).find((entry) => entry.id === id)?.project ?? null)),
    remove: (id) => enqueue(async () => { const entries = await read(); const kept = entries.filter((entry) => entry.id !== id); if (kept.length !== entries.length) await persist(kept); return kept.length !== entries.length; }),
    clear: () => enqueue(() => backend.delete(PROJECT_VERSION_KEY)),
  };
}
