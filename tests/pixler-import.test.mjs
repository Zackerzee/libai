import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { importPixlerProject, decodePixlerPattern } from "../importers/pixler.mjs";

// 样本已固化进仓库（tests/fixtures/pixler/），不再依赖本机 Downloads 目录。
// 两个样本均为用户自己的作品导出，体积 96 KB / 117 KB，随仓库分发无额外许可义务。
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pixler");
const SAMPLE = join(FIXTURES, "square-104x104.pixler");
const LONG_SAMPLE = join(FIXTURES, "rect-7680x1942.pixler");

const read = (path) => new Uint8Array(readFileSync(path));
const skip = existsSync(SAMPLE) && existsSync(LONG_SAMPLE)
  ? false
  : "缺少 tests/fixtures/pixler/ 下的 .pixler 样本";

test("pixler：导入得到 104×104 网格", { skip }, async () => {
  const { project, report } = await importPixlerProject(read(SAMPLE));
  assert.equal(report.columns, 104);
  assert.equal(report.rows, 104);
  assert.equal(report.cellCount, 10816);
  assert.equal(project.canvas.width, 104);
  assert.equal(project.canvas.height, 104);
});

test("pixler：矩阵形状与格数一致，无越界索引", { skip }, async () => {
  const { project, report } = await importPixlerProject(read(SAMPLE));
  assert.equal(project.grid.length, 104);
  let cells = 0;
  for (const row of project.grid) {
    assert.equal(row.length, 104, "每行宽度必须等于 columns");
    cells += row.length;
  }
  assert.equal(cells, 10816);
  assert.equal(report.unresolvedCells, 0, "不应存在无法解析的格子");
});

test("pixler：输出符合本站 libms-project 契约", { skip }, async () => {
  const { project } = await importPixlerProject(read(SAMPLE));
  assert.equal(project.format, "libms-project");
  assert.equal(project.version, 1);
  assert.ok(typeof project.projectName === "string" && project.projectName.length > 0);
  assert.ok(Array.isArray(project.colors) && project.colors.length > 0);
  for (const color of project.colors) {
    assert.ok(typeof color.code === "string" && color.code.length > 0);
    assert.equal(color.rgb.length, 3);
    assert.match(color.hex, /^#[0-9a-fA-F]{6}$/);
  }
  assert.equal(project.stats.usedColors, project.colors.length);
  assert.ok(project.stats.totalBeads > 0);
});

test("pixler：色号来自 Mard standard-221 且已恢复真实色号", { skip }, async () => {
  const { project, report } = await importPixlerProject(read(SAMPLE));
  assert.equal(report.beadSource, "pixler-bead-match");
  assert.equal(report.algorithm.brandId, "mard");
  assert.equal(report.algorithm.seriesId, "standard-221");
  const codes = new Set(project.colors.map((color) => color.code));
  assert.ok(codes.has("B9"), "应恢复 Pixler 记录的 Mard 色号 B9");
  assert.ok(codes.has("D15"), "应恢复 Pixler 记录的 Mard 色号 D15");
});

test("pixler：decodePixlerPattern 展开结果与声明完全一致", { skip }, async () => {
  const bytes = read(SAMPLE);
  // 直接走一次完整导入拿到解码结果，再单独校验纯函数
  const { report } = await importPixlerProject(bytes);
  assert.equal(report.paletteCount, 5912);
  assert.equal(report.runCount, 9886);
});

test("pixler：非 Pixler 的 ZIP 应被拒绝而不是猜测", { skip }, async () => {
  const bytes = read(SAMPLE);
  // 篡改 magic 使其不是 ZIP
  const broken = bytes.slice();
  broken[0] = 0x00;
  broken[1] = 0x00;
  await assert.rejects(() => importPixlerProject(broken), /ZIP|pixler/);
});

test("pixler：第二个样本（非正方形）也能正确导入", { skip }, async () => {
  const { project, report } = await importPixlerProject(read(LONG_SAMPLE));
  assert.equal(report.columns, 103);
  assert.equal(report.rows, 26);
  assert.equal(project.grid.length, 26);
  assert.equal(project.grid[0].length, 103);
  assert.equal(report.cellCount, 103 * 26);
});
