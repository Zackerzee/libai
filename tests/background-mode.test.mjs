/**
 * background-mode.test.mjs — 阶段 3「背景处理正式整合」四层测试。
 *
 * 層次（自底向上）：
 *   A 契约      services/background-mode.mjs —— 三模式的唯一解释层
 *   B 引擎基元  compositeTransparentBackground（纯函数）
 *   C 引擎行为  generateV2 在三种模式下的空格/填充结果
 *   D 管线翻译  runGenerationPipeline 的 overrides → 引擎选项（含「用户模式
 *               必须盖过模式档案 autoBackground:true」与「不表态时档案说话」）
 *   E 预检      previewBackgroundRemoval 的 mode 分流
 *
 * 纪律：所有新测试都不依赖浏览器；与 B2 的既有夹具（transparent-png /
 * white-logo）共用，保证「测试的图」和「验收的图」是同一张。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKGROUND_MODES,
  BACKGROUND_MODE_IDS,
  BACKGROUND_MODE_LIST,
  BACKGROUND_MODE_HINTS,
  DEFAULT_BACKGROUND_MODE,
  normalizeBackgroundMode,
  backgroundModeOf,
  resolveBackgroundModeOptions,
} from "../services/background-mode.mjs";
import { compositeTransparentBackground, generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { previewBackgroundRemoval } from "../services/background-preview-service.mjs";
import { ENGINE_PASSTHROUGH_KEYS } from "../services/mode-profile.mjs";
import { materializeFixture, paletteOf, rasterizeSource, BACKGROUND_FIXTURES } from "./background-fixtures.mjs";

const fixtureData = (id) => {
  const fixture = BACKGROUND_FIXTURES.find((f) => f.id === id);
  assert.ok(fixture, `夹具不存在：${id}`);
  return materializeFixture(fixture).data;
};

/* =========================================================
 * A 契约
 * ======================================================= */

test("A1：三个模式 id 齐全且顺序固定（界面顺序 = 契约顺序）", () => {
  assert.deepEqual(BACKGROUND_MODE_IDS, ["keep", "transparent", "auto"]);
  assert.equal(BACKGROUND_MODES.KEEP, "keep");
  assert.equal(BACKGROUND_MODES.TRANSPARENT, "transparent");
  assert.equal(BACKGROUND_MODES.AUTO, "auto");
  assert.equal(BACKGROUND_MODE_LIST.length, 3);
  for (const mode of BACKGROUND_MODE_LIST) {
    assert.ok(BACKGROUND_MODE_IDS.includes(mode.id), `未知模式 id：${mode.id}`);
    assert.ok(mode.title && mode.description, `${mode.id} 缺标题或说明`);
    assert.ok(BACKGROUND_MODE_HINTS[mode.id], `${mode.id} 缺状态行提示`);
  }
  // 三个标题互不相同 —— 相同标题会让用户以为在选同一个东西
  assert.equal(new Set(BACKGROUND_MODE_LIST.map((m) => m.title)).size, 3);
});

test("A2：默认模式是 transparent —— 与改造前的既成行为一致", () => {
  // 改造前（单一开关关闭时）：采样引擎跳过透明像素 → 透明格是空豆。
  // 默认值一旦改成 keep，每个上传透明 PNG 的老用户都会看到行为变化。
  assert.equal(DEFAULT_BACKGROUND_MODE, "transparent");
});

test("A3：归一化把非法值收敛到默认模式", () => {
  assert.equal(normalizeBackgroundMode("keep"), "keep");
  assert.equal(normalizeBackgroundMode("auto"), "auto");
  assert.equal(normalizeBackgroundMode("nonsense"), "transparent");
  assert.equal(normalizeBackgroundMode(undefined), "transparent");
  assert.equal(normalizeBackgroundMode(null), "transparent");
  assert.equal(normalizeBackgroundMode(42), "transparent");
});

