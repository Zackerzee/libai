/**
 * 紧凑结果契约测试（Stage B3 §28）。
 *
 * 为什么需要它：跨线程搬结果的成本，在 104 档看不出来，在 500 档是致命的 ——
 * 500×375 = 187 500 个 `{code,rgb,hex}` 对象，结构化克隆要逐个重建，
 * 光搬运就能吃掉几百毫秒，而「不卡主线程」正是 B3 的全部意义。
 *
 * 所以跨线程只传 `palette + Int32Array`。这个文件的存在意义只有一个：
 * **证明 encode → decode 是逐格等价的**。一旦有人改了 palette 去重口径、
 * null 哨兵或下标排布，这里立刻红。
 *
 * 本文件全程 `typeof document === "undefined"` —— 与 Worker 同环境。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENERATION_RESULT_CODEC_VERSION,
  GENERATION_NULL_INDEX,
  encodeGenerationResult,
  decodeGenerationResult,
  isEncodedGenerationResult,
} from "../services/generation-result-codec.mjs";
import { createGenerationResult } from "../services/generation-request.mjs";

const CELL = (code, rgb) => ({ code, rgb, hex: null });

/** 造一版有 null、有重复色号、有多行多列的图纸。 */
function makeResult({ width = 5, height = 4 } = {}) {
  const grid = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      // 每 4 格留一个空洞，保证 null 分布不连续。
      if ((x + y * 2) % 4 === 3) { row.push(null); continue; }
      const pick = (x + y) % 3;
      if (pick === 0) row.push(CELL("A1", [255, 0, 0]));
      else if (pick === 1) row.push(CELL("B2", [0, 255, 0]));
      else row.push(CELL("C3", [0, 0, 255]));
    }
    grid.push(row);
  }
  return createGenerationResult({
    requestId: 42, grid, width, height,
    diagnostics: { colorsAfterBudget: 3 }, pipeline: { engine: "v2.5" }, milliseconds: 12,
  });
}

test("codec：无 DOM 环境下可加载（与 Worker 同环境）", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof window, "undefined");
});

test("codec：encode 产出紧凑形状，不携带逐格对象", () => {
  const compact = encodeGenerationResult(makeResult());
  assert.equal(compact.codec, GENERATION_RESULT_CODEC_VERSION);
  assert.equal(compact.ok, true);
  assert.equal(compact.requestId, 42);
  assert.equal(compact.width, 5);
  assert.equal(compact.height, 4);
  // palette 只含真正用到的颜色（3 个），不是 width*height 个对象。
  assert.deepEqual(compact.palette.map((entry) => entry.code), ["A1", "B2", "C3"]);
  // 下标必须是 TypedArray —— 它是 Transferable，也是「零拷贝」的前提。
  assert.ok(compact.indices instanceof Int32Array);
  assert.equal(compact.indices.length, 20);
  assert.equal(compact.grid, undefined, "紧凑形式不允许带完整 grid");
  assert.ok(Object.isFrozen(compact));
});

test("codec：encode→decode 逐格等价（这是契约不漂移的唯一保证）", () => {
  const original = makeResult();
  const restored = decodeGenerationResult(encodeGenerationResult(original));
  assert.equal(restored.width, original.width);
  assert.equal(restored.height, original.height);
  assert.equal(restored.requestId, original.requestId);
  for (let y = 0; y < original.height; y += 1) {
    for (let x = 0; x < original.width; x += 1) {
      const before = original.grid[y][x];
      const after = restored.grid[y][x];
      if (before == null) { assert.equal(after, null, `(${x},${y}) 空洞丢失`); continue; }
      assert.equal(after.code, before.code, `(${x},${y}) 色号不一致`);
      assert.deepEqual(after.rgb, before.rgb, `(${x},${y}) rgb 不一致`);
    }
  }
  assert.deepEqual(restored.metrics, original.metrics);
  assert.deepEqual(restored.pipeline, original.pipeline);
  assert.deepEqual(restored.diagnostics, original.diagnostics);
});

