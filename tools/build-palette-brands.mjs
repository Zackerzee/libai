#!/usr/bin/env node
// 把 HansBug/pindou-color-data（MIT）的官方色卡转换成 libms 的品牌色库模块。
//
// 用法：
//   node tools/build-palette-brands.mjs
//   node tools/build-palette-brands.mjs --src /path/to/pindou-color-data
//
// 说明：本脚本只搬运**数据**（色号 / RGB / 分组 / 市场元信息），不搬运任何源码。
// 数据许可是 MIT，允许逐字搬运；出处与许可头会写入产物文件。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "smart-preprocessing", "palette-brands.mjs");

const argv = process.argv.slice(2);
const srcFlag = argv.indexOf("--src");
const SRC = srcFlag === -1 ? "/tmp/bead-audit/pindou-color-data" : argv[srcFlag + 1];

// 只挑选对 libms 有增量的色源：
//  - artkal / youken 系列是真正的**新品牌**（libms 原本完全没有）
//  - *-official 后缀的是现有国产四家的**真实官方 RGB**（libms 原本四个国产品牌共用同一份 MARD 291 色，
//    只有色号不同）；这里作为**独立新增项**提供，不覆盖原品牌，避免既有图纸回归。
const SELECTED = [
  { id: "artkal197", dir: "artkal-c-197-official", label: "优肯 C197", family: "artkal" },
  { id: "artkal221", dir: "artkal-m-221-official", label: "优肯 M221", family: "artkal" },
  { id: "artkal418", dir: "artkal-c197-m221-418-official", label: "优肯 418", family: "artkal" },
  { id: "youken174", dir: "youken-public-174", label: "优肯 174旧表", family: "artkal" },
  { id: "cocoOfficial", dir: "coco-291", label: "COCO 官方", family: "generic" },
  { id: "manmanOfficial", dir: "manman-278", label: "漫漫 官方", family: "generic" },
  { id: "panpanOfficial", dir: "panpan-289", label: "盼盼 官方", family: "generic" },
  { id: "mixiaowoOfficial", dir: "mixiaowo-290", label: "咪小窝 官方", family: "generic" },
];

// ⚠️ id 里**不能含连字符**：app.js 的 getPaletteKey() 拼的是 `${brand}-${count}`，
// 而 UI 侧（ui/workspace.js:146 等）用 `key.split("-")[0]` 反解品牌名。含 "-" 会解析错位、尺寸变 NaN。

// 与现有 libms 品牌重合的源不入表（防止同 id 打架），记在注释里供核对。
//   mard-221-github / mard-221-alfonse-doudou / mard-291-github → 与内建 MARD 291 同源

function toHex(rgb) {
  return "#" + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function normalizeHex(hex, rgb) {
  const clean = String(hex || "").trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(clean)) return clean;
  return toHex(rgb);
}

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const byId = new Map(manifest.map((entry) => [entry.id, entry]));

const palettes = [];
const report = [];

for (const spec of SELECTED) {
  const file = path.join(SRC, spec.dir, "colors.json");
  if (!fs.existsSync(file)) {
    report.push(`SKIP ${spec.id}: ${file} 不存在`);
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(raw.colors) ? raw.colors : Array.isArray(raw.rows) ? raw.rows : [];
  const meta = byId.get(spec.dir) || {};

  const seen = new Set();
  const colors = [];
  let droppedDuplicate = 0;
  let droppedNoRgb = 0;
  for (const row of rows) {
    const code = String(row.code || "").trim();
    const rgb = Array.isArray(row.rgb) ? row.rgb.map(Number) : null;
    if (!code || !rgb || rgb.length < 3 || rgb.some((n) => !Number.isFinite(n))) {
      droppedNoRgb += 1;
      continue;
    }
    if (seen.has(code)) {
      droppedDuplicate += 1;
      continue;
    }
    seen.add(code);
    colors.push({
      code,
      rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])],
      hex: normalizeHex(row.hex, rgb),
      group: row.group ? String(row.group) : "",
    });
  }

  palettes.push({
    id: spec.id,
    label: spec.label,
    family: spec.family,
    title: meta.title || raw.title || spec.label,
    description: meta.description || raw.description || "",
    sourceId: spec.dir,
    sourceVersion: raw.generated_at || "",
    count: colors.length,
    tier: meta.mainstream_tier || "",
    score: meta.mainstream_score ?? null,
    tierLabel: meta.mainstream_label || "",
    summary: meta.mainstream_summary || "",
    groups: meta.groups || raw.groups || {},
    options: [colors.length],
    colors,
  });

  report.push(`OK   ${spec.id.padEnd(20)} ${String(colors.length).padStart(4)} 色  丢 BY 重复/无效=${droppedDuplicate}/${droppedNoRgb}`);
}

