/**
 * core/grid-stats.js
 * ─────────────────────────────────────────────────────────────
 * 矩阵统计的小工具。上游对应物是 `generatePattern` 尾部的内联统计
 * （app.js:466–474）与 `updateStats()`（app.js:584–590）：
 *
 * ```js
 * const usedColors = new Set();
 * let totalBeads = 0;
 * state.beadData.flat().forEach(id => { if (id) { usedColors.add(id); totalBeads++; } });
 * ```
 *
 * 上游同时维护 `gridData`（hex）与 `beadData`（豆号）两个矩阵，统计走的是豆号那份。
 * 本模块只认**单矩阵 + 色号**（与 libms / bgs 的单一事实源一致）。
 *
 * 数字格式纪律：**颗数 / 色数一律不带千分位**（libms 既有约定）；
 * 这里只产出数字，格式化交给展示层。
 */

import { cellCode, connectedSameColor } from "./metrics.js";

/**
 * 统计一个矩阵用到的色号与颗数。
 *
 * @param {Array} matrix 单元为 `null` / 色号字符串 / `{code}`
 * @param {{includeUsage?:boolean, includeComponents?:boolean}} [options]
 * @returns {{beadCount:number, emptyCount:number, cellCount:number,
 *            usedColors:string[], usage:Object, dominant:object|null,
 *            components?:number, largestComponent?:number}}
 */
export function countGridColors(matrix, options = {}) {
  const rows = Array.isArray(matrix) ? matrix.length : 0;
  const cols = rows ? Math.max(...matrix.map((row) => (Array.isArray(row) ? row.length : 0))) : 0;

  const usage = {};
  const usedSet = new Set();
  let beadCount = 0;
  let emptyCount = 0;

  for (let y = 0; y < rows; y++) {
    const row = Array.isArray(matrix[y]) ? matrix[y] : [];
    for (let x = 0; x < cols; x++) {
      const code = cellCode(row[x]);
      if (code == null) { emptyCount++; continue; }
      beadCount++;
      usedSet.add(code);
      if (options.includeUsage !== false) usage[code] = (usage[code] || 0) + 1;
    }
  }

  let dominant = null;
  for (const [code, count] of Object.entries(usage)) {
    if (!dominant || count > dominant.count) dominant = { code, count };
  }

  const result = {
    beadCount,
    emptyCount,
    cellCount: rows * cols,
    cols,
    rows,
    usedColors: [...usedSet].sort(),
    usage,
    dominant,
  };

  if (options.includeComponents) {
    const codes = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      const source = Array.isArray(matrix[y]) ? matrix[y] : [];
      for (let x = 0; x < cols; x++) row.push(cellCode(source[x]));
      codes.push(row);
    }
    const components = connectedSameColor(codes, cols, rows);
    result.components = components.length;
    result.largestComponent = components.reduce((max, component) => Math.max(max, component.size), 0);
  }

  return result;
}

/** 两个矩阵的逐格差异。用于「新算法有没有偷偷替换结果」这类核查。 */
export function diffGrids(a, b) {
  const rows = Math.max(a.length, b.length);
  const cols = Math.max(a[0]?.length || 0, b[0]?.length || 0);
  let changed = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ca = cellCode(a[y]?.[x]);
      const cb = cellCode(b[y]?.[x]);
      if (ca === cb) continue;
      changed++;
      if (ca != null && cb == null) onlyA++;
      else if (ca == null && cb != null) onlyB++;
    }
  }
  return { rows, cols, totalCells: rows * cols, changed, changedRatio: rows * cols ? changed / (rows * cols) : 0, onlyA, onlyB };
}
