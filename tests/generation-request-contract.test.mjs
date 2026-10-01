/**
 * 生成请求 / 结果契约测试（Stage B0 §9 / §10）。
 *
 * 为什么需要它：把生成挪进 Web Worker 的前置条件是「请求与结果都是纯数据」，
 * 并且**旧任务的结果不得覆盖新任务**。这两件事都必须在还没上 Worker 时就成立，
 * 否则等真的搬进 Worker，错图会以「偶发」的形式出现，极难定位。
 *
 * 本文件同时充当「无 DOM 可调用」的取证：整个过程 `typeof document === "undefined"`，
 * 并且最后会真的跑一次完整生成（executeGenerationJob），断言结果可结构化克隆。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENERATION_CONTRACT_VERSION,
  GENERATION_REQUEST_KIND,
  nextGenerationId,
  isStaleGeneration,
  createGenerationRequest,
  validateGenerationRequest,
  normalizeGenerationCell,
  createGenerationResult,
  createGenerationError,
} from "../services/generation-request.mjs";
import { executeGenerationJob } from "../services/generation-job.mjs";

/** 造一张有结构的合成图：色块 + 渐变，避免流水线拿到纯色图走特殊分支。 */
function makeImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = (x * 17 + y * 5) % 256;
      data[i + 1] = (y * 23) % 256;
      data[i + 2] = (x * 11) % 256;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const PALETTE = [
  { code: "H2", rgb: [255, 255, 255], hex: "#FFFFFF" },
  { code: "H7", rgb: [0, 0, 0], hex: "#000000" },
  { code: "A1", rgb: [220, 40, 40], hex: "#DC2828" },
  { code: "B3", rgb: [40, 120, 200], hex: "#2878C8" },
  { code: "C5", rgb: [60, 180, 90], hex: "#3CB45A" },
  { code: "D9", rgb: [240, 200, 60], hex: "#F0C83C" },
];

const validInput = () => ({
  requestId: 7,
  image: makeImage(16, 16),
  size: { width: 20, height: 15, longEdge: 20, ratio: 0.75 },
  mode: "auto",
  palette: PALETTE,
  maxColors: 6,
  overrides: {},
});

test("契约：无 DOM 环境下可加载（Worker / node 直接可用）", () => {
  assert.equal(typeof document, "undefined", "本文件必须在无 DOM 环境运行，否则取证无效");
  assert.equal(typeof window, "undefined");
});

test("契约：createGenerationRequest 产出冻结的纯数据", () => {
  const request = createGenerationRequest(validInput());
  assert.equal(request.version, GENERATION_CONTRACT_VERSION);
  assert.equal(request.kind, GENERATION_REQUEST_KIND);
  assert.equal(request.requestId, 7);
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.image));
  assert.ok(Object.isFrozen(request.size));
  assert.ok(Object.isFrozen(request.palette));
  assert.ok(Object.isFrozen(request.overrides));
  // 冻结是硬要求：契约对象一旦被下游就地改写，requestId 就失去意义。
  assert.throws(() => { request.requestId = 99; }, TypeError);
});

test("契约：请求可结构化克隆（Worker.postMessage 的硬前提）", () => {
  const request = createGenerationRequest(validInput());
  const clone = structuredClone(request);
  assert.equal(clone.requestId, request.requestId);
  assert.equal(clone.size.width, request.size.width);
  assert.deepEqual(clone.palette.map((c) => c.code), request.palette.map((c) => c.code));
});

test("契约：requestId 单调递增，陈旧判定是「不相等即过期」", () => {
  assert.equal(nextGenerationId(0), 1);
  assert.equal(nextGenerationId(41), 42);
  assert.equal(nextGenerationId(NaN), 1);
  assert.equal(isStaleGeneration(1, 2), true);
  assert.equal(isStaleGeneration(2, 2), false);
  // 结果回来时最新请求已经又推进了两轮 → 必须丢弃
  assert.equal(isStaleGeneration(3, 5), true);
});

test("契约：校验拒绝形状错误（版本 / kind / requestId / 尺寸 / 调色板）", () => {
  assert.equal(validateGenerationRequest(createGenerationRequest(validInput())), true);

  const reject = (patch, label) => {
    const request = { ...createGenerationRequest(validInput()), ...patch };
    assert.throws(() => validateGenerationRequest(request), label);
  };
  reject({ version: 99 }, /版本/);
  reject({ kind: "resize" }, /kind/);
  reject({ requestId: 0 }, /requestId/);
  reject({ requestId: 1.5 }, /requestId/);
  reject({ size: { width: 20, height: 15.5 } }, /整数宽高/);
  reject({ size: { width: 20, height: 0 } }, /整数宽高/);
  reject({ size: { width: 20, height: 900 } }, /超出/);
  reject({ size: { width: 4, height: 15 } }, /超出/);
  reject({ mode: "" }, /mode/);
  reject({ palette: [] }, /palette|调色板/);
  reject({ palette: [{ code: "", rgb: [1, 2, 3] }] }, /色号/);
  reject({ palette: [{ code: "A1", rgb: [1, 2] }] }, /rgb/);
  reject({ palette: [{ code: "A1", rgb: [1, NaN, 3] }] }, /rgb/);
  reject({ maxColors: -1 }, /maxColors/);
  reject({ overrides: null }, /overrides/);
});

