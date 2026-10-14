/**
 * 阶段 2 —— 生成策略统一（「生成目标」三张卡片）
 *
 * ── 这个文件守什么 ──────────────────────────────────────────────────────
 * 普通用户面对「8 个生成模式 × 一堆高级参数」是看不懂的。阶段 2 在面板顶部
 * 放了三个目标卡片：平衡推荐 / 最接近原图 / 最少颜色拼豆。选卡片 = 给既有
 * 领域（preset 模式 + maxColors 颜色数量）赋一次值。
 *
 * 三条硬边界，逐条对应下面的断言：
 *   ① 策略**不是**第二套生成真源 —— 映射只允许 preset + maxColors 两个字段，
 *      模式的完整参数永远走 applyPreset → GENERATION_MODE_PRESETS 注册表；
 *   ② 用户手动改模式 / 改色数 → 策略标记解除（strategy: null，回「自定义」），
 *      不静默覆盖用户明确设置；反向文案由 strategyHint() 一份产出；
 *   ③ 构造时**不许**悄悄套策略（初值 strategy: null）—— 默认套策略会改变
 *      每个人的既有生成行为。
 *
 * 另外守两条 UI 基础设施：
 *   · 模式标签只许有一份（mode-profile.mjs 的 MODE_LABELS，面板 import 它）；
 *   · 工作台皮肤（pixler-skin.css）不许把策略卡的说明文字藏掉 —— 说明文字
 *     是三个选项的选择依据，藏掉就等于把选项退化成三个词。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GenerationPanel } from "../ui/generation-panel.js";
import { GENERATION_MODE_PRESETS } from "../services/generation-pipeline.mjs";
import { MODE_LABELS } from "../services/mode-profile.mjs";

const panel = readFileSync(new URL("../ui/generation-panel.js", import.meta.url), "utf8");

/* =========================================================
 * A. 策略表本身
 * ======================================================= */

test("三个策略的 id 与正式中文名称", () => {
  assert.deepEqual(
    GenerationPanel.STRATEGIES.map((strategy) => strategy.id),
    ["balanced", "closest", "fewest"],
  );
  assert.deepEqual(
    GenerationPanel.STRATEGIES.map((strategy) => strategy.title),
    ["平衡推荐", "最接近原图", "最少颜色拼豆"],
  );
  assert.ok(Object.isFrozen(GenerationPanel.STRATEGIES), "策略表必须冻结");
  for (const strategy of GenerationPanel.STRATEGIES) {
    assert.ok(strategy.description.length >= 8, `策略 ${strategy.id} 缺说明文字`);
  }
});

test("策略映射只引用注册表里存在的模式，色数在 0..221 区间内", () => {
  const byId = Object.fromEntries(GenerationPanel.STRATEGIES.map((s) => [s.id, s]));
  assert.deepEqual(byId.closest.mapping, { preset: "auto", maxColors: 0 });
  assert.deepEqual(byId.fewest.mapping, { preset: "beginner", maxColors: 16 });
  assert.deepEqual(byId.balanced.mapping, { preset: "beginner" });
  for (const strategy of GenerationPanel.STRATEGIES) {
    assert.ok(
      strategy.mapping.preset in GENERATION_MODE_PRESETS,
      `策略 ${strategy.id} 映射到不存在的模式 ${strategy.mapping.preset}`,
    );
    if ("maxColors" in strategy.mapping) {
      assert.ok(
        strategy.mapping.maxColors >= 0 && strategy.mapping.maxColors <= 221,
        `策略 ${strategy.id} 的色数超出面板既有区间 0..221`,
      );
    }
  }
});

test("策略映射不出现生成参数字段（只许 preset + maxColors）", () => {
  for (const strategy of GenerationPanel.STRATEGIES) {
    for (const key of Object.keys(strategy.mapping)) {
      assert.ok(
        ["preset", "maxColors"].includes(key),
        `策略 ${strategy.id} 的映射出现陌生字段 ${key} —— 完整生成参数只走模式注册表`,
      );
    }
  }
});

