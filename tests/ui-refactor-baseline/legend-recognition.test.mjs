import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLegendRecognitionService,
  mergeRegionReads,
  classifyRow,
  parseScore,
  cellInsetFor,
  rankSource,
  rowsToLines,
  rgbaToRgb,
} from "../../services/legend-recognition-service.js";

/* ------------------------------ 纯函数 ------------------------------ */

test("parseScore 偏好「字母+数字」编号并给带数量的加分", () => {
  assert.equal(parseScore(null), 0);
  // A11(202)：字母+数字 60 + 数量 30
  assert.equal(parseScore({ id: "A11", count: 202 }), 90);
  // 纯字母编号次之
  assert.equal(parseScore({ id: "M", count: 64 }), 70);
  // 纯数字编号（OCR 丢了字母前缀）最低
  assert.equal(parseScore({ id: "620", count: 1076 }), 50);
  assert.equal(parseScore({ id: "A11", count: null }), 60);
});

test("rankSource 让印在色块内部的结果优先", () => {
  assert.ok(rankSource("cell") < rankSource("tight"));
  assert.ok(rankSource("tight") < rankSource("around"));
});

test("cellInsetFor 按色块高度取边距并夹在 4-12 之间", () => {
  assert.equal(cellInsetFor({ y0: 0, y1: 10 }), 4);
  assert.equal(cellInsetFor({ y0: 0, y1: 40 }), 8);
  assert.equal(cellInsetFor({ y0: 0, y1: 200 }), 12);
});

test("mergeRegionReads 取完整度最高的结果，并用其它区域补上缺失的数量", () => {
  const merged = mergeRegionReads([
    // 整块色块只读出了后缀数字，结构可疑但分数不低
    { parse: { id: "620", count: null }, confidence: 80 },
    // 紧致框读出了正确编号但没读到数量
    { parse: { id: "G20", count: null }, confidence: 55 },
    // 周边区域读到了数量
    { parse: { id: null, count: 1076 }, confidence: 70 },
  ]);
  assert.equal(merged.id, "G20");
  assert.equal(merged.count, 1076);
});

test("mergeRegionReads 绝不拿纯数量冒充编号", () => {
  const merged = mergeRegionReads([{ parse: { id: null, count: 202 }, confidence: 90 }]);
  assert.equal(merged.id, null);
  assert.equal(merged.count, 202);
});

test("mergeRegionReads 在全部解析失败时返回 null", () => {
  assert.equal(mergeRegionReads([{ parse: null, confidence: 0 }]), null);
  assert.equal(mergeRegionReads([]), null);
});

test("classifyRow 把三类情况分档：直接可用 / 需核对 / 未识别", () => {
  const clean = classifyRow({ code: "A11", count: 202, confidence: 88, match: { code: "A11" }, agreed: true });
  assert.equal(clean.status, "ok");
  assert.deepEqual(clean.warnings, []);

  const noCode = classifyRow({ code: "", count: null, confidence: 0, match: null, agreed: null });
  assert.equal(noCode.status, "failed");
  assert.ok(noCode.warnings[0].includes("补录"));

  assert.equal(classifyRow({ code: "620", count: 10, confidence: 80, match: null, agreed: null }).status, "review");
  assert.equal(classifyRow({ code: "A11", count: null, confidence: 80, match: null, agreed: null }).status, "review");
  assert.equal(classifyRow({ code: "A11", count: 10, confidence: 20, match: null, agreed: null }).status, "review");
});

test("classifyRow 在 OCR 编号与色块颜色不一致时要求人工确认", () => {
  const verdict = classifyRow({ code: "A11", count: 10, confidence: 90, match: { code: "B03" }, agreed: false });
  assert.equal(verdict.status, "review");
  assert.ok(verdict.warnings.some((message) => message.includes("B03")));
});

test("rowsToLines 丢掉空编号与零数量，并大写编号", () => {
  const lines = rowsToLines([
    { code: " a11 ", count: "202" },
    { code: "", count: 5 },
    { code: "B03", count: 0 },
    { code: "h07", count: 12.4 },
  ]);
  assert.deepEqual(lines, [
    { code: "A11", count: 202, name: "" },
    { code: "H07", count: 12, name: "" },
  ]);
});

test("rgbaToRgb 丢掉 alpha 通道", () => {
  const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128]);
  assert.deepEqual([...rgbaToRgb(rgba, 2, 1)], [1, 2, 3, 4, 5, 6]);
});

/* --------------------------- 端到端（假 OCR） --------------------------- */

/** 造一张三行六列宽色条的合成图纸，与参考实现 legend.test.ts 的场景同构。 */
function syntheticChart({ rows = 3, cols = 6 } = {}) {
  const width = 800;
  const height = 200;
  const palette = [
    [255, 0, 0], [255, 128, 0], [255, 255, 0],
    [0, 255, 0], [0, 128, 255], [128, 0, 255],
  ];
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const [r, g, b] = palette[col % palette.length];
      const x0 = 10 + col * 130;
      const y0 = 10 + row * 60;
      for (let y = y0; y < y0 + 44; y += 1) {
        for (let x = x0; x < x0 + 120; x += 1) {
          const i = (y * width + x) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
    }
  }
  return { imageData: { width, height, data }, rows, cols };
}

