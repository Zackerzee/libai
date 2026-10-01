/**
 * 生成 Worker 客户端测试（Stage B3 §26 / §27 / §29 / §33）。
 *
 * 为什么用假 Worker：真实 Worker 的语义（terminate 是否真的停、回包是否真的丢）
 * 必须能在 node --test 里**确定性地**验证，而不是靠「跑一次真机看看」。
 * 假 Worker 记录 postMessage / terminate 的每一次调用，于是下面这些
 * 最容易出错的语义都变成了可断言的事实：
 *
 *   · 陈旧回包必须丢弃（否则旧结果会覆盖新图纸 —— 本阶段最不能出的错）
 *   · 取消必须是真 terminate（不是「标记一下等它跑完」）
 *   · 新请求必须顶掉旧请求，且**同时杀掉旧 Worker**
 *     （Worker.onmessage 是同步的，不杀就会排队 —— 表现为「换尺寸反而更慢」）
 *   · 首次不转移 buffer，证明 Worker 能跑通之后才启用零拷贝
 *     （Transferable 不可逆，冷启动失败会让主线程手里只剩一份空 buffer）
 *
 * 真机侧另有 tools/b3-worker-probe.mjs 覆盖「真实 Worker + 生产 CSP」，
 * 两者分工明确：这里管语义，那里管环境。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGenerationWorkerClient,
  GenerationCancelledError,
  GenerationStaleError,
  DEFAULT_GENERATION_WORKER_URL,
} from "../services/generation-worker-client.mjs";
import { createGenerationResult } from "../services/generation-request.mjs";
import { encodeGenerationResult } from "../services/generation-result-codec.mjs";

/** 可控假 Worker：把 postMessage 的参数原样记下来，由测试决定何时回包。 */
function makeFakeWorker() {
  const instances = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.sent = [];        // { payload, transfer }
      this.terminated = 0;
      this.onmessage = null;
      this.onerror = null;
      instances.push(this);
    }
    postMessage(payload, transfer = []) {
      this.sent.push({ payload, transfer });
    }
    terminate() { this.terminated += 1; }
    /** 模拟 Worker 回包。 */
    reply(payload) { this.onmessage?.({ data: payload }); }
    /** 模拟 Worker 启动失败（CSP / 路径 / 模块解析错误）。 */
    fail(message) { this.onerror?.({ message }); }
  }
  return { FakeWorker, instances };
}

const compactFor = (requestId, width = 2, height = 2) => encodeGenerationResult(createGenerationResult({
  requestId, width, height,
  grid: Array.from({ length: height }, () => Array.from({ length: width }, () => ({ code: "A1", rgb: [1, 2, 3] }))),
}));

const makeRequest = (requestId, { withImage = true } = {}) => ({
  version: 1, kind: "generate", requestId,
  image: withImage ? { data: new Uint8ClampedArray(16), width: 2, height: 2 } : null,
  size: { width: 2, height: 2 }, mode: "auto", palette: [{ code: "A1", rgb: [1, 2, 3] }],
  maxColors: 0, overrides: {},
});

test("客户端：无 DOM 环境下可加载（Worker 侧同源）", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof Worker, "undefined", "node 下没有全局 Worker —— 所以必须可注入");
});

test("客户端：没有 Worker 支持时 supported=false，run 直接 reject 而不是静默", async () => {
  const client = createGenerationWorkerClient({ WorkerCtor: null });
  assert.equal(client.supported, false);
  assert.equal(client.busy, false);
  await assert.rejects(() => client.run(makeRequest(1)), /不支持 Web Worker/);
});

test("客户端：run 用 module 类型起 Worker，URL 可覆盖", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker, workerUrl: "./x.worker.mjs?v=1" });
  const promise = client.run(makeRequest(1));
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, "./x.worker.mjs?v=1");
  assert.equal(instances[0].options?.type, "module", "生成链路全是 ESM，Worker 必须按模块加载");
  assert.equal(instances[0].sent[0].payload.type, "generate");
  assert.equal(instances[0].sent[0].payload.request.requestId, 1);
  instances[0].reply({ type: "result", requestId: 1, envelope: compactFor(1) });
  const out = await promise;
  assert.equal(out.width, 2);
  assert.equal(out.height, 2);
  assert.equal(out.grid.length, 2);
  assert.equal(out.grid[0][0].code, "A1");
});

test("客户端：默认 URL 与 app.js 预载的模块路径同源（避免两份实例）", () => {
  assert.match(DEFAULT_GENERATION_WORKER_URL, /^\.\/services\/generation\.worker\.mjs\?v=/);
});

test("客户端：进度回调只喂给当前在等的那一个，过期进度直接丢", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const seen = [];
  const promise = client.run(makeRequest(7), { onProgress: (phase) => seen.push(phase) });
  instances[0].reply({ type: "progress", requestId: 7, phase: "analyze" });
  instances[0].reply({ type: "progress", requestId: 7, phase: "matching" });
  // 别的请求的进度绝不能混进来。
  instances[0].reply({ type: "progress", requestId: 99, phase: "cleanup" });
  instances[0].reply({ type: "result", requestId: 7, envelope: compactFor(7) });
  await promise;
  assert.deepEqual(seen, ["analyze", "matching"]);
});

