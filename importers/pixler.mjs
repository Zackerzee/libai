/**
 * Pixler 项目文件（.pixler）导入适配器。
 *
 * 定位：**新的 import adapter**，不是新的存储格式。
 * 输出严格复用本站既有的工程存档契约（`format: "libms-project"`），
 * 交给 `bridge.loadProjectJson()` 载入 —— 不改动全站 Grid Storage 结构。
 *
 * 之所以不把 .pixler 转成图片再识别：文件里已经存了**精确的网格数据**，
 * 转图片会经历「采样 → RGB 提取 → 减色 → 色号匹配」的二次损失。
 * 这里直接读取结构化网格，只保留最后一步色号匹配，且输入是精确 RGB。
 *
 * 文件格式（codecVersion 1，实测反推）：
 *   .pixler 是 ZIP。ZIP 层可能是 STORED 或 deflate。
 *   pattern.bin 内部负载 = deflate-raw，解压后：
 *     [0..7]   magic "PXLRPTN1"
 *     [8..11]  indexByteWidth (uint32 LE)
 *     [12..15] columns
 *     [16..19] rows
 *     [20..23] paletteCount
 *     [24..27] runCount
 *     [28..31] cellCount
 *     [32 ..)  palette: RGBA × paletteCount
 *     [.. )    RLE: (index: indexByteWidth LE)(count: uint32 LE) × runCount
 */

const PIXLER_FORMAT = "pixler-project";
const PATTERN_MAGIC = "PXLRPTN1";
const SUPPORTED_CODEC_VERSIONS = new Set([1]);
const SUPPORTED_INDEX_WIDTHS = new Set([1, 2, 4]);

const LIMITS = {
  fileBytes: 64 * 1024 * 1024,
  entries: 64,
  cells: 4_000_000,
  entryBytes: 32 * 1024 * 1024,
};

// ===== 色彩管线：sRGB -> CIELAB(D65) -> CIEDE2000 =====
// 与 Pixler 自带的 lab 值逐位一致（实测校验），因此色号匹配可 100% 复现其结果。

function srgbToLab(r, g, b) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.0;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function ciede2000(lab1, lab2) {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1 = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
  const h2 = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;
  const dL = l2 - l1;
  const dC = C2p - C1p;
  let dh;
  if (C1p * C2p === 0) dh = 0;
  else if (Math.abs(h2 - h1) <= 180) dh = h2 - h1;
  else if (h2 - h1 > 180) dh = h2 - h1 - 360;
  else dh = h2 - h1 + 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh * Math.PI / 360);
  const Lbar = (l1 + l2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbar;
  if (C1p * C2p === 0) hbar = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hbar = (h1 + h2) / 2;
  else if (h1 + h2 < 360) hbar = (h1 + h2 + 360) / 2;
  else hbar = (h1 + h2 - 360) / 2;
  const T = 1
    - 0.17 * Math.cos((hbar - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * hbar * Math.PI / 180)
    + 0.32 * Math.cos((3 * hbar + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * hbar - 63) * Math.PI / 180);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// ===== ZIP 解包 =====

let fflatePromise = null;

async function loadFflate() {
  if (globalThis.fflate) return globalThis.fflate;
  if (!fflatePromise) {
    fflatePromise = import("../vendor/fflate.js").then((mod) => {
      const candidate = mod?.default || mod;
      const api = globalThis.fflate || (typeof candidate?.unzip === "function" ? candidate : null);
      if (!api) throw new Error("ZIP 解压库加载失败");
      return api;
    });
  }
  return fflatePromise;
}

function assertSafeEntryName(name) {
  // 禁止路径穿越与绝对路径
  if (!name || name.includes("\\") || name.startsWith("/")) throw new Error(`非法压缩包条目名：${name}`);
  if (name.split("/").some((part) => part === "..")) throw new Error(`压缩包条目名包含上级目录：${name}`);
}

async function readEntries(bytes) {
  const head = String.fromCharCode(bytes[0] || 0, bytes[1] || 0);
  if (head !== "PK") throw new Error("不是有效的 ZIP / .pixler 文件");
  const api = await loadFflate();
  const files = api.unzipSync(bytes);
  const names = Object.keys(files);
  if (names.length > LIMITS.entries) throw new Error(`压缩包条目过多（${names.length}），已拒绝`);
  const entries = new Map();
  for (const name of names) {
    assertSafeEntryName(name);
    const data = files[name];
    if (data.byteLength > LIMITS.entryBytes) throw new Error(`条目 ${name} 过大，已拒绝`);
    entries.set(name, data);
  }
  return entries;
}

async function toBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (typeof source?.arrayBuffer === "function") return new Uint8Array(await source.arrayBuffer());
  throw new Error("无法读取文件内容");
}

function parseJsonEntry(entries, name, { required = true } = {}) {
  const raw = entries.get(name);
  if (!raw) {
    if (required) throw new Error(`缺少 ${name}`);
    return null;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(raw));
  } catch {
    throw new Error(`${name} 不是合法 JSON`);
  }
}

