/**
 * Stage C0 §6 —— 颜色数量的显示层：0 不再直接甩给用户。
 *
 * 内部协议没变：`maxColors === 0` 仍然表示「不设上限，由算法自行决定」
 * （见 smart-preprocessing/generation-engine-v2.test.mjs 的
 * 「maxColors=0 means AUTO」）。变的是**显示层**：
 * 以前只有一个数字框写着「最大颜色数 / 0 = 自动」，用户得先理解 0 是魔法值。
 * 现在有档位按钮 + 读数说人话。
 *
 * 这个文件同时守两条边界：
 *   ① 生成侧一条限制都没新增（区间仍是 0..221，写入路径仍只有 setState 一条）；
 *   ② 引擎侧的 0 语义不许被这次改动动到。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../ui/generation-panel.js", import.meta.url), "utf8");
const engine = readFileSync(new URL("../smart-preprocessing/generation-engine-v2.test.mjs", import.meta.url), "utf8");

test("§6 「不限制」是一个真实档位，值就是内部哨兵 0", () => {
  // 档位表是 `[["0", "不限制"], ["8", "8"], …].map(([value, label]) => …)`
  assert.match(panel, /\[\s*\["0", "不限制"\]/, "「不限制」档必须存在且值为 0");
  for (const value of ["8", "16", "24", "38", "64"]) {
    assert.match(panel, new RegExp(`\\["${value}", "${value}"\\]`), `缺少档位 ${value}`);
  }
  assert.match(panel, /data-color-cap="\$\{value\}">\$\{label\}</, "档位按钮必须由这张表渲染出来");
});

test("§6 档位按钮走同一条 setState，不新增旁路状态", () => {
  assert.match(panel, /const colorCap = event\.target\.closest\("\[data-color-cap\]"\)/);
  assert.match(panel, /this\.setState\(\{ maxColors: Number\(colorCap\.dataset\.colorCap\) \|\| 0 \}\)/);
  // 档位不许自己写 state 字段
  assert.doesNotMatch(panel, /this\.state\.colorCap/, "档位不该有自己的 state 字段");
  assert.doesNotMatch(panel, /data-color-cap[\s\S]{0,200}this\.onChange\(/, "档位不许绕过 setState 直接 emit");
});

test("§6 读数把 0 翻译成人话，且高亮当前档位", () => {
  assert.match(panel, /id="ws-color-cap-readout"/);
  assert.match(panel, /capValue > 0\s*\n?\s*\? `最多 \$\{capValue\} 色`/);
  assert.match(panel, /: "不限制（由算法按画面自行决定）"/);
  assert.match(panel, /\(Number\(button\.dataset\.colorCap\) \|\| 0\) === capValue/);
});

test("§6 标题从「最大颜色数」改成「颜色数量」，措辞不再要求用户理解 0", () => {
  assert.match(panel, /<strong>颜色数量<\/strong>/);
  assert.doesNotMatch(panel, /最大颜色数/, "旧标题必须消失");
  assert.doesNotMatch(panel, /0 = 自动/, "旧提示必须消失");
});

test("§6 数字框保留为自定义入口，取值区间**没有**被改动", () => {
  assert.match(panel, /type="number"\s*\n\s*min="0"\s*\n\s*max="221"/, "区间必须仍是 0..221");
  assert.match(panel, /data-step-field="maxColors"/, "步进按钮必须保留（既有探针按它驱动）");
  assert.match(panel, /data-field="maxColors"/, "数字框必须保留（既有探针按它驱动）");
  assert.match(panel, /Math\.max\(\s*\n?\s*0,\s*\n?\s*Number\(this\.state\[field\]\) \+ step/, "步进下限仍是 0，没有被悄悄抬到 1");
});

test("§6 生成侧一条限制都没新增：0 语义仍然是「不设上限」", () => {
  // 引擎侧回归（这些断言本来就在 generation-engine-v2.test.mjs 里，这里做交叉引用）
  assert.match(engine, /maxColors=0 means AUTO \(no forced cap\) but cleanup still runs/);
  assert.match(engine, /DEFAULT_GENERATION_V2_CONFIG\.maxColors, 0/);
  // 面板只是把值原样发出去，不许在这里做任何 clamp / 兜底
  assert.doesNotMatch(panel, /Math\.(min|max)\(\s*1,\s*Number\(settings\.maxColors\)/, "面板不许把 0 抬成 1");
  const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
  assert.match(workspace, /if \(Number\(settings\.maxColors\) !== get\(\)\.palette\.maxColors\) palettes\.setMaxColors\(Number\(settings\.maxColors\) \|\| 0\)/);
});
