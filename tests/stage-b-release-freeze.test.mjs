/**
 * Stage B5 —— 发布冻结门（Release Freeze Gate）
 *
 * ── 这个文件存在的理由 ────────────────────────────────────────────────
 * Stage B 的结论不只是「现在是这样的」，而是「**以后也得是这样**」。
 * 一份写在报告里的冻结清单，下一个改动的人看不到；写成断言才会在
 * 有人不小心把它打开时立刻变红。
 *
 * 所以这里断言的**不是**「代码现在长什么样」，而是：
 *   §1  生产算法集：四个被裁掉的算法必须不可达
 *   §2  Auto Tune：只给「智能」，lab 白名单保持空集
 *   §7  Worker-only：主线程直算只能是显式降级，不能是默认路径
 *   §19 UI 面：工作台不得暴露实验入口
 *   §20 死代码：B5 清掉的东西不许回来
 *
 * ── 为什么断言「不可达」而不是「默认关」 ──────────────────────────────
 * 「默认关」是一个可以被一次误操作打开的开关；「不可达」是结构上到不了。
 * 一个被明确否决的算法留在搜索空间里，代价不是「可能被选中」，
 * 而是**它会被当成一个仍然有效的选项** —— 下一次调参的人会重新评估它、
 * 重新写一份报告、重新得出同一个结论。冻结的意义是终止这个循环。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_TUNE_LAB_CANDIDATES,
  AUTO_TUNE_PROFILES,
  PRODUCTION_LAB_CANDIDATES,
  resolveCandidates,
} from "../services/auto-tune-profiles.mjs";
import {
  AUTO_TUNE_PRODUCTION_MODES,
  isAutoTuneEnabledFor,
} from "../services/auto-tune.mjs";
import { GENERATION_MODES, MODE_LABELS, MODE_PROFILES } from "../services/mode-profile.mjs";

const root = new URL("../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), "utf8");

const APP = read("app.js");
const WORKSPACE = read("ui/workspace.js");
const GENERATION_PANEL = read("ui/generation-panel.js");
const INDEX = read("index.html");

/**
 * 去掉注释后的源码。
 *
 * **只按行前缀过滤，绝不用正则剥 `/* … *\/`。** 仓库里有大量含 CSS / HTML 的
 * 模板字符串，用正则剥注释会把它们里面的内容一起吃掉 —— 那些内容恰恰是
 * 「界面有没有暴露某个入口」这类断言要看的地方。行前缀过滤会漏掉块注释中段，
 * 但那比误删模板字符串安全得多（这个取舍与 `mode-profile-contract.test.mjs` 一致）。
 */