test("A4：backgroundModeOf 向后兼容 —— 老调用方只带 autoBackground", () => {
  // 新字段优先
  assert.equal(backgroundModeOf({ backgroundMode: "keep", autoBackground: true }), "keep");
  // 只有 autoBackground:true（B2 单一开关时代）→ auto
  assert.equal(backgroundModeOf({ autoBackground: true }), "auto");
  // autoBackground:false / 都没有 → 默认 transparent（不是「不清除」的歧义态）
  assert.equal(backgroundModeOf({ autoBackground: false }), "transparent");
  assert.equal(backgroundModeOf({}), "transparent");
  assert.equal(backgroundModeOf(null), "transparent");
  // 非法 backgroundMode 不静默生效 —— 回落到 autoBackground 判定
  assert.equal(backgroundModeOf({ backgroundMode: "bogus", autoBackground: true }), "auto");
  assert.equal(backgroundModeOf({ backgroundMode: "bogus" }), "transparent");
});

test("A5：模式 → 引擎选项的翻译（唯一翻译处）", () => {
  // keep：不跑移除，但透明区域要填充（缺省色 = 白）
  const keep = resolveBackgroundModeOptions("keep");
  assert.deepEqual(keep, { autoBackground: false, transparentFill: "#ffffff" });
  // keep + 自定义填充色（来自「图片调整」的背景色）
  assert.deepEqual(resolveBackgroundModeOptions("keep", { fillColor: "#102030" }), {
    autoBackground: false, transparentFill: "#102030",
  });
  // transparent：什么都不做（透明格走采样引擎的跳过老路）
  assert.deepEqual(resolveBackgroundModeOptions("transparent", { fillColor: "#102030" }), {
    autoBackground: false, transparentFill: null,
  });
  // auto：既有可靠性门（透明格的处置由 B2 §11 负责，不填充）
  assert.deepEqual(resolveBackgroundModeOptions("auto", { fillColor: "#102030" }), {
    autoBackground: true, transparentFill: null,
  });
  // 非法模式按 transparent 处理（不抛、不静默变 auto）
  assert.deepEqual(resolveBackgroundModeOptions("bogus"), { autoBackground: false, transparentFill: null });
});

/* =========================================================
 * B 引擎基元：compositeTransparentBackground
 * ======================================================= */

const makeImage = (pixels) => ({
  data: new Uint8ClampedArray(pixels.flatMap(([r, g, b, a]) => [r, g, b, a])),
  width: pixels.length,
  height: 1,
});

test("B1：全不透明图零拷贝、零填充（不改任何一个字节）", () => {
  const image = makeImage([[10, 20, 30, 255], [200, 100, 50, 255]]);
  const before = Uint8ClampedArray.from(image.data);
  const out = compositeTransparentBackground(image, "#ffffff");
  assert.equal(out.filledPixels, 0);
  assert.equal(out.data, image.data, "没有透明像素时应原样复用，不分配新数组");
  assert.deepEqual([...out.data], [...before], "入参一个字节都不许动");
});

test("B2：全透明像素填成填充色且 alpha 置 255", () => {
  const image = makeImage([[0, 0, 0, 0], [10, 200, 30, 255]]);
  const out = compositeTransparentBackground(image, "#ff8800");
  assert.equal(out.filledPixels, 1);
  assert.deepEqual([...out.data.slice(0, 4)], [255, 136, 0, 255], "透明格必须变成填充色");
  assert.deepEqual([...out.data.slice(4, 8)], [10, 200, 30, 255], "不透明格逐位不变");
  assert.notEqual(out.data, image.data, "有填充时必须返回新数组，不能改入参");
  assert.equal(image.data[3], 0, "入参的 alpha 不许被改写");
});

