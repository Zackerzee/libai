/**
 * 色卡「系列」的唯一真源。
 *
 * 为什么需要它：
 *   系列此前由 ui/workspace.js 用 `code.match(/^[A-Z]+/)` 现猜。
 *   猜不出前缀的品牌直接变成「零系列」—— 盼盼 / 咪小窝的官方色号是纯数字
 *   （"65" / "29" / "138"），正则返回 null，于是它们 7 个官方中文系列
 *   （黄 / 橙棕 / 红粉 / 灰白黑 / 紫 / 绿 / 青蓝）在 UI 上完全消失。
 *   而 registry（smart-preprocessing/palette-brands.mjs）本来就带 group 元数据，
 *   只是 app.js 的 buildPaletteVariant 搬运时把它丢了。
 *
 * 优先级（从强到弱）：
 *   1. 显式元数据 entry.group / entry.series —— 官方色卡的系列划分，最高权威；
 *   2. 色号字母前缀 —— 仅在没有元数据时作为推导；
 *   3. 无系列 —— 两者都没有时返回空串，UI 不显示系列行，
 *      而不是伪造一个「其它」把颜色塞进去。
 *
 * 禁止：把 `/^[A-Z]+/` 当成唯一 series 逻辑。
 */

/** 「无系列」的规范表示。空串而非 null —— 便于直接当 key 与 dataset 值。 */
export const PALETTE_SERIES_NONE = "";

/** 全部系列的规范表示（UI 上的「全部」筛选片）。 */
export const PALETTE_SERIES_ALL = "__all__";

/**
 * 色号规范化：去掉字母前缀后数字段的前导零，并转大写。
 * 目的是让「同一个色号的不同写法」折叠成同一个 key：
 *   C01 → C1 ； H07 → H7 ； MA1 → MA1 ； GB1 → GB1 ； 65 → 65
 * 这样搜索框里打 H7 或 H07 都能命中（placeholder 承诺的就是这个）。
 *
 * 注意：纯数字色号（盼盼 / 咪小窝）不会被破坏 —— `[A-Z]*` 匹配空串后，
 * `0+(\d+)` 要求至少还有一个数字，所以 "65" 原样返回。
 */
export function normalizePaletteCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/^([A-Z]*)0+(\d+)$/, "$1$2");
}

/** 色号是否完全没有字母前缀（盼盼 / 咪小窝这类官方数字色号）。 */
export function isNumericPaletteCode(value) {
  const text = String(value ?? "").trim();
  return text !== "" && /^\d+$/.test(text);
}

/**
 * 从色号推导系列：取开头的连续字母段。
 * 纯数字色号返回空串（而不是 null 或 "0"）。
 */
export function deriveSeriesFromCode(code) {
  const text = String(code ?? "").trim();
  if (!text) return PALETTE_SERIES_NONE;
  const matched = /^([A-Za-z]+)/.exec(text);
  return matched ? matched[1].toUpperCase() : PALETTE_SERIES_NONE;
}

/**
 * 取一个色条目的系列。元数据优先，色号推导兜底。
 * 返回 PALETTE_SERIES_NONE（空串）表示「这个颜色没有系列」。
 */
export function getPaletteSeries(entry) {
  if (!entry || typeof entry !== "object") return PALETTE_SERIES_NONE;
  for (const field of ["group", "series"]) {
    const value = entry[field];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return deriveSeriesFromCode(entry.code);
}

/** 系列 key 的展示名。系列 key 本身就是官方叫法（"黄" / "MA" / "GB"）。 */
export function getPaletteSeriesLabel(series) {
  const key = typeof series === "string" ? series : "";
  return key === PALETTE_SERIES_NONE ? "全部" : key;
}

/**
 * 按系列切分色板，**保持首次出现顺序**。
 * 顺序即官方色卡顺序（优肯 418 = C,CE,CG,CP,CT,MA..MM；盼盼 = 黄,橙棕,红粉,灰白黑,紫,绿,青蓝），
 * 所以这里绝不排序 —— 排序会打乱用户认色卡的习惯。
 */
export function groupColorsBySeries(colors) {
  const groups = new Map();
  for (const color of Array.isArray(colors) ? colors : []) {
    if (!color) continue;
    const key = getPaletteSeries(color);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(color);
  }
  return groups;
}

/**
 * 列出色板里真实存在的系列（**不含**「无系列」与「全部」）。
 * 返回 [{ key, label, count }]，首次出现顺序。
 *
 * 为什么要排除「无系列」：它的 label 也是「全部」，如果放进来会出现两个叫
 * 「全部」的筛选片，用户点哪个都说不清。无系列的颜色只在「全部」视图里出现。
 * 实测当前 8 个外源品牌的每一色都带 group，MARD 291 色也全部有字母前缀，
 * 所以这条分支现在走不到 —— 但它是防未来数据退化的护栏，不是装饰。
 */
export function listPaletteSeries(colors) {
  return [...groupColorsBySeries(colors)]
    .filter(([key]) => key !== PALETTE_SERIES_NONE)
    .map(([key, list]) => ({ key, label: getPaletteSeriesLabel(key), count: list.length }));
}

/**
 * 色板是否具备可用的系列维度。
 * 没有任何具名系列时返回 false —— 此时 UI 不该渲染系列筛选行。
 */
export function hasPaletteSeries(colors) {
  return listPaletteSeries(colors).length > 0;
}

/**
 * 色板筛选：系列 + 搜索词。两个条件是与关系。
 *   series: PALETTE_SERIES_ALL / undefined / null → 不按系列过滤
 *   query : 空 → 不按搜索词过滤；否则先比规范化色号，再比原始色号与名称
 * 保持输入顺序。
 */
export function filterPaletteColors(colors, { series = PALETTE_SERIES_ALL, query = "" } = {}) {
  const list = Array.isArray(colors) ? colors : [];
  const bySeries = !series || series === PALETTE_SERIES_ALL
    ? list
    : list.filter((color) => getPaletteSeries(color) === series);
  const raw = String(query ?? "").trim();
  if (!raw) return bySeries.slice();
  const normalized = normalizePaletteCode(raw);
  const upper = raw.toUpperCase();
  return bySeries.filter((color) => {
    if (!color) return false;
    if (normalizePaletteCode(color.code).includes(normalized)) return true;
    if (String(color.code ?? "").toUpperCase().includes(upper)) return true;
    const name = String(color.name ?? "").toUpperCase();
    return name !== "" && name.includes(upper);
  });
}

/**
 * 系列的诊断快照，给测试与验收用。
 * 有了它，「盼盼有没有 7 个中文系列」是一件可断言的事，而不是靠肉眼看截图。
 */
export function describePaletteSeries(colors) {
  const list = listPaletteSeries(colors);
  const groups = groupColorsBySeries(colors);
  return {
    total: Array.isArray(colors) ? colors.length : 0,
    hasSeries: hasPaletteSeries(colors),
    seriesCount: list.length,
    series: list.map((entry) => ({ ...entry })),
    unassigned: groups.get(PALETTE_SERIES_NONE)?.length || 0,
  };
}
