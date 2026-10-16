/**
 * Worker 本体协议测试（Stage B3 §25 / §26 / §28 / §30）。
 *
 * 关键做法：**不读文件做正则，而是真的把 generation.worker.mjs 跑起来**。
 * 只要给 node 装一个 `self` 垫片，Worker 的 onmessage 处理函数就是普通函数 ——
 * 于是「收 request → 跑流水线 → 回紧凑结果」这条链路可以在 node --test 里
 * 端到端验证，而不是等真机才发现 postMessage 形状不对。
 *
 * 这层覆盖的是**协议**；真实 Worker 的加载 / CSP / Transferable 由
 * tools/b3-worker-probe.mjs 在真机上覆盖。两者不可互相替代。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createGenerationRequest } from "../services/generation-request.mjs";
import { isEncodedGenerationResult, decodeGenerationResult } from "../services/generation-result-codec.mjs";

const WORKER_URL = new URL("../services/generation.worker.mjs", import.meta.url);

/** 造一张有结构的合成图，避免流水线拿到纯色图走特殊分支。 */
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
];

const request = (patch = {}) => createGenerationRequest({
  requestId: 1,
  image: makeImage(24, 18),
  size: { width: 24, height: 18 },
  mode: "auto",
  palette: PALETTE,
  maxColors: 5,
  overrides: {},
  ...patch,
});

/**
 * 用 self 垫片把 Worker 模块加载进来。
 *
 * 注意：垫片必须**一直挂着**，不能 import 完就还原 —— Worker 的 `post()` 是在
 * 每次回包时才去读 `self.postMessage`，提前还原会让第一次回包就 TypeError。
 * （node --test 每个文件独立进程，所以这里的全局污染不会外溢。）
 */
const sink = [];
let workerHandler = null;
let workerLoaded = null;

function installSelfShim() {
  if (workerLoaded) return workerLoaded;
  globalThis.self = {
    postMessage: (payload, transfer = []) => { sink.push({ payload, transfer }); },
    set onmessage(fn) { workerHandler = fn; },
    get onmessage() { return workerHandler; },
  };
  workerLoaded = import(WORKER_URL.href);
  return workerLoaded;
}

/** 取走并清空回包，让每个用例只看自己这一次的输出。 */
function drain() {
  const messages = sink.splice(0, sink.length);
  return messages;
}

async function loadWorker() {
  await installSelfShim();
  drain();
  assert.equal(typeof workerHandler, "function", "Worker 必须注册 onmessage");
  return { handler: workerHandler, drain };
}

test.after(() => { delete globalThis.self; });

test("Worker：本体不依赖 DOM / window（结构上保证生成不依赖界面）", async () => {
  const source = await readFile(WORKER_URL, "utf8");
  assert.doesNotMatch(source, /\bdocument\./, "Worker 里碰 document 就是 ReferenceError");
  assert.doesNotMatch(source, /\bwindow\./, "Worker 里碰 window 就是 ReferenceError");
  assert.doesNotMatch(source, /querySelector|getElementById/, "Worker 不得接触界面");
});

test("Worker：复用 B0 契约，不另起第二套协议（§25）", async () => {
  const source = await readFile(WORKER_URL, "utf8");
  assert.match(source, /from "\.\/generation-job\.mjs(?:\?[^\"]*)?"/, "必须复用 executeGenerationJob");
  assert.match(source, /from "\.\/generation-result-codec\.mjs"/, "必须走紧凑结果编解码");
  // 只扫代码，不扫注释 —— 注释里正是在说明「没有这些协议」。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
  for (const forbidden of ["GenerationRequestV2", "WorkerRequest2", "parallelJobState", "GenerationJob2"]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `禁止第二套协议：${forbidden}`);
  }
});

