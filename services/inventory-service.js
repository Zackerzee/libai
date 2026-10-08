/**
 * 库存台账 + 用豆流水（纯数据层，不碰 DOM）。
 *
 * 与参考实现（perler-bead-manager 的 SQLite 版 WarehouseStore）的对应关系：
 * - inventory_items  -> state.items（按色号索引的字典）
 * - submissions      -> state.submissions（每次扣料一条，含 revertedAt）
 * - consumption_lines-> submission.lines（[{ code, count }]）
 *
 * 关键取舍：
 * 1. 每颗豆的消耗只由 submission 记录，不做"逐条增删库存"的流水，这样撤销
 *    一次扣料只需标记 revertedAt，累计消耗与库存回补都能从同一份数据推出。
 * 2. 允许库存扣成负数。用户拿在手上的豆可能没登记过，硬拦会让"先扣料后盘点"
 *    这种真实用法没法走通；负数本身就是"账面缺料"的最诚实表达，UI 负责报出来。
 * 3. storage 可注入（默认 localStorage），这样纯 Node 环境下也能单测。
 */

export const INVENTORY_STORAGE_KEY = "libms-inventory-v1";
export const INVENTORY_VERSION = 1;
export const DEFAULT_UNIT = "颗";
export const CSV_HEADERS = ["编号", "名称", "当前库存", "最低库存", "单位", "位置", "供应商", "备注"];

/** 色号归一化：去空白、转大写。空号返回空串，由调用方判定非法。 */
export function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

/** 非负整数校验；非法返回 null（刻意区分"0"与"非法"）。 */
function toCount(value) {
  if (value === "" || value == null) return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

/** 极简 CSV 解析：支持双引号包裹字段与字段内逗号/换行，够用且不引依赖。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
}

/** CSV 字段转义：含逗号、引号、换行时用双引号包裹。 */
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function emptyState() {
  return { version: INVENTORY_VERSION, items: {}, submissions: [] };
}

/** 从任意来源读回状态并做结构校验；损坏时退回空台账而不是抛错。 */
function readState(storage, key) {
  if (!storage) return emptyState();
  let raw = null;
  try { raw = storage.getItem(key); } catch { return emptyState(); }
  if (!raw) return emptyState();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return emptyState(); }
  if (!parsed || typeof parsed !== "object") return emptyState();
  const items = {};
  for (const [code, item] of Object.entries(parsed.items || {})) {
    const normalized = normalizeCode(item?.code || code);
    if (!normalized) continue;
    items[normalized] = {
      code: normalized,
      name: String(item?.name ?? ""),
      hex: String(item?.hex ?? ""),
      rgb: Array.isArray(item?.rgb) ? item.rgb.slice(0, 3).map((channel) => Number(channel) || 0) : null,
      stock: toCount(item?.stock) ?? 0,
      minStock: toCount(item?.minStock) ?? 0,
      unit: String(item?.unit || DEFAULT_UNIT),
      location: String(item?.location ?? ""),
      supplier: String(item?.supplier ?? ""),
      note: String(item?.note ?? ""),
      updatedAt: String(item?.updatedAt || ""),
    };
  }
  const submissions = (Array.isArray(parsed.submissions) ? parsed.submissions : [])
    .filter((entry) => entry && Array.isArray(entry.lines))
    .map((entry) => ({
      id: String(entry.id ?? ""),
      label: String(entry.label ?? ""),
      source: String(entry.source ?? "manual"),
      createdAt: String(entry.createdAt ?? ""),
      revertedAt: entry.revertedAt ? String(entry.revertedAt) : null,
      lines: entry.lines
        .map((line) => ({ code: normalizeCode(line?.code), count: toCount(line?.count) ?? 0, name: String(line?.name ?? "") }))
        .filter((line) => line.code && line.count > 0),
    }))
    .filter((entry) => entry.id);
  return { version: INVENTORY_VERSION, items, submissions };
}

