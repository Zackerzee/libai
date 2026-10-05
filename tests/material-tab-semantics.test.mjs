/**
 * Stage C0 §2 / §14 —— 「材料」Tab 的语义，以及「库存」能力的完整保留。
 *
 * §14 的原文纪律：**不要因为命名建议直接删除**。
 * 「库存」是一块真实完整的功能（库存概览 / 按当前图纸扣料 / OCR 识别外部图纸 /
 * 手工录入 / CSV 导入导出 / 缺货提醒 / 最近用豆 / 全部库存搜索 / 单色号明细与补货）。
 * 把它改名成「材料」的同时，材料面板要承担**新**语义：
 * 本作品用豆（备料口径）+ 底板数量与实物厘米数。
 *
 * 所以这个文件守三件事：
 *   ① 材料面板有新的备料口径内容；
 *   ② 库存面板的每一项能力都还在（逐条点名，防止「顺手精简」）；
 *   ③ 备料清单的排序恒定，不跟着色彩面板的用户排序跑。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const inventory = readFileSync(new URL("../ui/inventory-panel.js", import.meta.url), "utf8");

const materialPanel = workspace.slice(
  workspace.indexOf('data-ws-inspector="material"'),
  workspace.indexOf("</div>`;", workspace.indexOf('data-ws-inspector="material"')),
);

test("§2 材料面板有三节：本作品用豆 / 底板与采购 / 豆子库存", () => {
  assert.match(materialPanel, /<div class="ws-section-title">本作品用豆<\/div>/);
  assert.match(materialPanel, /<div class="ws-section-title">底板与采购<\/div>/);
  assert.match(materialPanel, /<div class="ws-section-title">豆子库存<\/div>/);
  assert.match(materialPanel, /id="ws-material-total"/);
  assert.match(materialPanel, /id="ws-material-list"/);
  assert.match(materialPanel, /id="ws-material-boards"/);
});

test("§2 备料口径：总颗数 + 逐色号颗数 + 底板数量与实物厘米数", () => {
  const fn = workspace.slice(workspace.indexOf("function renderMaterial(state) {"), workspace.indexOf("function renderPaletteDatalist()"));
  assert.ok(fn.length > 200, "找不到 renderMaterial");
  assert.match(fn, /entries\.reduce\(\(sum, entry\) => sum \+ entry\.count, 0\)/, "必须算总颗数");
  assert.match(fn, /`\$\{entries\.length\} 色 · 共 \$\{format\(beads\)\} 颗`/, "读数必须同时给色数与颗数");
  assert.match(fn, /ws-material-row/, "必须逐色号列出");
  assert.match(fn, /exportV2\.split\(\)/, "底板数量必须复用真实的分板计算，不能另写一套");
  assert.match(fn, /state\.canvas\.beadSize \/ 10/, "实物厘米数必须由豆径算出来");
  assert.match(fn, /needsSplit\s*\n?\s*\?/, "单板 / 多板两种口径都要有");
});

test("§2 备料清单恒定按数量降序，不跟着色彩面板的用户排序跑", () => {
  const fn = workspace.slice(workspace.indexOf("function renderMaterial(state) {"), workspace.indexOf("function renderPaletteDatalist()"));
  assert.match(fn, /sort: "count-desc"/, "备料清单必须写死 count-desc");
  assert.doesNotMatch(fn, /usageSort/, "不许复用跟着用户排序走的 usageEntries()");
});

test("§2 备料清单按 gridRevision + 物理尺寸做签名缓存（paint 是高频的）", () => {
  const fn = workspace.slice(workspace.indexOf("function renderMaterial(state) {"), workspace.indexOf("function renderPaletteDatalist()"));
  assert.match(fn, /if \(signature === materialSignature\) return;/);
  assert.match(fn, /const signature = `\$\{gridRevision\}\|\$\{state\.canvas\.width\}x\$\{state\.canvas\.height\}\|\$\{state\.canvas\.beadSize\}`/);
  assert.match(workspace, /renderMaterial\(state\);/);
});

test("§14 库存面板的能力逐条点名，一个都不许少", () => {
  const capabilities = [
    ["库存概览", /库存概览/],
    ["按当前图纸扣料", /按当前图纸扣料/],
    ["识别外部图纸（OCR 录入）", /识别外部图纸/],
    ["手工录入", /手工录入|手工添加|手动录入/],
    ["CSV 导出", /导出\s*CSV|exportCsv|导出.*csv/i],
    ["CSV 导入", /导入\s*CSV|importCsv|导入.*csv/i],
    ["缺货提醒", /缺货/],
    ["最近用豆", /最近用豆|最近用/],
    ["全部库存搜索", /搜索/],
    ["单色号明细", /明细/],
    ["补货", /补货/],
    ["单位", /单位/],
    ["位置", /位置/],
    ["供应商", /供应商/],
    ["备注", /备注/],
  ];
  for (const [name, pattern] of capabilities) {
    assert.match(inventory, pattern, `库存面板少了「${name}」这项能力 —— §14 明确不许因为改名顺手删功能`);
  }
});

test("§14 材料面板挂的是同一个 InventoryPanel 实例，不是另起一套", () => {
  assert.match(workspace, /const inventoryPanel = new InventoryPanel\(\{/);
  assert.match(workspace, /root: right\.querySelector\("#inventoryPanel"\)/);
  assert.match(workspace, /inventoryPanel\.mount\(\)/);
  // 库存面板只在图纸/项目状态变化时重建（这是既有的性能取舍，不能被材料面板的重建带坏）
  assert.match(workspace, /if \(patch\.status \|\| patch\.stats\) inventoryPanel\?\.render\(\)/);
});

test("§14 库存面板的注释与文档头也一并更新到「材料」语境", () => {
  // 只钉「模块头第一句把挂载位置说清楚了」这一件事。
  // 别去钉整句的措辞 —— 那种断言会在改一个字的注释时变红，然后被人顺手删掉。
  assert.match(
    inventory,
    /库存面板（挂在工作台右侧「材料」栏的最后一节）/,
    "模块头的定位说明要跟上新的 IA",
  );
  assert.match(inventory, /Stage C0 §2\/§14/, "模块头要标注这条语义变更的出处，方便日后追溯");
});