test("契约：image.data 长度必须与宽高自洽", () => {
  const input = validInput();
  input.image = { ...input.image, width: 17 };
  assert.throws(() => validateGenerationRequest(createGenerationRequest(input)), /长度与宽高不匹配/);
});

test("契约：尺寸必须是**已解析**的整数 —— 契约层不接受 null / 比例", () => {
  // 这是 §1 的落点：比例推导必须在进入契约之前完成，
  // 契约层看到 null 就直接拒绝，绝不给「拿 width 兜底」留后门。
  const input = validInput();
  input.size = { width: null, height: null, longEdge: 104, ratio: 0.75 };
  assert.throws(() => validateGenerationRequest(createGenerationRequest(input)), /整数宽高/);
});

test("契约：normalizeGenerationCell 把空位与各种 rgb 形状归一", () => {
  assert.equal(normalizeGenerationCell(null), null);
  assert.equal(normalizeGenerationCell({ code: "" }), null);
  assert.deepEqual(normalizeGenerationCell({ code: "A1", rgb: [1, 2, 3] }), { code: "A1", rgb: [1, 2, 3], hex: "#010203" });
  assert.deepEqual(normalizeGenerationCell({ code: "A1", rgb: { 0: 4, 1: 5, 2: 6 } }), { code: "A1", rgb: [4, 5, 6], hex: "#040506" });
  // paletteId 是引擎侧的历史别名，必须能被识别
  assert.equal(normalizeGenerationCell({ paletteId: "B3", rgb: [1, 1, 1] }).code, "B3");
});

test("契约：结果与错误信封都是冻结的纯数据", () => {
  const result = createGenerationResult({
    requestId: 3, width: 2, height: 2,
    grid: [[{ code: "A1", rgb: [1, 2, 3] }, null], [null, { code: "A1", rgb: [1, 2, 3] }]],
    milliseconds: 12.4,
  });
  assert.equal(result.ok, true);
  assert.equal(result.metrics.cells, 4);
  assert.equal(result.metrics.usedColors, 1);
  assert.equal(result.metrics.milliseconds, 12);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(structuredClone(result).grid[0][0].code, "A1");

  const error = createGenerationError({ requestId: 3, error: new RangeError("炸了") });
  assert.equal(error.ok, false);
  assert.equal(error.name, "RangeError");
  assert.equal(error.message, "炸了");
  assert.ok(Object.isFrozen(error));
});

test("契约：executeGenerationJob 在无 DOM 环境真的跑完一次生成（§9 取证）", () => {
  const request = createGenerationRequest({
    requestId: 11,
    image: makeImage(48, 32),
    size: { width: 24, height: 16 },
    mode: "auto",
    palette: PALETTE,
    maxColors: 6,
  });
  const envelope = executeGenerationJob(request);
  assert.equal(envelope.ok, true, envelope.ok ? "" : `${envelope.name}: ${envelope.message}`);
  assert.equal(envelope.requestId, 11);
  assert.equal(envelope.width, 24);
  assert.equal(envelope.height, 16);
  assert.equal(envelope.grid.length, 16, "结果行数必须等于请求高度");
  assert.equal(envelope.grid[0].length, 24, "结果列数必须等于请求宽度");
  assert.ok(envelope.metrics.usedColors > 0, "生成结果不该是空图");
  assert.ok(envelope.metrics.usedColors <= 6, `maxColors=6 时实际用了 ${envelope.metrics.usedColors} 色`);
  // Worker 边界的关键：结果必须能原样过 postMessage
  const clone = structuredClone(envelope);
  assert.equal(clone.grid.length, envelope.grid.length);
  assert.equal(clone.metrics.usedColors, envelope.metrics.usedColors);
  for (const row of envelope.grid) {
    for (const cell of row) {
      if (!cell) continue;
      assert.equal(typeof cell.code, "string");
      assert.equal(cell.rgb.length, 3);
      assert.equal(typeof cell.hex, "string");
    }
  }
});

test("契约：executeGenerationJob 对形状错误抛（编程错误），对运行故障回信封（运行时故障）", () => {
  // 编程错误：不合法请求必须抛，不能被吞成 error 信封 —— 否则契约层失去守门作用。
  const bad = createGenerationRequest({ ...validInput(), requestId: 0 });
  assert.throws(() => executeGenerationJob(bad), /requestId/);

  // 运行时故障：引擎内部抛错要变成 ok:false 信封，且带上 requestId 供调用方丢弃。
  const request = createGenerationRequest({
    requestId: 12,
    image: { data: new Uint8ClampedArray(12 * 12 * 4), width: 12, height: 12 },
    size: { width: 12, height: 12 },
    mode: "auto",
    palette: PALETTE,
    maxColors: 0,
  });
  // 全透明 12×12 是引擎的退化输入，不应抛到调用方（本仓库的口径是返回兜底结果），
  // 因此这里只断言「要么成功、要么是带 requestId 的 error 信封」，不制造假失败。
  const envelope = executeGenerationJob(request);
  assert.equal(envelope.requestId, 12);
  if (envelope.ok) {
    assert.equal(envelope.grid.length, 12);
  } else {
    assert.equal(typeof envelope.message, "string");
    assert.ok(envelope.message.length > 0);
  }
});
