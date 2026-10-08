import { selectionContains, selectionCells, outerOutline } from "./selection-service.js";
import { shapeCells, expandBrush, lineCells } from "./shapes-service.js";
import { cleanPixelPerfectPath } from "./pixel-perfect-stroke.js";
import { createCellCommand, createStructureCommand, isEditorCommand } from "./editor-command.js";
import { symmetryBrushCells } from "./symmetry-service.js";
import { paletteIdOf } from "./palette-identity.js";
import { getPaletteIndex, inspectPaletteCell } from "./palette-usage.js";
import { findSimilarPaletteColors, detectRarePaletteColors } from "./palette-diagnostics.js";
import { buildColorComponents } from "./structural-diagnostics.js";
import { computeOuterOutline } from "./outline-service.js";
import { stepDarker, stepLighter } from "./color-ramp-service.js";

const cloneGrid = (grid) => grid.map((row) => row.map((color) => (color ? { ...color, rgb: Array.isArray(color.rgb) ? [...color.rgb] : color.rgb } : null)));

// 顺时针 turns × 90°。奇数圈会交换宽高，因此返回的矩阵长宽与输入不同。
export function rotateGrid(grid, turns) {
  const height = grid.length, width = grid[0]?.length || 0;
  const clone = (color) => (color ? { ...color, rgb: Array.isArray(color.rgb) ? [...color.rgb] : color.rgb } : null);
  if (!height || !width) return cloneGrid(grid);
  if (turns === 2) {
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => clone(grid[height - 1 - y][width - 1 - x])));
  }
  if (turns === 1) {
    return Array.from({ length: width }, (_, y) => Array.from({ length: height }, (_, x) => clone(grid[height - 1 - x][y])));
  }
  return Array.from({ length: width }, (_, y) => Array.from({ length: height }, (_, x) => clone(grid[x][width - 1 - y])));
}