// ===== manifest 校验 =====

function validateManifest(manifest, entries) {
  if (manifest?.format !== PIXLER_FORMAT) throw new Error("不是 Pixler 项目文件（manifest.format 不匹配）");
  const version = Number(manifest.formatVersion);
  if (!Number.isInteger(version) || version < 1) throw new Error("Pixler 文件格式版本无法识别");
  if (version > 1) throw new Error(`Pixler 格式版本 ${version} 高于当前支持的 1`);
  // 校验 manifest 声明的条目确实存在，且字节数一致
  for (const [name, meta] of Object.entries(manifest.entries || {})) {
    const data = entries.get(name);
    if (!data) throw new Error(`manifest 声明的 ${name} 在压缩包中不存在`);
    if (Number.isFinite(meta?.bytes) && data.byteLength !== meta.bytes) {
      throw new Error(`${name} 大小与 manifest 声明不一致（${data.byteLength} ≠ ${meta.bytes}）`);
    }
  }
  const patternMeta = manifest.pattern;
  if (!patternMeta) throw new Error("manifest 缺少 pattern 描述");
  if (!SUPPORTED_CODEC_VERSIONS.has(Number(patternMeta.codecVersion))) {
    throw new Error(`不支持的 pattern.bin 编码版本 ${patternMeta.codecVersion}，已停止导入`);
  }
  if (patternMeta.indexEncoding !== "little-endian-min-width") {
    throw new Error(`不支持的索引编码 ${patternMeta.indexEncoding}`);
  }
  if (patternMeta.runEncoding !== "value-count-rle-v1") {
    throw new Error(`不支持的行程编码 ${patternMeta.runEncoding}`);
  }
  if (patternMeta.compression !== "deflate-raw") {
    throw new Error(`不支持的压缩方式 ${patternMeta.compression}`);
  }
  return patternMeta;
}

// ===== pattern.bin 解码 =====

export function decodePixlerPattern(decoded, meta) {
  const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const magic = String.fromCharCode(...decoded.subarray(0, 8));
  if (magic !== PATTERN_MAGIC) throw new Error("pattern.bin 文件头不是 PXLRPTN1");
  const indexByteWidth = view.getUint32(8, true);
  const columns = view.getUint32(12, true);
  const rows = view.getUint32(16, true);
  const paletteCount = view.getUint32(20, true);
  const runCount = view.getUint32(24, true);
  const cellCount = view.getUint32(28, true);

  if (!SUPPORTED_INDEX_WIDTHS.has(indexByteWidth)) throw new Error(`不支持的索引宽度 ${indexByteWidth}`);
  if (!columns || !rows) throw new Error("pattern.bin 尺寸为空");
  if (columns * rows !== cellCount) throw new Error(`尺寸与格数不一致：${columns}×${rows} ≠ ${cellCount}`);
  if (cellCount > LIMITS.cells) throw new Error(`网格过大（${cellCount} 格），已拒绝`);

  const expected = 32 + paletteCount * 4 + runCount * (indexByteWidth + 4);
  if (expected !== decoded.byteLength) {
    throw new Error(`pattern.bin 长度与声明不符（期望 ${expected}，实际 ${decoded.byteLength}）`);
  }
  if (Number.isFinite(meta?.cellCount) && meta.cellCount !== cellCount) {
    throw new Error(`pattern.bin 格数与 manifest 不一致（${cellCount} ≠ ${meta.cellCount}）`);
  }

  const palette = new Array(paletteCount);
  for (let i = 0; i < paletteCount; i += 1) {
    const at = 32 + i * 4;
    palette[i] = [decoded[at], decoded[at + 1], decoded[at + 2], decoded[at + 3]];
  }

  const cells = new Int32Array(cellCount);
  const runStride = indexByteWidth + 4;
  let cursor = 0;
  let maxIndex = -1;
  const runOffset = 32 + paletteCount * 4;
  for (let i = 0; i < runCount; i += 1) {
    const at = runOffset + i * runStride;
    let value = 0;
    for (let b = 0; b < indexByteWidth; b += 1) value += decoded[at + b] * 256 ** b;
    const count = view.getUint32(at + indexByteWidth, true);
    if (value >= paletteCount) throw new Error(`调色板索引越界：${value} ≥ ${paletteCount}`);
    if (cursor + count > cellCount) throw new Error("行程总长超出网格格数");
    for (let n = 0; n < count; n += 1) cells[cursor + n] = value;
    cursor += count;
    if (value > maxIndex) maxIndex = value;
  }
  if (cursor !== cellCount) throw new Error(`行程展开后格数不符（${cursor} ≠ ${cellCount}）`);

  return { columns, rows, cellCount, palette, cells, indexByteWidth, runCount, maxIndex };
}