const CODES = [["A11", "A12", "A13", "A14", "A15", "A16"], ["B03", "B04", "B05", "B06", "B07", "B08"], ["H07", "H08", "H09", "H10", "H11", "H12"]];
const COUNTS = [[202, 173, 88, 45, 30, 12], [56, 61, 77, 120, 9, 4], [1000, 320, 15, 6, 2, 55]];

/** 按几何位置返回固定文本的假 OCR：不依赖引擎，纯逻辑可测。 */
function fakeOcr({ failAt = null } = {}) {
  const calls = [];
  return {
    calls,
    async recognizeBox(_source, box, options) {
      calls.push({ box: { ...box }, options });
      const cx = (box.x0 + box.x1) / 2;
      const cy = (box.y0 + box.y1) / 2;
      const col = Math.round((cx - 70) / 130);
      const row = Math.round((cy - 32) / 60);
      if (col < 0 || col > 5 || row < 0 || row > 2) return { text: "", words: [], confidence: 0 };
      // 只在"整块色块"的区域内返回文字，模拟文字印在色条上
      if (Math.abs(cx - (70 + col * 130)) > 62 || Math.abs(cy - (32 + row * 60)) > 24) return { text: "", words: [], confidence: 0 };
      if (failAt && failAt.row === row && failAt.col === col) return { text: "###", words: [], confidence: 0 };
      return { text: `${CODES[row][col]}(${COUNTS[row][col]})`, words: [{ text: CODES[row][col], confidence: 88 }], confidence: 88 };
    },
  };
}

const stubSource = (imageData) => ({ canvas: null, width: imageData.width, height: imageData.height });

test("识别整张图纸：三行六列全部读出编号与数量", async () => {
  const { imageData } = syntheticChart();
  const service = createLegendRecognitionService({
    ocr: fakeOcr(),
    createSource: stubSource,
    matchColor: (rgb) => ({ nearest: { code: "A11" }.code, candidates: [] }),
  });
  const result = await service.recognize(imageData);
  // 色块数量不应少于 18（宽色条按列切分）
  assert.ok(result.rows.length >= 18, `只识别到 ${result.rows.length} 条`);
  const byKey = new Map(result.rows.map((row) => [`${row.row}-${row.col}`, row]));
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const entry = byKey.get(`${row + 1}-${col + 1}`);
      assert.ok(entry, `缺少第 ${row + 1} 行第 ${col + 1} 个图例`);
      assert.equal(entry.code, CODES[row][col]);
      assert.equal(entry.count, COUNTS[row][col]);
    }
  }
  assert.equal(result.image.detectScale, 1);
  assert.ok(result.totalBeads > 0);
});

test("颜色与 OCR 编号不一致的行会被标成需核对", async () => {
  const { imageData } = syntheticChart();
  const service = createLegendRecognitionService({
    ocr: fakeOcr(),
    createSource: stubSource,
    // 模拟：色块颜色匹配到 X01，与图例里任何一个 OCR 编号都不同
    matchColor: () => ({ nearest: { code: "X01" }.code, candidates: [] }),
  });
  const result = await service.recognize(imageData);
  assert.equal(result.counts.ok, 0);
  assert.equal(result.counts.review, result.rows.length);
  assert.ok(result.rows[0].warnings.some((message) => message.includes("不一致")));
});

test("还原不了编号的色块进 failed 而不是被悄悄丢掉", async () => {
  const { imageData } = syntheticChart();
  const service = createLegendRecognitionService({
    ocr: fakeOcr({ failAt: { row: 0, col: 0 } }),
    createSource: stubSource,
    matchColor: () => null,
  });
  const result = await service.recognize(imageData);
  const failed = result.rows.filter((row) => row.status === "failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].row, 1);
  assert.equal(failed[0].col, 1);
  assert.equal(failed[0].code, "");
  // 采样颜色仍然保留，供人工补录时辨认
  assert.equal(failed[0].rgb.length, 3);
  assert.ok(failed[0].hex.startsWith("#"));
});

test("识别过程会报告进度，并遵守 maxSwatches 上限", async () => {
  const { imageData } = syntheticChart();
  const progress = [];
  const service = createLegendRecognitionService({ ocr: fakeOcr(), createSource: stubSource, matchColor: () => null });
  const result = await service.recognize(imageData, { onProgress: (entry) => progress.push(entry), maxSwatches: 5 });
  assert.equal(result.rows.length, 5);
  assert.equal(result.truncated, true);
  assert.ok(result.warnings.some((warning) => warning.message.includes("只处理了前 5 个")));
  assert.equal(progress.at(-1).stage, "done");
  assert.ok(progress.filter((entry) => entry.stage === "ocr").length === 5);
});

test("找不到图例时给出明确提示而不是返回空表", async () => {
  const width = 300;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const service = createLegendRecognitionService({ ocr: fakeOcr(), createSource: stubSource, matchColor: () => null });
  const result = await service.recognize({ width, height, data });
  assert.equal(result.rows.length, 0);
  assert.ok(result.warnings.some((warning) => warning.level === "error" && warning.message.includes("没有在这张图里找到图例色块")));
});
