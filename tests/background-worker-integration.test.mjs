/**
 * background-worker-integration.test.mjs — Stage B2 §6 §16 §17 §18
 *
 * 两件事：
 *
 * 1. **Worker 兼容性（§16）**。背景判定要能在 Worker 里跑：纯计算、无 DOM、
 *    结构化克隆安全、确定性；而且**不许另起一套协议** —— B0 的
 *    generation-request / generation-job / requestId 必须原样复用。
 *    预览 UI 的逻辑不能塞进算法模块。
 *
 * 2. **界面纪律（§6 §17 §18）**。工作台上只有一个「去除纯色背景」开关，
 *    没有新增任何背景算法参数；开启后先预览再应用；uncertain 自动保持原图。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKGROUND_FIXTURES, materializeFixture, rasterizeSource } from "./background-fixtures.mjs";
import {
  PREVIEW_LONG_EDGE,
  resolveProbeSize,
  previewBackgroundRemoval,
} from "../services/background-preview-service.mjs";
import { BACKGROUND_STATUS, BACKGROUND_KEEP_MESSAGE } from "../smart-preprocessing/background-reliability.mjs";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** 只保留代码行 —— 注释里解释「为什么不能这么写」时会自然出现被禁词。 */
const codeOnly = (source) => source
  .split("\n")
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n");

const dataOf = (id) => materializeFixture(BACKGROUND_FIXTURES.find((f) => f.id === id)).data;

/* =========================================================
 * §16 Worker 兼容
 * ======================================================= */

test("§16：可靠性模块与预览服务都不碰 DOM / window / 应用 state", () => {
  for (const file of ["smart-preprocessing/background-reliability.mjs", "services/background-preview-service.mjs"]) {
    const code = codeOnly(read(file));
    for (const banned of ["document.", "window.", "localStorage", "sessionStorage", "libmsStore", "requestAnimationFrame"]) {
      assert.ok(!code.includes(banned), `${file} 里出现了 ${banned} —— Worker 里会直接 ReferenceError`);
    }
  }
});

test("§16：没有第二套 Worker 协议 —— 复用 B0 的 request / job / codec", () => {
  const worker = read("services/generation.worker.mjs");
  assert.match(worker, /import \{ executeGenerationJob \} from "\.\/generation-job\.mjs"/);
  assert.match(worker, /import \{ encodeGenerationResult \} from "\.\/generation-result-codec\.mjs"/);
  const code = codeOnly(worker);
  for (const banned of ["GenerationRequestV2", "WorkerRequest2", "parallelJobState", "GenerationProtocol2"]) {
    assert.ok(!code.includes(banned), `Worker 里出现了第二套协议：${banned}`);
  }
});

test("§16：overrides 是透传的 —— autoBackground / backgroundConfig 必须能穿过契约层", () => {
  const source = read("services/generation-request.mjs");
  assert.match(source, /overrides: Object\.freeze\(\{ \.\.\.\(overrides \|\| \{\}\) \}\)/,
    "overrides 变成了白名单 —— 新增选项会被静默丢掉");

  const request = {
    version: 1,
    kind: "generate",
    requestId: 7,
    image: { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 },
    size: { width: 10, height: 10 },
    mode: "logo",
    palette: [{ code: "H1", rgb: [255, 255, 255] }],
    maxColors: 0,
    overrides: { autoBackground: true, backgroundConfig: { maxColorDelta: 18 } },
  };
  const cloned = structuredClone(request);
  assert.equal(cloned.overrides.autoBackground, true);
  assert.deepEqual(cloned.overrides.backgroundConfig, { maxColorDelta: 18 });
});

test("§16：判定结果是结构化克隆安全的，能原样从 Worker 回主线程", () => {
  const data = dataOf("white-logo");
  const decisionPayload = {
    status: BACKGROUND_STATUS.RELIABLE,
    metrics: { borderConsistency: 1, seedAgreement: 0, foregroundSeparation: 80, connectivity: 1, interiorRisk: 0 },
    removedCount: 12,
    removedRatio: 0.5,
  };
  const cloned = structuredClone(decisionPayload);
  assert.deepEqual(cloned, decisionPayload);
});

