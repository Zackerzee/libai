/**
 * 横向「用色统计」条的数据整形（Stage B1 §12）。
 *
 * 为什么单独成模块：排序和汇总是最容易算错、又最难靠肉眼发现的部分
 * （「数量↑」把 0 颗的排最前、「共 X 色」把空格算进去…）。
 * 放在纯函数里，node --test 能直接断言；UI 只负责画。
 *
 * 零 DOM、零状态 —— 输入是 palette-usage 的实时索引，输出是可直接渲染的数组。
 */

import { paletteIdOf } from "./palette-identity.js";

/** 支持的排序方式。 */
export const USAGE_SORT_MODES = Object.freeze(["count-desc", "count-asc", "code"]);

/** 默认「数量↓」—— 核对材料时先看用量最大的。 */
export const USAGE_SORT_DEFAULT = "count-desc";

export function isUsageSortMode(value) {
  return USAGE_SORT_MODES.includes(value);
}

/** 色号比较器：数字段按数值比，所以 2 < 10（localeCompare 默认会给出 10 < 2）。 */
const byCode = (a, b) => a.code.localeCompare(b.code, "zh-CN", { numeric: true });

/** 排序（不改原数组）。无法识别的模式回落默认，绝不返回乱序。 */
export function sortUsageEntries(entries, mode = USAGE_SORT_DEFAULT) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (mode === "count-asc") list.sort((a, b) => a.count - b.count || byCode(a, b));
  else if (mode === "code") list.sort(byCode);
  else list.sort((a, b) => b.count - a.count || byCode(a, b));
  return list;
}

/**
 * 由「paletteId → 颗数」索引 + 色板，构造统计条目。
 *
 * @param {Map<string, number>} counts  palette-usage 的索引（或它的 count 投影）
 * @param {Array} palette              当前色板的颜色条目（带 code / hex / group）
 * @param {object} options
 *   sort    排序模式
 *   resolve 色板里查不到该 paletteId 时的兜底解析（换品牌后旧 id 会落到这里）
 *
 * 约定：**颗数为 0 或非正数的颜色不出现**。统计条回答的是「这幅图上用了什么」，
 * 把 0 颗的色号列出来只会让人以为用到了。
 */
export function buildUsageEntries(counts, palette, { sort = USAGE_SORT_DEFAULT, resolve = null } = {}) {
  const list = Array.isArray(palette) ? palette : [];
  const byId = new Map(list.map((color) => [paletteIdOf(color), color]));
  const entries = [];
  const source = counts instanceof Map ? counts : new Map(Object.entries(counts || {}));
  for (const [paletteId, rawCount] of source) {
    const count = Number(rawCount) || 0;
    if (count <= 0) continue;
    const color = byId.get(paletteId) || (typeof resolve === "function" ? resolve(paletteId) : null);
    entries.push({
      paletteId,
      count,
      code: color?.code ? String(color.code) : String(paletteId),
      hex: color?.hex || "#cccccc",
    });
  }
  return sortUsageEntries(entries, sort);
}

/** 汇总：色数与总颗数。 */
export function summarizeUsage(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    colorCount: list.length,
    beadCount: list.reduce((sum, entry) => sum + (Number(entry.count) || 0), 0),
  };
}

/** 汇总文案。空图纸给「尚未生成」，而不是「共 0 色 · 0 颗」。 */
export function formatUsageSummary(entries) {
  const { colorCount, beadCount } = summarizeUsage(entries);
  if (!colorCount) return "尚未生成";
  return `共 ${colorCount} 色 · ${beadCount.toLocaleString("zh-CN", { useGrouping: false })} 颗`;
}

/**
 * 当前选中的颜色是否还在图上。被全局替换掉之后就该收起操作条，
 * 否则会留下一个指向已消失颜色的悬空操作面板。
 */
export function isUsageEntryPresent(entries, paletteId) {
  if (paletteId == null || String(paletteId) === "") return false;
  return (Array.isArray(entries) ? entries : []).some((entry) => entry.paletteId === paletteId);
}