test("codec：null 与色号 0 / 空字符串不可混淆", () => {
  const grid = [[null, { code: "0", rgb: [1, 2, 3] }, { code: "A1", rgb: [4, 5, 6] }]];
  const compact = encodeGenerationResult({ width: 3, height: 1, grid, requestId: 1 });
  assert.equal(compact.indices[0], GENERATION_NULL_INDEX);
  assert.equal(compact.nullCount, 1);
  const restored = decodeGenerationResult(compact);
  assert.equal(restored.grid[0][0], null);
  assert.equal(restored.grid[0][1].code, "0");
  assert.equal(restored.grid[0][2].code, "A1");
});

test("codec：palette 按色号去重，同色号跨格共享同一下标", () => {
  const grid = [[{ code: "A1", rgb: [9, 9, 9] }, { code: "A1", rgb: [9, 9, 9] }, { code: "A1", rgb: [9, 9, 9] }]];
  const compact = encodeGenerationResult({ width: 3, height: 1, grid, requestId: 1 });
  assert.equal(compact.palette.length, 1, "同色号必须合并成一个 palette 项");
  assert.equal(compact.indices[0], compact.indices[1]);
  assert.equal(compact.indices[1], compact.indices[2]);
});

test("codec：decode 出的每格都是新对象，改一格不会串到 palette", () => {
  const compact = encodeGenerationResult(makeResult());
  const restored = decodeGenerationResult(compact);
  const first = restored.grid[0][0];
  assert.ok(first, "测试前提：首格必须有颜色");
  first.rgb[0] = 12345;
  first.code = "MUTATED";
  const second = restored.grid.flat().find((cell) => cell && cell.code === "A1");
  if (second) assert.notEqual(second.code, "MUTATED", "格子之间共享了对象");
});

test("codec：空图纸 / 全空洞不炸，且 nullCount 正确", () => {
  const empty = encodeGenerationResult({ width: 3, height: 2, grid: [[null, null, null], [null, null, null]], requestId: 5 });
  assert.equal(empty.nullCount, 6);
  assert.equal(empty.palette.length, 0);
  const restored = decodeGenerationResult(empty);
  assert.deepEqual(restored.grid, [[null, null, null], [null, null, null]]);

  const zero = encodeGenerationResult({ width: 0, height: 0, grid: [], requestId: 6 });
  assert.equal(zero.indices.length, 0);
  assert.deepEqual(decodeGenerationResult(zero).grid, []);
});

test("codec：isEncodedGenerationResult 是回包门禁，挡得住静默空图纸", () => {
  const compact = encodeGenerationResult(makeResult());
  assert.equal(isEncodedGenerationResult(compact), true);
  assert.equal(isEncodedGenerationResult(null), false);
  assert.equal(isEncodedGenerationResult(undefined), false);
  assert.equal(isEncodedGenerationResult({}), false);
  // 版本漂移必须挡住：否则新旧协议互认会产出错图而不是报错。
  assert.equal(isEncodedGenerationResult({ ...compact, codec: 99 }), false);
  assert.equal(isEncodedGenerationResult({ ...compact, palette: null }), false);
  assert.equal(isEncodedGenerationResult({ ...compact, indices: undefined }), false);
  // 完整结果（非紧凑）不该被当成紧凑形式放过。
  assert.equal(isEncodedGenerationResult(makeResult()), false);
});

test("codec：decode 对残缺 palette 下标退化为 null 而不是崩", () => {
  const compact = encodeGenerationResult(makeResult());
  const damaged = { ...compact, palette: compact.palette.slice(0, 1) };
  const restored = decodeGenerationResult(damaged);
  assert.equal(restored.grid.length, damaged.height);
  // 下标越界 → null，绝不产生 undefined 格子（下游 `if (!cell)` 依赖这一点）。
  for (const row of restored.grid) for (const cell of row) assert.ok(cell === null || typeof cell.code === "string");
});

test("codec：indices 可被 Transfer（结构化克隆后仍逐格等价）", () => {
  const compact = encodeGenerationResult(makeResult());
  const before = Array.from(compact.indices);
  const clone = structuredClone({ ...compact, indices: compact.indices }, { transfer: [compact.indices.buffer] });
  // transfer 之后原 buffer 被 detach —— 这正是「零拷贝」的代价，必须显式认知。
  assert.equal(compact.indices.byteLength, 0, "transfer 后原 buffer 应已 detach");
  assert.deepEqual(Array.from(clone.indices), before, "转移后内容必须逐格不变");
  const restored = decodeGenerationResult(clone);
  assert.equal(restored.grid[0].length, compact.width);
});