// ===== bead-match 解析 =====

function buildBeadTable(beadMatch) {
  if (!beadMatch || !Array.isArray(beadMatch.revisions) || !beadMatch.revisions.length) {
    return { beads: [], algorithm: null, revisionId: null, patternsHash: null };
  }
  const activeId = beadMatch.activeRevisionId;
  const revision = beadMatch.revisions.find((item) => item.revisionId === activeId) || beadMatch.revisions[0];
  const matches = Array.isArray(revision?.matches) ? revision.matches : [];
  const byCode = new Map();
  for (const match of matches) {
    const bead = match?.bead;
    if (!bead?.code) continue;
    const rgb = Array.isArray(bead.rgb) ? bead.rgb.slice(0, 3) : null;
    if (!rgb || rgb.length !== 3) continue;
    const identity = bead.paletteId || bead.code;
    if (!byCode.has(identity)) {
      byCode.set(identity, {
        ...(bead.paletteId ? { paletteId: bead.paletteId } : {}),
        paletteIndex: match.paletteIndex,
        code: bead.code,
        name: bead.name || bead.code,
        rgb,
        hex: typeof bead.hex === "string" ? bead.hex : null,
        lab: Array.isArray(bead.lab) ? bead.lab : srgbToLab(rgb[0], rgb[1], rgb[2]),
      });
    }
  }
  return {
    beads: [...byCode.values()],
    algorithm: revision?.algorithm || null,
    catalog: revision?.catalog || null,
    revisionId: revision?.revisionId || null,
    patternHash: revision?.patternContentHash || null,
  };
}

// ===== 色号匹配 =====

function matchPaletteToBeads(palette, beads) {
  const candidates = beads.map((bead) => ({ bead, lab: bead.lab || srgbToLab(...bead.rgb) }));
  const cache = new Map();
  const codes = new Array(palette.length);
  for (let i = 0; i < palette.length; i += 1) {
    const [r, g, b, a] = palette[i];
    const exact = beads.find((bead) => bead.paletteIndex === i && bead.rgb.every((v, channel) => v === palette[i][channel]));
    if (a !== 0 && exact) { codes[i] = exact.paletteId || exact.code; continue; }
    const key = `${r},${g},${b},${a}`;
    const cached = cache.get(key);
    if (cached !== undefined) { codes[i] = cached; continue; }
    if (a === 0) { cache.set(key, null); continue; }
    const lab = srgbToLab(r, g, b);
    let best = null;
    let bestDelta = Infinity;
    for (const candidate of candidates) {
      const delta = ciede2000(lab, candidate.lab);
      if (delta < bestDelta) { bestDelta = delta; best = candidate.bead; }
    }
    cache.set(key, best ? best.paletteId || best.code : null);
    codes[i] = best ? best.paletteId || best.code : null;
  }
  return { codes, colorByCode: new Map(beads.map((bead) => [bead.paletteId || bead.code, bead])) };
}

// ===== 主入口 =====