const total = palettes.reduce((sum, p) => sum + p.count, 0);

// 紧凑序列化：hex 不落盘（运行时由 rgb 推导，省 ~40 字节/色），一行一个色。
function quote(value) {
  return JSON.stringify(value);
}

function serializePalette(palette) {
  const lines = ["  {"];
  lines.push(`    id: ${quote(palette.id)},`);
  lines.push(`    label: ${quote(palette.label)},`);
  lines.push(`    family: ${quote(palette.family)},`);
  lines.push(`    title: ${quote(palette.title)},`);
  lines.push(`    description: ${quote(palette.description)},`);
  lines.push(`    sourceId: ${quote(palette.sourceId)},`);
  lines.push(`    sourceVersion: ${quote(palette.sourceVersion)},`);
  lines.push(`    count: ${palette.count},`);
  lines.push(`    tier: ${quote(palette.tier)},`);
  lines.push(`    score: ${palette.score === null ? "null" : palette.score},`);
  lines.push(`    tierLabel: ${quote(palette.tierLabel)},`);
  lines.push(`    summary: ${quote(palette.summary)},`);
  lines.push(`    groups: ${JSON.stringify(palette.groups)},`);
  lines.push(`    options: [${palette.options.join(", ")}],`);
  lines.push("    colors: [");
  for (const color of palette.colors) {
    lines.push(`      { code: ${quote(color.code)}, rgb: [${color.rgb.join(", ")}], group: ${quote(color.group)} },`);
  }
  lines.push("    ],");
  lines.push("  }");
  return lines.join("\n");
}

const body = `// 自动生成，请勿手改。重新构建：node tools/build-palette-brands.mjs
//
// 数据来源：HansBug/pindou-color-data（MIT License, Copyright (c) 2026 HansBug）
//   https://github.com/HansBug/pindou-color-data
// 本文件只搬运**颜色数据与元信息**，不含任何来源源码。
// 色号为各品牌官方色卡编号，非 libms 自造；id 与内建品牌不冲突（国产四家另建 xxx-official）。
//
// 注意：每个色只存 rgb，不存 hex —— hex 由运行时推导，体积省约 40%。
//
// 生成时间：${new Date().toISOString()}
// 品牌数：${palettes.length}，总色数：${total}

export const BRAND_PALETTE_SOURCE = ${JSON.stringify(
  {
    repo: "HansBug/pindou-color-data",
    url: "https://github.com/HansBug/pindou-color-data",
    license: "MIT",
    licenseUrl: "https://github.com/HansBug/pindou-color-data/blob/main/LICENSE",
    generatedAt: new Date().toISOString(),
    note: "仅搬运颜色数据与元信息；每个品牌使用其官方色卡的独立 RGB。",
  },
  null,
  2,
)};

export const BRAND_PALETTES = [
${palettes.map(serializePalette).join(",\n")}
];

export function getBrandPalette(id) {
  return BRAND_PALETTES.find((palette) => palette.id === id) || null;
}
`;

fs.writeFileSync(OUT, body, "utf8");

console.log(report.join("\n"));
console.log(`\n→ ${OUT}`);
console.log(`  品牌 ${palettes.length} 个，总色数 ${total}，文件 ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`);