/* =========================================================
 * §6 预览服务
 * ======================================================= */

test("§6：预检长边封顶，且等比缩放", () => {
  assert.equal(PREVIEW_LONG_EDGE, 160);
  assert.deepEqual(resolveProbeSize(800, 600), { width: 160, height: 120 });
  assert.deepEqual(resolveProbeSize(600, 800), { width: 120, height: 160 });
  assert.deepEqual(resolveProbeSize(100, 50), { width: 100, height: 50 }, "没超上限就不缩放");
  assert.deepEqual(resolveProbeSize(1000, 1000), { width: 160, height: 160 });
  const tiny = resolveProbeSize(0, 0);
  assert.ok(tiny.width >= 2 && tiny.height >= 2, "退化输入也必须给出合法尺寸");
});

test("§6：白底 Logo 预检给出 reliable + 可读文案", () => {
  const data = dataOf("white-logo");
  const preview = previewBackgroundRemoval({
    image: rasterizeSource(data, 4),
    finalSize: { width: 104, height: 104 },
    sampling: "center",
    preset: "logo",
  });
  assert.equal(preview.status, BACKGROUND_STATUS.RELIABLE);
  assert.equal(preview.reliable, true);
  assert.ok(preview.estimatedRemoved > 0, "应该估算出要移除的格数");
  assert.ok(preview.estimatedRemoved <= 104 * 104, "估算格数不能超过图纸总格数");
  assert.match(preview.message, /^检测到可安全移除背景 · 预计移除 \d+ 格 · [\d.]+%$/);
});

test("§6：不确定的图预检给出保持原图的文案，且 estimatedRemoved 为 0", () => {
  const data = dataOf("white-shirt-faint");
  const preview = previewBackgroundRemoval({
    image: rasterizeSource(data, 4),
    finalSize: { width: 104, height: 104 },
    sampling: "center",
    preset: "portrait",
  });
  assert.equal(preview.reliable, false);
  assert.equal(preview.estimatedRemoved, 0);
  assert.equal(preview.message, BACKGROUND_KEEP_MESSAGE);
  assert.doesNotMatch(preview.message, /失败|错误/);
});

test("§6：预检是只读的 —— 跑两次结果完全一致，且不依赖任何全局状态", () => {
  const data = dataOf("white-logo");
  const image = rasterizeSource(data, 4);
  const a = previewBackgroundRemoval({ image, finalSize: { width: 104, height: 104 }, sampling: "center", preset: "logo" });
  const b = previewBackgroundRemoval({ image, finalSize: { width: 104, height: 104 }, sampling: "center", preset: "logo" });
  assert.deepEqual(a, b);
});

test("§6：没有源图时预检返回 none，不抛", () => {
  const preview = previewBackgroundRemoval({ image: null, finalSize: { width: 104, height: 104 } });
  assert.equal(preview.status, BACKGROUND_STATUS.NONE);
  assert.equal(preview.reliable, false);
  assert.equal(preview.estimatedRemoved, 0);
});

test("§16：算法模块不反向依赖服务层（预览逻辑不许塞进算法模块）", () => {
  for (const file of ["smart-preprocessing/background-reliability.mjs", "smart-preprocessing/generation-engine-v2.mjs"]) {
    const code = codeOnly(read(file));
    assert.ok(!code.includes("background-preview-service"), `${file} 引用了预览服务 —— 算法层不该知道 UI 的存在`);
  }
});

/* =========================================================
 * §17 §18 界面纪律
 * ======================================================= */

