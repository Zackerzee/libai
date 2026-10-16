import { createIndexedDbVersionStorage } from "./project-version-service.js";
import { parseTemplateJson } from "./template-service.mjs";

export const TEMPLATE_LIBRARY_KEY = "mother-template-library";
export const TEMPLATE_LIBRARY_SCHEMA = 1;
const clone = (value) => structuredClone(value);

function snapshotTemplate(template) {
  return parseTemplateJson(template);
}

function validateThumbnail(value = "") {
  if (typeof value !== "string" || value.length > 2 * 1024 * 1024 || (value !== "" && (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) || (value.length - 22) % 4 !== 0))) {
    throw new TypeError("母版缩略图必须是 2MB 以内的 PNG 数据");
  }
  return value;
}

/** Shares the existing manual-version store without upgrading its database. */
export function createTemplateLibrary({ storage, indexedDB, now = Date.now } = {}) {
  const backend = storage || createIndexedDbVersionStorage({ indexedDB });
  let chain = Promise.resolve();
  let sequence = 0;
  const enqueue = (action) => {
    const pending = chain.then(() => globalThis.navigator?.locks?.request
      ? globalThis.navigator.locks.request("libms-mother-template-library", action) : action());
    chain = pending.catch(() => undefined);
    return pending;
  };
  const read = async () => {
    const record = await backend.get(TEMPLATE_LIBRARY_KEY);
    if (!record) return [];
    if (record.version !== TEMPLATE_LIBRARY_SCHEMA || !Array.isArray(record.entries)) throw new Error("本地母版数据不兼容，未覆盖已有数据");
    try {
      return clone(record.entries).map((entry) => {
        if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string") throw new TypeError("母版记录无效");
        entry.template = snapshotTemplate(entry.template);
        entry.thumbnail = validateThumbnail(entry.thumbnail);
        if (entry.previous) {
          entry.previous.template = snapshotTemplate(entry.previous.template);
          entry.previous.thumbnail = validateThumbnail(entry.previous.thumbnail);
        }
        return entry;
      });
    } catch (cause) { throw new Error("本地母版数据损坏，未覆盖已有数据", { cause }); }
  };
  const persist = async (entries) => {
    try { await backend.put({ key: TEMPLATE_LIBRARY_KEY, version: TEMPLATE_LIBRARY_SCHEMA, entries }); }
    catch (cause) {
      throw new Error(cause?.name === "QuotaExceededError" ? "本地存储空间不足，请删除旧母版后重试" : "母版保存失败，请重试", { cause });
    }
  };
  const nameOf = (name) => String(name ?? "").trim() || "未命名母版";
  const find = (entries, id) => {
    const entry = entries.find((item) => item.id === id);
    if (!entry) throw new Error("母版不存在");
    return entry;
  };
  const timestamp = () => new Date(Number(now())).toISOString();
  const create = (template, name, time, thumbnail = "") => ({
    id: globalThis.crypto?.randomUUID?.() || `${time}-${++sequence}-${Math.random().toString(36).slice(2)}`,
    name, createdAt: time, updatedAt: time, template, thumbnail,
  });
  return {
    save(template, { name, updateId = null, confirmed = false, thumbnail = "" } = {}) {
      let snapshot;
      try { snapshot = snapshotTemplate(template); validateThumbnail(thumbnail); } catch (error) { return Promise.reject(error); }
      const savedName = nameOf(name);
      return enqueue(async () => {
        const entries = await read();
        const time = timestamp();
        let entry;
        if (updateId !== null) {
          if (confirmed !== true) throw new Error("更新母版需要明确确认");
          entry = find(entries, updateId);
          entry.previous = { template: clone(entry.template), name: entry.name, updatedAt: entry.updatedAt, thumbnail: entry.thumbnail };
          entry.template = snapshot;
          entry.thumbnail = thumbnail;
          entry.name = savedName;
          entry.updatedAt = time;
        } else {
          entry = create(snapshot, savedName, time, thumbnail);
          entries.unshift(entry);
        }
        await persist(entries);
        return clone(entry);
      });
    },
    list: () => enqueue(async () => clone(await read())),
    get: (id) => enqueue(async () => clone((await read()).find((entry) => entry.id === id) ?? null)),
    rename(id, name) {
      const savedName = nameOf(name);
      return enqueue(async () => {
        const entries = await read();
        const entry = find(entries, id);
        entry.name = savedName;
        entry.updatedAt = timestamp();
        await persist(entries);
        return clone(entry);
      });
    },
    copy(id, name) {
      const savedName = name === undefined ? undefined : nameOf(name);
      return enqueue(async () => {
        const entries = await read();
        const source = find(entries, id);
        const entry = create(clone(source.template), savedName ?? `${source.name} 副本`, timestamp(), source.thumbnail);
        entries.unshift(entry);
        await persist(entries);
        return clone(entry);
      });
    },
    remove: (id) => enqueue(async () => {
      const entries = await read();
      const kept = entries.filter((entry) => entry.id !== id);
      if (kept.length === entries.length) return false;
      await persist(kept);
      return true;
    }),
    restorePrevious: (id) => enqueue(async () => {
      const entries = await read();
      const entry = find(entries, id);
      if (!entry.previous) throw new Error("此母版没有上一版本");
      entry.template = clone(entry.previous.template);
      entry.thumbnail = entry.previous.thumbnail;
      entry.name = entry.previous.name;
      entry.updatedAt = timestamp();
      delete entry.previous;
      await persist(entries);
      return clone(entry);
    }),
  };
}