test("B3：半透明像素按 alpha 线性混合（与浏览器白底观感一致）", () => {
  // k = 128/255：out = src*k + fill*(1-k)，四舍五入后落在 ±1 内
  const image = makeImage([[200, 100, 50, 128]]);
  const out = compositeTransparentBackground(image, "#ffffff");
  const k = 128 / 255;
  const expect = (src, fill) => Math.round(src * k + fill * (1 - k));
  assert.deepEqual([...out.data], [expect(200, 255), expect(100, 255), expect(50, 255), 255]);
  assert.equal(out.filledPixels, 1, "半透明也算「需要合成」");
});

test("B4：非法填充色原样返回（不静默产出半黑底）", () => {
  const image = makeImage([[0, 0, 0, 0]]);
  for (const bad of ["#fff", "nope", "", null, "#gggggg"]) {
    const out = compositeTransparentBackground(image, bad);
    assert.equal(out.filledPixels, 0, `${String(bad)} 不该被当成合法色`);
    assert.equal(out.data[3], 0, "原图透明度不许被改写");
  }
});

/* =========================================================
 * C 引擎行为：generateV2 在三种模式下
 * ======================================================= */

const TRANSPARENT_PALETTE = [
  { code: "W", rgb: [255, 255, 255] },
  { code: "G", rgb: [60, 120, 90] },
];

const runEngine = (data, extra) => generateV2({
  source: rasterizeSource(data, 4),
  width: data.width,
  height: data.height,
  palette: TRANSPARENT_PALETTE,
  options: { preset: "logo", sampling: "center", maxColors: 0, ...extra },
});

test("C1：transparent 模式（不传 transparentFill）—— 透明格保持空豆（既成行为）", () => {
  const data = fixtureData("transparent-png");
  const result = runEngine(data, {});
  assert.equal(result.diagnostics.transparentFill, null, "没开填充就不该有填充诊断");
  // 夹具四角都是透明 → 保持 null
  assert.equal(result.grid[0][0], null);
  assert.equal(result.grid[data.height - 1][data.width - 1], null);
});

test("C2：keep 模式（transparentFill）—— 透明格填成背景色的豆，不再是空豆", () => {
  const data = fixtureData("transparent-png");
  const result = runEngine(data, { transparentFill: "#ffffff" });
  const fill = result.diagnostics.transparentFill;
  assert.ok(fill, "开了填充就必须有填充诊断");
  assert.equal(fill.color, "#ffffff");
  assert.ok(fill.filledPixels > 0, "透明区域一个像素都没填 —— 填充没生效");
  // 四角从 null 变成非 null（白豆）
  assert.notEqual(result.grid[0][0], null, "左上角必须被填上");
  assert.notEqual(result.grid[data.height - 1][data.width - 1], null, "右下角必须被填上");
  // resolvedConfig 要能自证「这一版带着填充色跑」
  assert.equal(result.diagnostics.resolvedConfig.transparentFill, "#ffffff");
});

test("C3：keep 模式的填充色如实生效（非白填充 → 非白豆）", () => {
  const data = fixtureData("transparent-png");
  const result = runEngine(data, { transparentFill: "#102030" });
  assert.ok(result.diagnostics.transparentFill.filledPixels > 0);
  // 深色填充不该被清理/降色悄悄抹掉成 null
  assert.notEqual(result.grid[0][0], null);
});

/* =========================================================
 * D 管线翻译：overrides → 引擎选项
 * ======================================================= */

const pipelineResolved = (overrides, mode = "beginner") => {
  const data = fixtureData("transparent-png");
  const result = runGenerationPipeline({
    image: rasterizeSource(data, 4),
    mode,
    size: { width: data.width, height: data.height },
    palette: TRANSPARENT_PALETTE,
    maxColors: 0,
    overrides,
  });
  return result.diagnostics.resolvedConfig;
};

test("D1：transparentFill 在 ENGINE_PASSTHROUGH_KEYS 里（漏掉它 = 静默失效）", () => {
  assert.ok(ENGINE_PASSTHROUGH_KEYS.includes("transparentFill"),
    "transparentFill 必须能穿过 toEngineOptions 的白名单");
});