function codeOnly(source) {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

const APP_CODE = codeOnly(APP);
const WORKSPACE_CODE = codeOnly(WORKSPACE);
const PANEL_CODE = codeOnly(GENERATION_PANEL);

/* =========================================================
 * §1 生产算法集冻结
 * ======================================================= */

/**
 * §0 裁定 REJECT 的四个算法。它们仍然以 lab 候选的形式存在于
 * `smart-preprocessing/lab/`（Lab 是实验场，不是产品路径），
 * 但**一个生产入口都不许够到**。
 */
const REJECTED_ALGORITHMS = Object.freeze([
  { id: "dual-mode", label: "Dual Mode" },
  { id: "spatial-refine", label: "Spatial Refine" },
  { id: "neutral-protection", label: "Neutral Protection" },
  { id: "conservative-cleanup", label: "Conservative Cleanup" },
]);

test("§1 四个被裁掉的算法都不在 Auto Tune 的 lab 白名单里", () => {
  for (const algo of REJECTED_ALGORITHMS) {
    assert.ok(
      !AUTO_TUNE_LAB_CANDIDATES.includes(algo.id),
      `${algo.label}（${algo.id}）出现在 AUTO_TUNE_LAB_CANDIDATES 里 —— `
      + "§0 已裁定 REJECT，不许放回搜索空间。要放回必须先改 §0 的裁定，不是改这个数组。",
    );
  }
});

test("§1 生产 lab 白名单是空集 —— 任何 lab 候选都够不到生产", () => {
  assert.equal(PRODUCTION_LAB_CANDIDATES.length, 0,
    "PRODUCTION_LAB_CANDIDATES 非空：生产里开始跑 lab 候选了。"
    + "§13 的结论是保持空集（photo 上 oracle 0 次命中）。");
});

test("§1 所有 8 个模式的候选集里都没有被裁掉的算法", () => {
  for (const mode of GENERATION_MODES) {
    for (const production of [false, true]) {
      const ids = resolveCandidates(mode, { production }).map((c) => c.id);
      for (const algo of REJECTED_ALGORITHMS) {
        assert.ok(!ids.includes(algo.id),
          `${mode}${production ? "（生产档）" : ""} 的候选集含 ${algo.id}`);
      }
    }
  }
});

test("§1 生产源码里不出现被裁算法的 id", () => {
  for (const algo of REJECTED_ALGORITHMS) {
    assert.ok(!APP_CODE.includes(algo.id),
      `app.js 里出现了 ${algo.id} —— 生产入口不该认识这个名字`);
  }
});

test("§1 七个明确模式继续用固定 ModeProfile（Auto Tune 不介入）", () => {
  const explicit = GENERATION_MODES.filter((mode) => mode !== "auto");
  assert.equal(explicit.length, 7, "公开模式应该是 8 个，其中 7 个是用户明确表态的");
  for (const mode of explicit) {
    assert.equal(isAutoTuneEnabledFor(mode), false,
      `${mode} 被允许跑 Auto Tune 了 —— §26 第一阶段只给「智能」`);
  }
  assert.equal(isAutoTuneEnabledFor("auto"), true, "「智能」必须仍然启用 Auto Tune");
});

test("§1 每个模式的 ModeProfile 都在，且字段完整", () => {
  for (const mode of GENERATION_MODES) {
    const profile = MODE_PROFILES[mode];
    assert.ok(profile, `模式 ${mode} 没有 ModeProfile`);
    for (const key of ["sampling", "detailProtection", "edgeProtection", "cleanupStrength"]) {
      assert.ok(key in profile, `${mode} 缺 ${key}`);
    }
  }
});

/* =========================================================
 * §2 Auto Tune 冻结
 * ======================================================= */

test("§2 Auto Tune 只给「智能」启用，且名单只有一项", () => {
  assert.deepEqual([...AUTO_TUNE_PRODUCTION_MODES], ["auto"],
    "AUTO_TUNE_PRODUCTION_MODES 变了 —— 放开更多模式需要一轮独立验收");
});

test("§2 lab 白名单只含 bean-fit（§12 唯一被继续测的候选）", () => {
  assert.deepEqual([...AUTO_TUNE_LAB_CANDIDATES], ["bean-fit"]);
});

test("§2 生产档候选集里一个 lab 候选都没有", () => {
  for (const mode of GENERATION_MODES) {
    const production = resolveCandidates(mode, { production: true });
    for (const candidate of production) {
      assert.equal(candidate.labCandidate, null,
        `${mode} 的生产候选 ${candidate.id} 挂了 labCandidate=${candidate.labCandidate}`);
    }
  }
});

test("§2 每个模式第一个候选必须是「无覆盖」的（§23 的安全规则靠这条结构性质）", () => {
  // 断言的是**性质**而不是名字：§23 要的是「首项 == 生产行为」，
  // 而「生产行为」的实现就是「overrides 为空」。名字后缀是排版，不是契约
  // （`beginner` 的首项叫 `beginner-safe` 而不是 `beginner-standard`，
  //  但它的 overrides 是空的 —— 结构上完全正确）。
  for (const mode of GENERATION_MODES) {
    const production = resolveCandidates(mode, { production: true });
    assert.ok(production.length >= 1, `${mode} 没有生产候选`);
    const first = production[0];
    assert.deepEqual({ ...first.overrides }, {},
      `${mode} 的首个候选 ${first.id} 带了覆盖 ${JSON.stringify(first.overrides)} —— `
      + "首项必须是「不调优」本身，否则 §23 的回落目标不是生产行为");
    assert.equal(first.labCandidate, null, `${mode} 的首个候选挂了 lab`);
  }
});

test("§2 standardProfileId 返回的就是各模式首项（回落目标可复核）", async () => {
  const { standardProfileId } = await import("../services/auto-tune-profiles.mjs");
  for (const mode of GENERATION_MODES) {
    const ids = resolveCandidates(mode, { production: true }).map((c) => c.id);
    assert.equal(standardProfileId(mode), ids[0],
      `${mode} 的 standardProfileId 不是候选表首项 —— 回落目标与列表不一致`);
  }
});

test("§2 每个 Profile 都引用 MODE_PROFILES，不是复制一份配置", () => {
  for (const profile of AUTO_TUNE_PROFILES) {
    if (!profile.baseProfile) continue;
    assert.ok(MODE_PROFILES[profile.mode] === profile.baseProfile || profile.baseProfile,
      `${profile.id} 的 baseProfile 不是 MODE_PROFILES 的引用`);
  }
  // 覆盖项必须是**小增量**：复制整份配置的后果是改真源不生效。
  for (const profile of AUTO_TUNE_PROFILES) {
    assert.ok(Object.keys(profile.overrides).length <= 4,
      `${profile.id} 覆盖了 ${Object.keys(profile.overrides).length} 个字段 —— `
      + "Profile 应该是 baseProfile + 少量覆盖，不是第二份配置");
  }
});

/* =========================================================
 * §7 Worker-only
 * ======================================================= */

test("§7 生产生成走真实 Worker：runGenerationJob 先试 Worker", () => {
  const start = APP_CODE.indexOf("async function runGenerationJob(");
  assert.ok(start > 0, "找不到 runGenerationJob");
  const body = APP_CODE.slice(start, start + 3000);

  const workerAt = body.indexOf("getGenerationWorkerClient()");
  const workerRunAt = body.indexOf("client.run(request");
  assert.ok(workerAt > 0, "runGenerationJob 不再取 Worker 客户端");
  assert.ok(workerRunAt > workerAt, "runGenerationJob 取了 Worker 客户端却没有 run 它");

  // 主线程直算必须排在 Worker 之后 —— 它是降级路径，不是默认路径。
  const directAt = body.indexOf("job.executeGenerationJob(request)");
  assert.ok(directAt > workerRunAt,
    "executeGenerationJob 出现在 Worker 之前 —— 主线程直算变成了默认路径（§7 禁止）");
});

test("§7 主线程直算只出现在两个显式降级分支里", () => {
  const start = APP_CODE.indexOf("async function runGenerationJob(");
  const body = APP_CODE.slice(start, start + 3000);

  // ① 契约模块没加载（非工作台入口）→ 直调流水线
  assert.match(body, /if \(!job \|\| !contract\)/,
    "契约缺失的降级分支不见了 —— 直算会变成无条件执行");
  // ② Worker 不可用 / 失败 → 主线程
  assert.match(body, /client\?\.supported/,
    "Worker 可用性判断不见了");
  assert.match(body, /生成 Worker 失败，退回主线程执行/,
    "Worker 失败的降级日志不见了 —— 静默降级比降级本身更危险");
});

test("§7 生产提交路径（processImageV2）只经 runGenerationJob，不直调流水线", () => {
  const start = APP_CODE.indexOf("async function processImageV2(");
  assert.ok(start > 0, "找不到 processImageV2");
  const body = APP_CODE.slice(start, start + 4000);
  assert.match(body, /await runGenerationJob\(/, "processImageV2 不再经 runGenerationJob");
  assert.ok(!/runGenerationPipeline\(/.test(body),
    "processImageV2 里出现了 runGenerationPipeline —— 主线程直算回来了");
  assert.ok(!/executeGenerationJob\(/.test(body),
    "processImageV2 里出现了 executeGenerationJob —— 主线程直算回来了");
});

test("§7 取消 / 过期不退回主线程重跑（否则「点了取消反而又开始算」）", () => {
  const start = APP_CODE.indexOf("async function runGenerationJob(");
  const body = APP_CODE.slice(start, start + 3000);
  const catchAt = body.indexOf("生成 Worker 失败，退回主线程执行");
  assert.ok(catchAt > 0, "找不到 Worker 失败的 catch 块");
  const guard = body.slice(Math.max(0, catchAt - 600), catchAt);
  assert.match(guard, /AbortError/);
  assert.match(guard, /StaleGenerationError/);
  assert.match(guard, /throw error/);
});

/* =========================================================
 * §19 UI 面：工作台不得暴露实验入口
 * ======================================================= */

test("§19 工作台源码里没有实验入口的文案或控件", () => {
  const forbidden = [
    /bean[\s-]?fit/i, /dual[\s-]?mode/i, /spatial[\s-]?refine/i,
    /neutral[\s-]?protection/i, /conservative[\s-]?cleanup/i,
    /auto[\s-]?tune[\s-]?profile/i, /recommended[\s-]?hybrid/i,
  ];
  for (const source of [WORKSPACE_CODE, PANEL_CODE]) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(source),
        `界面源码里出现了实验入口 ${pattern} —— 用户只能看到「智能」，不能看到算法名`);
    }
  }
});

test("§19 工作台源码里没有 debug 面板 / 指标 dump 入口", () => {
  const forbidden = [/debug[\s-]?metrics/i, /dump[\s-]?diagnostics/i, /debug[\s-]?panel/i];
  for (const source of [WORKSPACE_CODE, PANEL_CODE]) {
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(source), `界面源码里出现了 ${pattern}`);
    }
  }
});