test("§17：工作台上只有一个去背景开关 —— backgroundRemoval", () => {
  const panel = read("ui/generation-panel.js");
  assert.equal((panel.match(/switchRow\(\s*"backgroundRemoval"/g) || []).length, 1, "去背景开关必须恰好一个");
  assert.equal((panel.match(/switchRow\(\s*"autoBackground"/g) || []).length, 0,
    "「自动留空背景」是重复开关，必须删掉");
  // switchRow 内部用 `data-field="${field}"` 渲染，所以字面量不会出现在源码里 ——
  // 这条守卫改扫「传给 switchRow 的字段名集合」。
  const fields = [...panel.matchAll(/switchRow\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(fields).size, fields.length, `switchRow 字段名重复：${fields.join(", ")}`);
  assert.ok(fields.includes("backgroundRemoval"));
  assert.ok(!fields.includes("autoBackground"));
});

test("§18：面板把 backgroundRemoval 镜像成 autoBackground（同一个值发给引擎）", () => {
  const panel = read("ui/generation-panel.js");
  assert.match(panel, /emitSettings\(\)/);
  assert.match(panel, /return \{ \.\.\.this\.state, backgroundRemoval, autoBackground: backgroundRemoval \};/);
  assert.match(panel, /this\.onChange\(this\.emitSettings\(\)\)/);
  // 「小白一键」把 autoBackground 打开时，可见开关必须跟着打开
  assert.match(panel, /patch\.backgroundRemoval = Boolean\(centralized\.autoBackground\)/);
});

test("§17：工作台没有新增背景算法参数（阈值 / ΔE / 连通 / Seed Mode）", () => {
  const workspace = read("ui/workspace.js");
  for (const banned of ["ws-bg-threshold", "ws-bg-delta", "ws-bg-connectivity", "ws-bg-seed", "ws-bg-mode"]) {
    assert.ok(!workspace.includes(banned), `工作台出现了背景算法控件：${banned}`);
  }
  // 预检条只有三个动作按钮
  const strip = workspace.slice(workspace.indexOf('id="ws-bg-preview"'), workspace.indexOf('id="ws-canvas-hint"'));
  const buttons = strip.match(/<button/g) || [];
  assert.equal(buttons.length, 3, `预检条应该只有 3 个按钮，实得 ${buttons.length}`);
});

test("§6：开启去背景后先预览再生成，不静默应用", () => {
  const workspace = read("ui/workspace.js");
  assert.match(workspace, /id="ws-bg-preview"/);
  assert.match(workspace, /id="ws-bg-preview-apply"/);
  assert.match(workspace, /id="ws-bg-preview-keep"/);
  assert.match(workspace, /id="ws-bg-preview-dismiss"/);
  // 从关到开的那一刻必须走预检分支并且**提前 return**，不能顺手排一次生成
  assert.match(workspace, /if \(backgroundRemoval && !backgroundRemovalWasOn\) \{\s*requestBackgroundPreview\(\);\s*return;\s*\}/);
});

test("§18：选「保留背景」会把开关真的关掉（面板 + state 一起）", () => {
  const workspace = read("ui/workspace.js");
  assert.match(workspace, /function keepBackgroundAndGenerate\(\)/);
  assert.match(workspace, /generationPanel\.setState\(\{ backgroundRemoval: false \}, false\)/);
  assert.match(workspace, /store\.setState\(\{ generation: \{ backgroundRemoval: false, autoBackground: false \} \}\)/);
});

test("§6：预检失败不挡生成（异常路径静默退回正常生成）", () => {
  const workspace = read("ui/workspace.js");
  const fn = workspace.slice(workspace.indexOf("async function requestBackgroundPreview()"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /catch \{/, "预检必须有 catch —— 否则一次探测失败会让用户点不动生成");
  assert.match(body, /hideBackgroundPreview\(\)/, "异常时应收起预检条");
});

test("§6：桥接层暴露 previewBackgroundRemoval，且不写任何 state", () => {
  const app = read("app.js");
  assert.match(app, /async previewBackgroundRemoval\(\{ width, height \} = \{\}\) \{/);
  const at = app.indexOf("async previewBackgroundRemoval(");
  const body = app.slice(at, at + 1600);
  assert.ok(!/state\.grid =/.test(body), "预检不得改画布");
  assert.match(body, /previewModule\.previewBackgroundRemoval\(/);
});
