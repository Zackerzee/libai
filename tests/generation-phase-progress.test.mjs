/**
 * 生成阶段进度测试（Stage B3 §30）。
 *
 * 为什么需要它：Worker 跑起来之后，主线程**真的闲了** —— 这既是好事也是风险。
 * 界面不再冻结，但用户也看不到任何「它在动」的信号，于是「卡住」变成「静止」。
 * 所以进度必须是真实上报的，而不是主线程定时器假装的。
 *
 * 三条纪律，这个文件逐一取证：
 *   1. 阶段钩子**不能进 request / config** —— 函数进不去结构化克隆，
 *      一旦混进去，Worker 那条路会在 postMessage 处静默失败。
 *   2. 阶段顺序必须与引擎真实执行顺序一致（sampling → matching → cleanup → finalize）。
 *   3. 钩子缺失时行为**逐位不变** —— 主线程直跑不能因为多了这个机制而改变结果。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { executeGenerationJob } from "../services/generation-job.mjs";
import { createGenerationRequest } from "../services/generation-request.mjs";

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

const pipelineInput = () => ({
  image: makeImage(24, 18),
  mode: "auto",
  size: { width: 24, height: 18 },
  palette: PALETTE,
  maxColors: 5,
  overrides: {},
});

const request = (patch = {}) => createGenerationRequest({ requestId: 1, ...pipelineInput(), ...patch });

test("进度：流水线第一帧必须是 analyze（用户按下按钮后立刻要有反馈）", () => {
  const phases = [];
  runGenerationPipeline({ ...pipelineInput(), onPhase: (phase) => phases.push(phase) });
  assert.equal(phases[0], "analyze");
});

test("进度：阶段顺序与引擎真实执行顺序一致，且不重复乱序", () => {
  const phases = [];
  runGenerationPipeline({ ...pipelineInput(), onPhase: (phase) => phases.push(phase) });
  const expected = ["analyze", "sampling", "matching", "cleanup", "finalize"];
  assert.deepEqual(phases, expected, `阶段序列不符：${phases.join(" → ")}`);
});

test("进度：不传 onPhase 时行为完全不变（主线程直跑零影响）", () => {
  const withHook = runGenerationPipeline({ ...pipelineInput(), onPhase: () => {} });
  const withoutHook = runGenerationPipeline({ ...pipelineInput() });
  assert.equal(withHook.width, withoutHook.width);
  assert.equal(withHook.height, withoutHook.height);
  assert.deepEqual(
    withHook.grid.map((row) => row.map((cell) => (cell ? cell.code : null))),
    withoutHook.grid.map((row) => row.map((cell) => (cell ? cell.code : null))),
    "加了进度钩子不得改变任何一格结果",
  );
  assert.deepEqual(withHook.diagnostics?.timing && Object.keys(withHook.diagnostics.timing), withoutHook.diagnostics?.timing && Object.keys(withoutHook.diagnostics.timing));
});

test("进度：非函数 onPhase 被忽略（不抛、不误调）", () => {
  for (const bogus of [null, undefined, 0, "sampling", {}, []]) {
    const result = runGenerationPipeline({ ...pipelineInput(), onPhase: bogus });
    assert.equal(result.grid.length, 18, `onPhase=${JSON.stringify(bogus)} 时不该影响生成`);
  }
});

test("进度：钩子抛异常不会污染生成结果（用户代码不能弄坏图纸）", () => {
  let calls = 0;
  let result = null;
  assert.doesNotThrow(() => {
    // 钩子抛错会向上冒 —— 这是**契约**：钩子是调用方的东西，
    // 它自己炸了应该由调用方看见，而不是被悄悄吞掉后给出半成品图纸。
    try {
      result = runGenerationPipeline({ ...pipelineInput(), onPhase: () => { calls += 1; throw new Error("hook boom"); } });
    } catch (error) {
      assert.match(error.message, /hook boom/);
    }
  });
  assert.equal(calls, 1, "第一帧就抛，后续不应继续上报");
  assert.equal(result, null);
});

test("进度：executeGenerationJob 把 onPhase 与 request 分开传（§25 结构化克隆硬前提）", () => {
  const phases = [];
  const envelope = executeGenerationJob(request({ requestId: 31 }), { onPhase: (phase) => phases.push(phase) });
  assert.equal(envelope.ok, true);
  assert.deepEqual(phases, ["analyze", "sampling", "matching", "cleanup", "finalize"]);
  // request 里绝不能出现函数 —— 它是 postMessage 的载荷。
  const walk = (value, path) => {
    if (typeof value === "function") assert.fail(`request 里出现了函数：${path}`);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(request({ requestId: 31 }), "request");
  assert.doesNotThrow(() => structuredClone(request({ requestId: 31 })));
});

test("进度：hooks 缺省 / 非法时 executeGenerationJob 照常工作", () => {
  const envelope = executeGenerationJob(request({ requestId: 32 }));
  assert.equal(envelope.ok, true);
  assert.equal(envelope.width, 24);
  for (const bogus of [null, undefined, { onPhase: 42 }, { onPhase: "analyze" }]) {
    assert.equal(executeGenerationJob(request({ requestId: 33 }), bogus).ok, true);
  }
});

test("进度：阶段名不出现在界面文案里 —— 中文翻译只做一次（§30）", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  // 界面文案必须是中文，且不得暴露内部算法名。
  for (const [phase, label] of Object.entries({
    analyze: "正在分析图片…", sampling: "正在分析图片…",
    matching: "正在匹配真实色号…", cleanup: "正在整理色块…", finalize: "正在完成图纸…",
  })) {
    assert.match(app, new RegExp(`${phase}:\\s*"${label}"`), `缺少阶段文案：${phase} → ${label}`);
  }
  for (const internal of ["palette matching", "smart cleanup", "accentProtection", "paletteBudget"]) {
    assert.doesNotMatch(app, new RegExp(`setStatus\\("[^"]*${internal}`, "i"), `界面不得显示内部算法名：${internal}`);
  }
});

test("进度：引擎的 phase 钩子不进 cfg（否则结构化克隆会在 postMessage 处静默失败）", async () => {
  const engine = await readFile(new URL("../smart-preprocessing/generation-engine-v2.mjs", import.meta.url), "utf8");
  assert.match(engine, /const cfg = resolveOptions\(options\);/);
  assert.match(engine, /typeof options\.onPhase === "function"/, "必须从 options 单独读 onPhase");
  // resolveOptions 的调用点不能把 onPhase 一起塞进去。
  assert.doesNotMatch(engine, /resolveOptions\(\{[^}]*onPhase/, "onPhase 不能进 resolveOptions 的入参");
  assert.doesNotMatch(engine, /cfg\.onPhase/, "onPhase 不能从 cfg 读（那意味着它进了要克隆的配置）");
});