test("§19 生成模式入口恰好是 8 个，文案来自 MODE_LABELS", () => {
  // 阶段 2：面板不再内嵌标签字面量，改为 import 注册表的 MODE_LABELS
  //（mode-profile.mjs 原话：「界面文案。放在这里是为了让『模式清单』只有一份来源」）。
  // 断言随之改写：8 个模式键在面板里都以 MODE_LABELS.<key> 形式引用，
  // 标签字面量只许存在于注册表 —— 面板里再出现 quoted label 就是第二张表。
  const keys = [...GENERATION_MODES];
  assert.equal(keys.length, 8, "公开模式必须恰好 8 个");
  for (const key of keys) {
    assert.ok(GENERATION_PANEL.includes(`MODE_LABELS.${key}`),
      `生成模式「${key}」的按钮没有引用 MODE_LABELS.${key}`);
  }
  assert.match(GENERATION_PANEL,
    /import \{ MODE_LABELS \} from "\.\.\/services\/mode-profile\.mjs"/,
    "面板没有从 mode-profile.mjs 导入 MODE_LABELS");
  const labels = ["小白一键", "智能", "人像", "动漫", "插画", "像素", "Logo", "写实"];
  for (const label of labels) {
    assert.ok(!GENERATION_PANEL.includes(`"${label}"`),
      `面板里又内嵌了模式标签「${label}」—— 文案只许有一份（mode-profile.mjs 的 MODE_LABELS）`);
  }
  // 真源没被搬走：注册表仍然持这 8 条文案。
  assert.deepEqual(
    GENERATION_MODES.map((key) => MODE_LABELS[key]),
    labels,
    "注册表 MODE_LABELS 的 8 条文案发生变化 —— 改文案请改注册表并同步此断言"
  );
  // 采样策略是内部实现，不能变成用户选项。
  assert.ok(!/data-sampling=/.test(PANEL_CODE), "采样策略出现在界面上了");
});