test("D2：用户的背景模式盖过模式档案（beginner 的 autoBackground:true）", () => {
  // 面板/ store 的 backgroundMode 是用户明示选择，必须赢。
  const resolved = pipelineResolved({ backgroundMode: "transparent", backgroundFillColor: "#ffffff" });
  assert.equal(resolved.autoBackground, false,
    "选了「保留原图透明区域」却被 beginner 档案打开自动去背景 —— 用户选择被静默推翻");
  assert.equal(resolved.transparentFill, null);
});

test("D3：keep 模式把填充色一路带到引擎", () => {
  const resolved = pipelineResolved({ backgroundMode: "keep", backgroundFillColor: "#102030" });
  assert.equal(resolved.autoBackground, false);
  assert.equal(resolved.transparentFill, "#102030");
});

test("D4：auto 模式打开既有去背景链路", () => {
  const resolved = pipelineResolved({ backgroundMode: "auto" });
  assert.equal(resolved.autoBackground, true);
  assert.equal(resolved.transparentFill, null);
});

test("D5：调用方不表态时，模式档案自己说话（跑分器/工具直调不受影响）", () => {
  // beginner 档案 autoBackground:true —— 没有背景字段的调用方必须照旧拿到 true。
  const resolved = pipelineResolved({});
  assert.equal(resolved.autoBackground, true,
    "没有背景字段的调用方被翻译成了 autoBackground:false —— 跑分基线的 beginner 会全变");
});

test("D6：B2 单一开关时代的 legacy 调用方逐位兼容", () => {
  assert.equal(pipelineResolved({ autoBackground: true }).autoBackground, true);
  assert.equal(pipelineResolved({ autoBackground: false }).autoBackground, false);
  assert.equal(pipelineResolved({ autoBackground: true }).transparentFill, null);
});

/* =========================================================
 * E 预检：mode 分流
 * ======================================================= */

const preview = (data, extra = {}) => previewBackgroundRemoval({
  image: rasterizeSource(data, 4),
  finalSize: { width: data.width, height: data.height },
  ...extra,
});

test("E1：缺省 mode = auto —— 与阶段 3 之前逐位一致（既有调用方不传它）", () => {
  const result = preview(fixtureData("transparent-png"));
  assert.equal(result.mode, "auto");
  // auto 路径跑完整可靠性判定 → 有 metrics
  assert.ok(result.metrics, "auto 预检必须给出五指标");
  // 全透明图没有可分离纯色背景 → 保持原图
  assert.equal(result.reliable, false);
});

test("E2：keep 预检报告「多少透明格会被填充」，不跑移除判定", () => {
  const result = preview(fixtureData("transparent-png"), { mode: "keep", fillColor: "#123456" });
  assert.equal(result.mode, "keep");
  assert.equal(result.metrics, null, "keep 模式不跑五指标 —— 它压根不移除背景");
  assert.ok(result.estimatedTransparent > 0, "夹具大面积透明，估算必须 > 0");
  assert.match(result.message, /填充为背景色 #123456/);
});

test("E3：transparent 预检报告「多少透明格会留空」", () => {
  const result = preview(fixtureData("transparent-png"), { mode: "transparent" });
  assert.equal(result.mode, "transparent");
  assert.match(result.message, /留空、不填豆/);
  assert.equal(result.estimatedRemoved, 0, "transparent 模式永不报告移除");
});

test("E4：没有透明区域时两种模式都说清楚「没什么会变」", () => {
  const keep = preview(fixtureData("white-logo"), { mode: "keep" });
  assert.equal(keep.estimatedTransparent, 0);
  assert.match(keep.message, /未检测到透明区域/);
  const transparent = preview(fixtureData("white-logo"), { mode: "transparent" });
  assert.match(transparent.message, /未检测到透明区域/);
});