export function createEditorService(bridge, { limit = 100, onHistoryChange = () => {} } = {}) {
  const undoStack = [], redoStack = [];
  const clone = (color) => color ? { ...color, rgb: Array.isArray(color.rgb) ? [...color.rgb] : color.rgb } : null;
  const same = (a, b) => paletteIdOf(a) === paletteIdOf(b);
  const result = () => bridge.getResult();
  const colorFor = (identity) => bridge.getPaletteColors().find((color) => paletteIdOf(color) === String(identity || "") || color.code.toUpperCase() === String(identity || "").trim().toUpperCase()) || null;
  let stroke = null;
  // 网格修改后才失效，普通鼠标移动或 UI 重绘直接复用统计结果。
  let paletteIndex = null, selectionUsageCache = null;
  const invalidateUsageCounts = () => { paletteIndex = null; selectionUsageCache = null; };
  const currentPaletteIndex = () => paletteIndex || (paletteIndex = getPaletteIndex(result().grid));
  const currentUsageCounts = () => new Map([...currentPaletteIndex()].map(([paletteId, entry]) => [paletteId, entry.count]));
  // 剪贴板存「相对选区左上角的偏移」，粘贴时把选区左上角对齐到目标格。
  // 空豆也一并入板（矩形选区＝真正的图章），因此粘贴会覆盖目标区域的空白格。
  let clipboard = null;
  // 豆格类历史只在画布宽高不变时有效；结构类历史自带整幅快照，永远有效。
  // 宽高一旦改变，按旧宽高记录的豆格动作坐标已不可信，必须剔除而不是硬套。
  const pruneFor = (width, height) => {
    const valid = (entry) => entry.kind !== "cells" || (entry.width === width && entry.height === height);
    for (let index = undoStack.length - 1; index >= 0; index -= 1) if (!valid(undoStack[index])) undoStack.splice(index, 1);
    for (let index = redoStack.length - 1; index >= 0; index -= 1) if (!valid(redoStack[index])) redoStack.splice(index, 1);
  };
  const record = (command) => {
    if (!isEditorCommand(command)) return false;
    undoStack.push(command);
    if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
    onHistoryChange();
    return true;
  };
  const run = (command) => {
    if (!isEditorCommand(command) || !command.execute()) return false;
    invalidateUsageCounts();
    record(command);
    if (command.kind === "structure") pruneFor(command.width, command.height);
    return true;
  };
  const cellCommand = (type, label, changes) => createCellCommand(bridge, {
    type, label, changes, width: result().width, height: result().height,
  });
  const commit = (type, label, changes) => !changes.length ? false : run(cellCommand(type, label, changes));
  // 「格 → 目标颜色」的显式映射是各种编辑动作的公共出口：
  // 画笔、形状、粘贴、移动都能表达成它，于是撤销/重做只需处理一种历史载荷。
  const changesFromMap = (map) => {
    const changes = [];
    for (const [id, after] of map) {
      const [x, y] = id.split(",").map(Number);
      if (!result().grid[y] || x < 0 || x >= result().grid[y].length) continue;
      const before = bridge.getCell(x, y);
      if (same(before, after)) continue;
      changes.push({ x, y, before: clone(before), after: clone(after) });
    }
    return changes;
  };
  const changesFor = (cells, after) => {
    const map = new Map();
    for (const { x, y } of cells) map.set(`${x},${y}`, clone(after));
    return changesFromMap(map);
  };
  // 选区 → 格列表。宽高取当前图纸，越界格由 selectionCells 自行裁剪。
  const selectedCells = (selection) => selection ? selectionCells(selection, result().width, result().height) : [];
  const shapeLabel = (kind) => ({ line: "直线", rect: "矩形", ellipse: "圆形" }[kind] || kind);
  // 形状与笔宽的合成只写一份：预览与提交都走它，保证「所见即所得」。
  const shapePlan = (kind, start, end, { filled = false, size = 1, shape = "round" } = {}) => {
    const cells = shapeCells(kind, start, end, { filled });
    return size > 1 ? expandBrush(cells, size, shape) : cells;
  };
  const api = {
    getCell: (x, y) => bridge.getCell(x, y),
    getPaletteColors: () => bridge.getPaletteColors(),
    getPaletteUsageCounts: currentUsageCounts,
    getUsedPaletteColor(identity) {
      return currentPaletteIndex().get(String(identity || ""))?.color || colorFor(identity);
    },
    getColorUsage(identity) {
      const key = paletteIdOf(colorFor(identity)) || String(identity || "");
      return currentPaletteIndex().get(key)?.count || 0;
    },
    inspectCell(x, y) { return inspectPaletteCell(result().grid, x, y, currentUsageCounts()); },
    getSelectionPaletteUsage(selection) {
      if (!selection) return new Map();
      if (selectionUsageCache?.selection === selection) return new Map(selectionUsageCache.usage);
      const usage = new Map();
      for (const { x, y } of selectedCells(selection)) {
        const paletteId = paletteIdOf(bridge.getCell(x, y));
        if (paletteId) usage.set(paletteId, (usage.get(paletteId) || 0) + 1);
      }
      selectionUsageCache = { selection, usage };
      return new Map(usage);
    },
    findSimilarPaletteColors(paletteId, options) { return findSimilarPaletteColors(bridge.getPaletteColors(), paletteId, options); },
    detectRarePaletteColors(options) { return detectRarePaletteColors(currentPaletteIndex(), options); },
    planOutline({ sourceMode="component", selectedCell=null, selectedPaletteId=null, selection=null, thickness=1, connectivity=4, includeHoles=false }={}) {
      const grid=result().grid; let sourceCells=[];
      if(sourceMode==="selection") sourceCells=selectedCells(selection).filter(({x,y})=>grid[y]?.[x]);
      else if(sourceMode==="palette") grid.forEach((row,y)=>row.forEach((color,x)=>{if(paletteIdOf(color)===selectedPaletteId)sourceCells.push({x,y});}));
      else if(selectedCell){const index=buildColorComponents(grid,{connectivity:4});const id=index.cellToComponent.get(`${selectedCell.x},${selectedCell.y}`);sourceCells=index.components[id]?.cells.map(c=>({...c}))||[];}
      return computeOuterOutline(sourceCells,grid,{thickness,connectivity,includeHoles});
    },
    applyOutlinePlan(plan, code) {
      const after=colorFor(code); if(!after||!plan?.outlineCells?.length)return false;
      return commit("OUTLINE",`结构描边：${after.code} · ${plan.outlineCells.length} 颗`,changesFor(plan.outlineCells,after));
    },
    invalidateUsageCounts,
    resolveColor: colorFor,
    setCellColor(x, y, code) {
      const before = bridge.getCell(x, y), after = colorFor(code);
      if (!after) return false;
      return commit("CELL_COLOR_CHANGE", `单豆：${before?.code || "空白"} → ${after.code}`, changesFor([{ x, y }], after));
    },
    replaceColor(fromPaletteId, toPaletteId, selection = null) {
      const after = colorFor(toPaletteId);
      const fromIdentity = paletteIdOf(colorFor(fromPaletteId)) || String(fromPaletteId);
      if (!after || fromIdentity === paletteIdOf(after)) return false;
      const changes = [];
      result().grid.forEach((row, y) => row.forEach((before, x) => {
        if (paletteIdOf(before) !== fromIdentity) return;
        if (selection && !selectionContains(selection, x, y)) return;
        changes.push({ x, y, before: clone(before), after: clone(after) });
      }));
      return commit(selection ? "REGION_CHANGE" : "COLOR_REPLACE", `替换：${colorFor(fromPaletteId)?.code || fromPaletteId} → ${after.code}`, changes);
    },
    replaceColorInSelection(fromCode, toCode, selection) { return this.replaceColor(fromCode, toCode, selection); },
    recolorSelection(selection, toPaletteId) {
      const after = colorFor(toPaletteId);
      if (!selection || !after) return false;
      const cells = selectedCells(selection).filter(({ x, y }) => bridge.getCell(x, y) != null);
      return commit("REGION_CHANGE", `选区全部换色 → ${after.code}`, changesFor(cells, after));
    },
    mergePaletteColors(sourcePaletteIds, targetPaletteId) {
      const after=colorFor(targetPaletteId), targetId=paletteIdOf(after);
      const sources=new Set((sourcePaletteIds||[]).map((id)=>paletteIdOf(colorFor(id))||String(id)).filter((id)=>id&&id!==targetId));
      if(!after||!sources.size)return false;
      const changes=[];
      result().grid.forEach((row,y)=>row.forEach((before,x)=>{if(sources.has(paletteIdOf(before)))changes.push({x,y,before:clone(before),after:clone(after)});}));
      return commit("COLOR_MERGE",`合并 ${sources.size} 种颜色 → ${after.code}：${changes.length} 颗`,changes);
    },
    applyRepairChanges(repairs, label = "采用修复建议") {
      const map = new Map();
      for (const repair of repairs || []) {
        const after = colorFor(repair.targetPaletteId);
        if (!after) continue;
        for (const { x, y } of repair.cells || [repair]) {
          const id = `${x},${y}`, existing = map.get(id);
          if (existing && paletteIdOf(existing) !== paletteIdOf(after)) return false;
          const before = bridge.getCell(x, y);
          if (repair.sourcePaletteId && paletteIdOf(before) !== repair.sourcePaletteId) continue;
          map.set(id, clone(after));
        }
      }
      const changes = changesFromMap(map);
      return commit("APPLY_REPAIR_SUGGESTION", `${label}：${changes.length} 颗`, changes);
    },
    applyCells(cells, code, type = "BRUSH_STROKE", label = null) {
      const color = colorFor(code); if (!color) return false;
      return commit(type, label || `画笔：${color.code}`, changesFor(cells, color));
    },
    eraseCells(cells, label = null) { const changes = changesFor(cells, null); return commit("ERASE", label || `擦除：${changes.length} 豆`, changes); },
    eraseSelection(selection) { if (!selection) return false; const { width, height } = result(); return this.eraseCells(selectionCells(selection, width, height)); },
    beginStroke(code = null, { size = 1, shape = "square", symmetry = null, pixelPerfect = false, inkMode = "normal", rampPaletteIds = [] } = {}) {
      stroke = { code, size, shape, symmetry, pixelPerfect:Boolean(pixelPerfect && size === 1), inkMode, rampPaletteIds:[...rampPaletteIds], path:[], cells:new Map(), active:new Set(), last:null };
      return true;
    },
    strokeCell(x, y) {
      if (!stroke || !result().grid[y] || x < 0 || x >= result().grid[y].length) return false;
      const shading = stroke.inkMode === "darker" || stroke.inkMode === "lighter";
      const after = stroke.code ? colorFor(stroke.code) : null;
      if (!shading && stroke.code && !after) return false;
      const segment = stroke.last ? lineCells(stroke.last.x,stroke.last.y,x,y).slice(1) : [{x,y}];
      stroke.path.push(...segment); stroke.last={x,y};
      const centers = stroke.pixelPerfect ? cleanPixelPerfectPath(stroke.path) : stroke.path;
      const desiredCells = symmetryBrushCells(centers, result().width, result().height, { size:stroke.size, shape:stroke.shape, symmetry:stroke.symmetry });
      const desired = new Set(desiredCells.filter((cell)=>result().grid[cell.y]&&cell.x>=0&&cell.x<result().grid[cell.y].length).map((cell)=>`${cell.x},${cell.y}`));
      let touched = false;
      for (const id of stroke.active) if (!desired.has(id)) {
        const original=stroke.cells.get(id); if (original) bridge.applyCellChanges([{x:original.x,y:original.y,after:clone(original.before)}],{live:true});
        stroke.active.delete(id); touched=true;
      }
      for (const cell of desiredCells) {
        const row=result().grid[cell.y]; if(!row||cell.x<0||cell.x>=row.length) continue;
        const id=`${cell.x},${cell.y}`;
        if (!stroke.cells.has(id)) {
          const before=clone(bridge.getCell(cell.x,cell.y));
          const beforeId=paletteIdOf(before);
          const targetId=shading?(stroke.inkMode==="lighter"?stepLighter(stroke.rampPaletteIds,beforeId):stepDarker(stroke.rampPaletteIds,beforeId)):null;
          const target=shading?(targetId!==beforeId?colorFor(targetId):before):after;
          stroke.cells.set(id,{x:cell.x,y:cell.y,before,after:clone(target)});
        }
        if (stroke.active.has(id)) continue;
        const original=stroke.cells.get(id); stroke.active.add(id);
        if (!same(bridge.getCell(cell.x,cell.y),original.after)) { bridge.applyCellChanges([{x:cell.x,y:cell.y,after:clone(original.after)}],{live:true}); touched=true; }
      }
      if (touched) invalidateUsageCounts();
      return touched;
    },
    endStroke() {
      if (!stroke) return false;
      const { code, cells, active, inkMode } = stroke; stroke = null;
      const changes = [...active].map((id)=>cells.get(id)).filter(({before,after})=>!same(before,after));
      if (changes.length) bridge.applyCellChanges([], { finalize: true });
      if (changes.length) invalidateUsageCounts();
      return changes.length ? record(cellCommand(
        inkMode !== "normal" ? "SHADING_STROKE" : code ? "BRUSH_STROKE" : "ERASE_STROKE",
        inkMode === "darker" ? `加深：${changes.length} 豆` : inkMode === "lighter" ? `提亮：${changes.length} 豆` : code ? `画笔：${code}` : `擦除：${changes.length} 豆`,
        changes,
      )) : false;
    },
    cancelStroke() { if (!stroke) return; bridge.applyCellChanges([...stroke.cells.values()].map(({x,y,before})=>({x,y,after:clone(before)}))); stroke = null; invalidateUsageCounts(); },
    // 形状工具：预览与提交共用 shapePlan，杜绝「预览一套、落笔另一套」。
    previewShape(kind, start, end, options = {}) { return shapePlan(kind, start, end, options); },
    applyShape(kind, start, end, code, options = {}) {
      const color = colorFor(code);
      if (!color) return false;
      const cells = shapePlan(kind, start, end, options);
      return commit("SHAPE", `形状：${shapeLabel(kind)}${options.filled ? "（实心）" : ""}`, changesFor(cells, color));
    },
    // 剪贴板与选区搬移。四者都建立在 selectedCells / changesFromMap 之上。
    copySelection(selection) {
      const cells = selectedCells(selection);
      if (!cells.length) return false;
      const minX = Math.min(...cells.map((cell) => cell.x));
      const minY = Math.min(...cells.map((cell) => cell.y));
      const entries = cells.map(({ x, y }) => ({ dx: x - minX, dy: y - minY, color: clone(bridge.getCell(x, y)) }));
      clipboard = {
        entries,
        width: Math.max(...entries.map((entry) => entry.dx)) + 1,
        height: Math.max(...entries.map((entry) => entry.dy)) + 1,
        beads: entries.filter((entry) => entry.color).length,
      };
      return true;
    },
    cutSelection(selection) { return this.copySelection(selection) ? this.eraseSelection(selection) : false; },
    hasClipboard: () => Boolean(clipboard && clipboard.entries.length),
    getClipboard() { return clipboard ? { width: clipboard.width, height: clipboard.height, beads: clipboard.beads } : null; },
    pasteClipboard(x, y) {
      if (!clipboard) return false;
      const map = new Map();
      for (const { dx, dy, color } of clipboard.entries) map.set(`${x + dx},${y + dy}`, clone(color));
      return commit("PASTE", `粘贴：${clipboard.beads} 豆`, changesFromMap(map));
    },
    moveSelection(selection, dx, dy) {
      const cells = selectedCells(selection);
      const width = result().width, height = result().height;
      if (!cells.length || (!dx && !dy)) return false;
      const map = new Map();
      // 先清空原位置、再写入新位置。两趟都读原始网格，所以「搬走」与「搬到」合并成一步历史，
      // 撤销时整体回退，不会出现中途半截状态。
      for (const { x, y } of cells) map.set(`${x},${y}`, null);
      for (const { x, y } of cells) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        map.set(`${nx},${ny}`, clone(bridge.getCell(x, y)));
      }
      return commit("MOVE_SELECTION", `移动选区：${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy}`, changesFromMap(map));
    },
    fillAt(x, y, code) {
      const grid = result().grid, from = paletteIdOf(grid[y]?.[x]), after = colorFor(code);
      if (!grid[y] || !after || from === paletteIdOf(after)) return false;
      const seen = new Set([`${x},${y}`]), queue = [{x,y}], cells = [];
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        if (paletteIdOf(grid[current.y]?.[current.x]) !== from) continue;
        cells.push(current);
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = current.x + dx, ny = current.y + dy, id = `${nx},${ny}`;
          if (grid[ny] && nx >= 0 && nx < grid[ny].length && !seen.has(id)) { seen.add(id); queue.push({x:nx,y:ny}); }
        }
      }
      return commit("FLOOD_FILL", `填充：${from || "空白"} → ${after.code}`, changesFor(cells, after));
    },
    outline(selection, code, diagonal = false) {
      if (!selection) return false;
      const { width, height } = result(), after = colorFor(code);
      if (!after) return false;
      return commit("OUTLINE", `描边：${after.code}`, changesFor(outerOutline(selection, width, height, diagonal), after));
    },
    flip(axis) {
      const grid = result().grid, { width, height } = result();
      if (!grid.length || !["horizontal","vertical"].includes(axis)) return false;
      const changes = [];
      grid.forEach((row,y) => row.forEach((before,x) => {
        const after = axis === "horizontal" ? grid[y][width-1-x] : grid[height-1-y][x];
        if (!same(before,after)) changes.push({x,y,before:clone(before),after:clone(after)});
      }));
      return commit(axis === "horizontal" ? "FLIP_H" : "FLIP_V", axis === "horizontal" ? "水平翻转" : "垂直翻转", changes);
    },
    rotate(quarter = 1) {
      const { grid, width, height } = result();
      if (!grid.length || !width || !height) return false;
      if (typeof bridge.replaceGridStructure !== "function") return false;
      const turns = ((Math.round(quarter) % 4) + 4) % 4;
      if (!turns) return false;
      // 结构级动作必须整幅快照：90°/270° 会交换宽高，豆格级增量历史无法表达。
      const before = { grid: cloneGrid(grid), width, height };
      const after = {
        grid: rotateGrid(grid, turns),
        width: turns === 2 ? width : height,
        height: turns === 2 ? height : width,
      };
      return run(createStructureCommand(bridge, {
        type: turns === 1 ? "ROTATE_CW" : turns === 3 ? "ROTATE_CCW" : "ROTATE_180",
        label: turns === 1 ? "顺时针旋转 90°" : turns === 3 ? "逆时针旋转 90°" : "旋转 180°",
        before,
        after,
      }));
    },
    canRotate: () => typeof bridge.replaceGridStructure === "function",
    executeCommand(command) { return run(command); },
    getHistory() { return undoStack.map(({ type, label, affectedCells }) => ({ type, label, count: affectedCells })); },
    undo() {
      const command = undoStack.pop(); if (!command) return false;
      if (!command.undo()) { undoStack.push(command); return false; }
      invalidateUsageCounts();
      const { width, height } = result();
      pruneFor(width, height);
      redoStack.push(command); onHistoryChange(); return true;
    },
    redo() {
      const command = redoStack.pop(); if (!command) return false;
      if (!command.redo()) { redoStack.push(command); return false; }
      invalidateUsageCounts();
      const { width, height } = result();
      pruneFor(width, height);
      undoStack.push(command); onHistoryChange(); return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clearHistory() { undoStack.length = 0; redoStack.length = 0; stroke = null; invalidateUsageCounts(); onHistoryChange(); },
    historyDepth: () => ({ undo: undoStack.length, redo: redoStack.length }),
  };
  return api;
}