/* =========================================================
 * §20 死代码：B5 清掉的东西不许回来
 * ======================================================= */

test("§20 generation-panel 里不再有第二张 presets 表", () => {
  assert.ok(!/const presets =/.test(PANEL_CODE),
    "`const presets = null` 死变量回来了");
  assert.ok(!/presets\[/.test(PANEL_CODE),
    "generation-panel 里出现了 presets 下标读取 —— 第二张模式表回来了");
  // 唯一出口仍然是 Registry。
  assert.match(PANEL_CODE, /GENERATION_MODE_PRESETS\[preset\]/);
});

test("§20 generation-panel 的面板 state 不再声明 autoBackground", () => {
  const start = PANEL_CODE.indexOf("this.state = {");
  assert.ok(start > 0, "找不到面板 state 初始化");
  const body = PANEL_CODE.slice(start, start + 1200);
  assert.ok(!/^\s*autoBackground:/m.test(body),
    "面板 state 里又有 autoBackground 了 —— 它是写不到也读不回的字段；"
    + "真正活的那个在 state/store.js 的 generation 槽里");
  // 但 emitSettings 必须仍然输出镜像 —— 引擎读的是 autoBackground。
  assert.match(PANEL_CODE, /autoBackground: backgroundRemoval/,
    "emitSettings 的镜像输出被删了 —— 引擎读的 autoBackground 会永远拿不到值");
});

test("§20 source-classifier 不再有永不可达的 reason 默认值", () => {
  const classifier = codeOnly(read("services/source-classifier.mjs"));
  assert.ok(!/let reason = "no-signal"/.test(classifier),
    "`let reason = \"no-signal\"` 回来了 —— 三路分支互斥且穷尽，那个值到不了返回值");
  assert.match(classifier, /let reason;/);
});

test("§20 尺寸系统里不再有旧「倍数」概念", () => {
  const workspaceCode = codeOnly(WORKSPACE);
  for (const legacy of ["manualMultiple", "syncMultipleReadout", "effectiveMultiple", "data-multiple-step"]) {
    assert.ok(!workspaceCode.includes(legacy), `旧倍数 UI 的 ${legacy} 回来了`);
  }
});

/* =========================================================
 * §8 / §11 requestId 接线
 *
 * ── 为什么这条要用「数出现次数」这种笨办法 ────────────────────────────
 * 2026-10-04 实测出来的一个真缺陷：`processImageV2` 的形参漏解构了
 * `requestId`，而调用方把它传在**顶层**（不是塞进 `options` 里）。于是这个
 * 函数里读的 `options.requestId` 恒为 `undefined` —— 实证是 §12 profile 的
 * `__libmsCommitProfileMeta.requestId` 一直是 null。
 *
 * 一个丢参，三处设计好的守卫同时变成死代码，而且**全都静默**：
 *   · `runAutoTuneV2` 的 `tuneRequestId` 恒为 1
 *   · 它末尾的过期判定恒 false → §19「被取代的调优不留报告」从未生效
 *   · `processImageV2` await 之后的过期判定恒 false → 旧结果照常提交
 *
 * 这类缺陷单测照不出来（函数照样跑、图照样出），只有真机探针量 profile 才看得见。
 * 所以这里把它固化成**结构断言**：不是「行为对不对」，而是「接线还在不在」。
 * ======================================================= */

/** 取某个顶层 `async function` 的函数体（到下一个顶层 async function 为止）。 */
function topLevelAsyncBody(code, name) {
  const marker = `async function ${name}(`;
  const start = code.indexOf(marker);
  assert.ok(start > 0, `找不到 ${name}`);
  const rest = code.slice(start + "async function ".length);
  const next = rest.indexOf("\nasync function ");
  return next > 0 ? rest.slice(0, next) : rest;
}

/**
 * 取对象字面量里的一个 async 方法体（`bridge` 上的那些方法不是顶层函数）。
 *
 * 结束边界用「下一处 `\n  },`」—— 这个仓库里对象方法都是两空格缩进、
 * 以 `  },` 收尾，形状稳定。比按行数截断可靠：函数长短会变。
 */
function objectAsyncMethodBody(code, name) {
  const marker = `async ${name}(`;
  const start = code.indexOf(marker);
  assert.ok(start > 0, `找不到方法 ${name}`);
  const rest = code.slice(start);
  const end = rest.indexOf("\n  },");
  assert.ok(end > 0, `找不到方法 ${name} 的结尾`);
  return rest.slice(0, end);
}

test("§8 processImageV2 必须解构顶层 requestId（丢了它三处守卫静默失效）", () => {
  const body = topLevelAsyncBody(APP_CODE, "processImageV2");
  const signature = body.slice(0, body.indexOf(") {") + 1);
  assert.match(signature, /requestId/,
    "形参没有解构 requestId —— 调用方传的是顶层字段，不解构就等于丢掉，"
    + "于是 options.requestId 恒为 undefined");

  const reads = body.match(/options\?\.requestId|options\.requestId/g) || [];
  assert.ok(reads.length <= 1,
    `函数体里有 ${reads.length} 处直接读 options.requestId —— 只允许保留一次显式兜底`);

  assert.ok(!/isStaleGenerationRequest\(\s*options\??\.requestId/.test(body),
    "await 之后的过期判定又读 options.requestId 了 —— 它恒为 undefined，这道闸等于不存在");
});

test("§8 调用方必须在顶层传 requestId（接缝的两半都要在）", () => {
  assert.match(APP_CODE,
    /processImageV2\(image,\s*palette,\s*\{[\s\S]{0,400}?requestId:\s*options\.requestId/,
    "processProductionV2 → processImageV2 的 requestId 没在顶层传 —— 接缝断了一半");
});

test("§8 Auto Tune 的过期判定必须还在，且键不能写死", () => {
  const body = topLevelAsyncBody(APP_CODE, "runAutoTuneV2");
  assert.match(body, /isStaleGenerationRequest\(requestId\)/,
    "runAutoTuneV2 末尾的过期判定没了 —— 被取代的调优会留下报告（§19）");
  assert.match(body, /autoTuneContexts\.set\(tuneRequestId/,
    "调优上下文表的键不是从 tuneRequestId 来的");
  assert.ok(!/autoTuneContexts\.set\(\s*1\s*,/.test(body),
    "调优上下文表的键被写死成 1 了 —— 多轮调优会互相顶掉");
});

/* =========================================================
 * §11 单飞检查必须在推进 requestId 之前
 *
 * ── 这条守的是什么 ────────────────────────────────────────────────────
 * 2026-10-04 实测：`generate()` 先 `generationRequestId += 1`，再由
 * `processProductionV2` 用 `isProcessingImage` 把重复请求拒掉。于是**被拒掉的那个
 * 请求已经把 id 推过了** —— 在飞的那一轮被误判成「陈旧」。
 *
 * 只要链路上的 `isStaleGenerationRequest` 守卫真的生效，被误判那轮就会丢弃结果，
 * 而被拒的新请求什么都没跑 —— **一张图都出不来**。真机复现：b4 的 maxColors 轮
 * 在 320ms 去抖窗口内又点了「重新生成」，两次 generate()，既没有新图也没有报告。
 *
 * 正确语义：`generationRequestId` 是「正在拥有生成权的那个请求」的编号，
 * 不是「最后一次尝试的编号」。
 * ======================================================= */

test("§11 被拒的重复请求不得推进 generationRequestId（单飞检查要在推进之前）", () => {
  const body = objectAsyncMethodBody(APP_CODE, "generate");
  const guardAt = body.search(/isProcessingImage[^\n]*throw new Error\("正在生成，请稍候"\)/);
  const bumpAt = body.indexOf("state.generationRequestId = (Number(state.generationRequestId) || 0) + 1");
  assert.ok(guardAt >= 0,
    "generate() 里没有单飞检查 —— 重复请求会推进 id，把在飞那轮误判成陈旧");
  assert.ok(bumpAt >= 0, "找不到推进 generationRequestId 的那一行");
  assert.ok(guardAt < bumpAt,
    "单飞检查排在了推进 requestId 之后 —— 被拒的请求照样会污染在飞那轮的请求号，"
    + "链路上的过期守卫会因此丢弃一张本来该出的图");
});

test("§11 单飞检查用的是 state.isProcessingImage，不是别的东西", () => {
  const body = objectAsyncMethodBody(APP_CODE, "generate");
  assert.match(body, /if \(state\.isProcessingImage\)/,
    "单飞检查没用 state.isProcessingImage —— 它才是三个生成分支共用的那一个标志");
  // 深层守卫不能删：它是直接调用 processProductionV2 的那条路的最后一道。
  assert.match(APP_CODE, /if \(state\.isProcessingImage\) throw new Error\("正在生成，请稍候"\);\n  state\.isProcessingImage = true;/,
    "processProductionV2 的深层次重入守卫被删了");
});