/* =========================================================
 * B. applyStrategy 行为（spy  replacing this）
 * ======================================================= */

const spyPanel = () => {
  const calls = { preset: [], state: [] };
  return {
    calls,
    applyPreset(preset, extra = {}) {
      calls.preset.push([preset, extra]);
    },
    setState(patch, emit = true) {
      calls.state.push(patch);
    },
  };
};

test("applyStrategy 先把模式落进注册表视图，再叠加色数", () => {
  const spy = spyPanel();
  GenerationPanel.prototype.applyStrategy.call(spy, "fewest");
  // applyPreset 不带 extra —— applyStrategy 自己就是设标记的一方，不能被清掉
  assert.deepEqual(spy.calls.preset, [["beginner", {}]]);
  assert.deepEqual(spy.calls.state, [{ strategy: "fewest", maxColors: 16 }]);
});

test("balanced 不强改色数（该策略对 maxColors 没有发言权）", () => {
  const spy = spyPanel();
  GenerationPanel.prototype.applyStrategy.call(spy, "balanced");
  assert.deepEqual(spy.calls.state, [{ strategy: "balanced" }]);
});

test("未知策略 id 是彻底 no-op", () => {
  const spy = spyPanel();
  GenerationPanel.prototype.applyStrategy.call(spy, "no-such-strategy");
  assert.deepEqual(spy.calls.preset, []);
  assert.deepEqual(spy.calls.state, []);
});

/* =========================================================
 * C. strategyHint 文案（唯一状态行来源）
 * ======================================================= */

const hint = (state) => GenerationPanel.prototype.strategyHint.call({ state });

test("未选策略 → 自定义态", () => {
  assert.equal(
    hint({ strategy: null, preset: "auto", maxColors: 38 }),
    "自定义：智能 · 最多 38 色",
  );
});

test("策略生效 → 展示映射值", () => {
  assert.equal(
    hint({ strategy: "closest", preset: "auto", maxColors: 0 }),
    "最接近原图：智能 · 不限制颜色",
  );
  assert.equal(
    hint({ strategy: "fewest", preset: "beginner", maxColors: 16 }),
    "最少颜色拼豆：小白一键 · 最多 16 色",
  );
});

test("balanced 展示当前色数；0 说「不限制颜色」而不是「最多 0 色」", () => {
  assert.equal(
    hint({ strategy: "balanced", preset: "beginner", maxColors: 38 }),
    "平衡推荐：小白一键 · 最多 38 色",
  );
  assert.equal(
    hint({ strategy: "balanced", preset: "beginner", maxColors: 0 }),
    "平衡推荐：小白一键 · 不限制颜色",
  );
});

test("策略标记还在、数值已偏 → 附注说明（恢复态安全网）", () => {
  assert.equal(
    hint({ strategy: "closest", preset: "auto", maxColors: 24 }),
    "最接近原图：智能 · 不限制颜色（最多 24 色，已手动调整）",
  );
  assert.equal(
    hint({ strategy: "balanced", preset: "anime", maxColors: 38 }),
    "平衡推荐：小白一键 · 最多 38 色（当前模式：动漫）",
  );
});

test("面板 state 的 strategy 初值是 null —— 构造时不许悄悄套策略", () => {
  const start = panel.indexOf("this.state = {");
  assert.ok(start > 0, "找不到面板 state 初始化");
  const body = panel.slice(start, panel.indexOf("...initialState", start));
  assert.match(body, /strategy: null,/);
});

/* =========================================================
 * D. 事件接线（源码断言）
 * ======================================================= */

const bindEvents = panel.slice(
  panel.indexOf("bindEvents() {"),
  panel.indexOf("applyPreset(preset, extra = {})"),
);