test("Worker：收到 generate 后回一条符合紧凑契约的 result（端到端真跑）", async () => {
  const { handler, drain } = await loadWorker();
  handler({ data: { type: "generate", request: request({ requestId: 21 }) } });
  const messages = drain();

  const results = messages.filter((entry) => entry.payload.type === "result");
  assert.equal(results.length, 1, "一次请求必须且只回一条结果");
  const envelope = results[0].payload.envelope;
  assert.equal(results[0].payload.requestId, 21);
  assert.equal(envelope.ok, true, "成功信封必须 ok:true");
  assert.ok(isEncodedGenerationResult(envelope), "回包必须是紧凑形式，不得是逐格对象网格");
  assert.equal(envelope.grid, undefined, "回包不得携带完整 grid");

  const decoded = decodeGenerationResult(envelope);
  assert.equal(decoded.width, 24);
  assert.equal(decoded.height, 18);
  assert.equal(decoded.grid.length, 18);
  // 结果里必须带 paletteId（色号），生产状态禁止退化成 hex-only（§28）。
  const cells = decoded.grid.flat().filter(Boolean);
  assert.ok(cells.length > 0, "24×18 的合成图不该全是空洞");
  for (const cell of cells) assert.equal(typeof cell.code, "string");
  assert.ok(decoded.palette.length > 0);
});

test("Worker：结果里 indices 的 buffer 被列入 transfer（§27 零拷贝）", async () => {
  const { handler, drain } = await loadWorker();
  handler({ data: { type: "generate", request: request({ requestId: 22 }) } });
  const results = drain().filter((entry) => entry.payload.type === "result");
  assert.equal(results.length, 1);
  const { transfer } = results[0];
  assert.equal(transfer.length, 1, "indices.buffer 必须转移，否则等于把整版下标拷贝一遍");
  assert.equal(transfer[0], results[0].payload.envelope.indices.buffer);
});

test("Worker：进度按阶段上报，且阶段名是内部名（中文翻译在主线程做）", async () => {
  const { handler, drain } = await loadWorker();
  handler({ data: { type: "generate", request: request({ requestId: 23 }) } });
  const messages = drain();
  const phases = messages.filter((entry) => entry.payload.type === "progress").map((entry) => entry.payload.phase);
  assert.ok(phases.length > 0, "必须上报进度，否则用户看不到任何反馈");
  // 内部阶段名只允许出现在协议里，不允许漏出到界面（界面文案见 app.js）。
  const allowed = new Set(["analyze", "sampling", "matching", "cleanup", "finalize"]);
  for (const phase of phases) assert.ok(allowed.has(phase), `未知阶段名：${phase}`);
  assert.equal(phases[0], "analyze", "第一帧必须是 analyze");
  for (const entry of messages.filter((item) => item.payload.type === "progress")) {
    assert.equal(entry.payload.requestId, 23, "进度必须带 requestId，否则主线程无法丢弃过期进度");
  }
});

test("Worker：非 generate 消息被忽略，不会误触发一次生成", async () => {
  const { handler, drain } = await loadWorker();
  handler({ data: { type: "ping" } });
  handler({ data: {} });
  handler({ data: null });
  assert.equal(drain().length, 0, "未知消息不得产生任何回包");
});

test("Worker：非法请求回 error，不静默吞掉", async () => {
  const { handler, drain } = await loadWorker();
  const broken = { ...request({ requestId: 24 }), size: { width: 2, height: 2 } };
  handler({ data: { type: "generate", request: broken } });
  const errors = drain().filter((entry) => entry.payload.type === "error");
  assert.equal(errors.length, 1, "非法请求必须报错，不能什么都不回");
  assert.match(errors[0].payload.message, /尺寸|size/i);
  assert.equal(errors[0].payload.requestId, 24);
});

test("Worker：空调色板也必须回包（可读原因），不能什么都不回", async () => {
  const { handler, drain } = await loadWorker();
  const noPalette = createGenerationRequest({
    requestId: 25, image: makeImage(16, 16), size: { width: 16, height: 16 },
    mode: "auto", palette: [{ code: "A1", rgb: [1, 2, 3] }], maxColors: 0, overrides: {},
  });
  handler({ data: { type: "generate", request: { ...noPalette, palette: [] } } });
  const messages = drain();
  assert.ok(messages.length >= 1, "任何输入都必须有回包");
  const payload = messages[0].payload;
  assert.ok(payload.type === "error" || payload.type === "result");
  if (payload.type === "result") assert.equal(payload.envelope.ok, false);
  if (payload.type === "error") assert.match(payload.message, /调色板|palette/i);
});