export async function importPixlerProject(source, options = {}) {
  const bytes = await toBytes(source);
  if (bytes.byteLength > LIMITS.fileBytes) throw new Error("文件过大，已拒绝");

  const entries = await readEntries(bytes);
  const manifest = parseJsonEntry(entries, "manifest.json");
  const patternMeta = validateManifest(manifest, entries);

  const work = parseJsonEntry(entries, "work.json", { required: false });
  const settings = parseJsonEntry(entries, "settings.json", { required: false });
  const beadMatch = parseJsonEntry(entries, "bead-match.json", { required: false });

  const api = await loadFflate();
  const patternRaw = entries.get("pattern.bin");
  if (!patternRaw) throw new Error("缺少 pattern.bin");
  const decoded = api.inflateSync(patternRaw);
  if (Number.isFinite(patternMeta.decodedBytes) && decoded.byteLength !== patternMeta.decodedBytes) {
    throw new Error(`pattern.bin 解压后长度与 manifest 不符（${decoded.byteLength} ≠ ${patternMeta.decodedBytes}）`);
  }

  const pattern = decodePixlerPattern(decoded, patternMeta);
  const beadTable = buildBeadTable(beadMatch);

  // 色号来源优先级：Pixler 自带的 bead 集合 > 调用方传入的当前色板 > 无（保留原色，无编号）
  let beads = beadTable.beads;
  let beadSource = beadTable.beads.length ? "pixler-bead-match" : "";
  if (!beads.length && Array.isArray(options.palette) && options.palette.length) {
    beads = options.palette.map((color) => ({
      code: color.code,
      name: color.name || color.code,
      rgb: color.rgb,
      hex: color.hex || null,
      lab: srgbToLab(color.rgb[0], color.rgb[1], color.rgb[2]),
    }));
    beadSource = "site-palette";
  }

  const { codes, colorByCode } = beads.length
    ? matchPaletteToBeads(pattern.palette, beads)
    : { codes: new Array(pattern.palette.length).fill(null), colorByCode: new Map() };

  const fallbackHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const resolved = new Map();
  for (let i = 0; i < pattern.palette.length; i += 1) {
    const code = codes[i];
    if (!code) continue;
    if (!resolved.has(code)) resolved.set(code, colorByCode.get(code) || null);
  }

  const grid = [];
  let unresolved = 0;
  for (let row = 0; row < pattern.rows; row += 1) {
    const line = new Array(pattern.columns);
    for (let col = 0; col < pattern.columns; col += 1) {
      const index = pattern.cells[row * pattern.columns + col];
      const [r, g, b, a] = pattern.palette[index];
      if (a === 0) { line[col] = null; continue; }
      const code = codes[index];
      if (!code) { unresolved += 1; line[col] = null; continue; }
      line[col] = code;
    }
    grid.push(line);
  }

  const usedCodes = new Map();
  for (const row of grid) {
    for (const code of row) {
      if (!code) continue;
      usedCodes.set(code, (usedCodes.get(code) || 0) + 1);
    }
  }
  const colors = [...usedCodes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => {
      const bead = colorByCode.get(code);
      const rgb = bead ? bead.rgb : [0, 0, 0];
      return { code: bead?.code || code, ...(bead?.paletteId ? { paletteId: bead.paletteId } : {}), name: bead?.name || code, hex: bead?.hex || fallbackHex(rgb), rgb, count };
    });

  const title = work?.meta?.title || options.fallbackName || "Pixler 作品";
  const drawing = settings?.drawingSettings || {};

  const project = {
    format: "libms-project",
    version: 1,
    savedAt: new Date().toISOString(),
    projectName: String(title).slice(0, 60),
    canvas: { width: pattern.columns, height: pattern.rows },
    palette: {
      key: beadTable.algorithm?.seriesId ? `${beadTable.algorithm.brandId}-${beadTable.algorithm.seriesId}` : "pixler-import",
      label: beadTable.algorithm
        ? beadTable.catalog?.label || `Pixler · ${beadTable.algorithm.brandId}${beadTable.algorithm.seriesId ? ` ${beadTable.algorithm.seriesId}` : ""}`
        : "Pixler 导入",
      maxColors: colors.length || null,
    },
    stats: { usedColors: colors.length, totalBeads: [...usedCodes.values()].reduce((sum, n) => sum + n, 0) },
    colors: colors.map(({ count, ...rest }) => rest),
    grid: grid.map((row) => row.map((id) => id ? colorByCode.get(id)?.code || id : null)),
    ...(beads.some((bead) => bead.paletteId) ? { gridPaletteIds: grid.map((row) => row.map((id) => id ? colorByCode.get(id)?.paletteId || null : null)) } : {}),
  };

  const hashMatches = Boolean(
    beadTable.patternHash && manifest.pattern?.contentHash && beadTable.patternHash === manifest.pattern.contentHash,
  );

  return {
    project,
    report: {
      source: "pixler",
      title: project.projectName,
      columns: pattern.columns,
      rows: pattern.rows,
      cellCount: pattern.cellCount,
      paletteCount: pattern.palette.length,
      runCount: pattern.runCount,
      usedColors: colors.length,
      totalBeads: project.stats.totalBeads,
      beadSource: beadSource || "none",
      algorithm: beadTable.algorithm,
      catalog: beadTable.catalog,
      beadMatchSynced: hashMatches,
      unresolvedCells: unresolved,
      // 仅回传本站已有能力对应的设置，其余 Pixler 专属设置保留为原始值供展示
      restoredSettings: { gridVisible: drawing.gridVisible === true },
      pixlerOnlySettings: {
        majorGridEvery: drawing.majorGridEvery ?? null,
        colorCodeLabelMode: drawing.colorCodeLabelMode ?? null,
        legendSort: drawing.legendSort ?? null,
        displayMode: drawing.displayMode ?? null,
      },
    },
  };
}

/** 供上传入口做文件类型判定：不只看后缀。 */
export async function looksLikePixler(file) {
  const name = String(file?.name || "");
  if (name.toLowerCase().endsWith(".pixler")) return true;
  if (!/\.(zip|pixler)$/i.test(name)) return false;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return String.fromCharCode(head[0], head[1]) === "PK";
  } catch {
    return false;
  }
}