export function createInventoryService(options = {}) {
  const {
    getStats = () => [],
    getPaletteColors = () => [],
    storage = (() => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } })(),
    key = INVENTORY_STORAGE_KEY,
    now = () => new Date().toISOString(),
    idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  } = options;

  let state = readState(storage, key);
  const listeners = new Set();

  const notify = () => { const snapshot = getState(); listeners.forEach((listener) => listener(snapshot)); };
  const persist = () => {
    if (!storage) return;
    try { storage.setItem(key, JSON.stringify(state)); }
    catch (error) { console.warn("[inventory] 台账保存失败，本次改动只存在于内存中", error); }
  };
  const commit = () => { persist(); notify(); };

  function getState() {
    return {
      version: state.version,
      items: Object.values(state.items).map((item) => ({ ...item, rgb: item.rgb ? [...item.rgb] : null })),
      submissions: state.submissions.map((entry) => ({ ...entry, lines: entry.lines.map((line) => ({ ...line })) })),
    };
  }

  /** 每个色号被真正扣掉的累计数（已撤销的提交不计入）。 */
  function consumedMap() {
    const map = new Map();
    for (const entry of state.submissions) {
      if (entry.revertedAt) continue;
      for (const line of entry.lines) map.set(line.code, (map.get(line.code) || 0) + line.count);
    }
    return map;
  }

  /** 用当前图纸统计生成扣料预览：哪些色号、多少颗、库存够不够。 */
  function buildLines(stats) {
    return (stats || [])
      .map((color) => {
        const code = normalizeCode(color?.code);
        if (!code) return null;
        const count = toCount(color?.count) ?? 0;
        if (count <= 0) return null;
        return { code, count, name: String(color?.name ?? ""), hex: String(color?.hex ?? ""), rgb: Array.isArray(color?.rgb) ? color.rgb.slice(0, 3) : null };
      })
      .filter(Boolean);
  }

  /** 台账里没有的色号按色卡补齐名称/颜色；色卡也没有就留空，交给用户手工填。 */
  function enrich(line) {
    const existing = state.items[line.code];
    const palette = getPaletteColors().find((color) => normalizeCode(color?.code) === line.code) || null;
    return {
      name: line.name || existing?.name || String(palette?.name ?? ""),
      hex: line.hex || existing?.hex || String(palette?.hex ?? ""),
      rgb: line.rgb || existing?.rgb || (Array.isArray(palette?.rgb) ? palette.rgb.slice(0, 3) : null),
    };
  }

  function upsertItem(code, patch = {}) {
    const normalized = normalizeCode(code);
    if (!normalized) throw new Error("色号不能为空");
    const existing = state.items[normalized] || null;
    const palette = getPaletteColors().find((color) => normalizeCode(color?.code) === normalized) || null;
    const nextStock = patch.stock === undefined ? existing?.stock ?? 0 : toCount(patch.stock);
    const nextMin = patch.minStock === undefined ? existing?.minStock ?? 0 : toCount(patch.minStock);
    if (nextStock === null) throw new Error(`色号 ${normalized} 的库存必须是非负整数`);
    if (nextMin === null) throw new Error(`色号 ${normalized} 的最低库存必须是非负整数`);
    const item = {
      code: normalized,
      name: String(patch.name ?? existing?.name ?? palette?.name ?? ""),
      hex: String(patch.hex ?? existing?.hex ?? palette?.hex ?? ""),
      rgb: patch.rgb ?? existing?.rgb ?? (Array.isArray(palette?.rgb) ? palette.rgb.slice(0, 3) : null),
      stock: nextStock,
      minStock: nextMin,
      unit: String(patch.unit ?? existing?.unit ?? DEFAULT_UNIT),
      location: String(patch.location ?? existing?.location ?? ""),
      supplier: String(patch.supplier ?? existing?.supplier ?? ""),
      note: String(patch.note ?? existing?.note ?? ""),
      updatedAt: now(),
    };
    state.items[normalized] = item;
    commit();
    return { ...item };
  }

  function ensureItem(code, seed = {}) {
    const normalized = normalizeCode(code);
    if (state.items[normalized]) return state.items[normalized];
    const palette = getPaletteColors().find((color) => normalizeCode(color?.code) === normalized) || null;
    state.items[normalized] = {
      code: normalized,
      name: String(seed.name || palette?.name || ""),
      hex: String(seed.hex || palette?.hex || ""),
      rgb: seed.rgb || (Array.isArray(palette?.rgb) ? palette.rgb.slice(0, 3) : null),
      stock: 0,
      minStock: 0,
      unit: DEFAULT_UNIT,
      location: "",
      supplier: "",
      note: "",
      updatedAt: now(),
    };
    return state.items[normalized];
  }

  function removeItem(code) {
    const normalized = normalizeCode(code);
    if (!state.items[normalized]) throw new Error("台账中没有这个色号");
    const used = state.submissions.some((entry) => entry.lines.some((line) => line.code === normalized));
    if (used) throw new Error(`${normalized} 已有用豆记录，不能直接删除`);
    delete state.items[normalized];
    commit();
  }

  function listItems({ search = "", onlyLow = false } = {}) {
    const query = String(search || "").trim().toUpperCase();
    const consumed = consumedMap();
    const rows = Object.values(state.items)
      .map((item) => ({
        ...item,
        rgb: item.rgb ? [...item.rgb] : null,
        deficit: Math.max(0, item.minStock - item.stock),
        consumed: consumed.get(item.code) || 0,
      }))
      .filter((item) => {
        if (onlyLow && item.deficit <= 0) return false;
        if (!query) return true;
        return [item.code, item.name, item.location, item.supplier, item.note]
          .some((field) => String(field || "").toUpperCase().includes(query));
      });
    rows.sort((a, b) => a.code.localeCompare(b.code, "zh-CN"));
    return rows;
  }

  const listReplenish = () => listItems({ onlyLow: true });

  function getOverview() {
    const items = listItems();
    return {
      itemCount: items.length,
      lowCount: items.filter((item) => item.deficit > 0).length,
      outCount: items.filter((item) => item.stock < 0).length,
      totalStock: items.reduce((sum, item) => sum + item.stock, 0),
      totalConsumed: items.reduce((sum, item) => sum + item.consumed, 0),
      submissionCount: state.submissions.filter((entry) => !entry.revertedAt).length,
    };
  }

  /** 用当前图纸统计生成扣料预览（不写库）。这是站内图纸那条「零 OCR」路径。 */
  function previewFromPattern() {
    const lines = buildLines(getStats());
    const rows = lines.map((line) => {
      const item = state.items[line.code] || null;
      const stock = item?.stock ?? 0;
      return {
        ...line,
        name: line.name || item?.name || "",
        hex: line.hex || item?.hex || "",
        stock,
        missing: !item,
        minStock: item?.minStock ?? 0,
        enough: stock >= line.count,
        after: stock - line.count,
      };
    });
    return {
      lines: rows,
      totalBeads: rows.reduce((sum, row) => sum + row.count, 0),
      missingCodes: rows.filter((row) => row.missing).map((row) => row.code),
      shortageCodes: rows.filter((row) => !row.enough).map((row) => row.code),
    };
  }

  /**
   * 扣料：确保每个色号在台账里存在（不存在则建 0 库存条目），再写一条提交记录。
   * 不做原子性回滚的必要：全流程都在内存里同步完成，中途不抛错。
   */
  function consume({ lines = [], source = "manual", label = "" } = {}) {
    const normalized = buildLines(lines).map((line) => ({ ...line, ...enrich(line) }));
    if (!normalized.length) throw new Error("没有可扣减的色号");
    const created = [];
    const shortages = [];
    for (const line of normalized) {
      if (!state.items[line.code]) created.push(line.code);
      const item = ensureItem(line.code, line);
      item.stock -= line.count;
      item.updatedAt = now();
      if (item.stock < 0) shortages.push({ code: line.code, after: item.stock });
    }
    const entry = {
      id: idFactory(),
      label: String(label || ""),
      source: String(source || "manual"),
      createdAt: now(),
      revertedAt: null,
      lines: normalized.map((line) => ({ code: line.code, count: line.count, name: line.name || "" })),
    };
    state.submissions.unshift(entry);
    commit();
    return { submission: { ...entry, lines: entry.lines.map((line) => ({ ...line })) }, created, shortages };
  }

  /** 撤销一次扣料：把数量加回、标记 revertedAt（累计消耗随之排除）。 */
  function revert(submissionId) {
    const entry = state.submissions.find((item) => item.id === submissionId);
    if (!entry) throw new Error("找不到这条用豆记录");
    if (entry.revertedAt) throw new Error("这条记录已经撤销过了");
    entry.revertedAt = now();
    for (const line of entry.lines) {
      const item = state.items[line.code];
      if (!item) continue;
      item.stock += line.count;
      item.updatedAt = now();
    }
    commit();
    return { ...entry, lines: entry.lines.map((line) => ({ ...line })) };
  }

  const listSubmissions = () => state.submissions.map((entry) => ({ ...entry, lines: entry.lines.map((line) => ({ ...line })) }));

  function exportCsv() {
    const rows = [CSV_HEADERS.join(",")];
    for (const item of listItems()) {
      rows.push([item.code, item.name, item.stock, item.minStock, item.unit, item.location, item.supplier, item.note].map(csvCell).join(","));
    }
    return `\uFEFF${rows.join("\r\n")}\r\n`;
  }

  /** CSV 导入：表头必须含「编号」，库存列按表头名读取，缺列则保留原值。 */
  function importCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("CSV 是空的");
    const header = rows[0].map((cell) => String(cell).trim());
    const at = (name) => header.indexOf(name);
    if (at("编号") < 0) throw new Error("CSV 表头缺少「编号」列");
    const stockIndex = at("当前库存");
    const minIndex = at("最低库存");
    if (stockIndex < 0 && minIndex < 0) throw new Error("CSV 表头需要「当前库存」或「最低库存」列");
    const optional = { name: at("名称"), unit: at("单位"), location: at("位置"), supplier: at("供应商"), note: at("备注") };
    let imported = 0;
    const errors = [];
    for (const cells of rows.slice(1)) {
      const code = normalizeCode(cells[at("编号")]);
      if (!code) { errors.push("有一行编号为空"); continue; }
      const patch = {};
      if (stockIndex >= 0) {
        const stock = toCount(cells[stockIndex]);
        if (stock === null) { errors.push(`${code} 的当前库存不是非负整数`); continue; }
        patch.stock = stock;
      }
      if (minIndex >= 0) {
        const min = toCount(cells[minIndex]);
        if (min === null) { errors.push(`${code} 的最低库存不是非负整数`); continue; }
        patch.minStock = min;
      }
      for (const [field, index] of Object.entries(optional)) {
        if (index >= 0) patch[field] = String(cells[index] ?? "").trim();
      }
      try { upsertItem(code, patch); imported += 1; }
      catch (error) { errors.push(`${code}：${error.message}`); }
    }
    return { imported, skipped: errors.length, errors };
  }

  function reset() {
    state = emptyState();
    commit();
  }

  return {
    getState,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getItem: (code) => { const item = state.items[normalizeCode(code)]; return item ? { ...item, rgb: item.rgb ? [...item.rgb] : null } : null; },
    upsertItem,
    adjustStock: (code, delta) => {
      const normalized = normalizeCode(code);
      const current = state.items[normalized]?.stock ?? 0;
      const next = current + Math.round(Number(delta) || 0);
      if (next < 0) throw new Error(`${normalized} 的库存不能改成负数`);
      return upsertItem(normalized, { stock: next });
    },
    removeItem,
    listItems,
    listReplenish,
    getOverview,
    previewFromPattern,
    consume,
    revert,
    listSubmissions,
    exportCsv,
    importCsv,
    reset,
  };
}