test("点击策略卡 → applyStrategy，且不触发生成", () => {
  assert.match(bindEvents, /const strategyButton = event\.target\.closest\("\[data-strategy\]"\)/);
  assert.match(bindEvents, /this\.applyStrategy\(strategyButton\.dataset\.strategy\)/);
  // 只看策略分支本身（到下一个 const preset 之前）：选目标不该直接开生成，
  // 生成仍然只由「生成」按钮显式触发。整个 bindEvents 里当然有 onGenerate
  // —— 那是既有的生成按钮，不属于这个分支。
  const strategyBranch = bindEvents.slice(
    bindEvents.indexOf("const strategyButton"),
    bindEvents.indexOf("const preset ="),
  );
  assert.doesNotMatch(strategyBranch, /onGenerate\(/, "点策略卡不该直接开生成");
});

test("用户接管即解除策略标记：模式按钮 / 色数档位 / 步进 / 手输", () => {
  // 模式按钮：extra 补丁传 strategy:null
  assert.match(bindEvents, /this\.applyPreset\(preset\.dataset\.preset, \{ strategy: null \}\)/);
  // 色数档位：同一次 setState 里解除
  assert.match(bindEvents, /this\.setState\(\{ maxColors: Number\(colorCap\.dataset\.colorCap\) \|\| 0, strategy: null \}\)/);
  // maxColors 步进：只对 maxColors 解除，其它步进字段与策略无关
  assert.match(bindEvents, /field === "maxColors" \? \{ strategy: null \} : \{\}/);
  // 数字框手输：onInput 里解除
  assert.match(panel, /if \(field === "maxColors"\) this\.state\.strategy = null/);
});

test("applyPreset 接受 extra 补丁（applyStrategy 不传，手动切模式才传）", () => {
  assert.match(panel, /applyPreset\(preset, extra = \{\}\) \{/);
  assert.match(panel, /this\.setState\(\{ preset, \.\.\.patch, \.\.\.extra \}\)/);
  assert.match(panel, /this\.applyPreset\(strategy\.mapping\.preset\);/);
});

test("syncUI 同步策略卡高亮与状态行", () => {
  assert.match(panel, /querySelectorAll\("\[data-strategy\]"\)/);
  assert.match(panel, /card\.dataset\.strategy === this\.state\.strategy/);
  assert.match(panel, /const strategyHint = this\.root\.querySelector\("#sl-strategy-hint"\)/);
  assert.match(panel, /if \(strategyHint\) strategyHint\.textContent = this\.strategyHint\(\)/);
});

/* =========================================================
 * E. 单一来源与皮肤放行
 * ======================================================= */

test("模式标签只许有一份：面板 import 注册表 MODE_LABELS，不内嵌字面量", () => {
  assert.match(panel, /import \{ MODE_LABELS \} from "\.\.\/services\/mode-profile\.mjs"/);
  for (const key of Object.keys(MODE_LABELS)) {
    assert.ok(panel.includes(`MODE_LABELS.${key}`), `模式 ${key} 的按钮没走 MODE_LABELS`);
  }
  for (const label of Object.values(MODE_LABELS)) {
    assert.ok(!panel.includes(`"${label}"`), `面板又内嵌了标签「${label}」`);
  }
});

test("工作台皮肤不许把策略卡说明文字藏掉", () => {
  const skin = readFileSync(new URL("../styles/pixler-skin.css", import.meta.url), "utf8");
  const genCss = readFileSync(new URL("../styles/generation-editor.css", import.meta.url), "utf8");
  assert.match(genCss, /\.sl-strategy-grid \{/, "生成面板 CSS 缺策略网格规则");
  assert.match(genCss, /\.sl-strategy-hint \{/, "生成面板 CSS 缺状态行规则");
  assert.match(genCss, /\.sl-strategy-card \{/, "生成面板 CSS 缺策略卡规则");
  // 皮肤把 .sl-preset-card 的说明文字 display:none 了；策略卡必须显式放行。
  assert.match(
    skin,
    /\.phase2-workspace \.sl-strategy-card \.sl-preset-copy small \{ display: block;/,
    "pixler-skin 没有放行策略卡说明文字 —— 三个选项会退化成三个词",
  );
  assert.match(skin, /\.phase2-workspace \.sl-strategy-grid \{/, "皮肤没有策略网格覆盖");
});
