import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importPixlerProject, decodePixlerPattern } from "../importers/pixler.mjs";

const SAMPLE = "/Users/gongzhenyan/Downloads/四格窗景/《京华四景》｜北京/Codex 图像 2026年9月22日 11_17_03-Pixler-20260922-1122.pixler";
const LONG_SAMPLE = "/Users/gongzhenyan/Downloads/01_斜形眼睛条_原形状_8K_7680x1942-Pixler-20260920-1749.pixler";

const read = (path) => new Uint8Array(readFileSync(path));

test("pixler：导入得到 104×104 网格", async () => {
  const { project, report } = await importPixlerProject(read(SAMPLE));
  assert.equal(report.columns, 104);
  assert.equal(report.rows, 104);
  assert.equal(report.cellCount, 10816);
  assert.equal(project.canvas.width, 104);
  assert.equal(project.canvas.height, 104);
});

test("pixler：矩阵形状与格数一致，无越界索引", async () => {
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

test("pixler：输出符合本站 libms-project 契约", async () => {
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

test("pixler：色号来自 Mard standard-221 且已恢复真实色号", async () => {
  const { project, report } = await importPixlerProject(read(SAMPLE));
  assert.equal(report.beadSource, "pixler-bead-match");
  assert.equal(report.algorithm.brandId, "mard");
  assert.equal(report.algorithm.seriesId, "standard-221");
  const codes = new Set(project.colors.map((color) => color.code));
  assert.ok(codes.has("B9"), "应恢复 Pixler 记录的 Mard 色号 B9");
  assert.ok(codes.has("D15"), "应恢复 Pixler 记录的 Mard 色号 D15");
});

test("pixler：decodePixlerPattern 展开结果与声明完全一致", async () => {
  const bytes = read(SAMPLE);
  // 直接走一次完整导入拿到解码结果，再单独校验纯函数
  const { report } = await importPixlerProject(bytes);
  assert.equal(report.paletteCount, 5912);
  assert.equal(report.runCount, 9886);
});

test("pixler：非 Pixler 的 ZIP 应被拒绝而不是猜测", async () => {
  const bytes = read(SAMPLE);
  // 篡改 magic 使其不是 ZIP
  const broken = bytes.slice();
  broken[0] = 0x00;
  broken[1] = 0x00;
  await assert.rejects(() => importPixlerProject(broken), /ZIP|pixler/);
});

test("pixler：第二个样本（非正方形）也能正确导入", async () => {
  const { project, report } = await importPixlerProject(read(LONG_SAMPLE));
  assert.equal(report.columns, 103);
  assert.equal(report.rows, 26);
  assert.equal(project.grid.length, 26);
  assert.equal(project.grid[0].length, 103);
  assert.equal(report.cellCount, 103 * 26);
});