test("客户端：陈旧回包被丢弃，绝不 resolve 到旧结果（§33）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const promise = client.run(makeRequest(11));
  // 回一个 requestId 不匹配的结果：客户端必须当没看见。
  instances[0].reply({ type: "result", requestId: 10, envelope: compactFor(10) });
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false, "过期回包不得让 promise 落地");
  instances[0].reply({ type: "result", requestId: 11, envelope: compactFor(11) });
  const out = await promise;
  assert.equal(out.requestId, 11);
});

test("客户端：取消是真 terminate，并以 AbortError 结束（§29）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const promise = client.run(makeRequest(3));
  assert.equal(client.busy, true);
  const had = client.cancel("用户取消");
  assert.equal(had, true, "cancel 必须报告「确实取消了一个任务」");
  assert.equal(instances[0].terminated, 1, "必须真杀 Worker，不能只标记");
  assert.equal(client.busy, false);
  await assert.rejects(() => promise, (error) => {
    assert.ok(error instanceof GenerationCancelledError);
    assert.equal(error.name, "AbortError", "上层按 name 识别「预期结局」，name 不能变");
    return true;
  });
});

test("客户端：没有在跑时 cancel 返回 false，且不产生副作用", () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  assert.equal(client.cancel(), false);
  assert.equal(instances.length, 0, "取消不该把 Worker 起起来");
});

test("客户端：新请求顶掉旧请求，并杀掉旧 Worker（否则新任务会排在旧任务后面）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const first = client.run(makeRequest(1));
  const second = client.run(makeRequest(2));

  await assert.rejects(() => first, (error) => {
    assert.ok(error instanceof GenerationStaleError);
    assert.equal(error.name, "StaleGenerationError");
    return true;
  });
  assert.equal(instances[0].terminated, 1, "被顶掉的旧 Worker 必须 terminate");
  assert.equal(instances.length, 2, "第二次 run 必须起一个新 Worker");

  instances[1].reply({ type: "result", requestId: 2, envelope: compactFor(2) });
  const out = await second;
  assert.equal(out.requestId, 2);
});

test("客户端：Worker 引擎错误信封 → reject 可读信息（不是静默空图纸）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const promise = client.run(makeRequest(4));
  instances[0].reply({ type: "result", requestId: 4, envelope: { ok: false, message: "调色板为空" } });
  await assert.rejects(() => promise, /调色板为空/);
});

test("客户端：回包不符合紧凑契约 → reject，绝不把空图纸当成功", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const promise = client.run(makeRequest(5));
  instances[0].reply({ type: "result", requestId: 5, envelope: { ok: true, width: 2, height: 2, grid: [] } });
  await assert.rejects(() => promise, /紧凑结果契约/);
});

test("客户端：Worker 起不来 → supported 翻 false 并 reject（让上层退回主线程）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const promise = client.run(makeRequest(6));
  instances[0].fail("Refused to create a worker");
  assert.equal(client.supported, false);
  await assert.rejects(() => promise, /Refused to create a worker/);
});

test("客户端：首次不转移 buffer，成功一次之后才启用零拷贝（§27 + 不可逆保护）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });

  const first = makeRequest(1);
  const p1 = client.run(first);
  assert.deepEqual(instances[0].sent[0].transfer, [], "首次必须克隆，否则 Worker 起不来时主线程只剩空 buffer");
  assert.equal(first.image.data.byteLength, 16, "首次不该动调用方的 buffer");
  instances[0].reply({ type: "result", requestId: 1, envelope: compactFor(1) });
  await p1;

  const second = makeRequest(2);
  const p2 = client.run(second);
  assert.equal(instances[0].sent[1].transfer.length, 1, "证明可跑之后才转移");
  assert.equal(instances[0].sent[1].transfer[0], second.image.data.buffer);
  instances[0].reply({ type: "result", requestId: 2, envelope: compactFor(2) });
  await p2;
});

test("客户端：显式 transfer: [] 可关闭零拷贝（数据要复用时）", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const p1 = client.run(makeRequest(1));
  instances[0].reply({ type: "result", requestId: 1, envelope: compactFor(1) });
  await p1;

  const request = makeRequest(2);
  const p2 = client.run(request, { transfer: [] });
  assert.deepEqual(instances[0].sent[1].transfer, []);
  assert.equal(request.image.data.byteLength, 16);
  instances[0].reply({ type: "result", requestId: 2, envelope: compactFor(2) });
  await p2;
});

test("客户端：dispose 杀掉 Worker 并清空竞态基准", () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  client.run(makeRequest(1));
  client.dispose();
  assert.equal(instances[0].terminated, 1);
  assert.equal(client.busy, false);
  assert.equal(client.latestRequestId, null);
});

test("客户端：取消后可以再跑（新 Worker），不是一次性的", async () => {
  const { FakeWorker, instances } = makeFakeWorker();
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const p1 = client.run(makeRequest(1));
  client.cancel();
  await assert.rejects(() => p1);
  const p2 = client.run(makeRequest(2));
  assert.equal(instances.length, 2);
  instances[1].reply({ type: "result", requestId: 2, envelope: compactFor(2) });
  const out = await p2;
  assert.equal(out.requestId, 2);
});
