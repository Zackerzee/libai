import { projectStore } from "../state/project-store.js?v=20260929-editor-phase8";
import { createGenerationService } from "../services/generation-service.js?v=20260918-usage2";
import { createPaletteService } from "../services/palette-service.js";
import { createExportService } from "../services/export-service.js?v=20260917-batchA";
import { createEditorService } from "../services/editor-service.js?v=20260929-editor-phase10";
import { BASE_CELL, createViewportService } from "../services/viewport-service.js?v=20260929-editor-phase3";
import { createCanvasRenderer } from "./canvas-renderer.js?v=20260929-editor-phase9";
import { rectangularSelection, sameColorSelection, connectedSelection, selectionContains, selectionCells } from "../services/selection-service.js?v=20260916-phase35-5";
import { magicWandSelection, fitSelectionBox, invertSelection as invertSelectionMask, selectAll as selectAllCells, translateSelection } from "../services/shapes-service.js?v=20260918-usage2";
import { renderSourceTransform, defaultSourceTransform, cropFromDrag, sourceOutputGeometry } from "../services/source-editor-service.js?v=20260916-phase35-5";
import { GenerationPanel } from "./generation-panel.js?v=20260930-generation-consolidation";
import { GridEditorToolbar, SHAPE_TOOLS } from "./grid-editor-toolbar.js?v=20260930-top-toolbar-cleanup";
import { detectPixelMultiple, loadImageData, logicalSize } from "./pixel-multiple.js?v=20260923-pixelmultiple";
import { ZoomControls } from "./zoom-controls.js?v=20260930-lazy-b1";
import { Navigator } from "./navigator.js?v=20260929-editor-phase3";
import { createInspectionState, currentInspectionIssue, setInspectionIssues, startInspection, stopInspection, nextInspectionIssue, previousInspectionIssue, nextInspectionCell, previousInspectionCell } from "../services/inspection-service.js?v=20260929-editor-phase3";
import { TextPanel } from "./text-panel.js?v=20261001-stage-a";
import { createTextLayer, rasterizeTextCached, layerContainsCell } from "../services/text-layer-service.js?v=20261001-stage-a";
import { createInventoryService } from "../services/inventory-service.js?v=20260917-inventory";
import { moveReference } from "../services/reference-layer-service.js";
import { buildRamp, createPaletteMetricCache } from "../services/color-ramp-service.js";
import { createOcrService } from "../services/ocr-service.js?v=20260917-inventory";
import { createLegendRecognitionService } from "../services/legend-recognition-service.js?v=20260917-inventory";
import { InventoryPanel } from "./inventory-panel.js?v=20260917-inventory";
import { UsageDialog } from "./usage-dialog.js?v=20260917-inventory";
import { resolveScreenRenderPolicy } from "../smart-preprocessing/render-policy.mjs?v=20260928-v3";
import { paletteIdOf } from "../services/palette-identity.js";
// Stage B1：系列的唯一真源（不再用 code.match(/^[A-Z]+/) 现猜系列）。
import { PALETTE_SERIES_ALL, filterPaletteColors, listPaletteSeries } from "../services/palette-series.mjs?v=20261002-stage-b1";
// Stage B1 §6/§7/§8：当前颜色的唯一真源。写 currentPaletteId 只能走这两个 patch 构造器。
import { buildActivateColorPatch, buildClearPalettePatch, buildCurrentPalettePatch, buildHighlightOnlyPatch, readCurrentPaletteId } from "../services/current-palette.mjs?v=20261002-stage-b1";
// Stage B1 §12：用色统计条的数据整形（排序 / 汇总 / 选中项是否仍在图上）。
import { buildUsageEntries, formatUsageSummary, isUsageEntryPresent, USAGE_SORT_DEFAULT } from "../services/palette-usage-strip.mjs?v=20261002-stage-b1";
import { buildStructuralDiagnostics } from "../services/structural-diagnostics.js?v=20260929-editor-phase4d";
import { stableIssueKey, deriveRepairSuggestions, createRepairQueue, createRepairPreview } from "../services/repair-suggestion.js?v=20260929-editor-phase5";
import { membershipService } from "../services/membership-service.js?v=20260930-membership-v1";
import { createExportV2Service } from "../services/export-v2-service.js?v=20260930-export-cjk";
import { resizeCanvasGrid, scalePatternNearest, createGridResizeCommand, clampSelectionToBounds, resizeCropInsets } from "../services/grid-resize-service.js?v=20261001-hotfix";
import { createAutoDraftService } from "../services/auto-draft-service.js";
import { createEditorCommand } from "../services/editor-command.js";
// Stage B4 P0：长边权威。**query string 必须与 app.js 里那一处逐字一致** ——
// 不一致就是两个模块实例，`LONG_EDGE_AUTHORITY` 会是两个不同的对象，
// 「用户点过应用尺寸」这个事实就在一边成立、另一边不成立。
// 守卫：tests/source-dimensions-wiring.test.mjs 断言所有引用点用同一个 specifier。
import { LONG_EDGE_AUTHORITY, LONG_EDGE_EVENT, resolveLongEdgeAuthority, shouldAutoWriteLongEdge } from "../services/source-dimensions.mjs?v=20261003-stage-b4";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const canvasHint = (view) => {
  const policy = resolveScreenRenderPolicy({
    showCodes: view.showCodes,
    zoom: view.zoom,
    baseCell: 20,
    codeThreshold: view.codeVisibilityThreshold,
  });
  return view.showCodes && !policy.showCodes ? "放大以查看色号" : "拖动画布平移 · 滚轮缩放";
};

export function mountWorkspace(bridge) {
  if (!bridge) throw new Error("缺少 Workspace Bridge");
  try {
    membershipService.init();
  } catch (error) {
    console.warn("[membership] 初始化失败；编辑功能继续保持免费可用", error);
  }
  const store = projectStore, generation = createGenerationService(bridge, store);
  const palettes = createPaletteService(bridge, store), exports = createExportService(bridge, store), editorService = createEditorService(bridge, { onHistoryChange: () => updateHistory() });
  const wrap = document.querySelector(".workspace-wrap"), grid = wrap?.querySelector(".workspace-grid");
  const top = wrap?.querySelector(".main-global-toolbar"), left = grid?.querySelector(".main-left-toolbar");
  const center = grid?.querySelector(".main-center-workspace"), right = grid?.querySelector(".main-right-inspector");
  if (grid?.dataset.workspaceReady) return { mounted: true, reused: true };
  if (grid?.dataset.workspaceMounting) throw new Error("工作台正在挂载");
  const missing = [
    [wrap, ".workspace-wrap"], [grid, ".workspace-grid"], [top, ".main-global-toolbar"],
    [left, ".main-left-toolbar"], [center, ".main-center-workspace"], [right, ".main-right-inspector"],
  ].filter(([node]) => !node).map(([, selector]) => selector);
  if (missing.length) throw new Error("工作台骨架不完整：" + missing.join(", "));
  grid.dataset.workspaceMounting = "true";
  grid.dataset.workspaceShell = "v3";
  // 生成尺寸的唯一自由度是「长边格数」。宽高由 长边 + 有效裁剪比例 派生，
  // 所以这里只推一个数，不推 width/height（推两个数就必然有人不守比例）。
  //
  // 用 ensureGenerationLongEdge 而不是 setGenerationLongEdge：挂载是**无条件发生**的，
  // 但尺寸依据是有条件的。无条件写 104 会把更强的证据冲掉 ——
  // 例如「先打开 222×295 的工程、再挂载工作台」会得到 104（B0.1 §6）。
  bridge.ensureGenerationLongEdge(104);
  store.setState({ canvas: { width: 104, height: 104, lockAspectRatio: false }, generation: { engine: "v2.5", algorithm: "current" } });
  document.body.classList.add("phase2-workspace");

  // 原先「更多现有工具与参数」折叠里装的是旧顶/左/右栏的控件，现已全部迁到工作台上方
  // 的 #ws-top-controls（扩展工具条 + 色号选择 + 生成参数），不再保留这个重复入口。

  // 顶栏只承担项目身份、历史和项目级动作。编辑工具统一放左侧工具栏。
  top.className = "ws-topbar";
  top.innerHTML = `<div class="ws-brand"><img src="./assets/brand/shiliber-mark-256.png" alt="" width="34" height="34"><span><strong>LIBMS Studio</strong><small>by 时里白造物</small></span></div>
    <div class="ws-project-identity"><input class="ws-name" id="ws-project-name" aria-label="作品名称" value="未命名作品" maxlength="40" title="点击编辑作品名称"><span id="ws-project-meta">尚未创建图纸</span><span class="ws-status" id="ws-status">未开始</span></div>
    <span class="ws-topbar-spacer"></span>
    <div class="ws-history-actions" aria-label="编辑历史"><button type="button" id="ws-undo" aria-label="撤销" title="撤销 · Ctrl/Cmd+Z" disabled>↶</button><button type="button" id="ws-redo" aria-label="重做" title="重做 · Ctrl/Cmd+Shift+Z" disabled>↷</button></div>
    <details class="ws-project-menu"><summary class="ws-button" aria-label="新建或导入项目">新建 / 导入</summary><div class="ws-project-popover" role="menu"><button type="button" id="ws-new-blank" role="menuitem">新建空白图纸<small>从空白画布开始</small></button><button type="button" id="ws-import-again" role="menuitem">导入图片<small>生成新的拼豆图纸</small></button><button type="button" id="ws-import-pattern" role="menuitem">导入现成图纸<small>识别已有色号图</small></button><button type="button" id="ws-project-import" role="menuitem">打开工程<small>LIBMS / Pixler</small></button></div></details>
    <input type="file" id="ws-project-file" accept="application/json,.json,.pixler" hidden>
    <button type="button" class="ws-button" id="ws-save-project">保存</button>
    <button type="button" class="ws-button ws-button-primary" id="ws-export" disabled>导出</button>
    <select id="ws-engine" hidden aria-label="生成引擎"><option value="v2.5">智能 V2.5</option><option value="legacy">Legacy</option></select>
    <span class="ws-membership-status" id="ws-membership-status" hidden>全部功能免费开放</span>
    <button type="button" id="ws-source-open" hidden>图片调整</button>
    <button type="button" class="ws-button ws-button-primary" id="ws-generate" hidden>重新生成</button>
    <button type="button" class="ws-button ws-button-danger" id="ws-cancel-generate" hidden>取消生成</button>
    <button type="button" class="ws-button" id="ws-legacy-retry" hidden>Legacy 重试</button>`;

  // 左轨是唯一一级编辑工具入口；施工模式保留为独立工作模式。
  left.className = "ws-rail";
  left.setAttribute("aria-label", "专业编辑工具");
  left.innerHTML = `<button type="button" class="ws-rail-collapse" id="ws-rail-collapse" aria-label="收起工具栏" title="收起工具栏">‹</button><div id="gridEditorToolbar" class="ws-grid-toolbar-host"></div>
    <button type="button" class="ws-rail-mode" data-ws-mode="build" aria-label="施工模式" title="施工 · 按区块拼豆，暗色护眼">
      <span class="ws-rail-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="12" height="12"/><path d="M6 2v12M10 2v12M2 6h12M2 10h12" stroke-width=".8"/></svg></span>
      <small>施工</small>
    </button>`;

  center.className = "ws-center";
  const oldTabs = center.querySelector(".main-view-tabs"); if (oldTabs) oldTabs.hidden = true;
  const oldPreview = center.querySelector(".preview-column"); if (oldPreview) oldPreview.classList.add("ws-old-preview");
  const importView = document.createElement("section"); importView.className = "ws-import"; importView.id = "ws-import";
  importView.innerHTML = `<div class="ws-import-inner"><p class="ws-eyebrow">创作工作台</p><h1>开始创作拼豆图纸</h1><p>选择图片自动生成，或从空白画布开始手工绘制。</p><div class="ws-start-options"><div class="ws-drop-slot"></div><div class="ws-blank-start"><strong>＋ 新建空白图纸</strong><label>尺寸<select id="ws-blank-size"><option value="52,52">52 × 52</option><option value="78,78">78 × 78</option><option value="104,104">104 × 104</option><option value="custom">自定义</option></select></label><div class="ws-blank-custom"><input id="ws-blank-width" type="number" min="1" max="1000" value="52" aria-label="空白图纸宽度"><span>×</span><input id="ws-blank-height" type="number" min="1" max="1000" value="52" aria-label="空白图纸高度"></div><button type="button" id="ws-blank-start">创建空白图纸</button></div></div><span>图片只在本地浏览器处理</span></div>`;
  const oldUpload = document.querySelector("#upload-zone"); importView.querySelector(".ws-drop-slot").append(oldUpload);
  importView.querySelector("#ws-blank-size").addEventListener("change", (event) => {
    if (event.target.value==="custom") return;
    const [width,height]=event.target.value.split(",");
    importView.querySelector("#ws-blank-width").value=width;
    importView.querySelector("#ws-blank-height").value=height;
  });
  importView.querySelector("#ws-blank-start").addEventListener("click", () => {
    bridge.createBlankCanvas?.({
      width:importView.querySelector("#ws-blank-width").value,
      height:importView.querySelector("#ws-blank-height").value,
    });
    const result=bridge.getResult();
    if (result?.sourceName==="blank-board" && result.grid?.length) {
      syncLegacy(result);
      activateBlankCanvas();
    }
  });
  const canvas = document.createElement("section"); canvas.className = "ws-canvas-area"; canvas.id = "ws-canvas-area";
  canvas.innerHTML = `<div class="ws-canvas-well" id="ws-canvas-well" role="img" aria-label="当前拼豆作品画布"><div class="ws-canvas-layers" id="ws-canvas-layers"></div><canvas id="ws-source-canvas" class="ws-source-canvas" aria-label="原图裁剪画布" hidden></canvas></div><div class="ws-canvas-stats" id="ws-canvas-stats"><span>已使用颜色</span> <strong id="ws-stats-colors">0</strong> <span>种</span> <i aria-hidden="true">/</i> <strong id="ws-stats-beads">0</strong> <span>颗</span></div>
    <!-- Stage B2 §6：生成前的背景预检条。
         开启「去除纯色背景」后不直接静默应用 —— 先在这里给出结论，
         由用户选 [应用] / [保留背景]。结论来自 services/background-preview-service.mjs，
         真实判定仍在生成时由 background-reliability.mjs 重跑。 -->
    <div class="ws-bg-preview" id="ws-bg-preview" role="status" hidden>
      <span class="ws-bg-preview-text" id="ws-bg-preview-text">—</span>
      <span class="ws-bg-preview-actions">
        <button type="button" class="ws-button ws-button-primary" id="ws-bg-preview-apply">应用</button>
        <button type="button" class="ws-button" id="ws-bg-preview-keep">保留背景</button>
        <button type="button" class="ws-button" id="ws-bg-preview-dismiss" hidden>知道了</button>
      </span>
    </div><p class="ws-canvas-hint" id="ws-canvas-hint"></p>`;
  center.append(importView, canvas);
  // 底部工具坞：左=画布工具，中=视图与缩放，右=主操作。严格单行不换行。
  // 原先浮在画布上方 top:12px 的工具条会盖住画布抢点击，这里改为常驻底栏。
  const dock = document.createElement("nav"); dock.className = "ws-dock"; dock.setAttribute("aria-label", "画布工具坞");
  dock.innerHTML = `<div class="ws-dock-view" id="ws-dock-view">
      <div class="ws-view-modes">${[["original","原图"],["blocks","色块"],["beads","拼豆"],["pattern","图纸"]].map(([id,name])=>`<button type="button" data-ws-view="${id}">${name}</button>`).join("")}<button type="button" id="ws-compare" title="按住临时看原图">对照</button></div>
      <div class="ws-view-toggles"><label><input type="checkbox" id="ws-grid">网格</label><label><input type="checkbox" id="ws-codes">色号</label></div>
    </div>
    <div class="ws-dock-actions">
      <button type="button" class="ws-button" id="ws-making" disabled>开始拼</button>
    </div>`;
  wrap.append(dock);
  const viewBar = dock.querySelector("#ws-dock-view");

  right.className = "ws-inspector";
  // Stage C0 §2/§3：右栏按产品层级重排 —— 作品 / 图片 / 生成 / 色彩 / 编辑 / 检查 / 材料。
  //   · 新增「生成」：承载 8 个生成模式。改之前模式卡挂在「色彩」面板里，
  //     而 6 个 tab 里没有一个叫「生成」—— 用户只能靠猜「色彩」才找得到模式入口
  //     （实测：只有 color tab 能把它从 display:none 里露出来）。
  //   · 「库存」→「材料」：语义从「只读台账」扩到「本作品用豆 + 底板 + 采购」。
  //     库存面板本身的能力（扣料 / OCR 录入 / CSV / 缺货 / 单色号明细）一个都没删，
  //     它现在是「材料」面板里的一节。
  const INSPECTOR_TABS = [["project", "作品"], ["source", "图片"], ["generation", "生成"], ["color", "色彩"], ["edit", "编辑"], ["check", "检查"], ["material", "材料"]];
  right.innerHTML = `<div class="ws-side-tabs" role="tablist" aria-label="右栏分组">${INSPECTOR_TABS.map(([id, name]) => `<button type="button" role="tab" data-ws-panel="${id}">${name}</button>`).join("")}</div>
    <div class="ws-inspector-head"><strong id="ws-inspector-title">作品</strong><small id="ws-inspector-subtitle">当前设计</small></div>
    <div class="ws-inspector-scroll">
      <section class="ws-panel" data-ws-inspector="build">
        <div class="ws-section-title">分割区块</div>
        <p class="ws-note">把图纸切成若干块，一次只拼一块。</p>
        <div class="ws-stepper"><button type="button" data-ws-block="dec" aria-label="减少区块">−</button><output id="ws-block-count">1</output><button type="button" data-ws-block="inc" aria-label="增加区块">+</button></div>
        <p class="ws-note" id="ws-block-advice">—</p>
        <div class="ws-section-title">区块切换</div>
        <div class="ws-block-map" id="ws-block-map" role="group" aria-label="区块切换"></div>
        <div class="ws-block-arrows"><button type="button" data-ws-block="prev" aria-label="上一区块">←</button><button type="button" data-ws-block="next" aria-label="下一区块">→</button></div>
        <div class="ws-section-title">颜色切换 · 当前区块</div>
        <div class="ws-block-colors" id="ws-block-colors" role="group" aria-label="当前区块颜色"></div>
        <div class="ws-block-arrows"><button type="button" data-ws-color="prev" aria-label="上一颜色">↑</button><button type="button" data-ws-color="next" aria-label="下一颜色">↓</button></div>
        <div class="ws-readout" id="ws-build-focus">—</div>
        <button type="button" class="ws-button ws-wide" id="ws-build-reset">显示全部</button>
      </section>
      <section class="ws-panel" data-ws-inspector="project"><div class="ws-section-title">拼豆规格</div><label class="ws-field">单豆直径<select id="ws-bead-size"><option value="2.6">小豆 · 2.6 mm</option><option value="5">大豆 · 5.0 mm</option></select></label><div class="ws-readout" id="ws-physical-size">—</div><div class="ws-section-title">已有作品</div><div class="ws-project-gallery-slot"></div></section>
      <section class="ws-panel" data-ws-inspector="source"><div class="ws-section-title">非破坏式原图修整</div><p class="ws-note">在中央原图拖动裁剪。原文件不变，应用后重新生成图纸。</p><label class="ws-field">裁剪比例<select id="ws-source-ratio"><option value="free">自由</option><option>1:1</option><option>4:3</option><option>3:4</option><option>16:9</option><option>9:16</option></select></label><div class="ws-source-buttons"><button type="button" data-ws-source-rotate="-90">左转 90°</button><button type="button" data-ws-source-rotate="90">右转 90°</button><button type="button" data-ws-source-flip="flipX">水平翻转</button><button type="button" data-ws-source-flip="flipY">垂直翻转</button><button type="button" id="ws-source-pick-mode">原图取色</button></div><div id="ws-source-sample" class="ws-source-sample"></div><div class="ws-section-title">画面调整</div>${[["brightness","亮度",-100,100],["contrast","对比度",-100,100],["saturation","饱和度",-100,100],["sharpen","锐化",0,100]].map(([key,label,min,max])=>`<label class="ws-source-slider">${label}<span id="ws-source-${key}-value">0</span><input type="range" data-ws-source-adjust="${key}" min="${min}" max="${max}" value="0"></label>`).join("")}<div class="ws-section-title">扩容画布 · 原图像素</div><div class="ws-expand-grid">${["top","bottom","left","right"].map((side)=>`<label>${{top:"上",bottom:"下",left:"左",right:"右"}[side]}<input type="number" data-ws-source-expand="${side}" min="0" max="500" value="0"></label>`).join("")}</div><label class="ws-field">背景色<input id="ws-source-background" type="color" value="#ffffff"></label><div class="ws-section-title">处理后预览</div><canvas id="ws-source-preview" class="ws-source-preview" aria-label="处理后图片预览"></canvas><div id="ws-source-size" class="ws-note"></div><div class="ws-source-buttons"><button type="button" id="ws-source-reset">恢复原图</button><button type="button" class="ws-button-primary" id="ws-source-apply">应用并生成</button></div></section>
      <section class="ws-panel" data-ws-inspector="generation">
        <div class="ws-section-title">生成尺寸</div>
        <p class="ws-note">长边是唯一自由度；宽高按原图有效比例派生。改完点「应用尺寸」才会重新生成。</p>
        <div class="ws-top-size ws-size-block">
          <span class="ws-top-size-label">长边</span>
          <div class="ws-size-chips" id="ws-size-chips" role="group" aria-label="长边预设（格）">
            <button type="button" class="ws-size-chip ws-size-chip-auto" data-size="auto" title="按像素倍数识别结果自动定长边">自动</button>
            <button type="button" class="ws-size-chip" data-size="52" title="长边 52 格">52</button>
            <button type="button" class="ws-size-chip" data-size="78" title="长边 78 格">78</button>
            <button type="button" class="ws-size-chip" data-size="104" title="长边 104 格">104</button>
          </div>
          <div class="ws-size-slider" id="ws-size-controls" role="group" aria-label="长边（格）：滑杆、数字输入、滚轮、方向键">
            <output id="ws-size-value" for="ws-size-range" aria-live="polite" title="派生尺寸（宽 × 高）"><strong>—</strong><span>×</span><strong>—</strong></output>
            <input id="ws-size-range" type="range" min="10" max="500" step="1" value="104" aria-label="图纸长边（格）">
            <input id="ws-size-number" type="number" min="10" max="500" step="1" value="104" aria-label="图纸长边格数（可直接输入）">
          </div>
          <button type="button" class="ws-button ws-size-apply" id="ws-size-apply">应用尺寸</button>
          <span class="ws-size-authority" id="ws-size-authority" role="status" hidden></span>
          <span class="ws-size-tier" id="ws-size-tier" role="status" hidden></span>
        </div>
        <div class="ws-section-title">生成参数</div>
        <div id="generationPanel"></div>
        <div class="ws-section-title">生成状态</div>
        <div class="ws-readout" id="ws-generation-status" role="status">尚未生成</div>
      </section>
      <section class="ws-panel" data-ws-inspector="color">
        <div class="ws-section-title">色卡</div>
        <label class="ws-field">品牌<select id="ws-brand"></select></label>
        <label class="ws-field">色数<select id="ws-palette-size"></select></label>
        <div class="ws-section-title">完整真实色盘</div>
        <div class="ws-current-color-summary" id="ws-palette-current">当前颜色：未选择</div>
        <input id="ws-color-search" type="search" placeholder="搜索色号 · H7 / H07" aria-label="搜索色号">
        <div class="ws-picker-count" id="ws-picker-count">—</div>
        <!-- §21：5 个「选一个色号」的控件共用这一份色号清单。
             旧版每个控件各持一份完整色板 <select>，优肯 418 色 = 5 × 418 = 2090 个 <option>，
             而且每次 paint 全部重建。现在只存在一份，且按色板签名缓存、不随 paint 重建。 -->
        <datalist id="ws-palette-datalist"></datalist>
        <div id="ws-palette-categories" class="ws-palette-categories"></div>
        <div id="ws-recent-colors" class="ws-recent-colors"></div>
        <div id="ws-bead-picker" class="ws-bead-picker"></div>
        <div class="ws-readout" id="ws-used-colors">尚未生成</div>
        <div class="ws-section-title">用色统计</div>
        <div class="ws-usage-head">
          <span id="ws-usage-summary">尚未生成</span>
          <div class="ws-usage-sort" role="group" aria-label="用色统计排序">
            <button type="button" data-ws-usage-sort="count-desc" class="active">数量↓</button>
            <button type="button" data-ws-usage-sort="count-asc">数量↑</button>
            <button type="button" data-ws-usage-sort="code">色号</button>
          </div>
        </div>
        <div class="ws-usage-strip" id="ws-usage-strip" role="list"></div>
        <div class="ws-usage-actions" id="ws-usage-actions" hidden>
          <span id="ws-usage-current" class="ws-usage-current">未选择颜色</span>
          <button type="button" id="ws-usage-only">只看此色</button>
          <button type="button" id="ws-usage-replace">全局替换</button>
          <button type="button" id="ws-usage-similar">相近颜色</button>
        </div>
        <div class="ws-usage-similar" id="ws-usage-similar-list" hidden></div>
        <div class="ws-section-title">色彩优化</div>
        <div class="ws-color-optimization" role="group" aria-label="色彩优化">
          <button type="button" id="ws-color-auto-optimize">自动优化</button>
          <button type="button" id="ws-color-manual-merge">手动合并</button>
          <button type="button" id="ws-color-cleanup">清理杂点</button>
        </div>
        <div id="ws-manual-merge-panel" hidden>
          <label class="ws-field">选择来源色（可多选）<select id="ws-merge-sources" multiple size="5"></select></label>
          <label class="ws-field">合并为<input id="ws-merge-target" list="ws-palette-datalist" placeholder="输入色号"></label>
          <p class="ws-note" id="ws-merge-impact">请选择来源色和目标色。</p>
          <button type="button" class="ws-button ws-wide" id="ws-merge-confirm">确认合并</button>
        </div>
        <div class="ws-section-title">全局换色</div>
        <label class="ws-field">来源色号<input id="ws-replace-from" type="text" placeholder="H07"></label>
        <label class="ws-field">替换为<input id="ws-replace-to" type="text" placeholder="A03"></label>
        <p class="ws-note" id="ws-replace-impact">选择来源色后显示影响颗数。</p>
        <button type="button" class="ws-button ws-wide" id="ws-replace-confirm">确认替换</button>
      </section>
      <section class="ws-panel" data-ws-inspector="edit"><div class="ws-editor-group"><div class="ws-section-title">工具属性</div><div id="ws-tool-details" class="ws-cell-details">选择工具 · 点击查看单豆</div><label class="ws-source-slider">笔宽<span id="ws-brush-size-value">1</span><input type="range" id="ws-brush-size" min="1" max="9" step="2" value="1" aria-label="画笔大小（格）"></label><label class="ws-switch-row"><input type="checkbox" id="ws-shape-filled"> 形状实心（矩形 / 圆形）</label><label class="ws-source-slider">魔棒容差<span id="ws-wand-tolerance-value">12</span><input type="range" id="ws-wand-tolerance" min="0" max="100" value="12"></label></div><div class="ws-editor-group"><div class="ws-section-title">选中对象</div><div id="ws-cell-details" class="ws-cell-details">点击画布或对象列表进行选择。</div><div id="ws-text-objects" class="ws-text-objects"></div><div id="textPanel" class="ws-text-panel"></div></div><div class="ws-editor-group"><div class="ws-section-title">选区动作</div><div class="ws-selection-actions"><button type="button" id="ws-erase-selection">擦除选区</button><button type="button" id="ws-clear-selection">清除选择</button></div><div class="ws-selection-actions"><button type="button" id="ws-copy-selection">复制</button><button type="button" id="ws-cut-selection">剪切</button><button type="button" id="ws-paste-selection">粘贴</button></div><div class="ws-selection-actions"><button type="button" id="ws-invert-selection">反选</button><button type="button" id="ws-select-all">全选</button></div><div class="ws-outline-options"><label><input id="ws-outline-diagonal" type="checkbox">描边包含对角</label><button type="button" id="ws-apply-outline">外描边</button></div><div id="ws-history-label" class="ws-note"></div></div><div class="ws-editor-group"><div class="ws-section-title">对称绘制</div><label class="ws-field">模式<select id="ws-symmetry-mode"><option value="none">关闭</option><option value="vertical">左右对称</option><option value="horizontal">上下对称</option><option value="both">双向对称</option></select></label><div class="ws-selection-actions"><label>左右轴<input id="ws-symmetry-axis-x" type="number" step="0.5"></label><label>上下轴<input id="ws-symmetry-axis-y" type="number" step="0.5"></label></div></div><div class="ws-editor-group"><div class="ws-section-title">参考底图</div><p class="ws-note">独立参考对象，不写入图纸与导出。</p><div class="ws-source-buttons"><button type="button" id="ws-ref-pick">添加 / 替换</button><button type="button" id="ws-ref-clear">删除</button></div><input type="file" id="ws-ref-file" accept="image/*" hidden><label class="ws-switch-row"><input type="checkbox" id="ws-ref-visible" checked> 显示参考图</label><label class="ws-source-slider">透明度<span id="ws-ref-opacity-value">40%</span><input type="range" id="ws-ref-opacity" min="0" max="100" value="40"></label><label class="ws-field">显示<select id="ws-ref-display"><option value="normal">正常</option><option value="reference-only">只看原图</option><option value="grid-only">只看图纸</option></select></label><label class="ws-field">适配<select id="ws-ref-fit"><option value="contain">完整适应</option><option value="cover">铺满裁切</option></select></label><label class="ws-field">质量<select id="ws-ref-smoothing"><option value="smooth">平滑</option><option value="pixelated">像素</option></select></label><label class="ws-source-slider">参考图缩放<span id="ws-ref-scale-value">100%</span><input type="range" id="ws-ref-scale" min="25" max="200" value="100"></label><div class="ws-selection-actions"><button type="button" id="ws-ref-adjust">调整位置</button><button type="button" id="ws-ref-reset">重新适配</button></div></div><button type="button" class="ws-button ws-wide" id="ws-open-editor" disabled hidden>打开原画板</button></section>
      <section class="ws-panel" data-ws-inspector="check"><div class="ws-section-title">真实检查结果</div><div id="ws-check-results" class="ws-check-results">生成后显示可验证的尺寸、色数与结构报告。</div></section>
      <section class="ws-panel" data-ws-inspector="material">
        <div class="ws-section-title">本作品用豆</div>
        <div class="ws-readout" id="ws-material-total">尚未生成图纸</div>
        <div class="ws-material-list" id="ws-material-list"></div>
        <div class="ws-section-title">底板与采购</div>
        <div class="ws-readout" id="ws-material-boards">—</div>
        <p class="ws-note" id="ws-material-note">按当前图纸精确统计，用于备料与补货；不含损耗余量。</p>
        <div class="ws-section-title">豆子库存</div>
        <div id="inventoryPanel"></div>
      </section>
    </div>`;
  const editPanel = right.querySelector('[data-ws-inspector="edit"]');
  const projectPanel = right.querySelector('[data-ws-inspector="project"]');
  projectPanel?.insertAdjacentHTML("beforeend", `<div class="ws-editor-group ws-resize-panel"><div class="ws-section-title">图纸尺寸</div><div class="ws-resize-current"><strong id="ws-resize-current">104 × 104</strong><span id="ws-resize-kind">自定义</span></div><button type="button" class="ws-button ws-wide" id="ws-resize-open">调整尺寸</button></div><div class="ws-editor-group"><div class="ws-section-title">崩溃恢复</div><p class="ws-note" id="ws-draft-status">编辑后自动保存本地草稿。</p><div class="ws-selection-actions" id="ws-draft-actions" hidden><button type="button" id="ws-draft-restore">恢复</button><button type="button" id="ws-draft-discard">放弃</button></div></div>`);
  const resizeDialog=document.createElement("dialog");resizeDialog.className="ws-resize-dialog";resizeDialog.id="ws-resize-dialog";
  const resizeAnchors=["top-left","top","top-right","left","center","right","bottom-left","bottom","bottom-right"],resizeAnchorLabels=["左上","上中","右上","左中","居中","右中","左下","下中","右下"];
  resizeDialog.innerHTML=`<form method="dialog" class="ws-resize-card"><div class="ws-resize-head"><div><strong>调整图纸尺寸</strong><small id="ws-resize-from">当前：104 × 104</small></div><button value="cancel" aria-label="关闭">×</button></div><div class="ws-resize-body"><div class="ws-section-title">目标尺寸</div><div class="ws-selection-actions"><label>宽<input id="ws-resize-width" type="number" min="1" max="1000" value="104"></label><span>×</span><label>高<input id="ws-resize-height" type="number" min="1" max="1000" value="104"></label></div><div class="ws-resize-presets"><button type="button" data-resize-preset="52">52×52</button><button type="button" data-resize-preset="78">78×78</button><button type="button" data-resize-preset="104">104×104</button><span>自定义</span></div><fieldset class="ws-resize-modes"><legend>模式</legend><label><input type="radio" name="ws-resize-mode" value="canvas" checked> 调整图纸</label><label><input type="radio" name="ws-resize-mode" value="pattern"> 缩放图案</label></fieldset><div id="ws-resize-anchor-wrap"><div class="ws-section-title">锚点</div><div class="ws-anchor-grid" role="radiogroup" aria-label="九宫格锚点">${resizeAnchors.map((anchor,index)=>`<label title="${resizeAnchorLabels[index]}"><input type="radio" name="ws-resize-anchor" value="${anchor}"${anchor==="center"?" checked":""}><span></span></label>`).join("")}</div></div><p class="ws-resize-warning" id="ws-resize-summary">调整图纸不会重新匹配颜色。</p></div><div class="ws-resize-foot"><button value="cancel">取消</button><button type="button" class="ws-button-primary" id="ws-resize-apply">确认调整</button></div></form>`;
  wrap.append(resizeDialog);
  const symmetryControls = editPanel?.querySelector("#ws-symmetry-mode")?.closest(".ws-editor-group");
  symmetryControls?.insertAdjacentHTML("beforeend", `<label class="ws-switch-row"><input id="ws-symmetry-guides" type="checkbox" checked> 显示对称轴</label><p class="ws-note">对称绘制只影响新的画笔与橡皮笔画；镜像是对已有内容执行即时变换。</p>`);
  const outlineControls=document.createElement("div");outlineControls.className="ws-outline-controls";
  outlineControls.innerHTML=`<div class="ws-section-title">结构描边</div>
    <label class="ws-field">来源<select id="ws-outline-source"><option value="component">当前连通区域</option><option value="palette">全图当前颜色</option><option value="selection">选区内容</option></select></label>
    <label class="ws-field">描边颜色<input id="ws-outline-target" list="ws-palette-datalist" placeholder="输入色号"></label>
    <div class="ws-selection-actions"><label>厚度 <select id="ws-outline-thickness"><option>1</option><option>2</option><option>3</option></select></label><label>邻域 <select id="ws-outline-connectivity"><option value="4">4 邻域</option><option value="8">8 邻域</option></select></label></div>
    <label class="ws-switch-row"><input id="ws-outline-holes" type="checkbox"> 包含内部孔洞</label>
    <button type="button" class="ws-button ws-wide" id="ws-outline-preview">预览描边</button><p class="ws-note" id="ws-outline-summary">选择来源和真实色号后预览。</p>
    <div class="ws-selection-actions"><button type="button" id="ws-outline-apply" disabled>应用</button><button type="button" id="ws-outline-cancel" disabled>取消</button></div>`;
  symmetryControls?.before(outlineControls);
  const colorInspector = document.createElement("div");
  colorInspector.className = "ws-current-color";
  colorInspector.innerHTML = `<div class="ws-section-title">当前颜色</div>
    <div class="ws-current-color-summary" id="ws-current-color-summary">点击画布中的拼豆格子识别颜色</div>
    <label class="ws-switch-row"><input id="ws-same-color-highlight" type="checkbox" disabled> 同色高亮：开启</label>
    <div class="ws-section-title">选区颜色</div>
    <div class="ws-note" id="ws-selection-palette-summary">框选区域后显示颜色统计。</div>
    <div class="ws-palette-diagnostic-list" id="ws-selection-palette-list"></div>
    <div class="ws-section-title">相近颜色</div>
    <div class="ws-palette-suggestions" id="ws-similar-colors"><span class="ws-note">选择当前颜色后显示推荐。</span></div>
    <label class="ws-field">选择替换色<input id="ws-current-color-target" list="ws-palette-datalist" placeholder="输入色号" disabled></label>
    <div class="ws-note" id="ws-current-color-impact">选择当前颜色后显示替换数量。</div>
    <div class="ws-selection-actions"><button type="button" id="ws-selection-color-replace" disabled>仅选区替换</button><button type="button" id="ws-current-color-replace" disabled>全局替换</button></div>
    <div class="ws-section-title">色阶</div>
    <div class="ws-note">暗 ← <span id="ws-ramp-base-label">选择一个基础色</span> → 亮</div>
    <div class="ws-palette-suggestions" id="ws-color-ramp"></div>
    <label class="ws-field">级数<select id="ws-ramp-size"><option value="3">3 级</option><option value="5" selected>5 级</option><option value="7">7 级</option></select></label>
    <div class="ws-selection-actions"><button type="button" id="ws-ramp-regenerate">重新生成</button><button type="button" id="ws-ramp-remove-level">移除当前级</button></div>
    <label class="ws-field">替换当前级<input id="ws-ramp-level-target" list="ws-palette-datalist" placeholder="输入色号"></label>
    <label class="ws-field">Ink<select id="ws-ink-mode"><option value="normal">普通</option><option value="darker">加深</option><option value="lighter">提亮</option></select></label>
    <div class="ws-section-title">低频颜色</div>
    <label class="ws-field">诊断阈值<select id="ws-rare-threshold"><option value="3">≤ 3 颗</option><option value="5" selected>≤ 5 颗</option><option value="10">≤ 10 颗</option></select></label>
    <div class="ws-palette-diagnostic-list" id="ws-rare-colors"></div>
    <div class="ws-section-title">结构诊断</div>
    <div class="ws-diagnostic-counts" id="ws-diagnostic-counts"></div>
    <label class="ws-field">问题分类<select id="ws-diagnostic-category"><option value="all">全部</option><option value="rare-color">低频颜色</option><option value="isolated-pixel">孤立像素</option><option value="tiny-region">微小区域</option><option value="edge-contamination" selected>边缘污染</option></select></label>
    <label class="ws-field">严重程度<select id="ws-diagnostic-severity"><option value="all">全部</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
    <label class="ws-field">微小区域阈值<select id="ws-tiny-threshold"><option value="3">≤ 3 颗</option><option value="5">≤ 5 颗</option><option value="8">≤ 8 颗</option></select></label>
    <label class="ws-switch-row"><input id="ws-diagnostic-overlay" type="checkbox" checked> 显示诊断标记</label>
    <div class="ws-inspection" id="ws-inspection">
      <div class="ws-inspection-head"><strong id="ws-inspection-title">问题巡检</strong><button type="button" id="ws-inspection-toggle">开始巡检</button></div>
      <div class="ws-note" id="ws-inspection-current">当前没有可巡检的问题。</div>
      <div class="ws-inspection-row"><button type="button" id="ws-inspection-prev">上一项</button><span id="ws-inspection-status">0 / 0</span><button type="button" id="ws-inspection-next">下一项</button></div>
      <div class="ws-inspection-row"><button type="button" id="ws-inspection-cell-prev">上一个位置</button><span id="ws-inspection-cell-status">0 / 0</span><button type="button" id="ws-inspection-cell-next">下一个位置</button></div>
    </div>
    <div class="ws-section-title">修复建议</div>
    <div class="ws-repair-card" id="ws-repair-card">
      <div class="ws-note" id="ws-repair-current">选择一个可修复问题后显示建议。</div>
      <label class="ws-field">选择其他颜色<input id="ws-repair-target" list="ws-palette-datalist" placeholder="留空＝用建议颜色"></label>
      <div class="ws-repair-actions"><button type="button" id="ws-repair-preview">预览</button><button type="button" id="ws-repair-apply">采用建议</button><button type="button" id="ws-repair-ignore">忽略</button></div>
      <button type="button" id="ws-repair-cancel-preview" hidden>取消预览</button>
    </div>
    <div class="ws-repair-queue">
      <div class="ws-repair-counts" id="ws-repair-counts">高 0 · 中 0 · 低 0 · 冲突 0</div>
      <div class="ws-repair-actions"><button type="button" id="ws-repair-review-high">审核高置信</button><button type="button" id="ws-repair-review-all">逐项审核</button></div>
      <button type="button" class="ws-button ws-wide" id="ws-repair-apply-high">应用全部高置信建议</button>
    </div>`;
  symmetryControls?.before(colorInspector);
  let activeRampIndex = -1;
  let rampCachePalette = null, rampMetricCache = null;
  const rampCache = () => {
    const palette = editorService.getPaletteColors();
    if (palette !== rampCachePalette) { rampCachePalette = palette; rampMetricCache = createPaletteMetricCache(palette); }
    return { palette, cache: rampMetricCache };
  };
  const pixelPerfectControl = document.createElement("label");
  pixelPerfectControl.className = "ws-switch-row";
  pixelPerfectControl.innerHTML = '<input type="checkbox" id="ws-pixel-perfect" checked> Pixel Perfect（仅 1 格画笔）';
  right.querySelector("#ws-brush-size")?.closest("label")?.after(pixelPerfectControl);
  const gallery = document.querySelector(".gallery-section"); if (gallery) right.querySelector(".ws-project-gallery-slot").append(gallery);

  // 工作台上方的参数条，只保留一件事：**视图缩放**。
  // Stage C0 §2/§4：生成尺寸（长边草稿 + 派生宽高 +「应用尺寸」）已经搬进右栏「生成」面板 ——
  // 它是生成这一层的 PROPERTY，和「生成模式」是同一层的东西，不该和视图控件挤在一条横条上。
  // 顶栏剩下的是 TOOL 层：视图缩放（选择工具本身在左轨，见 toolRail）。
  const topControls = document.createElement("section");
  topControls.className = "ws-top-controls";
  topControls.id = "ws-top-controls";
  topControls.setAttribute("aria-label", "视图缩放");
  topControls.innerHTML = `<div id="zoomControls" class="ws-top-zoom"></div>`;
  grid.before(topControls);

  const toolRail = left.querySelector("#gridEditorToolbar");

  const drawer = document.createElement("aside"); drawer.className = "ws-export-drawer"; drawer.id = "ws-export-drawer";
  drawer.setAttribute("aria-label", "导出作品");
  drawer.innerHTML = `<div class="ws-drawer-head"><strong>导出</strong><button type="button" id="ws-export-close" aria-label="关闭导出" onclick="this.closest('#ws-export-drawer')?.classList.remove('open')">×</button></div>
    <label class="ws-field">作品名称<input id="ws-export-title" maxlength="60" placeholder="未命名作品"></label>
    <div class="ws-export-options"><strong>图纸</strong><label>清晰度<select id="ws-export-quality"><option value="standard">标准 · 16px/格</option><option value="high">高清 · 24px/格</option><option value="ultra" selected>超高清 · 32px/格</option></select></label><label><input type="checkbox" id="ws-export-grid" checked>网格</label><label><input type="checkbox" id="ws-export-codes" checked>色号</label><label><input type="checkbox" id="ws-export-coords" checked>坐标</label><small id="ws-export-pixels"></small></div>
    <button type="button" class="ws-export-choice" data-export-v2="png"><strong>PNG 图纸</strong><small>按目标分辨率直接绘制，色号不经过低清放大</small></button>
    <button type="button" class="ws-export-choice" data-export-v2="pdf"><strong>PDF 图纸</strong><small>网格与色号使用 PDF 矢量命令</small></button>
    <button type="button" class="ws-export-choice" data-export-v2="pixler"><strong>Pixler 工程</strong><small>结构化网格、真实色号与透明空格</small></button>
    <button type="button" class="ws-export-choice" data-ws-export="project-json"><strong>工程存档</strong><small>保存并继续编辑</small></button>
    <div class="ws-export-options"><strong>分享海报</strong><canvas id="ws-poster-preview" aria-label="海报实时预览"></canvas><label>比例<select id="ws-poster-ratio"><option value="3x4">3:4 · 1500×2000</option><option value="1x1">1:1 · 1800×1800</option></select></label><label>背景<select id="ws-poster-background"><option value="auto">自动同色系</option><option value="solid">纯色</option></select></label><div id="ws-poster-solid-controls" hidden><label>颜色<input type="color" id="ws-poster-solid-color" value="#f1eee8"></label><label>HEX<input id="ws-poster-solid-hex" value="#F1EEE8" maxlength="7"></label></div><label>作品大小<select id="ws-poster-size"><option value="small">小</option><option value="standard" selected>标准</option><option value="large">大</option></select></label><label>衬纸<select id="ws-poster-backing"><option value="none">无</option><option value="narrow">窄边</option><option value="standard" selected>标准</option></select></label><label>品牌<select id="ws-poster-brand"><option value="libms">libms Studio</option><option value="shiliber">时里白造物</option><option value="custom">自定义</option></select></label><label><input type="checkbox" id="ws-poster-logo" checked>显示 Logo</label><label>署名<input id="ws-poster-signature" placeholder="署名"></label><label>前缀<select id="ws-poster-prefix"><option value="none">无</option><option value="at">@</option><option value="copyright">©</option></select></label><label>字体风格<select id="ws-poster-style"><option value="minimal">简约</option><option value="artistic">文艺</option><option value="handwritten">手写</option><option value="modern">现代</option></select></label><label><input type="checkbox" id="ws-poster-title-toggle">显示作品名称</label><label><input type="checkbox" id="ws-poster-meta">显示作品信息</label></div>
    <button type="button" class="ws-export-choice" data-export-v2="poster"><strong>作品海报 · PNG</strong><small>canonical grid 干净预览与自动同色系背景</small></button>
    <div class="ws-export-options"><strong>大型作品 · 104×104 板型分割</strong><span id="ws-board-summary">当前作品无需分板</span><label><input type="checkbox" id="ws-board-codes" checked>色号</label><label><input type="checkbox" id="ws-board-grid" checked>网格</label></div>
    <button type="button" class="ws-export-choice" data-export-v2="boards" id="ws-boards-choice"><strong>导出板型 ZIP</strong><small>零重叠、零重采样、尾板保持真实尺寸</small></button>
    <button type="button" class="ws-export-choice" data-ws-export="usage-csv"><strong>用豆清单 · CSV</strong></button><p class="ws-note" id="ws-export-message"></p>`;
  wrap.append(drawer);
  const exportV2 = createExportV2Service({
    getGrid: () => bridge.getResult().grid || [],
    getTitle: () => get().project.name || "未命名作品",
    getPaletteLabel: () => bridge.getResult().paletteLabel || get().palette.id || "MARD 221",
  });
  const confirmDialog = document.createElement("dialog"); confirmDialog.className = "ws-confirm-dialog";
  confirmDialog.innerHTML = `<p id="ws-confirm-text"></p><div><button type="button" id="ws-confirm-cancel">取消</button><button type="button" id="ws-confirm-ok">确认</button></div>`;
  wrap.append(confirmDialog);
  const askConfirmation = (message) => new Promise((resolve) => {
    confirmDialog.querySelector("#ws-confirm-text").textContent = message;
    const done = (accepted) => { confirmDialog.close(); resolve(accepted); };
    const ok = confirmDialog.querySelector("#ws-confirm-ok"), cancel = confirmDialog.querySelector("#ws-confirm-cancel");
    ok.onclick = () => done(true); cancel.onclick = () => done(false);
    confirmDialog.oncancel = (event) => { event.preventDefault(); done(false); };
    confirmDialog.showModal();
  });

  const $ = (selector) => wrap.querySelector(selector);
  const symmetryOptions = () => {
    const result = bridge.getResult();
    const editor = get().editor;
    return { symmetry: {
      mode: editor.symmetryMode || "none",
      axisX: Number.isFinite(editor.symmetryAxisX) ? editor.symmetryAxisX : (result.width - 1) / 2,
      axisY: Number.isFinite(editor.symmetryAxisY) ? editor.symmetryAxisY : (result.height - 1) / 2,
    } };
  };
  const get = () => store.getState();
  function updateHistory() {
    store.setState({ editor: { history: { canUndo: editorService.canUndo(), canRedo: editorService.canRedo() }, outlinePreview: null } });
  }
  // ===================== Stage B1 §6：当前颜色的唯一写入口 =====================
  // 工作台里所有「改变当前颜色」都必须走下面两个函数。
  // 直接写 editor.selectedPaletteId 会让真源与镜像分叉 ——
  // tests/current-palette-id.test.mjs 有一道机械守卫，扫到裸写就红。
  //
  // **绝对不要写 editor.selectedColor**：经过 projectStore 适配器它落到
  // paletteState.selectedColor，那是 app.js 旧编辑器存**完整颜色对象**的槽位。
  // 工作台往那儿写字符串会把旧编辑器弄坏（它读 `.code`，拿到 undefined，
  // 于是「打开旧编辑器就把刚选的色清空」）。工作台侧的读一律走
  // readCurrentPaletteId() / currentPaletteId()。
  //
  // 为什么不干脆删掉 selectedPaletteId 镜像：它被工作台侧若干处兼容读取，
  // 一次性删字段的回归面太大。所以 currentPaletteId 是真源，
  // selectedPaletteId 降级为**只由这里写**的镜像。
  const paletteColors = () => editorService.getPaletteColors();
  /** 只设当前颜色，不动高亮。paletteId = null → 未选色（＝橡皮擦，§8）。 */
  const setCurrentPalette = (paletteId, extra = {}) => store.setState({ editor: { ...buildCurrentPalettePatch(paletteId, paletteColors()), ...extra } });
  /** 设当前颜色并把同色高亮一起指过去（选色格、用色统计卡、吸管都走它）。 */
  const activatePalette = (paletteId, extra = {}) => store.setState({ editor: { ...buildActivateColorPatch(paletteId, paletteColors()), ...extra } });
  /** 当前 paletteId（真源；未选色为 null）。 */
  const currentPaletteId = () => readCurrentPaletteId(get().editor);
  const syncLegacy = (result = bridge.getResult()) => {
    if (!result) return;
    store.setState({
      project: { name: result.sourceName?.replace(/\.[^.]+$/, "") || get().project.name },
      source: { image: result.sourceUrl || null, width: result.sourceWidth || 0, height: result.sourceHeight || 0 },
      // 画布宽高**只从 state 取**，不读任何 DOM。
      // 这里以前是 `result.width || Number(#granularity-input.value || 50)`：
      // 一旦去读那个 input，它就又成了尺寸真源（B0.1 §8 要拆的正是这条）。
      // 而且它只给宽度留了退路、高度走 state，两轴不对称 —— 高度那份才是对的做法。
      canvas: { width: result.width || get().canvas.width || 50, height: result.height || get().canvas.height || 50 },
      palette: { id: result.paletteKey, maxColors: result.maxColors, usedColors: result.usedColors },
      stats: { totalBeads: result.totalBeads, usedColors: result.usedColors, colors: result.colors },
      status: { hasSource: Boolean(result.sourceUrl), hasPattern: Boolean(result.grid?.length), generating: false, dirty: Boolean(result.manualEdited), generationError: null },
    });
  };
  // 像素倍数：识别结果 + 手动覆盖值。声明放在最前，保证导入事件先于尺寸逻辑就绪。
  let detectedMultiple = 1;
  // 生成尺寸草稿：**唯一自由度是长边格数**。
  // 滑杆 / 数字框 / 滚轮 / 方向键 / 预设都只改这个草稿，点「应用尺寸」才写进 bridge。
  // 声明必须早于 paint()：paint 会调 syncSizeUi()，晚声明会踩 TDZ。
  let longEdgeDraft = 104;
  // 草稿来源："auto"（像素倍数识别推导）| "manual"（用户显式指定）。
  // 只用于预设 chip 的高亮，不参与任何计算。
  let sizeOrigin = "auto";
  // 长边权威（Stage B4 P0）。**和 sizeOrigin 不是一回事**：
  //   sizeOrigin        = 「草稿现在这个值是不是手动来的」——拖滑杆就会变 manual
  //   longEdgeAuthority = 「用户有没有在「应用尺寸」上确认过」——只有点按钮才升级
  // 只有后者能挡住自动链。用户拖着滑杆但还没点应用时，自动识别仍然可以定尺寸。
  let longEdgeAuthority = LONG_EDGE_AUTHORITY.AUTO;
  /** 自动链被长边权威挡下的次数。只用于诊断与真机验收，不参与逻辑。 */
  let blockedAutoSizeWrites = 0;
  const setLongEdgeAuthority = (event) => {
    longEdgeAuthority = resolveLongEdgeAuthority(longEdgeAuthority, event);
    return longEdgeAuthority;
  };
  // 已经识别过的源图 URL，避免 paint 每次触发都重跑识别。
  let detectedForUrl = null;
  let detecting = false;
  // 当前源图的识别 Promise。首帧生成要等它 settle，否则会先按默认尺寸出一版、
  // 识别完再出一版 —— 那就是一次实打实的「触发风暴」。
  let multipleDetection = null;
  let multipleDetectionUrl = null;
  // 自动尺寸流程改过尺寸后，等下一次出图再适配窗口。
  // 不能在改尺寸的当下 fit：那一刻 getSize() 拿到的还是旧网格，会按旧尺寸算缩放。
  let fitOnNextResult = false;
  let gridRevision = 0;
  let inspectionState = createInspectionState();
  let structuralCache = { revision: -1, tinyMaxSize: -1, value: null };
  let diagnosticOverlayIssues = [];
  let diagnosticOverlayVisible = true;
  const ignoredIssueKeys = new Set();
  let repairPreview = null;
  let repairQueue = createRepairQueue([]);
  let repairSuggestions = [];
  window.addEventListener("libms:source-loaded", (event) => {
    editorService.clearHistory();
    ignoredIssueKeys.clear();
    repairPreview = null;
    // B4 §0：换源图 = 清除 user-explicit。这是两个清除口之一（另一个是「自动」档）。
    // 放在事件处理器最前面：下面的 scheduleInitialGeneration() 会用到这个权威值。
    setLongEdgeAuthority(LONG_EDGE_EVENT.SOURCE_REPLACED);
    blockedAutoSizeWrites = 0;
    sizeOrigin = "auto";
    store.setState({
      source: { image: event.detail.url, width: event.detail.width, height: event.detail.height },
      project: { name: event.detail.name.replace(/\.[^.]+$/, "") },
      stats: { totalBeads: 0, usedColors: 0, colors: [] },
      status: { hasSource: true, hasPattern: false, dirty: false, generationError: null },
      editor: { selectedCell: null, ...buildClearPalettePatch(), selection: null, hoveredCell: null },
    });
    // 像素倍数识别由 paint() 里的 detectMultipleFor() 统一驱动（覆盖导入与恢复会话两条路径）。
    // 首帧生成必须**等识别落地**：识别是异步的，先按默认尺寸出一版、识别完再出一版，
    // 就是一次实打实的「触发风暴」。成功与失败都要 settle，不能因为识别挂了就不出图。
    scheduleInitialGeneration();
  });
  // 尺寸权威变更（打开工程 / 人工标定 / 网格识别）要立刻反映到尺寸栏：
  // 锁定态、读数、控件可用性全都在 syncSizeUi() 里，这里只负责把它叫醒。
  window.addEventListener("libms:source-dimensions", () => { syncSizeUi(); });
  window.addEventListener("libms:source-transform-changed", () => { store.setState({ status: { dirty: true } }); });
  window.addEventListener("libms:project-result", (event) => { const first = !get().status.hasPattern;
    editorService.invalidateUsageCounts();
    gridRevision += 1;
    repairPreview = null;
    if (!event.detail.manualEdited) { ignoredIssueKeys.clear(); editorService.clearHistory(); store.setState({ editor: { tool: "select", hoveredCell: null, selectedCell: null, ...buildClearPalettePatch(), selection: null } }); }
    syncLegacy(event.detail); updateHistory();
    // 首次出图、或尺寸刚被自动流程改过 → 适配窗口，保证「导入即可见全貌」。
    if ((first || fitOnNextResult) && event.detail.grid?.length) { fitOnNextResult = false; viewport.fitToViewport(); } });
  const activateBlankCanvas = () => {
    const color=editorService.getPaletteColors()[0]||null;
    editorService.clearHistory();ignoredIssueKeys.clear();repairPreview=null;
    store.setState({
      source:{image:"",width:0,height:0},
      stats:{totalBeads:0,usedColors:0,colors:[]},
      status:{hasSource:false,hasPattern:true,dirty:true,generationError:null},
      editor:{tool:"brush",selectedCell:null,...buildActivateColorPatch(color?paletteIdOf(color):null,paletteColors(),{highlight:false}),selection:null,hoveredCell:null,rampBasePaletteId:null,rampPaletteIds:[],inkMode:"normal"},
      ui:{activePanel:"color",exportDrawerOpen:false},
      view:{mode:"blocks"},
    });
    updateHistory();viewport.fitToViewport();renderPicker();
  };
  window.addEventListener("libms:blank-canvas-created", activateBlankCanvas);
  document.querySelector("#blank-board-modal")?.addEventListener("close", () => {
    const result=bridge.getResult();
    if (result?.sourceName==="blank-board" && result.grid?.length && !get().status.hasPattern) {
      syncLegacy(result);
      activateBlankCanvas();
    }
  });
  window.addEventListener("libms:generation-error", (event) => store.setState({ status: { generating: false, generationError: event.detail, notice: "", generationPhase: "" } }));
  // 生成阶段进度（B3 §30）：Worker 上报的真实阶段，翻成中文后写进 state。
  // 走 state 而不是直接改 DOM —— paint() 随时可能重绘，直接改会被覆盖。
  window.addEventListener("libms:generation-phase", (event) => {
    const label = event.detail?.label;
    if (label) store.setState({ status: { generationPhase: label } });
  });
  window.addEventListener("libms:grid-edited", (event) => {
    editorService.invalidateUsageCounts();
    gridRevision += 1;
    repairPreview = null;
    syncLegacy(event.detail);
    const selected = get().editor.selectedCell;
    if (selected) {
      const inspected = editorService.inspectCell(selected.x, selected.y);
      const paletteId = inspected?.paletteId || null;
      // 点到空格时**不要**把当前颜色清掉 —— 保留选色，只让高亮跟着走。
      // 这是原行为的语义（selectedColor 用 `||` 兜底），改成单真源后必须显式表达，
      // 否则「点一下空白就丢色」会变成新回归。
      const followsSelection = Boolean(get().editor.highlightedPaletteId);
      if (paletteId) store.setState({ editor: buildActivateColorPatch(paletteId, paletteColors(), { highlight: followsSelection }) });
      else if (followsSelection) store.setState({ editor: buildHighlightOnlyPatch(null, { enabled: false }) });
    }
    updateHistory();
    queueMicrotask(() => activateInspectionCurrent());
  });
  window.addEventListener("libms:legacy-editor-saved", () => { editorService.clearHistory(); store.setState({ editor: { tool: "select", hoveredCell: null, selectedCell: null, selection: null } }); });

  const brandNames = { mard: "MARD", coco: "COCO", manman: "漫漫", panpan: "盼盼", mixiaowo: "咪小窝" };
  // 第三方品牌（异步加载）的中文名由 app.js 写入 window.LibmsBrandLabels，优先于硬编码表。
  const brandLabel = (brand) => window.LibmsBrandLabels?.[brand] || brandNames[brand] || brand;
  const brands = () => [...new Set(palettes.getPalettes().map((key) => key.split("-")[0]))];
  function renderBrandOptions() {
    $("#ws-brand").innerHTML = brands().map((brand) => `<option value="${esc(brand)}">${esc(brandLabel(brand))}</option>`).join("");
  }
  renderBrandOptions();
  function refreshPaletteOptions() {
    const active = palettes.getActivePalette(); const [brand, size] = active.key.split("-");
    $("#ws-brand").value = brand;
    const sizes = palettes.getPalettes().filter((key) => key.startsWith(`${brand}-`)).map((key) => Number(key.split("-")[1])).sort((a,b) => b-a);
    $("#ws-palette-size").innerHTML = sizes.map((count) => `<option value="${count}">${count} 色</option>`).join("");
    $("#ws-palette-size").value = size;
  }
  refreshPaletteOptions();
  // 第三方品牌色板是异步 import 的，可能晚于本初始化；到达后重建下拉并恢复选中项。
  window.addEventListener("libms:brand-palettes-ready", () => {
    renderBrandOptions();
    refreshPaletteOptions();
  });

  right.querySelector(".ws-side-tabs").querySelectorAll("[data-ws-panel]").forEach((button) => button.addEventListener("click", () => store.setState({ ui: { activePanel: button.dataset.wsPanel } })));
  left.querySelectorAll("[data-ws-mode]").forEach((button) => button.addEventListener("click", () => setWorkspaceMode(button.dataset.wsMode)));
  dock.addEventListener("click", (event) => { const button = event.target.closest("[data-ws-view]"); if (button) store.setState({ view: { mode: button.dataset.wsView } }); });
  $("#ws-project-name").addEventListener("input", (event) => store.setState({ project: { name: event.target.value }, status: { dirty: true } }));

  // ── 全自动生成 ─────────────────────────────────────────────────────────
  // 改参数 / 算法 / 引擎 / 尺寸 / 色卡都直接触发重新生成，不再需要点「生成 / 更新」。
  // · 防抖 320ms：合并连点与滑块拖动，避免每拖一格就重算一次。
  // · 同一时刻只跑一次，期间到来的新请求合并成「下一轮」，不排队堆积。
  // · 有手动编辑时不静默覆盖：改状态栏提示，并放出「重新生成」按钮作为显式出口。
  let autoGenTimer = null, autoGenRunning = false, autoGenQueued = false;
  async function runAutoGenerate() {
    if (!get().status.hasSource) return;
    if (autoGenRunning) { autoGenQueued = true; return; }
    if (bridge.getResult().manualEdited) {
      store.setState({ status: { notice: "参数已改 · 手动编辑未覆盖，点「重新生成」覆盖" } });
      return;
    }
    autoGenRunning = true;
    try {
      await generation.generate({ overwriteApproved: true });
    } catch (error) {
      store.setState({ status: { notice: error.message } });
    } finally {
      autoGenRunning = false;
      if (autoGenQueued) { autoGenQueued = false; scheduleAutoGenerate(60); }
    }
  }
  function scheduleAutoGenerate(delay = 320) {
    if (autoGenTimer) clearTimeout(autoGenTimer);
    autoGenTimer = setTimeout(runAutoGenerate, delay);
  }

  // 面板实例只用于「渲染出右栏色彩面板」这一个副作用；尺寸已不经过它，
  // 所以不再需要向外暴露 setState 入口。
  const generationPanel = new GenerationPanel({
    root: "#generationPanel",
    initialState: { maxColors: get().palette.maxColors || 0 },
    // 这里只处理**非尺寸**参数。尺寸已经和这条链路彻底分开：
    // 它由顶栏草稿 +「应用尺寸」显式提交（见下方「生成尺寸」一节），
    // 所以拖尺寸滑杆不会走到 onChange，也就不会触发生成（B0 §5 / §7）。
    onChange: (settings) => {
      if (Number(settings.maxColors) !== get().palette.maxColors) palettes.setMaxColors(Number(settings.maxColors) || 0);
      // Stage B2 §17 §18：界面只有一个「去除纯色背景」开关（backgroundRemoval）。
      // 引擎读的是 autoBackground，所以这里把同一个值同时写给两者 ——
      // 面板的 emitSettings() 已经把镜像做好了，这里再兜一次，保证从任何路径进来都一致。
      const backgroundRemoval = Boolean(settings.backgroundRemoval);
      const backgroundRemovalWasOn = Boolean(get().generation.backgroundRemoval);
      store.setState({
        generation: { engine: get().generation.engine, algorithm: get().generation.algorithm || "current", preset: settings.preset, sampling: ({ edge: "edge-aware", mean: "linear-mean" })[settings.sampling] || settings.sampling, detailProtection: settings.detailProtection, edgeProtection: settings.edgeProtection, cleanupStrength: settings.cleanupStrength, preserveHighlights: settings.preserveHighlights, preserveEyes: settings.preserveEyes, preserveMicroDetails: settings.preserveMicroDetails, backgroundRemoval, autoBackground: backgroundRemoval, subjectCrop: Boolean(settings.subjectCrop), strokeProtection: Boolean(settings.strokeProtection), accentProtection: Boolean(settings.accentProtection), brightness: settings.brightness, contrast: settings.contrast, saturation: settings.saturation },
        status: { dirty: true },
      });
      // 刚把「去除纯色背景」从关打到开 → **不立刻生成**，先跑预检让用户确认（§6）。
      // 其他参数变化照旧直接重算。
      if (backgroundRemoval && !backgroundRemovalWasOn) {
        requestBackgroundPreview();
        return;
      }
      // 任何其他参数变化都直接重算 —— 顺手收起预检条：
      // 否则「预检还挂在画布下方、图纸却已经带着去背景重算过了」，
      // 等于绕过了用户确认这一步。
      hideBackgroundPreview();
      scheduleAutoGenerate();
    },
    onGenerate: async () => {
      if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
      try { await generation.generate({ overwriteApproved: true }); } catch (error) { store.setState({ status: { notice: error.message } }); }
    },
  });
  // ===================== Stage B2 §6：生成前背景预检 =====================
  // 「去除纯色背景」打开后**不立刻静默应用**。先跑一次轻量预检（长边封顶 160，
  // 见 services/background-preview-service.mjs），把结论摆到画布下方，由用户选
  // [应用] 还是 [保留背景]。
  //
  // 预检**不是放行凭证**：真正的判定在生成时由 generateV2 在真实格数上重跑一遍
  // （smart-preprocessing/background-reliability.mjs）。所以预检乐观一点也不会
  // 让主体被误删 —— 它只决定「要不要问用户」，不决定「删哪些格」。
  let backgroundPreviewRunning = false;

  function hideBackgroundPreview() {
    const strip = $("#ws-bg-preview");
    if (strip) strip.hidden = true;
  }

  /**
   * 预检跑不出来时的兜底：收起预检条 + **真的把生成发出去**。
   *
   * 只 `hideBackgroundPreview()` 是不够的 —— 条子消失了、图还是旧的、也没有任何
   * 提示。用户点了「小白一键」，模式高亮着，画布却没变，而且没有任何线索说明
   * 为什么。这正是本项目一直在清的那类「静默失效」形状：
   * 注释写着「静默退回直接生成」，代码却没生成。
   *
   * 兜底之后由引擎侧的可靠性门（B2）在**真实格数**上重新判定要不要去背景，
   * 所以这里不需要、也不应该在 UI 侧替它做决定。
   */
  function fallbackToDirectGeneration() {
    hideBackgroundPreview();
    scheduleAutoGenerate(0);
  }

  function showBackgroundPreview(result) {
    const strip = $("#ws-bg-preview");
    const text = $("#ws-bg-preview-text");
    const apply = $("#ws-bg-preview-apply");
    const keep = $("#ws-bg-preview-keep");
    const dismiss = $("#ws-bg-preview-dismiss");
    if (!strip || !text) return;
    const reliable = Boolean(result?.reliable);
    text.textContent = result?.message || "已保持原图。";
    strip.dataset.status = reliable ? "reliable" : "keep";
    if (apply) apply.hidden = !reliable;
    if (keep) keep.hidden = !reliable;
    if (dismiss) dismiss.hidden = reliable;
    strip.hidden = false;
  }

  /**
   * 跑一次背景预检。
   * 源图解码 / 裁剪变换由 app.js 侧完成（bridge.previewBackgroundRemoval），
   * 工作台只管「什么时候问、怎么显示」。
   */
  async function requestBackgroundPreview() {
    if (backgroundPreviewRunning) return;
    const strip = $("#ws-bg-preview");
    const text = $("#ws-bg-preview-text");
    if (!strip || !text) { scheduleAutoGenerate(0); return; }
    const size = bridge.getGenerationSize?.() || null;
    // 还没有源图 / 尺寸未解析 → 没有什么可预检的，直接按老路径生成。
    if (!size?.width || !size?.height || typeof bridge.previewBackgroundRemoval !== "function") {
      hideBackgroundPreview();
      scheduleAutoGenerate(0);
      return;
    }
    backgroundPreviewRunning = true;
    text.textContent = "正在检测背景…";
    strip.dataset.status = "probing";
    const apply = $("#ws-bg-preview-apply");
    const keep = $("#ws-bg-preview-keep");
    const dismiss = $("#ws-bg-preview-dismiss");
    if (apply) apply.hidden = true;
    if (keep) keep.hidden = true;
    if (dismiss) dismiss.hidden = true;
    strip.hidden = false;
    try {
      const result = await bridge.previewBackgroundRemoval({ width: size.width, height: size.height });
      if (!result) { fallbackToDirectGeneration(); return; }
      showBackgroundPreview(result);
    } catch {
      // 预检失败不该挡住生成：静默退回「直接生成」，由引擎侧的可靠性门兜底。
      fallbackToDirectGeneration();
    } finally {
      backgroundPreviewRunning = false;
    }
  }

  /** 用户选择「保留背景」：把开关真的关掉（面板 + state 一起），再生成。 */
  function keepBackgroundAndGenerate() {
    hideBackgroundPreview();
    generationPanel.setState({ backgroundRemoval: false }, false);
    store.setState({ generation: { backgroundRemoval: false, autoBackground: false } });
    scheduleAutoGenerate(0);
  }

  $("#ws-bg-preview-apply")?.addEventListener("click", () => { hideBackgroundPreview(); scheduleAutoGenerate(0); });
  $("#ws-bg-preview-keep")?.addEventListener("click", keepBackgroundAndGenerate);
  $("#ws-bg-preview-dismiss")?.addEventListener("click", () => { hideBackgroundPreview(); scheduleAutoGenerate(0); });

  $("#ws-engine").addEventListener("change", (event) => {
    const engine = event.target.value;
    bridge.setGenerationEngine(engine);
    store.setState({ generation: { engine }, status: { dirty: true } });
    scheduleAutoGenerate(0);
  });
  $("#ws-legacy-retry").addEventListener("click", async () => {
    $("#ws-engine").value = "legacy";
    bridge.setGenerationEngine("legacy");
    store.setState({ generation: { engine: "legacy" }, status: { generationError: null } });
    try { await generation.generate({ engine: "legacy", overwriteApproved: true }); }
    catch (error) { store.setState({ status: { generationError: error.message } }); }
  });
  $("#ws-bead-size").addEventListener("change", (event) => store.setState({ canvas: { beadSize: Number(event.target.value) } }));
  $("#ws-brand").addEventListener("change", (event) => { palettes.setActivePalette(event.target.value); refreshPaletteOptions(); scheduleAutoGenerate(0); });
  $("#ws-palette-size").addEventListener("change", (event) => { palettes.setActivePalette($("#ws-brand").value, Number(event.target.value)); refreshPaletteOptions(); scheduleAutoGenerate(0); });
  // 「重新生成」平时隐藏：只有存在手动编辑、自动生成主动让路时才出现，作为显式覆盖出口。
  $("#ws-generate").addEventListener("click", async () => { if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
    try { await generation.generate({ overwriteApproved: true }); } catch (error) { store.setState({ status: { notice: error.message } }); } });
  // 取消生成（B3 §29）：真 terminate Worker。被取消的那次以 AbortError 结束，
  // 不会写成「生成失败」，所以这里不需要额外压错误状态。
  //
  // 提示文案必须走 store 而不是直接写 #ws-status：直接写会被 setState 触发的
  // paint() 立刻覆盖成「已生成」，用户根本看不到自己那一下的结果（实测踩过）。
  $("#ws-cancel-generate").addEventListener("click", () => {
    const cancelled = bridge.cancelGeneration?.() === true;
    store.setState({
      status: {
        generating: false,
        generationError: null,
        notice: cancelled ? "已取消生成" : "当前没有正在进行的生成",
      },
    });
  });
  $("#ws-import-again").addEventListener("click", () => {
    // 必须在这次 click 的同步用户手势里打开文件选择器。经过异步 dialog/await 后，
    // Safari 与部分 Chromium 会把 input.click() 当成非用户触发并直接拦截。
    if (bridge.getResult().manualEdited && !window.confirm("换图会移除当前手动修改。继续吗？")) return;
    bridge.importImage({ overwriteApproved: true });
  });
  $("#ws-source-open").addEventListener("click", () => store.setState({ ui: { activePanel: "source" } }));
  $("#ws-new-blank").addEventListener("click", () => document.querySelector("#blank-board-modal")?.showModal());
  $("#ws-import-pattern").addEventListener("click", () => document.querySelector("#direct-pattern-file-input")?.click());
  $("#ws-save-project").addEventListener("click", () => { if (get().status.hasPattern) bridge.downloadProjectJson(); });
  const railPreferenceKey = "libms.workspace.toolRail.collapsed";
  const setRailCollapsed = (collapsed) => {
    left.classList.toggle("is-collapsed", collapsed);
    grid.style.setProperty("--ws-rail-width", collapsed ? "58px" : "102px");
    $("#ws-rail-collapse").textContent = collapsed ? "›" : "‹";
    $("#ws-rail-collapse").setAttribute("aria-label", collapsed ? "展开工具栏" : "收起工具栏");
    $("#ws-rail-collapse").title = collapsed ? "展开工具栏" : "收起工具栏";
    try { localStorage.setItem(railPreferenceKey, collapsed ? "1" : "0"); } catch {}
    requestAnimationFrame(() => { viewport?.fitToViewport?.(); navigator?.requestDraw?.(); });
  };
  try { setRailCollapsed(localStorage.getItem(railPreferenceKey) === "1"); } catch { setRailCollapsed(false); }
  $("#ws-rail-collapse").addEventListener("click", () => setRailCollapsed(!left.classList.contains("is-collapsed")));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") top.querySelector(".ws-project-menu")?.removeAttribute("open"); });
  $("#ws-open-editor").addEventListener("click", () => bridge.openEditor());
  $("#ws-making").addEventListener("click", () => bridge.openMaking());
  // 旧页面曾在同一按钮上绑定“直接打开图纸预览”。捕获阶段截断它，统一只进入 Export V2。
  const legacyExportButton=$("#ws-export"),exportButton=legacyExportButton.cloneNode(true);
  exportButton.removeAttribute("onclick");legacyExportButton.replaceWith(exportButton);
  exportButton.addEventListener("click", (event) => { event.preventDefault();event.stopPropagation();store.setState({ ui: { exportDrawerOpen: true } });setTimeout(() => { drawer.classList.add("open");refreshPosterPreview(); }, 0); });
  $("#ws-export-close").addEventListener("click", () => { store.setState({ ui: { exportDrawerOpen: false } }); drawer.classList.remove("open"); });
  drawer.addEventListener("click", async (event) => { const button = event.target.closest("[data-ws-export]"); if (!button) return; try { $("#ws-export-message").textContent = "正在准备导出…"; await exports.export(button.dataset.wsExport); $("#ws-export-message").textContent = "已启动下载"; } catch (error) { $("#ws-export-message").textContent = error.message; } });
  const posterConfig=()=>({ratio:$("#ws-poster-ratio").value,background:$("#ws-poster-background").value,solidColor:$("#ws-poster-solid-color").value,artworkSize:$("#ws-poster-size").value,backing:$("#ws-poster-backing").value,brand:$("#ws-poster-brand").value,showLogo:$("#ws-poster-logo").checked,signatureText:$("#ws-poster-signature").value,signaturePrefix:$("#ws-poster-prefix").value,signatureStyle:$("#ws-poster-style").value,showTitle:$("#ws-poster-title-toggle").checked,showMetadata:$("#ws-poster-meta").checked});
  let posterPreviewToken=0;const refreshPosterPreview=async()=>{if(!get().status.hasPattern)return;const token=++posterPreviewToken,preview=await exportV2.previewPoster(posterConfig(),{width:300});if(token!==posterPreviewToken)return;const canvas=$("#ws-poster-preview"),ctx=canvas.getContext("2d");canvas.width=preview.width;canvas.height=preview.height;ctx.drawImage(preview,0,0);};
  ["ws-poster-ratio","ws-poster-background","ws-poster-size","ws-poster-backing","ws-poster-brand","ws-poster-logo","ws-poster-signature","ws-poster-prefix","ws-poster-style","ws-poster-title-toggle","ws-poster-meta"].forEach(id=>$("#"+id).addEventListener(id==="ws-poster-signature"?"input":"change",()=>{$("#ws-poster-solid-controls").hidden=$("#ws-poster-background").value!=="solid";refreshPosterPreview();}));
  $("#ws-poster-solid-color").addEventListener("input",event=>{$("#ws-poster-solid-hex").value=event.target.value.toUpperCase();refreshPosterPreview();});
  $("#ws-poster-solid-hex").addEventListener("input",event=>{if(/^#[0-9a-f]{6}$/i.test(event.target.value)){$("#ws-poster-solid-color").value=event.target.value;refreshPosterPreview();}});
  drawer.addEventListener("click", async (event) => { const button=event.target.closest("[data-export-v2]");if(!button)return;const options={quality:$("#ws-export-quality").value,showGrid:$("#ws-export-grid").checked,showCodes:$("#ws-export-codes").checked};try{$("#ws-export-message").textContent="正在以目标分辨率绘制…";if(button.dataset.exportV2==="png")await exportV2.png(options);else if(button.dataset.exportV2==="pdf")await exportV2.pdf(options);else if(button.dataset.exportV2==="pixler")await exportV2.pixler();else if(button.dataset.exportV2==="poster")await exportV2.poster(posterConfig());else await exportV2.boards({showCodes:$("#ws-board-codes").checked,showGrid:$("#ws-board-grid").checked});$("#ws-export-message").textContent="已启动下载";}catch(error){$("#ws-export-message").textContent=error.message;}});
  $("#ws-export-title").addEventListener("input",event=>store.setState({project:{name:event.target.value},status:{dirty:true}}));
  $("#ws-export-quality").addEventListener("change",()=>paint(get(),{exportSettings:get().exportSettings}));
  [["#ws-export-grid","showGrid"],["#ws-export-codes","showCodes"],["#ws-export-coords","showCoordinates"]].forEach(([selector, field]) => $(selector).addEventListener("change", (event) => store.setState({ exportSettings: { pattern: { ...get().exportSettings.pattern, [field]: event.target.checked } } })));
  $("#ws-grid").addEventListener("change", (event) => store.setState({ view: { showGrid: event.target.checked } }));
  $("#ws-codes").addEventListener("change", (event) => store.setState({ view: { showCodes: event.target.checked } }));
  viewBar.addEventListener("click", (event) => { const button = event.target.closest("[data-ws-view]"); if (button) store.setState({ view: { mode: button.dataset.wsView } }); });
  const well = $("#ws-canvas-well"), layers = $("#ws-canvas-layers");
  const viewport = createViewportService(store, () => ({ viewportWidth: well.clientWidth, viewportHeight: well.clientHeight,
    gridWidth: bridge.getResult().width || 0, gridHeight: bridge.getResult().height || 0 }));
  const effectiveReference=()=>{const s=get();return {...s.reference,url:s.reference.url||(s.reference.useSource!==false?s.source.image:"")};};
  const renderer = createCanvasRenderer(layers, viewport, () => bridge.getResult(), () => get().view, () => get().editor, effectiveReference, (code) => editorService.resolveColor(code), () => diagnosticOverlayVisible ? diagnosticOverlayIssues : [], () => repairPreview);
  const navigatorHost = document.createElement("aside");
  well.append(navigatorHost);
  const navigator = Navigator({
    host: navigatorHost,
    getResult: () => bridge.getResult(),
    getView: () => get().view,
    getViewportSize: () => ({ width: well.clientWidth, height: well.clientHeight }),
    getGridRevision: () => gridRevision,
    onNavigate: (x, y) => viewport.focusCell(x, y, { center: true, preserveZoom: true }),
  });
  const sourceCanvas = $("#ws-source-canvas"), sourcePreview = $("#ws-source-preview");
  let sourceImage = null, sourceImageUrl = "", sourceLayout = null, sourceDrawPending = false, sourceDrag = null;
  const requestSourceDraw = () => { if (!sourceDrawPending) { sourceDrawPending = true; requestAnimationFrame(drawSourceEditor); } };
  const loadSourceEditorImage = () => {
    const url = bridge.getResult().sourceOriginalUrl;
    if (!url || url === sourceImageUrl) return;
    sourceImageUrl = url; sourceImage = null;
    const image = new Image(); image.onload = () => { if (sourceImageUrl === url) { sourceImage = image; requestSourceDraw(); } }; image.src = url;
  };
  const drawSourceEditor = () => {
    sourceDrawPending = false; if (get().ui.activePanel !== "source") return;
    loadSourceEditorImage(); if (!sourceImage) return;
    const dpr = Math.min(3,Math.max(1,window.devicePixelRatio||1)), w=well.clientWidth,h=well.clientHeight;
    sourceCanvas.width=Math.round(w*dpr); sourceCanvas.height=Math.round(h*dpr);
    sourceCanvas.style.width=`${w}px`; sourceCanvas.style.height=`${h}px`;
    const context=sourceCanvas.getContext("2d"); context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,w,h);
    const scale=Math.min(Math.max(1,w-100)/sourceImage.naturalWidth,Math.max(1,h-100)/sourceImage.naturalHeight,1);
    sourceLayout={x:(w-sourceImage.naturalWidth*scale)/2,y:(h-sourceImage.naturalHeight*scale)/2,width:sourceImage.naturalWidth*scale,height:sourceImage.naturalHeight*scale};
    context.drawImage(sourceImage,sourceLayout.x,sourceLayout.y,sourceLayout.width,sourceLayout.height);
    const transform=bridge.getSourceTransform(), crop=transform.crop;
    if (crop) { const x=sourceLayout.x+crop.x*scale,y=sourceLayout.y+crop.y*scale,cw=crop.width*scale,ch=crop.height*scale;
      context.fillStyle="rgba(14,25,34,.45)"; context.fillRect(sourceLayout.x,sourceLayout.y,sourceLayout.width,Math.max(0,y-sourceLayout.y));
      context.fillRect(sourceLayout.x,y,Math.max(0,x-sourceLayout.x),ch); context.fillRect(x+cw,y,Math.max(0,sourceLayout.x+sourceLayout.width-x-cw),ch);
      context.fillRect(sourceLayout.x,y+ch,sourceLayout.width,Math.max(0,sourceLayout.y+sourceLayout.height-y-ch));
      context.strokeStyle="#ffffff";context.lineWidth=2;context.strokeRect(x,y,cw,ch); }
    const preview=renderSourceTransform(sourceImage,transform,660);
    sourcePreview.width=preview.width;sourcePreview.height=preview.height;
    sourcePreview.getContext("2d").drawImage(preview,0,0);
    const geometry=sourceOutputGeometry(sourceImage.naturalWidth,sourceImage.naturalHeight,transform);
    $("#ws-source-size").textContent=`处理后 ${geometry.width} × ${geometry.height} px · 生成时才写入图纸。`;
  };
  const sourceNorm = (event) => { if (!sourceLayout) return null; const p=point(event);
    return {x:clamp((p.x-sourceLayout.x)/sourceLayout.width,0,1),y:clamp((p.y-sourceLayout.y)/sourceLayout.height,0,1)}; };
  const sampleOriginalSource = (norm) => {
    if (!sourceImage || !norm) return;
    const x=Math.min(sourceImage.naturalWidth-1,Math.floor(norm.x*sourceImage.naturalWidth)),y=Math.min(sourceImage.naturalHeight-1,Math.floor(norm.y*sourceImage.naturalHeight));
    const sample=document.createElement("canvas");sample.width=1;sample.height=1;
    const ctx=sample.getContext("2d",{willReadFrequently:true});ctx.drawImage(sourceImage,x,y,1,1,0,0,1,1);
    const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3);
    const hex="#"+rgb.map((channel)=>channel.toString(16).padStart(2,"0")).join("").toUpperCase();
    const matched=bridge.getNearestPaletteCandidates(rgb);
    $("#ws-source-sample").innerHTML=`<strong>原图 X${x+1} / Y${y+1} · RGB ${rgb.join(",")} · ${hex}</strong><p>现有色卡最近：${esc(matched.nearest || "—")}</p><div>${matched.candidates.map((color)=>`<button type="button" data-ws-source-candidate="${esc(color.code)}"><span class="ws-swatch" style="background:${esc(color.hex)}"></span>${esc(color.code)} · ΔE ${color.distance.toFixed(1)}</button>`).join("")}</div>`;
  };
  const setSourcePatch = (patch) => { bridge.setSourceTransform(patch); requestSourceDraw(); };
  $("#ws-source-ratio").addEventListener("change", (event) => setSourcePatch({cropRatio:event.target.value}));
  right.querySelectorAll("[data-ws-source-rotate]").forEach((button) => button.addEventListener("click", () => setSourcePatch({rotation:(bridge.getSourceTransform().rotation+Number(button.dataset.wsSourceRotate)+360)%360})));
  right.querySelectorAll("[data-ws-source-flip]").forEach((button) => button.addEventListener("click", () => { const key=button.dataset.wsSourceFlip; setSourcePatch({[key]:!bridge.getSourceTransform()[key]}); }));
  right.querySelectorAll("[data-ws-source-adjust]").forEach((input) => input.addEventListener("input", () => { const key=input.dataset.wsSourceAdjust; $("#ws-source-"+key+"-value").textContent=input.value; setSourcePatch({[key]:Number(input.value)}); }));
  right.querySelectorAll("[data-ws-source-expand]").forEach((input) => input.addEventListener("input", () => { if (input.value === "" || Number(input.value) < 0) return; setSourcePatch({expand:{[input.dataset.wsSourceExpand]:clamp(Number(input.value),0,500)}}); }));
  $("#ws-source-background").addEventListener("input", (event) => setSourcePatch({background:event.target.value}));
  $("#ws-source-pick-mode").addEventListener("click", () => store.setState({editor:{tool:"source-eyedropper"},ui:{activePanel:"source"}}));
  $("#ws-source-sample").addEventListener("click", (event) => { const button=event.target.closest("[data-ws-source-candidate]"); if (button) activateColor(button.dataset.wsSourceCandidate,false); });
  $("#ws-source-reset").addEventListener("click", () => { setSourcePatch(defaultSourceTransform()); $("#ws-source-ratio").value="free"; right.querySelectorAll("[data-ws-source-adjust]").forEach((input)=>{input.value="0"; $("#ws-source-"+input.dataset.wsSourceAdjust+"-value").textContent="0";});right.querySelectorAll("[data-ws-source-expand]").forEach((input)=>{input.value="0";});$("#ws-source-background").value="#ffffff"; });
  $("#ws-source-apply").addEventListener("click", async () => { if (bridge.getResult().manualEdited && !await askConfirmation("重新生成将覆盖当前人工编辑。继续吗？")) return;
    try { await generation.generate({overwriteApproved:true}); store.setState({ui:{activePanel:"project"}}); } catch(error) { $("#ws-source-size").textContent=error.message; } });
  let zoomControls;
  zoomControls = new ZoomControls({
    root: "#zoomControls",
    value: Math.round(get().view.zoom * 100),
    onChange: (value) => viewport.setZoom(value / 100),
    onFit: () => viewport.fitToViewport(),
  });
  const point = (event) => { const rect = well.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  well.addEventListener("wheel", (event) => {
    if (!get().status.hasPattern) return;
    event.preventDefault(); viewport.zoomAroundPoint(get().view.zoom * Math.exp(-event.deltaY * 0.0015), point(event));
  }, { passive: false });
  // 右键在画布上用于取色，禁掉浏览器默认右键菜单，否则会和取色手势冲突。
  well.addEventListener("contextmenu", (event) => event.preventDefault());
  let drag = null, spaceDown = false;
  // 文字面板实例在下面（notify 定义之后）才创建：这里先声明，好让画布的指针分支
  // 能在闭包里引用到它 —— 指针回调是运行时才执行的，那时已经赋值。
  let textPanel = null;
  // 用 function 声明（会提升）而不是 const 箭头：画布指针分支注册得比这里早，
  // 虽然回调是运行时执行，但保持「谁先注册都能引用」的写法更不容易踩 TDZ。
  function currentTextLayers() { return get().editor.textLayers || []; }
  function setTextLayers(layers, activeId = null) { store.setState({ editor: { textLayers: layers, activeTextLayerId: activeId } }); }
  function textDropPoint() {
    const { w, h } = gridSize();
    const origin = viewport.origin(), cell = origin.cell || BASE_CELL;
    const x = (well.clientWidth / 2 - origin.x) / cell;
    const y = (well.clientHeight / 2 - origin.y) / cell;
    return { x: clamp(Math.round(x), 0, Math.max(0, w - 1)), y: clamp(Math.round(y), 0, Math.max(0, h - 1)) };
  }
  function addTextLayer(at = textDropPoint()) {
    if (!get().status.hasPattern) { notify("先生成图纸，再添加文字。"); return null; }
    // 当前色走真源；真源为空时退到色板第一色（保留原行为）。
    // 工作台上 paletteId 恒等于色号 code，所以 color 与 paletteId 写同一个值。
    const fallback = editorService.getPaletteColors()[0];
    const id = currentPaletteId() || (fallback ? paletteIdOf(fallback) : "");
    const layer = createTextLayer({ x: at.x, y: at.y, color: id || "", paletteId: id || "" });
    setTextLayers([...currentTextLayers(), layer], layer.id);
    store.setState({ editor: { tool: "text" }, ui: { activePanel: "edit" }, view: { mode: "blocks" } });
    renderer.requestDraw();
    return layer;
  }
  // ---- 形状工具：约束与预览 ----
  // Shift 把终点吸附到 8 个方向（直线）或等比外接框（矩形 / 圆形）。
  // 吸附在「格坐标」上完成，所以预览与最终落笔用的是同一组整数，不会出现半格误差。
  const constrainShapeEnd = (kind, start, end, constrain) => {
    if (!constrain) return end;
    const dx = end.x - start.x, dy = end.y - start.y;
    if (kind !== "line") {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: start.x + (dx < 0 ? -size : size), y: start.y + (dy < 0 ? -size : size) };
    }
    const length = Math.round(Math.hypot(dx, dy));
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: start.x + Math.round(Math.cos(angle) * length), y: start.y + Math.round(Math.sin(angle) * length) };
  };
  const shapeOptions = () => ({ filled: get().editor.shapeFilled, size: get().editor.brushSize, shape: "round" });
  const updateShapePreview = (end, constrain) => {
    if (drag?.type !== "shape") return;
    const target = constrainShapeEnd(drag.kind, drag.start, end, constrain);
    drag.end = target;
    const cells = editorService.previewShape(drag.kind, drag.start, target, shapeOptions());
    const selectedId = currentPaletteId();
    const color = selectedId ? editorService.resolveColor(selectedId) : null;
    store.setState({ editor: { shapePreview: { cells, hex: color?.hex || null } } });
  };
  well.addEventListener("pointerdown", (event) => {
    if (get().ui.activePanel === "source") { const norm=sourceNorm(event); if (!norm || !sourceImage || !sourceLayout || event.button !== 0) return;
      if (get().editor.tool === "source-eyedropper") { sampleOriginalSource(norm); return; }
      well.setPointerCapture(event.pointerId); sourceDrag={ start:norm, previous:bridge.getSourceTransform().crop, moved:false }; return; }
    if (!get().status.hasPattern) return;
    if(get().reference.adjusting&&effectiveReference().url&&event.button===0){well.setPointerCapture(event.pointerId);drag={type:"reference",x:event.clientX,y:event.clientY,reference:{...get().reference}};return;}
    const selectedTool = get().editor.tool, tool = event.altKey ? "eyedropper" : selectedTool, p = point(event), cell = viewport.screenToGrid(p.x, p.y);
    // 右键取色：在任意工具下都能从画布取色设为当前色，不切换工具、不改图纸。
    // 与「取色」工具的区别：工具是点一下取完自动切回画笔；右键是纯取色，工具态不动。
    if (event.button === 2 && cell) {
      const picked = editorService.getCell(cell.x, cell.y);
      if (picked) activateColor(paletteIdOf(picked), false);
      return;
    }
    if (tool === "pan" || spaceDown || event.button === 1) {
      well.setPointerCapture(event.pointerId); drag = { type: "pan", x: event.clientX, y: event.clientY, panX: get().view.panX, panY: get().view.panY };
      well.classList.add("is-panning"); return;
    }
    if (event.button !== 0 || get().view.mode === "original") return;
    if (tool === "replace" && cell) {
      const code = editorService.getCell(cell.x, cell.y)?.code || "";
      $("#ws-replace-from").value = code;
      $("#ws-replace-impact").textContent = `影响 ${affectedCount(code).toLocaleString("zh-CN", { useGrouping: false })} 颗`;
      store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "color" } }); return;
    }
    if (tool === "region" && cell) { well.setPointerCapture(event.pointerId); drag = { type: "region", start: cell }; store.setState({ editor: { selection: rectangularSelection(cell.x, cell.y, cell.x, cell.y, bridge.getResult().width, bridge.getResult().height) } }); return; }
    if (tool === "wand" && cell) {
      // 默认「重新圈选」；按住 Shift 在当前选区内叠加，按住 Alt 从当前选区里减掉。
      // 默认就限制在旧选区内会让人点不出新区域，这个交互坑过一次，故改为行业惯用的修饰键语义。
      const current = get().editor.selection;
      let selection;
      if (event.altKey && current?.mask) {
        const hits = magicWandSelection(bridge.getResult().grid, cell.x, cell.y, { tolerance: get().editor.wandTolerance });
        const rest = hits?.mask
          ? [...current.mask].filter((id) => !hits.mask.has(id)).map((id) => { const [x, y] = id.split(",").map(Number); return { x, y }; })
          : [];
        selection = fitSelectionBox(rest, "magic-wand");
      } else {
        selection = magicWandSelection(bridge.getResult().grid, cell.x, cell.y, { tolerance: get().editor.wandTolerance, within: event.shiftKey ? current : null });
      }
      store.setState({ editor: { selection, selectedCell: cell }, ui: { activePanel: "edit" } }); return;
    }
    if (SHAPE_TOOLS[tool] && cell) {
      if (!currentPaletteId()) { store.setState({ ui: { activePanel: "edit" } }); return; }
      well.setPointerCapture(event.pointerId);
      drag = { type: "shape", kind: SHAPE_TOOLS[tool], start: cell, end: cell };
      updateShapePreview(cell, event.shiftKey);
      return;
    }
    if (["same","connected"].includes(tool) && cell) { const original = get().editor.selection, selection = tool === "same" ? sameColorSelection(bridge.getResult().grid, cell.x, cell.y, original) : connectedSelection(bridge.getResult().grid, cell.x, cell.y, original); store.setState({ editor: { selection, selectedCell: cell }, ui: { activePanel: "edit" } }); return; }
    if (tool === "fill" && cell) { const selected=currentPaletteId(); if(selected) editorService.fillAt(cell.x,cell.y,selected); store.setState({editor:{selectedCell:cell},ui:{activePanel:"edit"}}); return; }
    if (["brush","eraser"].includes(tool) && cell) {
      const selected = currentPaletteId();
      if (tool === "brush" && !selected) { store.setState({ ui: { activePanel: "edit" } }); return; }
      well.setPointerCapture(event.pointerId); drag = { type: "stroke" };
      const editor=get().editor,baseId=editor.rampBasePaletteId||selected;
      const rampData=rampCache(),rampPaletteIds=editor.rampPaletteIds?.length?editor.rampPaletteIds:buildRamp(rampData.palette,baseId,{size:editor.rampSize||5,cache:rampData.cache}).map(color=>color.paletteId);
      editorService.beginStroke(tool === "brush" ? selected : null, { size:editor.brushSize, shape:"square", pixelPerfect:editor.pixelPerfect, inkMode:tool==="brush"?(editor.inkMode||"normal"):"normal",rampPaletteIds, ...symmetryOptions() });
      editorService.strokeCell(cell.x, cell.y); renderer.requestDraw();
      return;
    }
    if (tool === "eyedropper" && cell) {
      // §7：吸管只读格子的颜色身份（paletteIdOf → cell.code），**绝不按 RGB 反猜**。
      const color = editorService.getCell(cell.x, cell.y); if (color) activateColor(paletteIdOf(color),false);
      store.setState({ editor: { selectedCell:cell, ...(selectedTool === "eyedropper" ? {tool:"brush"} : {}) }, ui: { activePanel: "edit" } }); return;
    }
    if (tool === "bead" && cell) {
      const selected = currentPaletteId();
      if (selected) editorService.setCellColor(cell.x, cell.y, selected);
      store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "edit" } }); return;
    }
    // 文字工具：点已有文字 = 选中并拖动；点空白 = 就地新建一个图层。
    // 文字是「浮动图层」，只画在 overlay 层、不写 grid，所以从放到拖全程撤销栈都是干净的，
    // 只有「向下合并」才产生一步历史。
    if (tool === "text") {
      const { w, h } = gridSize();
      // 用连续格坐标（含小数）：拖动取整交给栅格化那一步，手感才连续不跳格。
      const at = viewport.screenToGridFloat(p.x, p.y);
      const hit = [...currentTextLayers()].reverse()
        .find((layer) => layerContainsCell(layer, w, h, Math.floor(at.x), Math.floor(at.y)));
      if (hit) {
        store.setState({ editor: { activeTextLayerId: hit.id } });
        well.setPointerCapture(event.pointerId);
        drag = { type: "text-move", id: hit.id, grabX: at.x - hit.x, grabY: at.y - hit.y, moved: false };
        renderer.requestDraw();
        return;
      }
      const selected = currentPaletteId();
      if (!selected) { store.setState({ ui: { activePanel: "edit" } }); notify("先在「色彩」里选一个色号，再在画布上放文字。"); return; }
      const layer = createTextLayer({ x: Math.round(at.x), y: Math.round(at.y), color: selected, paletteId: selected });
      setTextLayers([...currentTextLayers(), layer], layer.id);
      store.setState({ ui: { activePanel: "edit" } });
      well.setPointerCapture(event.pointerId);
      drag = { type: "text-move", id: layer.id, grabX: 0, grabY: 0, moved: false };
      renderer.requestDraw();
      return;
    }
    const inspected = cell ? editorService.inspectCell(cell.x, cell.y) : null;
    // §7：paletteId 一律来自 cell.paletteId（inspectCell → paletteIdOf），**绝不按 RGB 反猜**。
    const paletteId = inspected?.paletteId || null;
    store.setState({
      // 点到空格 / 画布外时**不覆盖当前颜色**，只挪选中格并把高亮清掉 —— 与原行为一致。
      editor: { selectedCell: cell, ...(paletteId ? buildActivateColorPatch(paletteId, paletteColors()) : buildHighlightOnlyPatch(null, { enabled: false })), selection: null },
      ui: { activePanel: cell ? "edit" : get().ui.activePanel },
    });
  });
  well.addEventListener("pointermove", (event) => {
    if (sourceDrag) { const norm=sourceNorm(event); if (!norm || !sourceImage) return;
      if (Math.abs(norm.x-sourceDrag.start.x)*sourceLayout.width+Math.abs(norm.y-sourceDrag.start.y)*sourceLayout.height < 5) return;
      sourceDrag.moved=true; setSourcePatch({crop:cropFromDrag(sourceDrag.start.x,sourceDrag.start.y,norm.x,norm.y,sourceImage.naturalWidth,sourceImage.naturalHeight,$("#ws-source-ratio").value)}); return; }
    if (!get().status.hasPattern) return;
    const p = point(event), cell = viewport.screenToGrid(p.x, p.y);
    if (drag?.type === "pan") { viewport.setPan(drag.panX + event.clientX - drag.x, drag.panY + event.clientY - drag.y); return; }
    if(drag?.type==="reference"){const cell=BASE_CELL*get().view.zoom;store.setState({reference:moveReference(drag.reference,event.clientX-drag.x,event.clientY-drag.y,cell)});return;}
    if (drag?.type === "region" && cell) { store.setState({ editor: { selection: rectangularSelection(drag.start.x, drag.start.y, cell.x, cell.y, bridge.getResult().width, bridge.getResult().height) } }); return; }
    if (drag?.type === "stroke") { if (cell) { editorService.strokeCell(cell.x, cell.y); renderer.requestDraw(); } return; }
    if (drag?.type === "shape") {
      // 形状用夹取后的坐标：拖出画布边界时端点停在边界格上，继续跟随鼠标。
      updateShapePreview(viewport.screenToGridClamped(p.x, p.y), event.shiftKey);
      return;
    }
    if (drag?.type === "text-move") {
      // 拖动只改浮动图层的 x/y，一格豆都不写：所以拖多远撤销栈都是干净的。
      // 不夹边界 —— 拖出画布时文字继续跟着走，否则会「粘」在边上。
      const at = viewport.screenToGridFloat(p.x, p.y);
      setTextLayers(currentTextLayers().map((layer) => (layer.id === drag.id ? { ...layer, x: at.x - drag.grabX, y: at.y - drag.grabY } : layer)), drag.id);
      return;
    }
    const old = get().editor.hoveredCell;
    if (old?.x !== cell?.x || old?.y !== cell?.y) store.setState({ editor: { hoveredCell: cell } });
  });
  const endDrag = (cancel = false) => { if (sourceDrag) { if (cancel && sourceDrag.moved) setSourcePatch({crop:sourceDrag.previous}); sourceDrag=null; requestSourceDraw(); }
    if (drag?.type === "stroke") cancel ? editorService.cancelStroke() : editorService.endStroke();
    if (drag?.type === "shape") {
      const selected = currentPaletteId();
      // 预览只活在 overlay 层，所以这里才产生唯一的一步历史；取消则直接丢弃预览。
      if (!cancel && selected) editorService.applyShape(drag.kind, drag.start, drag.end || drag.start, selected, shapeOptions());
      store.setState({ editor: { shapePreview: null } });
    }
    drag = null; well.classList.remove("is-panning"); renderer.requestDraw(); };
  well.addEventListener("pointerup", () => endDrag()); well.addEventListener("pointercancel", () => endDrag(true));

  // 色格墙一屏最多渲染多少个（§10 惰性渲染）。
  // 优肯 418 色一次性铺 418 个 button，且每个 button 的 title 都要查一次用量 ——
  // 那是 418 次 `getColorUsage`，而它内部是 `colorFor()` → `getPaletteColors()`
  // **整份克隆 + 线性查找**，等于点一次色号克隆 418 遍全色板。
  // 现在：先渲染一屏，用户要更多再点；用量改成一次 Map 查表。
  const PICKER_PAGE = 120;
  let pickerExpanded = false;
  let pickerSignature = "";
  function renderPicker() {
    const state = get();
    const palette = paletteColors();
    const series = state.editor.paletteCategory || "all";
    const query = $("#ws-color-search").value;
    // 系列片来自 registry 元数据（entry.group），不是 code 前缀猜的。
    // 盼盼 / 咪小窝的 7 个官方中文系列在这里才第一次真正出现在界面上。
    const seriesList = listPaletteSeries(palette);
    $("#ws-palette-categories").innerHTML = seriesList.length
      ? [`<button type="button" data-ws-category="all" class="${series === "all" ? "active" : ""}">全部 ${palette.length}</button>`,
        ...seriesList.map((entry) => `<button type="button" data-ws-category="${esc(entry.key)}" class="${series === entry.key ? "active" : ""}" title="${esc(entry.label)} · ${entry.count} 色">${esc(entry.label)} ${entry.count}</button>`)].join("")
      : "";
    $("#ws-recent-colors").innerHTML = state.editor.recentColors.length ? `最近 · ${state.editor.recentColors.map((code)=>`<button type="button" data-ws-pick="${esc(code)}">${esc(code)}</button>`).join("")}` : "";
    // 签名守卫：paint 会被高频调用（悬停、选区、缩放），签名不变就不重建 DOM。
    const selectedId = readCurrentPaletteId(state.editor);
    const signature = `${palette.length}|${series}|${query}|${selectedId}|${pickerExpanded}`;
    if (signature === pickerSignature) return;
    pickerSignature = signature;
    const matched = filterPaletteColors(palette, { series: series === "all" ? PALETTE_SERIES_ALL : series, query });
    const shown = pickerExpanded ? matched : matched.slice(0, PICKER_PAGE);
    // 用量一次性建表（一次 Map 构造），替掉逐色 getColorUsage 的全色板克隆。
    const usage = editorService.getPaletteUsageCounts();
    const cards = shown.map((color) => {
      const id = paletteIdOf(color);
      const used = usage.get(id) || 0;
      return `<button type="button" data-ws-pick="${esc(color.code)}" title="${esc(color.code)}${used ? ` · 图上 ${used} 颗` : " · 未使用"}" class="${selectedId === id ? "active" : ""}"><span style="background:${esc(color.hex)}"></span><small>${esc(color.code)}</small></button>`;
    });
    const more = !pickerExpanded && matched.length > shown.length
      ? `<button type="button" class="ws-picker-more" id="ws-picker-more">显示其余 ${matched.length - shown.length} 色</button>`
      : "";
    $("#ws-bead-picker").innerHTML = (cards.join("") + more) || '<p class="ws-note">没有匹配的色号。</p>';
    $("#ws-picker-count").textContent = matched.length === palette.length
      ? `${palette.length} 色`
      : `${matched.length} / ${palette.length} 色`;
  }
  // ── Stage C0 §16：导出分板摘要的缓存 ─────────────────────────────────
  // 声明点必须在 paint 定义**之前**：paint 会读它，而 `let` 在初始化前是 TDZ。
  // 为什么需要缓存见 paint 里那段注释 —— 一句话：exportV2.estimate() 和
  // exportV2.split() 都会走 export-v2-service.js 的 `grid()`，那是**整幅深拷贝**，
  // 代价按格数走，而 paint 在一次提交里会被叫醒多次。
  let boardSplitSignature = "";
  let boardSplitCache = null;
  const paint = (state, patch = {}) => {
    if (state.editor.outlinePreview && patch.editor && ["selection","selectedCell","selectedPaletteId"].some((key)=>Object.prototype.hasOwnProperty.call(patch.editor,key))) {
      store.setState({editor:{outlinePreview:null}}); return;
    }
    // 拖拽过程中的高频更新（悬停格、形状预览）只重绘画布，不走整块面板重建，
    // 否则每移动一格就要重排一次调色板与库存表，手感会拖沓。
    if (patch.editor && Object.keys(patch).length === 1 && Object.keys(patch.editor).every((key) => key === "hoveredCell" || key === "shapePreview")) { renderer.requestDraw(); return; }
    // 文字图层的高频更新（拖动、打字、拖字号滑块）同理：只重绘画布叠加层 + 刷新文字面板，
    // 走整块 paint 的话每动一下都要重排调色板和库存表，拖起来会明显发涩。
    if (patch.editor && Object.keys(patch).length === 1
      && Object.keys(patch.editor).every((key) => key === "textLayers" || key === "activeTextLayerId" || key === "textRecentColors")) {
      renderTextPanel(state); renderer.requestDraw(); return;
    }
    if (patch.view && Object.keys(patch).length === 1 && Object.keys(patch.view).every((key) => ["zoom","panX","panY"].includes(key))) {
      zoomControls.setZoom(Math.round(state.view.zoom * 100), false);
      $("#ws-canvas-hint").textContent = canvasHint(state.view);
      if (buildActive()) updateBuildOverlay();
      renderer.requestDraw(); navigator.requestDraw(); return;
    }
    const hasSource = state.status.hasSource, hasPattern = state.status.hasPattern;
    // 源图一变（新导入 / 恢复会话）就重新识别像素倍数。挂在 paint 上而不是只挂
    // libms:source-loaded，否则「恢复上次会话」这条路径永远识别不到，倍数会停在 1×。
    detectMultipleFor(state.source.image);
    importView.hidden = hasSource || hasPattern; canvas.hidden = !hasSource && !hasPattern;
    // 「重新生成」平时不显示：只有存在手动编辑、自动生成主动让路时，才作为显式覆盖出口出现。
    const manualEdited = Boolean(bridge.getResult().manualEdited);
    $("#ws-generate").hidden = !(hasSource && manualEdited);
    $("#ws-generate").disabled = !hasSource || state.status.generating;
    // 「生成」面板里的主要动作。它在 GenerationPanel 内部渲染，workspace 只负责
    // 按同一套可用性条件开关它（生成中 / 没源图 → 不可点），避免「点了没反应」。
    const regenerate = $("#ws-generation-regenerate");
    if (regenerate) regenerate.disabled = !hasSource || state.status.generating;
    // 「取消生成」只在真的在跑时出现（B3 §31）：大尺寸生成期间界面必须能操作。
    const cancelButton = $("#ws-cancel-generate");
    if (cancelButton) cancelButton.hidden = !state.status.generating;
    $("#ws-engine").value = state.generation.engine || "v2.5";
    $("#ws-source-open").hidden = !hasSource;
    right.querySelector('.ws-side-tabs [data-ws-panel="source"]').disabled = !hasSource;
    $("#ws-making").disabled = !hasPattern; $("#ws-export").disabled = !hasPattern; $("#ws-open-editor").disabled = !hasPattern;
    $("#ws-bead-size").disabled = !hasPattern;
    $("#ws-replace-confirm").disabled = !hasPattern;
    $("#ws-ref-pick").disabled = !hasPattern;
    // 状态栏文案优先级（Stage B3）：
    //   失败 > 最近一次提示（notice）> 生成中（含真实阶段文案）> 常规状态
    // notice / generationPhase 都从 state 读，**不再直接写 DOM** ——
    // 直接写会被紧接着的一次 paint 覆盖（实测「点了取消 → 显示已生成」）。
    $("#ws-status").textContent = state.status.generationError
      ? `生成失败：${state.status.generationError}`
      : state.status.notice
        ? state.status.notice
        : state.status.generating
          ? (state.status.generationPhase || "正在生成")
          : bridge.getResult().manualEdited ? "已手动编辑" : state.status.dirty ? "参数待更新" : hasPattern ? "已生成" : hasSource ? "图片已导入" : "未开始";
    $("#ws-legacy-retry").hidden = !state.status.generationError;
    if (document.activeElement !== top.querySelector("#ws-project-name")) top.querySelector("#ws-project-name").value = state.project.name;
    const activePalette = palettes.getActivePalette();
    $("#ws-project-meta").textContent = hasPattern
      ? `${state.canvas.width}×${state.canvas.height} · ${state.stats.usedColors}色 · ${state.stats.totalBeads.toLocaleString("zh-CN", { useGrouping: false })}颗 · ${activePalette.key}`
      : hasSource ? "图片已导入 · 等待生成" : "尚未创建图纸";
    // Stage C0 §11：Tab 切换只有 **一个真源** —— `state.ui.activePanel`。
    // 这里只负责把真源映射到 DOM（active 类 + panel.hidden），不持有任何自己的 tab 状态。
    right.querySelector(".ws-side-tabs").querySelectorAll("[data-ws-panel]").forEach((button) => { button.classList.toggle("active", button.dataset.wsPanel === state.ui.activePanel); button.disabled = button.dataset.wsPanel === "source" && !hasSource; });
    right.querySelectorAll("[data-ws-inspector]").forEach((panel) => { panel.hidden = panel.dataset.wsInspector !== state.ui.activePanel; });
    const titles = { project: "作品", source: "图片调整", generation: "生成", color: "色彩", edit: "编辑", check: "检查", material: "材料", build: "施工" };
    const subtitles = { project: "当前设计", source: "原图对象", generation: "输出规格", color: "色号与用量", edit: "对象与工具", check: "校验结果", material: "备料与台账", build: "分块施工" };
    $("#ws-inspector-title").textContent = titles[state.ui.activePanel] || "";
    const subtitleNode = $("#ws-inspector-subtitle");
    if (subtitleNode) subtitleNode.textContent = subtitles[state.ui.activePanel] || "";
    // 施工模式下右栏整体换成施工面板，6 个 tab 收起
    const buildMode = document.body.classList.contains("ws-mode-build");
    right.querySelector(".ws-side-tabs").hidden = buildMode;
    left.querySelectorAll("[data-ws-mode]").forEach((button) => button.classList.toggle("active", button.dataset.wsMode === (buildMode ? "build" : "edit")));
    const sourceActive=state.ui.activePanel === "source" && hasSource;
    sourceCanvas.hidden = !sourceActive; layers.style.visibility = sourceActive ? "hidden" : "visible";
    if (sourceActive) requestSourceDraw();
    $("#ws-bead-size").value = String(state.canvas.beadSize);
    $("#ws-physical-size").textContent = state.status.dirty && !bridge.getResult().manualEdited ? "参数已修改 · 重新生成后显示实际尺寸" : hasPattern ? `${state.canvas.width} × ${state.canvas.height} 豆 · 约 ${(state.canvas.width * state.canvas.beadSize / 10).toFixed(1)} × ${(state.canvas.height * state.canvas.beadSize / 10).toFixed(1)} cm` : "导入后显示实际尺寸";
    $("#ws-used-colors").textContent = hasPattern ? `实际使用 ${state.stats.usedColors} 色 · ${state.stats.totalBeads.toLocaleString("zh-CN", { useGrouping: false })} 颗${state.palette.maxColors > 0 && state.stats.usedColors > state.palette.maxColors ? ` · 手动编辑超过生成限制 ${state.palette.maxColors} 色` : ""}` : "尚未生成";
    // §12：横向用色统计条。按 gridRevision 判陈旧 —— 只在图纸真的变了才重建，
    // 悬停/选区这类高频 paint 不会碰它。
    renderUsageIfStale();
    // §21：共享色号清单只在色板变化时重建（签名守卫），不再是每次 paint 重建 5 份。
    renderPaletteDatalist();
    // 画布下方的用量汇总条：这里同样只在数值真的变了才写 DOM（paint 每次状态变化都会被调用）。
    const statsBar = $("#ws-canvas-stats");
    if (statsBar) {
      const colorText = (hasPattern ? state.stats.usedColors : 0).toLocaleString("zh-CN", { useGrouping: false });
      const beadText = (hasPattern ? state.stats.totalBeads : 0).toLocaleString("zh-CN", { useGrouping: false });
      const colorNode = $("#ws-stats-colors"), beadNode = $("#ws-stats-beads");
      if (colorNode && colorNode.textContent !== colorText) colorNode.textContent = colorText;
      if (beadNode && beadNode.textContent !== beadText) beadNode.textContent = beadText;
      statsBar.classList.toggle("is-empty", !hasPattern);
    }
    // 施工模式：图纸变了要重算区块与颜色，视图变了要重定位叠加层
    if (buildActive()) { if (patch.stats || patch.status) { renderBlockMap(); renderBlockColors(); } updateBuildOverlay(); }
    navigator.requestDraw();
    // 「当前使用色」竖列面板已删除（B1 §11）。
    // 删除理由（不是审美）：
    //   1) 它的数据源 state.stats.colors 是**生成期**统计（app.js calculateStats，按 code 聚合），
    //      手动编辑后立刻陈旧 —— 面板上的数字会骗人；
    //   2) 它点击只写 highlightedColor，与 paletteId 高亮是两套机制，互相盖；
    //   3) 实时数据本来就有：services/palette-usage.js 的 getPaletteIndex() 走 paletteId，
    //      随每次 grid-edited 失效重算。
    // 现在由右栏横向「用色统计」条承担（下方 renderUsageStrip）。
    if (patch.stats || patch.status) {
      // §21：#ws-merge-target 已改为共享 datalist 的输入框（原来每次 paint 重建整份色板 <select>）。
      // 来源色多选框保持 <select multiple>：它的选项来自**图上用到的颜色**（通常几十个），
      // 不是整份色板，所以没有 418 选项的问题，保留多选语义更省事。
      const priorSources=new Set([...$("#ws-merge-sources").selectedOptions].map((option)=>option.value));
      const mergeOptions=state.stats.colors.map((color)=>{const resolved=editorService.resolveColor(color.code),id=paletteIdOf(resolved);return `<option value="${esc(id)}" ${priorSources.has(id)?"selected":""}>${esc(color.code)} · ${color.count}颗</option>`;}).join("");
      $("#ws-merge-sources").innerHTML=mergeOptions;
    }
    const checks = bridge.getChecks(); $("#ws-check-results").innerHTML = hasPattern ? `<p>尺寸：${state.canvas.width} × ${state.canvas.height}</p><p>颜色：${state.stats.usedColors} 色${checks.validation?.valid === false ? " · 超出当前上限" : " · 已校验"}</p>${checks.structural ? `<p>结构检测：${esc(JSON.stringify(checks.structural))}</p>` : ""}` : "生成后显示可验证的尺寸、色数与结构报告。";
    // ── Stage C0 §4：生成状态（「正在分析图片…」这类人话）也进「生成」面板 ──
    // 文案只从 state.status.generationPhase 取，**不在这里重写一份**（app.js 的
    // PHASE_LABELS 是唯一来源，见 tests/generation-status-notice.test.mjs §16）。
    const generationStatusNode = $("#ws-generation-status");
    if (generationStatusNode) {
      generationStatusNode.textContent = state.status.generationError
        ? `生成失败：${state.status.generationError}`
        : state.status.generating
          ? (state.status.generationPhase || "正在生成")
          : bridge.getResult().manualEdited ? "已手动编辑 · 可重新生成覆盖" : hasPattern ? "已生成" : hasSource ? "图片已导入 · 等待生成" : "尚未生成";
    }
    renderMaterial(state);
    viewBar.querySelectorAll("[data-ws-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.wsView === state.view.mode);
      button.disabled = button.dataset.wsView === "original" ? !hasSource : !hasPattern;
    });
    $("#ws-compare").disabled = !hasSource;
    $("#ws-grid").disabled = !hasPattern; $("#ws-codes").disabled = !hasPattern;
    $("#ws-grid").checked = state.view.showGrid; $("#ws-codes").checked = state.view.showCodes;
    zoomControls.setZoom(Math.round(state.view.zoom * 100), false);
    gridToolbar.setActiveTool(state.editor.tool);
    // 顶栏生成尺寸栏高亮 / 派生读数 / 大尺寸分档提示跟随当前草稿。
    syncSizeUi();
    // 取色按钮的色块跟随当前色：右键取色 / 调色板选色 / 取色工具点选都会更新这里。
    const toolbarSelectedId = readCurrentPaletteId(state.editor);
    gridToolbar.setEyedropperColor(toolbarSelectedId ? (editorService.resolveColor(toolbarSelectedId)?.hex || null) : null);
    // 只在值真的变了才写 DOM：paint 会在每次状态变化时被调用，无条件赋值会白刷控件。
    if (gridToolbar.brushSize !== state.editor.brushSize) gridToolbar.setBrushSize(state.editor.brushSize);
    gridToolbar.setShapeFilled(state.editor.shapeFilled);
    $("#ws-brush-size").disabled = !hasPattern;
    $("#ws-brush-size").value = String(state.editor.brushSize);
    $("#ws-brush-size-value").textContent = String(state.editor.brushSize);
    $("#ws-pixel-perfect").checked = state.editor.pixelPerfect !== false;
    $("#ws-pixel-perfect").disabled = !hasPattern || state.editor.brushSize !== 1;
    $("#ws-shape-filled").disabled = !hasPattern;
    $("#ws-shape-filled").checked = state.editor.shapeFilled;
    // §21：描边颜色改用共享 datalist，不再每次 paint 重建整份色板 <select>。
    // 值语义从 paletteId 改为色号 —— resolveColor/colorFor 两者都认。
    // 聚焦时不回写，否则打字会被高频 paint（悬停也会触发）打断。
    const outlineTarget=$("#ws-outline-target"),outlineSelected=state.editor.outlineTargetPaletteId||state.editor.selectedPaletteId||"";
    if (document.activeElement !== outlineTarget) outlineTarget.value = editorService.resolveColor(outlineSelected)?.code || "";
    const outlinePreview=state.editor.outlinePreview;
    $("#ws-outline-summary").textContent=outlinePreview?`候选 ${outlinePreview.candidateCount} · 新增 ${outlinePreview.cells.length} 颗 · 阻挡 ${outlinePreview.blockedCount} 颗`:"选择来源和真实色号后预览。";
    $("#ws-outline-apply").disabled=!outlinePreview?.cells?.length;$("#ws-outline-cancel").disabled=!outlinePreview;
    $("#ws-symmetry-mode").value = state.editor.symmetryMode || "none";
    $("#ws-symmetry-mode").disabled = !hasPattern;
    const resultSize = bridge.getResult();
    $("#ws-symmetry-axis-x").max = String(Math.max(0, resultSize.width - 1));
    $("#ws-symmetry-axis-y").max = String(Math.max(0, resultSize.height - 1));
    $("#ws-symmetry-axis-x").value = String(Number.isFinite(state.editor.symmetryAxisX) ? state.editor.symmetryAxisX : (resultSize.width - 1) / 2);
    $("#ws-symmetry-axis-y").value = String(Number.isFinite(state.editor.symmetryAxisY) ? state.editor.symmetryAxisY : (resultSize.height - 1) / 2);
    $("#ws-symmetry-axis-x").disabled = !hasPattern;
    $("#ws-symmetry-axis-y").disabled = !hasPattern;
    $("#ws-symmetry-guides").checked = state.editor.symmetryGuideVisible !== false;
    $("#ws-symmetry-guides").disabled = !hasPattern;
    $("#ws-wand-tolerance").disabled = !hasPattern;
    $("#ws-wand-tolerance-value").textContent = String(state.editor.wandTolerance);
    const hasSelection = Boolean(state.editor.selection);
    ["#ws-erase-selection", "#ws-clear-selection", "#ws-copy-selection", "#ws-cut-selection"].forEach((selector) => { $(selector).disabled = !hasSelection; });
    // 反选在「没有选区」时等价于全选，所以只要有图纸就可用。
    $("#ws-invert-selection").disabled = !hasPattern;
    $("#ws-paste-selection").disabled = !editorService.hasClipboard() || !hasPattern;
    $("#ws-select-all").disabled = !hasPattern;
    const selectedPaletteId = readCurrentPaletteId(state.editor);
    $("#ws-apply-outline").disabled = !hasPattern || !hasSelection || !selectedPaletteId;
    const selected = state.editor.selectedCell;
    const selectedColor = selected ? editorService.getCell(selected.x, selected.y) : null;
    const inspectedColor = selectedPaletteId ? (editorService.getPaletteColors().find((color) => paletteIdOf(color) === selectedPaletteId) || selectedColor) : null;
    const inspectedCount = selectedPaletteId ? editorService.getColorUsage(selectedPaletteId) : 0;
    const paletteCurrent=$("#ws-palette-current"),paletteCurrentColor=editorService.resolveColor(selectedPaletteId);
    if(paletteCurrent)paletteCurrent.innerHTML=paletteCurrentColor?`<strong>当前颜色：${esc(paletteCurrentColor.code)}</strong><span class="ws-current-color-swatch" style="background:${esc(paletteCurrentColor.hex||"#ccc")}"></span>`:"当前颜色：未选择";
    const paletteById = new Map(editorService.getPaletteColors().map((color) => [paletteIdOf(color), color]));
    const selectionUsage = hasSelection ? editorService.getSelectionPaletteUsage(state.editor.selection) : new Map();
    const selectionTotal = [...selectionUsage.values()].reduce((sum, count) => sum + count, 0);
    const selectionSourceCount = selectedPaletteId ? (selectionUsage.get(selectedPaletteId) || 0) : 0;
    $("#ws-current-color-summary").innerHTML = inspectedColor
      ? `<strong>当前：${esc(inspectedColor.code)}</strong><span class="ws-current-color-swatch" style="background:${esc(inspectedColor.hex || "#cccccc")}"></span><b>${inspectedCount.toLocaleString("zh-CN", { useGrouping: false })}颗</b>`
      : "点击画布中的拼豆格子识别颜色";
    $("#ws-same-color-highlight").disabled = !selectedPaletteId;
    $("#ws-same-color-highlight").checked = Boolean(selectedPaletteId && state.editor.highlightedPaletteId === selectedPaletteId);
    if (hasSelection) {
      const width = state.editor.selection.x1 - state.editor.selection.x0 + 1;
      const height = state.editor.selection.y1 - state.editor.selection.y0 + 1;
      $("#ws-selection-palette-summary").textContent = `${width} × ${height} · ${selectionTotal.toLocaleString("zh-CN", { useGrouping: false })} 颗 · ${selectionUsage.size} 色`;
      $("#ws-selection-palette-list").innerHTML = [...selectionUsage]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([paletteId, count]) => { const color = paletteById.get(paletteId); return `<button type="button" data-ws-inspect-palette="${esc(paletteId)}"><span style="background:${esc(color?.hex || "#ccc")}"></span><b>${esc(color?.code || paletteId)}</b><small>${count}颗</small></button>`; }).join("");
    } else {
      $("#ws-selection-palette-summary").textContent = "框选区域后显示颜色统计。";
      $("#ws-selection-palette-list").innerHTML = "";
    }
    const similar = selectedPaletteId ? editorService.findSimilarPaletteColors(selectedPaletteId, { limit: 6 }) : [];
    $("#ws-similar-colors").innerHTML = similar.length
      ? similar.map((color) => `<button type="button" data-ws-similar-target="${esc(color.paletteId)}" title="${esc(color.name || color.code)}"><span style="background:${esc(color.hex || "#ccc")}"></span><small>${esc(color.code)}</small></button>`).join("")
      : '<span class="ws-note">选择当前颜色后显示推荐。</span>';
    const rampBaseId = state.editor.rampBasePaletteId || selectedPaletteId;
    const rampData=rampCache(),generatedRamp = rampBaseId ? buildRamp(rampData.palette, rampBaseId, { size: state.editor.rampSize || 5,cache:rampData.cache }) : [];
    const rampIds = state.editor.rampBasePaletteId === rampBaseId && state.editor.rampPaletteIds?.length
      ? state.editor.rampPaletteIds.filter((id) => paletteById.has(id)) : generatedRamp.map((color) => color.paletteId);
    const rampColors = rampIds.map((id) => paletteById.get(id)).filter(Boolean);
    const rampBase = paletteById.get(rampBaseId);
    $("#ws-ramp-base-label").textContent = rampBase ? `基础 ${rampBase.code}` : "选择一个基础色";
    $("#ws-ramp-size").value = String(state.editor.rampSize || 5);
    $("#ws-ink-mode").value = state.editor.inkMode || "normal";
    $("#ws-color-ramp").innerHTML = rampColors.length ? rampColors.map((color,index)=>`<button type="button" data-ws-ramp-index="${index}" data-ws-ramp-color="${esc(paletteIdOf(color))}" class="${paletteIdOf(color)===rampBaseId?"is-active":""}" title="${esc(color.code)}"><span style="background:${esc(color.hex||"#ccc")}"></span><small>${esc(color.code)}</small></button>`).join("") : '<span class="ws-note">选择当前颜色后生成真实色阶。</span>';
    // §21：替换当前级 / 选择替换色都改用共享 datalist。
    // 这两处原来是「重建整份色板 <select> + 把上一个值按 option 是否仍存在来还原」——
    // 输入框的值天然跨 paint 保留，所以整段还原逻辑直接删掉，语义不变。
    const rampTarget=$("#ws-ramp-level-target");
    const activeRampId=rampIds[activeRampIndex];
    $("#ws-ramp-remove-level").disabled=!activeRampId||activeRampId===rampBaseId||rampIds.length<=1;
    $("#ws-ramp-regenerate").disabled=!selectedPaletteId;
    rampTarget.disabled=activeRampIndex<0||!activeRampId;
    const targetSelect = $("#ws-current-color-target");
    targetSelect.disabled = !selectedPaletteId;
    const targetColor = editorService.resolveColor(targetSelect.value);
    $("#ws-current-color-impact").textContent = inspectedColor && targetColor
      ? `${inspectedColor.code} → ${targetColor.code} · 全局 ${inspectedCount.toLocaleString("zh-CN", { useGrouping: false })} 颗${hasSelection ? ` · 选区内 ${selectionSourceCount.toLocaleString("zh-CN", { useGrouping: false })} 颗` : ""}`
      : selectedPaletteId ? `当前颜色共 ${inspectedCount.toLocaleString("zh-CN", { useGrouping: false })} 颗` : "选择当前颜色后显示替换数量。";
    $("#ws-current-color-replace").textContent = inspectedColor ? `全局替换 ${inspectedColor.code}` : "全局替换";
    $("#ws-current-color-replace").disabled = !selectedPaletteId || !targetColor || !inspectedCount;
    $("#ws-selection-color-replace").textContent = inspectedColor ? `选区替换 ${inspectedColor.code}` : "仅选区替换";
    $("#ws-selection-color-replace").disabled = !hasSelection || !selectedPaletteId || !targetColor || !selectionSourceCount;
    // §17：低频色阈值档位 ≤3 / ≤5 / ≤10，**默认 ≤5**。
    // 旧默认是 3（而且 select 的首项就是 3，浏览器默认选中它），档位里也没有 10。
    // 默认 3 会把「只用了 4~5 颗」这类正常收尾色误报成问题色 —— 专业用户先看到的应该是真问题。
    const rare = hasPattern ? editorService.detectRarePaletteColors({ maxCount: Number($("#ws-rare-threshold").value || 5) }) : [];
    const rareIssues = rare.map((entry) => ({
      id: `rare-color:${entry.paletteId}`,
      type: "rare-color",
      paletteId: entry.paletteId,
      cells: entry.cells,
      severity: entry.count <= 1 ? "high" : entry.count <= 2 ? "medium" : "low",
      label: `${entry.code} · ${entry.count}颗`,
      meta: { code: entry.code, count: entry.count },
    }));
    const tinyMaxSize = Number($("#ws-tiny-threshold").value || 3);
    if (hasPattern && (structuralCache.revision !== gridRevision || structuralCache.tinyMaxSize !== tinyMaxSize)) {
      structuralCache = { revision:gridRevision, tinyMaxSize, value:buildStructuralDiagnostics(bridge.getResult().grid,editorService.getPaletteColors(),{tinyMaxSize}) };
    }
    const structural = hasPattern ? structuralCache.value : { isolated:[],tiny:[],edge:[] };
    const allIssues = [...rareIssues, ...structural.isolated, ...structural.tiny, ...structural.edge];
    const category = $("#ws-diagnostic-category").value || "all";
    const severity = $("#ws-diagnostic-severity").value || "all";
    const issues = allIssues.filter((issue) => !ignoredIssueKeys.has(stableIssueKey(issue)) && (category === "all" || issue.type === category) && (severity === "all" || issue.severity === severity));
    repairSuggestions = deriveRepairSuggestions(issues, editorService.getPaletteColors(), ignoredIssueKeys);
    repairQueue = createRepairQueue(repairSuggestions);
    diagnosticOverlayIssues = issues;
    inspectionState = setInspectionIssues(inspectionState, issues);
    $("#ws-rare-colors").innerHTML = rare.length
      ? rare.map((entry) => { const color = paletteById.get(entry.paletteId); return `<button type="button" data-ws-rare-palette="${esc(entry.paletteId)}"><span style="background:${esc(color?.hex || "#ccc")}"></span><b>${esc(entry.code)}</b><small>${entry.count}颗</small></button>`; }).join("")
      : '<span class="ws-note">当前阈值内没有低频颜色。</span>';
    const visibleCounts = new Map();
    allIssues.filter((issue) => !ignoredIssueKeys.has(stableIssueKey(issue))).forEach((issue) => visibleCounts.set(issue.type,(visibleCounts.get(issue.type)||0)+1));
    const countRows = [["rare-color","低频颜色",visibleCounts.get("rare-color")||0],["isolated-pixel","孤立像素",visibleCounts.get("isolated-pixel")||0],["tiny-region","微小区域",visibleCounts.get("tiny-region")||0],["edge-contamination","边缘污染",visibleCounts.get("edge-contamination")||0]];
    $("#ws-diagnostic-counts").innerHTML = countRows.map(([type,label,count]) => `<button type="button" data-ws-diagnostic-category="${type}" class="${category===type?"active":""}"><span>${label}</span><b>${count}</b></button>`).join("");
    const currentIssue = currentInspectionIssue(inspectionState);
    const issueCellCount = currentIssue?.cells?.length || 0;
    $("#ws-inspection-title").textContent = `问题巡检 · ${issues.length}项`;
    $("#ws-inspection-toggle").textContent = inspectionState.active ? "结束巡检" : "开始巡检";
    $("#ws-inspection-toggle").disabled = !issues.length;
    const typeNames = {"rare-color":"低频颜色","isolated-pixel":"孤立像素","tiny-region":"微小区域","edge-contamination":"边缘污染"};
    const suggestion = currentIssue?.meta?.suggestedPaletteId ? editorService.resolveColor(currentIssue.meta.suggestedPaletteId) : null;
    $("#ws-inspection-current").textContent = currentIssue ? `${typeNames[currentIssue.type] || currentIssue.type} · ${currentIssue.label}${suggestion ? ` · 建议颜色 ${suggestion.code}` : ""}` : "当前没有符合筛选的问题。";
    $("#ws-inspection-status").textContent = currentIssue ? `${inspectionState.index + 1} / ${issues.length}` : "0 / 0";
    $("#ws-inspection-cell-status").textContent = issueCellCount ? `${inspectionState.cellIndex + 1} / ${issueCellCount}` : "0 / 0";
    $("#ws-inspection-prev").disabled = !inspectionState.active || inspectionState.index <= 0;
    $("#ws-inspection-next").disabled = !inspectionState.active || inspectionState.index < 0 || inspectionState.index >= issues.length - 1;
    $("#ws-inspection-cell-prev").disabled = !inspectionState.active || issueCellCount <= 1;
    $("#ws-inspection-cell-next").disabled = !inspectionState.active || issueCellCount <= 1;
    const currentRepair = currentIssue ? repairSuggestions.find((item) => item.issueKey === stableIssueKey(currentIssue)) : null;
    const confidenceNames = { high:"高置信", medium:"中置信", low:"低置信" };
    $("#ws-repair-current").innerHTML = currentRepair
      ? `<strong>建议 ${esc(editorService.resolveColor(currentRepair.targetPaletteId)?.code || currentRepair.targetPaletteId)} · ${confidenceNames[currentRepair.confidenceLevel]}</strong><br>${esc(currentRepair.reasonText)}<br>仅修改问题对应 ${currentRepair.cells.length} 颗拼豆。`
      : "当前问题没有可用的真实色卡修复建议。";
    // §21：改用共享 datalist（留空 = 采用建议颜色，与原空选项语义一致）。
    const repairTarget = $("#ws-repair-target");
    repairTarget.disabled = !currentRepair;
    $("#ws-repair-preview").disabled = !currentRepair;
    $("#ws-repair-apply").disabled = !currentRepair;
    $("#ws-repair-apply").textContent = repairTarget.value ? "采用选择颜色" : "采用建议";
    $("#ws-repair-ignore").disabled = !currentIssue;
    $("#ws-repair-cancel-preview").hidden = !repairPreview;
    $("#ws-repair-counts").textContent = `高 ${repairQueue.counts.high} · 中 ${repairQueue.counts.medium} · 低 ${repairQueue.counts.low} · 冲突 ${repairQueue.conflicts.length}`;
    $("#ws-repair-review-high").disabled = !repairQueue.counts.high;
    $("#ws-repair-review-all").disabled = !repairSuggestions.length;
    $("#ws-repair-apply-high").disabled = !repairQueue.highPlan.changes.length;
    $("#ws-repair-apply-high").textContent = repairQueue.highPlan.changes.length ? `应用全部高置信 · ${repairQueue.highPlan.changes.length}颗` : "应用全部高置信建议";
    $("#ws-cell-details").innerHTML = state.editor.selection ? `<strong>${esc({rectangle:"矩形", "same-color":"同色",connected:"连通", "magic-wand":"魔棒", inverse:"反选", selection:"区域"}[state.editor.selection.kind] || "区域")}选区 · ${selectionCells(state.editor.selection, state.canvas.width, state.canvas.height).length.toLocaleString("zh-CN", { useGrouping: false })} 豆</strong><p>X ${state.editor.selection.x0 + 1}–${state.editor.selection.x1 + 1} · Y ${state.editor.selection.y0 + 1}–${state.editor.selection.y1 + 1}</p><p>选区换色、擦除与描边仅影响对应豆格。方向键可整体搬移。</p>` : selected ? `<strong>${esc(selectedColor?.code || "空白")}</strong><p>位置 · X ${selected.x + 1} / Y ${selected.y + 1}</p><p>${selectedColor ? `${esc(selectedColor.hex || "")} · RGB ${esc(selectedColor.rgb?.join(",") || "")}` : "真正空豆"}</p><p>使用 · ${selectedColor ? editorService.getColorUsage(paletteIdOf(selectedColor)).toLocaleString("zh-CN", { useGrouping: false }) : 0} 颗</p>` : "用选择工具点击画布中的一颗豆。";
    const toolInfo = {select:"选择 · 点击查看豆格",bead:"单豆 · 选中色号后点击豆格",brush:"画笔 · 拖动为一笔历史，笔宽见检查器",eraser:"橡皮 · 拖动擦成真正空豆，笔宽见检查器",fill:"填充 · 四方向连续色块",line:"直线 · 从起点拖到终点，Shift 吸附 45°",rect:"矩形 · 拖出外接框，Shift 约束正方形",ellipse:"圆形 · 拖出外接框，Shift 约束正圆",region:"框选 · 拖出矩形选区",wand:"魔棒 · 按色差容差圈选连续区域，Shift 叠加 / Alt 减掉",same:"同色选择 · 点击任意豆格",connected:"连通选择 · 点击连续色块",eyedropper:"取色 · 点击豆格设置当前色","source-eyedropper":"原图取色 · 点击中央原图",outline:"描边 · 先选择区域再应用",replace:"换色 · 在色彩面板设置色号",pan:"移动 · 拖动画布",text:"文字 · 点画布放一个文字图层，拖动可移动；调好字体/颜色/字号后点「向下合并」写进图纸"};
    const inkLabel=state.editor.tool==="brush"&&state.editor.inkMode!=="normal"?(state.editor.inkMode==="darker"?" · Shade Darker":" · Shade Lighter"):"";
    const toolSelectedId = readCurrentPaletteId(state.editor);
    $("#ws-tool-details").textContent = `${toolInfo[state.editor.tool] || state.editor.tool}${inkLabel}${toolSelectedId ? ` · 当前 ${toolSelectedId}` : ""}`;
    $("#ws-history-label").textContent = editorService.getHistory().at(-1)?.label || "";
    $("#ws-undo").disabled = !state.editor.history.canUndo; $("#ws-redo").disabled = !state.editor.history.canRedo;
    gridToolbar.setHistory(state.editor.history.canUndo, state.editor.history.canRedo);
    // 镜像统一收在底栏一个菜单里，两个方向共享同一套 editorService 历史。
    const setActionDisabled = (action, disabled) => {
      const inDock = toolRail.querySelector(`[data-panel="${action}"]`);
      if (inDock) inDock.disabled = disabled;
    };
    ["mirror-horizontal", "mirror-vertical"].forEach((action) => setActionDisabled(action, !hasPattern));
    // 不满足前置条件的工具直接禁用，避免出现“按钮能点、画布却毫无反应”的假功能。
    for (const tool of ["select", "bead", "text", "brush", "eraser", "fill", "line", "rect", "ellipse", "region", "wand", "same", "connected", "eyedropper", "pan"]) {
      gridToolbar.setToolDisabled(tool, !hasPattern);
    }
    // 尺寸控件的可用性**不在这里**决定 —— 见 syncSizeUi()。
    // 拆成两处会漏：权威变更走 libms:source-dimensions → syncSizeUi()，那条路径不经过 paint()。
    $("#ws-source-pick-mode").disabled = !hasSource;
    syncReferenceUi(state);
    // 当前色变了也要重建色格墙的 active 态。用 `in` 而不是取值判断 ——
    // 清空（写 null）同样需要重绘，否则选中态会残留在旧色格上。
    if ((patch.editor && ("currentPaletteId" in patch.editor || "selectedPaletteId" in patch.editor || "paletteCategory" in patch.editor)) || patch.stats || patch.ui?.activePanel === "edit") renderPicker();
    // 文字面板：字体/颜色/加粗倾斜/字号/旋转/落豆数都要每次状态变化回灌一次。
    // 面板内部用「结构签名」自己判断该不该重建 DOM，所以这里无条件调用是安全的。
    renderTextPanel(state);
    // 打开状态由按钮直接控制；普通 canvas/state repaint 不应意外把导出中心关掉。
    if (state.ui.exportDrawerOpen) drawer.classList.add("open");
    if (document.activeElement !== $("#ws-export-title")) $("#ws-export-title").value = state.project.name || "";
    // ── Stage C0 §16：分板摘要「关着不算、开着也只算一次」 ────────────────
    // 改之前这里是 `if (hasPattern) { … }` —— 只要出过图就**每次 paint** 无条件跑，
    // 而 `exportV2.estimate()` 与 `exportV2.split()` 内部都会调
    // export-v2-service.js 的 `grid()`：
    //   getGrid().map(row => row.map(cell => cell ? {...cell, rgb:[...cell.rgb]} : null))
    // 也就是**整幅深拷贝**（500×500 = 25 万格，页内实测一次 ~15ms）。
    // paint() 在一次提交里会被叫醒多次（store 订阅 + 若干次 setState），抽屉
    // 还多半是关着的 —— 于是「没人看的抽屉摘要」成了 §12 `eventDispatch` 里
    // 按格数计费的一项。这与「材料」面板的 exportV2.split() 是同一笔钱。
    // 现在：抽屉关着 → 一个字段都不算（打开抽屉会 setState，paint 自然会重来）；
    // 开着 → 只在图纸真的变了时重算。
    if (hasPattern && state.ui.exportDrawerOpen) {
      const estimate = exportV2.estimate($("#ws-export-quality").value);
      $("#ws-export-pixels").textContent = `预计 ${estimate.width} × ${estimate.height}px`;
      const splitSignature = `${gridRevision}|${state.canvas.width}x${state.canvas.height}`;
      if (splitSignature !== boardSplitSignature) {
        boardSplitSignature = splitSignature;
        boardSplitCache = exportV2.split();
      }
      const split = boardSplitCache;
      $("#ws-board-summary").textContent = split.needsSplit ? `${state.canvas.width}×${state.canvas.height} · ${split.columns}列 × ${split.rows}行 · 共${split.total}块` : "当前作品无需分板";
      $("#ws-boards-choice").disabled = !split.needsSplit;
    } else if (!hasPattern) {
      $("#ws-export-pixels").textContent = "";
      $("#ws-board-summary").textContent = "请先创建图纸";
      $("#ws-boards-choice").disabled = true;
    }
    drawer.querySelectorAll("[data-ws-export]").forEach((button) => { button.disabled = !exports.isAvailable(button.dataset.wsExport); });
    if (patch.view || patch.editor || patch.stats || patch.status || patch.source || patch.reference) renderer.requestDraw();
    // 库存面板只在图纸/项目状态变化时重建；库存自身的变更由它自己订阅，避免每次鼠标移动都重排表格
    if (patch.status || patch.stats) inventoryPanel?.render();
    $("#ws-canvas-hint").textContent = canvasHint(state.view);
  };
  const affectedCount = (code) => {
    const selection = get().editor.selection;
    if (!selection) return editorService.getColorUsage(code);
    let count = 0; bridge.getResult().grid.forEach((row, y) => row.forEach((color, x) => {
      if (color?.code === code && selectionContains(selection, x, y)) count++;
    })); return count;
  };
  const mergeSelection=()=>[...$("#ws-merge-sources").selectedOptions].map((option)=>option.value);
  const updateMergeImpact=()=>{
    const sources=mergeSelection(),target=$("#ws-merge-target").value;
    const total=sources.reduce((sum,id)=>sum+editorService.getColorUsage(id),0);
    const targetColor=editorService.resolveColor(target);
    $("#ws-merge-impact").textContent=sources.length&&targetColor?`${sources.length} 种来源色 → ${targetColor.code} · 共影响 ${total} 颗` : "请选择来源色和目标色。";
    $("#ws-merge-confirm").disabled=!sources.length||!targetColor||!total;
  };
  $("#ws-color-manual-merge").addEventListener("click",()=>{const panel=$("#ws-manual-merge-panel");panel.hidden=!panel.hidden;if(!panel.hidden)updateMergeImpact();});
  $("#ws-merge-sources").addEventListener("change",updateMergeImpact);$("#ws-merge-target").addEventListener("change",updateMergeImpact);
  $("#ws-merge-confirm").addEventListener("click",()=>{
    const sources=mergeSelection(),target=$("#ws-merge-target").value,total=sources.reduce((sum,id)=>sum+editorService.getColorUsage(id),0),targetColor=editorService.resolveColor(target);
    if(!sources.length||!targetColor||!total)return;
    askConfirmation(`将 ${sources.length} 种颜色共 ${total} 颗合并为 ${targetColor.code}？`).then((accepted)=>{if(accepted)editorService.mergePaletteColors(sources,target);});
  });
  $("#ws-color-auto-optimize").addEventListener("click",()=>{
    const {changes,conflicts}=repairQueue.highPlan;if(!changes.length){$("#ws-merge-impact").textContent="当前没有可自动处理的高置信问题。";return;}
    askConfirmation(`自动优化将保守处理 ${changes.length} 颗拼豆${conflicts.length?`，并跳过 ${conflicts.length} 个冲突位置`:""}。继续吗？`).then((accepted)=>{if(!accepted)return;editorService.applyRepairChanges(changes.map((change)=>({sourcePaletteId:change.sourcePaletteId,targetPaletteId:change.targetPaletteId,cells:[{x:change.x,y:change.y}]})),"自动优化");});
  });
  $("#ws-color-cleanup").addEventListener("click",()=>{$("#ws-diagnostic-category").value="all";store.setState({ui:{activePanel:"edit"}});paint(get(),{editor:{selectedPaletteId:get().editor.selectedPaletteId}});});
  // ===================== Stage B1 §12–§16：横向用色统计 / 颜色巡检 =====================
  // 数据源是 palette-usage 的**实时**索引（editorService.getPaletteUsageCounts()），
  // 每次 libms:grid-edited 失效重算 —— 手动改色后数字不会骗人（旧竖列面板的毛病）。
  // 排序默认「数量↓」（先看用量最大的，这才是核对材料时要看的）。
  let usageSort = USAGE_SORT_DEFAULT;
  let usageSelected = null;
  let usageRenderedRevision = -1;
  function usageEntries() {
    return buildUsageEntries(editorService.getPaletteUsageCounts(), paletteColors(), {
      sort: usageSort,
      // 换品牌后旧 paletteId 可能已不在当前色板里 —— 交给 editorService 解析，
      // 解不出就用 paletteId 本身当色号显示，绝不按 RGB 猜一个颜色顶上。
      resolve: (paletteId) => editorService.resolveColor(paletteId),
    });
  }
  function renderUsageActions() {
    const color = usageSelected ? editorService.resolveColor(usageSelected) : null;
    $("#ws-usage-actions").hidden = !color;
    if (!color) { $("#ws-usage-similar-list").hidden = true; $("#ws-usage-similar-list").innerHTML = ""; return; }
    const count = editorService.getColorUsage(usageSelected);
    $("#ws-usage-current").textContent = `${color.code} · ${count.toLocaleString("zh-CN", { useGrouping: false })} 颗`;
  }
  function renderUsageStrip() {
    const entries = usageEntries();
    $("#ws-usage-summary").textContent = formatUsageSummary(entries);
    $("#ws-usage-strip").innerHTML = entries.map((entry) => `<button type="button" role="listitem" data-ws-usage="${esc(entry.paletteId)}" class="ws-usage-card${usageSelected === entry.paletteId ? " active" : ""}" title="${esc(entry.code)} · ${entry.count} 颗"><span class="ws-swatch" style="background:${esc(entry.hex)}"></span><small>${esc(entry.code)}</small><em>${entry.count.toLocaleString("zh-CN", { useGrouping: false })}</em></button>`).join("") || '<p class="ws-note">生成图纸后按色号显示用量。</p>';
    // 选中的颜色若已不在图上（被替换掉了），收起操作条，别留悬空操作。
    if (usageSelected && !isUsageEntryPresent(entries, usageSelected)) usageSelected = null;
    renderUsageActions();
  }
  function renderUsageIfStale() {
    if (usageRenderedRevision === gridRevision) return;
    usageRenderedRevision = gridRevision;
    renderUsageStrip();
  }
  // ── Stage C0 §2：右栏「材料」面板的「本作品用豆」一节 ──────────────────
  // 与「色彩」里的横向用色条同源（实时用量索引），但口径是**备料**：
  // 总颗数 + 逐色号颗数 + 底板数量与实物厘米数。
  // 这里不复用 usageEntries()，因为那个函数跟着用户在色彩面板选的排序走；
  // 备料清单必须恒定按数量降序，否则用户换个排序，材料数字的顺序就跟着乱。
  // 只在 gridRevision 或图纸物理尺寸变化时重建 —— paint 会被悬停/选区高频触发。
  let materialSignature = "";
  function renderMaterial(state) {
    const totalNode = $("#ws-material-total"), listNode = $("#ws-material-list"), boardNode = $("#ws-material-boards");
    if (!totalNode || !listNode || !boardNode) return;
    // ── Stage C0 §16：材料面板不是当前 Tab 时，一个字都不算 ────────────────
    // 不是「省一次 DOM 写入」那种小气：下面那句 exportV2.split() 的代价按**格数**走
    // （export-v2-service.js 的 `grid()` 是整幅深拷贝，500×500 页内实测 ~15ms，
    // 再叠加分板扫描），而 paint() 挂在 libms:project-result 的**同步监听者**里
    // —— 这笔钱直接记进 §12 的 eventDispatch / commitTotal。
    // 用户没在看「材料」，就不该替他付这笔钱。
    // 注意这里**不能**顺手写 materialSignature：写了就等于把「没算过」记成
    // 「算过了」，切回该 Tab 时会看到空面板。切 Tab 会 setState → paint 重来，
    // 那时才真正计算（见 tests/material-tab-semantics.test.mjs）。
    if (state.ui.activePanel !== "material") return;
    const signature = `${gridRevision}|${state.canvas.width}x${state.canvas.height}|${state.canvas.beadSize}`;
    if (signature === materialSignature) return;
    materialSignature = signature;
    const entries = buildUsageEntries(editorService.getPaletteUsageCounts(), paletteColors(), {
      sort: "count-desc",
      resolve: (paletteId) => editorService.resolveColor(paletteId),
    });
    if (!entries.length) {
      totalNode.textContent = "尚未生成图纸";
      listNode.innerHTML = "";
      boardNode.textContent = "—";
      return;
    }
    const beads = entries.reduce((sum, entry) => sum + entry.count, 0);
    const format = (value) => value.toLocaleString("zh-CN", { useGrouping: false });
    totalNode.textContent = `${entries.length} 色 · 共 ${format(beads)} 颗`;
    listNode.innerHTML = entries.map((entry) => `<div class="ws-material-row"><span class="ws-swatch" style="background:${esc(entry.hex)}"></span><b>${esc(entry.code)}</b><em>${format(entry.count)}</em></div>`).join("");
    const split = exportV2.split();
    const widthCm = (state.canvas.width * state.canvas.beadSize / 10).toFixed(1);
    const heightCm = (state.canvas.height * state.canvas.beadSize / 10).toFixed(1);
    const size = `${state.canvas.width}×${state.canvas.height} 豆 · ${widthCm}×${heightCm} cm`;
    boardNode.textContent = split.needsSplit
      ? `${size} · 需 ${split.columns}×${split.rows} = ${split.total} 块底板`
      : `${size} · 单块底板`;
  }
  // §21：共享色号清单（datalist）。按色板签名缓存 —— 换品牌/换色数才重建。
  // 选项文案带上系列，这样盼盼的纯数字色号也能看出属于哪个中文系列。
  let datalistSignature = "";
  function renderPaletteDatalist() {
    const palette = paletteColors();
    const signature = `${palette.length}|${palette[0]?.code || ""}|${palette.at(-1)?.code || ""}`;
    if (signature === datalistSignature) return;
    datalistSignature = signature;
    $("#ws-palette-datalist").innerHTML = palette.map((color) => {
      const group = typeof color.group === "string" ? color.group : "";
      return `<option value="${esc(color.code)}">${esc(color.code)}${group ? ` · ${esc(group)}` : ""}</option>`;
    }).join("");
  }
  // §13：点统计卡 = 设 currentPaletteId + 复用既有「同色高亮」（渲染层 alpha 淡化其余色，canvas-renderer.js）。
  $("#ws-usage-strip").addEventListener("click", (event) => {
    const card = event.target.closest("[data-ws-usage]");
    if (!card) return;
    usageSelected = card.dataset.wsUsage;
    activatePalette(usageSelected);
    $("#ws-usage-similar-list").hidden = true;
    $("#ws-same-color-highlight").checked = true;
    renderUsageStrip();
  });
  $(".ws-usage-sort")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ws-usage-sort]");
    if (!button) return;
    usageSort = button.dataset.wsUsageSort;
    wrap.querySelectorAll("[data-ws-usage-sort]").forEach((item) => item.classList.toggle("active", item === button));
    renderUsageStrip();
  });
  // §14：三个巡检动作**全部复用现有服务**，不建第二套。
  // 只看此色 → 复用 #ws-same-color-highlight 的渲染层淡化（勾复选框 + 同步 state）。
  $("#ws-usage-only").addEventListener("click", () => {
    if (!usageSelected) return;
    const next = !$("#ws-same-color-highlight").checked;
    $("#ws-same-color-highlight").checked = next;
    store.setState({ editor: buildHighlightOnlyPatch(usageSelected, { enabled: next }) });
  });
  // 全局替换 → 复用既有 #ws-replace-from / #ws-replace-to / #ws-replace-confirm
  // （editorService.replaceColor，一条 COLOR_REPLACE 历史，见 §15）。
  $("#ws-usage-replace").addEventListener("click", () => {
    const color = usageSelected ? editorService.resolveColor(usageSelected) : null;
    if (!color) return;
    $("#ws-replace-from").value = color.code;
    $("#ws-replace-impact").textContent = `影响 ${editorService.getColorUsage(usageSelected).toLocaleString("zh-CN", { useGrouping: false })} 颗 · 在下方「全局换色」里选目标色号`;
    $("#ws-replace-to").focus();
  });
  // 相近颜色 → 复用 findSimilarPaletteColors（rgbToLab + CIEDE2000），附 ΔE 与图上已有用量。
  $("#ws-usage-similar").addEventListener("click", () => {
    if (!usageSelected) return;
    const list = $("#ws-usage-similar-list");
    if (!list.hidden) { list.hidden = true; return; }
    const similar = editorService.findSimilarPaletteColors(usageSelected, { limit: 6 });
    list.innerHTML = similar.map((entry) => {
      const id = paletteIdOf(entry);
      const used = editorService.getColorUsage(id);
      const delta = Number(entry.distance ?? 0).toFixed(1);
      return `<button type="button" data-ws-similar="${esc(id)}" title="ΔE ${delta} · 图上已有 ${used} 颗"><span class="ws-swatch" style="background:${esc(entry.hex)}"></span><small>${esc(entry.code)}</small><em>ΔE ${delta}${used ? ` · ${used}颗` : ""}</em></button>`;
    }).join("") || '<p class="ws-note">色板里没有可比的相近色。</p>';
    list.hidden = false;
  });
  // 点相近色 = 填进「全局换色」的目标位，再复用同一条替换流程。
  $("#ws-usage-similar-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ws-similar]");
    if (!button) return;
    const color = editorService.resolveColor(button.dataset.wsSimilar);
    if (!color) return;
    $("#ws-replace-to").value = color.code;
    notify(`已把 ${color.code} 填为替换目标，确认后执行全局换色。`);
  });
  $("#ws-replace-from").addEventListener("input", (event) => { $("#ws-replace-impact").textContent = `影响 ${affectedCount(event.target.value.trim().toUpperCase()).toLocaleString("zh-CN", { useGrouping: false })} 颗`; });
  $("#ws-replace-confirm").addEventListener("click", () => {
    const from = $("#ws-replace-from").value.trim().toUpperCase(), to = $("#ws-replace-to").value.trim().toUpperCase();
    const count = affectedCount(from);
    if (!count || !editorService.resolveColor(to)) { $("#ws-replace-impact").textContent = "请填写作品中存在的来源色号和当前色卡中的目标色号。"; return; }
    askConfirmation(`将 ${count} 颗 ${from} 替换为 ${to}？`).then((accepted) => { if (accepted) editorService.replaceColor(from, to, get().editor.selection); });
  });
  $("#ws-same-color-highlight").addEventListener("change", (event) => {
    store.setState({ editor: buildHighlightOnlyPatch(currentPaletteId(), { enabled: event.target.checked }) });
  });
  const inspectPalette = (paletteId, selectedCell = get().editor.selectedCell) => {
    const color = editorService.resolveColor(paletteId);
    if (!color) return;
    store.setState({ editor: { ...buildActivateColorPatch(paletteIdOf(color), paletteColors()), selectedCell }, ui: { activePanel: "edit" } });
  };
  const activateInspectionCurrent = () => {
    const issue = currentInspectionIssue(inspectionState);
    if (!inspectionState.active || !issue) return;
    const cell = issue.cells[inspectionState.cellIndex] || issue.cells[0] || null;
    inspectPalette(issue.paletteId, cell);
    if (cell) viewport.focusCell(cell.x, cell.y, { preserveZoom: true, margin: .15 });
  };
  const updateInspection = (next) => {
    repairPreview = null;
    inspectionState = next;
    activateInspectionCurrent();
    paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } });
  };
  $("#ws-selection-palette-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ws-inspect-palette]");
    if (button) inspectPalette(button.dataset.wsInspectPalette);
  });
  $("#ws-similar-colors").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ws-similar-target]");
    if (!button) return;
    $("#ws-current-color-target").value = button.dataset.wsSimilarTarget;
    paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } });
  });
  const generatedRampIds=(baseId,size=get().editor.rampSize||5)=>{const data=rampCache();return buildRamp(data.palette,baseId,{size,cache:data.cache}).map(color=>color.paletteId);};
  $("#ws-color-ramp").addEventListener("click",event=>{
    const button=event.target.closest("[data-ws-ramp-color]");if(!button)return;
    const editor=get().editor,baseId=editor.rampBasePaletteId||editor.selectedPaletteId;
    if(!editor.rampBasePaletteId&&baseId)store.setState({editor:{rampBasePaletteId:baseId,rampPaletteIds:generatedRampIds(baseId)}});
    activeRampIndex=Number(button.dataset.wsRampIndex);
    inspectPalette(button.dataset.wsRampColor);
  });
  $("#ws-ramp-regenerate").addEventListener("click",()=>{
    const baseId=get().editor.selectedPaletteId;if(!baseId)return;activeRampIndex=-1;
    store.setState({editor:{rampBasePaletteId:baseId,rampPaletteIds:generatedRampIds(baseId)}});
  });
  $("#ws-ramp-size").addEventListener("change",event=>{
    const size=Number(event.target.value),baseId=get().editor.rampBasePaletteId||get().editor.selectedPaletteId;
    activeRampIndex=-1;store.setState({editor:{rampSize:size,rampBasePaletteId:baseId,rampPaletteIds:baseId?generatedRampIds(baseId,size):[]}});
  });
  $("#ws-ink-mode").addEventListener("change",event=>store.setState({editor:{inkMode:event.target.value}}));
  $("#ws-ramp-level-target").addEventListener("change",event=>{
    const state=get(),ids=[...(state.editor.rampPaletteIds?.length?state.editor.rampPaletteIds:generatedRampIds(state.editor.rampBasePaletteId||state.editor.selectedPaletteId))];
    if(activeRampIndex<0||!ids[activeRampIndex]||!event.target.value)return;
    ids[activeRampIndex]=event.target.value;
    const metrics=createPaletteMetricCache(editorService.getPaletteColors());
    const ordered=[...new Set(ids)].sort((a,b)=>(metrics.get(a)?.lightness||0)-(metrics.get(b)?.lightness||0));
    store.setState({editor:{rampPaletteIds:ordered}});
  });
  $("#ws-ramp-remove-level").addEventListener("click",()=>{
    const state=get(),base=state.editor.rampBasePaletteId||state.editor.selectedPaletteId,ids=[...(state.editor.rampPaletteIds?.length?state.editor.rampPaletteIds:generatedRampIds(base))];
    if(activeRampIndex<0||ids[activeRampIndex]===base||ids.length<=1)return;
    ids.splice(activeRampIndex,1);activeRampIndex=Math.min(activeRampIndex,ids.length-1);store.setState({editor:{rampPaletteIds:ids}});
  });
  $("#ws-rare-threshold").addEventListener("change", () => {
    paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } });
    activateInspectionCurrent();
  });
  $("#ws-rare-colors").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ws-rare-palette]");
    if (!button) return;
    $("#ws-diagnostic-category").value = "rare-color";
    paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } });
    const index = inspectionState.issues.findIndex((issue) => issue.paletteId === button.dataset.wsRarePalette);
    updateInspection(startInspection(inspectionState, index));
  });
  $("#ws-diagnostic-counts").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ws-diagnostic-category]");
    if (!button) return;
    $("#ws-diagnostic-category").value = button.dataset.wsDiagnosticCategory;
    paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } });
  });
  $("#ws-diagnostic-category").addEventListener("change", () => paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } }));
  $("#ws-diagnostic-severity").addEventListener("change", () => paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } }));
  $("#ws-tiny-threshold").addEventListener("change", () => paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } }));
  $("#ws-diagnostic-overlay").addEventListener("change", (event) => { diagnosticOverlayVisible = event.target.checked; renderer.requestDraw(); });
  $("#ws-inspection-toggle").addEventListener("click", () => updateInspection(inspectionState.active ? stopInspection(inspectionState) : startInspection(inspectionState)));
  $("#ws-inspection-prev").addEventListener("click", () => updateInspection(previousInspectionIssue(inspectionState)));
  $("#ws-inspection-next").addEventListener("click", () => updateInspection(nextInspectionIssue(inspectionState)));
  $("#ws-inspection-cell-prev").addEventListener("click", () => updateInspection(previousInspectionCell(inspectionState)));
  $("#ws-inspection-cell-next").addEventListener("click", () => updateInspection(nextInspectionCell(inspectionState)));
  const currentRepairSuggestion = () => {
    const issue = currentInspectionIssue(inspectionState);
    return issue ? repairSuggestions.find((suggestion) => suggestion.issueKey === stableIssueKey(issue)) || null : null;
  };
  const selectedRepairSuggestion = () => {
    const suggestion = currentRepairSuggestion();
    const selectedTarget = $("#ws-repair-target").value;
    if (!suggestion || !selectedTarget) return suggestion;
    const target = editorService.resolveColor(selectedTarget);
    return target ? { ...suggestion, targetPaletteId: paletteIdOf(target), reason:"manual-choice", reasonText:`人工选择 ${target.code}` } : suggestion;
  };
  $("#ws-repair-preview").addEventListener("click", () => {
    repairPreview = createRepairPreview(selectedRepairSuggestion());
    renderer.requestDraw();
    paint(get(), { editor:{ selectedPaletteId:get().editor.selectedPaletteId } });
  });
  $("#ws-repair-cancel-preview").addEventListener("click", () => {
    repairPreview = null;
    renderer.requestDraw();
    paint(get(), { editor:{ selectedPaletteId:get().editor.selectedPaletteId } });
  });
  $("#ws-repair-apply").addEventListener("click", () => {
    const suggestion = selectedRepairSuggestion();
    if (!suggestion) return;
    const target = editorService.resolveColor(suggestion.targetPaletteId);
    askConfirmation(`仅修复当前问题的 ${suggestion.cells.length} 颗拼豆，替换为 ${target?.code || suggestion.targetPaletteId}？`).then((accepted) => {
      if (accepted) editorService.applyRepairChanges([suggestion], "采用单项修复建议");
    });
  });
  $("#ws-repair-ignore").addEventListener("click", () => {
    const issue = currentInspectionIssue(inspectionState);
    if (!issue) return;
    ignoredIssueKeys.add(stableIssueKey(issue));
    repairPreview = null;
    paint(get(), { editor:{ selectedPaletteId:get().editor.selectedPaletteId } });
    activateInspectionCurrent();
  });
  const startRepairReview = (highOnly = false) => {
    const eligible = new Set(repairSuggestions.filter((suggestion) => !highOnly || suggestion.confidenceLevel === "high").map((suggestion) => suggestion.issueKey));
    const index = inspectionState.issues.findIndex((issue) => eligible.has(stableIssueKey(issue)));
    if (index >= 0) updateInspection(startInspection(inspectionState, index));
  };
  $("#ws-repair-review-high").addEventListener("click", () => startRepairReview(true));
  $("#ws-repair-review-all").addEventListener("click", () => startRepairReview(false));
  $("#ws-repair-apply-high").addEventListener("click", () => {
    const { changes, conflicts } = repairQueue.highPlan;
    if (!changes.length) return;
    const issueCount = new Set(changes.map((change) => change.suggestionId)).size;
    askConfirmation(`将修复 ${issueCount} 个高置信问题，共 ${changes.length} 颗拼豆${conflicts.length ? `；${conflicts.length} 个冲突位置会跳过` : ""}。确认修复吗？`).then((accepted) => {
      if (!accepted) return;
      const repairs = changes.map((change) => ({ sourcePaletteId:change.sourcePaletteId, targetPaletteId:change.targetPaletteId, cells:[{x:change.x,y:change.y}] }));
      editorService.applyRepairChanges(repairs, "批量采用高置信修复建议");
    });
  });
  $("#ws-repair-target").addEventListener("change", () => {
    if (repairPreview) repairPreview = createRepairPreview(selectedRepairSuggestion());
    $("#ws-repair-apply").textContent = $("#ws-repair-target").value ? "采用选择颜色" : "采用建议";
    renderer.requestDraw();
  });
  $("#ws-current-color-target").addEventListener("change", () => paint(get(), { editor: { selectedPaletteId: get().editor.selectedPaletteId } }));
  $("#ws-selection-color-replace").addEventListener("click", () => {
    const from = get().editor.selectedPaletteId, to = $("#ws-current-color-target").value, selection = get().editor.selection;
    const before = editorService.resolveColor(from), after = editorService.resolveColor(to);
    const count = selection ? (editorService.getSelectionPaletteUsage(selection).get(from) || 0) : 0;
    if (!selection || !from || !after || !count) return;
    askConfirmation(`${before?.code || from} → ${after.code}，仅替换选区内 ${count} 颗。继续吗？`).then((accepted) => {
      if (!accepted || !editorService.replaceColorInSelection(from, to, selection)) return;
      store.setState({ editor: buildActivateColorPatch(paletteIdOf(after), paletteColors()) });
    });
  });
  $("#ws-current-color-replace").addEventListener("click", () => {
    const from = get().editor.selectedPaletteId;
    const to = $("#ws-current-color-target").value;
    const before = editorService.resolveColor(from), after = editorService.resolveColor(to);
    const count = editorService.getColorUsage(from);
    if (!from || !after || !count) return;
    askConfirmation(`${before?.code || from} → ${after.code}，将替换 ${count} 颗。继续吗？`).then((accepted) => {
      if (!accepted || !editorService.replaceColor(from, to)) return;
      store.setState({ editor: buildActivateColorPatch(paletteIdOf(after), paletteColors()) });
    });
  });
  // 搜索 / 换系列都要把「显示其余 N 色」的展开状态收回，否则换到别的系列会莫名全展开。
  $("#ws-color-search").addEventListener("input", () => { pickerExpanded = false; renderPicker(); });
  $("#ws-palette-categories").addEventListener("click", (event) => { const button = event.target.closest("[data-ws-category]"); if (button) { pickerExpanded = false; store.setState({ editor: { paletteCategory: button.dataset.wsCategory } }); } });
  const activateColor = (code, applySelected = true) => {
    const color = editorService.resolveColor(code); if (!color) return;
    const selected = get().editor.selectedCell, tool = get().editor.tool;
    store.setState({ editor: { ...buildActivateColorPatch(paletteIdOf(color), paletteColors()), recentColors:[color.code,...get().editor.recentColors.filter((item)=>item!==color.code)].slice(0,10), tool:tool==="select"&&selected?"bead":tool } });
    if (applySelected && selected && ["select","bead"].includes(tool)) editorService.setCellColor(selected.x, selected.y, color.code);
  };
  // §10：色格墙惰性渲染的「显示其余 N 色」按钮每次重建，所以用事件委托。
  ["#ws-bead-picker","#ws-recent-colors"].forEach((selector) => $(selector).addEventListener("click", (event) => {
    if (event.target.closest("#ws-picker-more")) { pickerExpanded = true; renderPicker(); return; }
    const button = event.target.closest("[data-ws-pick]"); if (button) activateColor(button.dataset.wsPick); }));
  $("#ws-erase-selection").addEventListener("click", () => editorService.eraseSelection(get().editor.selection));
  $("#ws-clear-selection").addEventListener("click", () => store.setState({ editor: { selectedCell: null, ...buildClearPalettePatch(), selection: null, shapePreview: null } }));
  $("#ws-apply-outline").addEventListener("click", () => editorService.outline(get().editor.selection, currentPaletteId(), $("#ws-outline-diagonal").checked));
  $("#ws-undo").addEventListener("click", () => editorService.undo()); $("#ws-redo").addEventListener("click", () => editorService.redo());
  const resizeValue=(name)=>resizeDialog.querySelector(`[name="${name}"]:checked`)?.value;
  const syncResizeSummary=()=>{
    const result=bridge.getResult(),targetWidth=clamp(Math.round(Number($("#ws-resize-width").value)||0),1,1000),targetHeight=clamp(Math.round(Number($("#ws-resize-height").value)||0),1,1000),mode=resizeValue("ws-resize-mode")||"canvas",anchor=resizeValue("ws-resize-anchor")||"center";
    $("#ws-resize-anchor-wrap").hidden=mode!=="canvas";
    if(mode==="pattern"){ $("#ws-resize-summary").textContent="使用最近邻缩放图案；保留原 paletteId，不重新匹配颜色。";return; }
    const crop=resizeCropInsets(result.width||1,result.height||1,targetWidth,targetHeight,{anchor}),hasCrop=Object.values(crop).some(Boolean);
    $("#ws-resize-summary").textContent=hasCrop?`将裁掉：上 ${crop.top} · 下 ${crop.bottom} · 左 ${crop.left} · 右 ${crop.right}`:"扩大区域将填充真正空豆（null），现有色号保持不变。";
  };
  const syncResizeInputs = () => { const result=bridge.getResult(),width=result.width||104,height=result.height||104,preset=width===height&&[52,78,104].includes(width); $("#ws-resize-width").value=String(width); $("#ws-resize-height").value=String(height); $("#ws-resize-current").textContent=`${width} × ${height}`; $("#ws-resize-kind").textContent=preset?`${width}×${height}`:"自定义"; $("#ws-resize-from").textContent=`当前：${width} × ${height}`; syncResizeSummary(); };
  syncResizeInputs();
  $("#ws-resize-open").addEventListener("click",()=>{syncResizeInputs();resizeDialog.showModal();});
  resizeDialog.querySelectorAll("[data-resize-preset]").forEach((button)=>button.addEventListener("click",()=>{$("#ws-resize-width").value=button.dataset.resizePreset;$("#ws-resize-height").value=button.dataset.resizePreset;syncResizeSummary();}));
  resizeDialog.addEventListener("input",syncResizeSummary);resizeDialog.addEventListener("change",syncResizeSummary);
  $("#ws-resize-apply").addEventListener("click", () => {
    const result=bridge.getResult(), targetWidth=clamp(Math.round(Number($("#ws-resize-width").value)||0),1,1000), targetHeight=clamp(Math.round(Number($("#ws-resize-height").value)||0),1,1000);
    if (!result.grid?.length) return;
    const mode=resizeValue("ws-resize-mode")||"canvas",anchor=resizeValue("ws-resize-anchor")||"center",crop=resizeCropInsets(result.width,result.height,targetWidth,targetHeight,{anchor});
    const cropLine=mode==="canvas"&&Object.values(crop).some(Boolean)?`\n将裁掉：上 ${crop.top} / 下 ${crop.bottom} / 左 ${crop.left} / 右 ${crop.right}`:"";
    const message=`当前 ${result.width}×${result.height}\n目标 ${targetWidth}×${targetHeight}\n方式：${mode==="canvas"?"调整图纸":"缩放图案"}${mode==="canvas"?`\n锚点：${resizeAnchorLabels[resizeAnchors.indexOf(anchor)]}`:""}${cropLine}\n\n确认应用？`;
    if (!window.confirm(message)) return;
    const command=createGridResizeCommand(bridge,{grid:result.grid,width:result.width,height:result.height,targetWidth,targetHeight,mode,anchor});
    if (!editorService.executeCommand(command)) return;
    store.setState({canvas:{width:targetWidth,height:targetHeight},editor:{selection:clampSelectionToBounds(get().editor.selection,targetWidth,targetHeight),selectedCell:null},status:{dirty:true,hasPattern:true}});
    viewport.fitToViewport();navigator.requestDraw();syncResizeInputs();resizeDialog.close("applied");
  });

  const referenceInput = $("#ws-ref-file");
  const syncReferenceUi = (state = get()) => {
    const hasReference = Boolean(state.reference.url||(state.reference.useSource!==false&&state.source.image));
    $("#ws-ref-fit").value = state.reference.fit;
    $("#ws-ref-opacity").value = String(state.reference.opacity);
    $("#ws-ref-opacity-value").textContent = `${state.reference.opacity}%`;
    $("#ws-ref-visible").checked = state.reference.visible !== false;
    $("#ws-ref-display").value=state.reference.displayMode||"normal";$("#ws-ref-smoothing").value=state.reference.smoothing||"smooth";
    $("#ws-ref-scale").value=String(Math.round((state.reference.scale||1)*100));$("#ws-ref-scale-value").textContent=`${Math.round((state.reference.scale||1)*100)}%`;
    $("#ws-ref-adjust").textContent=state.reference.adjusting?"完成调整":"调整位置";
    ["#ws-ref-clear", "#ws-ref-fit", "#ws-ref-opacity", "#ws-ref-visible","#ws-ref-display","#ws-ref-smoothing","#ws-ref-scale","#ws-ref-adjust","#ws-ref-reset"].forEach((selector) => { $(selector).disabled = !hasReference; });
  };
  $("#ws-ref-pick").addEventListener("click", () => referenceInput.click());
  referenceInput.addEventListener("change", () => {
    const file = referenceInput.files?.[0];
    referenceInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => store.setState({ reference: { url: String(reader.result || ""),useSource:false,visible:true,fit:"contain",offsetX:0,offsetY:0,scale:1 } });
    reader.readAsDataURL(file);
  });
  $("#ws-ref-clear").addEventListener("click", () => store.setState({ reference: { url:"",useSource:false,visible:true,adjusting:false } }));
  $("#ws-ref-fit").addEventListener("change", (event) => store.setState({ reference: { fit: event.target.value } }));
  $("#ws-ref-display").addEventListener("change",event=>store.setState({reference:{displayMode:event.target.value}}));
  $("#ws-ref-smoothing").addEventListener("change",event=>store.setState({reference:{smoothing:event.target.value}}));
  $("#ws-ref-scale").addEventListener("input",event=>{const scale=clamp(Number(event.target.value)||100,25,200)/100;$("#ws-ref-scale-value").textContent=`${Math.round(scale*100)}%`;store.setState({reference:{scale}});});
  $("#ws-ref-adjust").addEventListener("click",()=>store.setState({reference:{adjusting:!get().reference.adjusting}}));
  $("#ws-ref-reset").addEventListener("click",()=>store.setState({reference:{offsetX:0,offsetY:0,scale:1,fit:"contain"}}));
  $("#ws-ref-opacity").addEventListener("input", (event) => {
    const value = clamp(Math.round(Number(event.target.value) || 0), 0, 100);
    $("#ws-ref-opacity-value").textContent = `${value}%`;
    store.setState({ reference: { opacity: value } });
  });
  $("#ws-ref-visible").addEventListener("change", (event) => store.setState({ reference: { visible: event.target.checked } }));

  // .pixler = ZIP 封装的结构化项目文件。判定不只看后缀：再看 ZIP 签名 PK。
  const isPixlerFile = async (file) => {
    if (/\.pixler$/i.test(file.name || "")) return true;
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      return String.fromCharCode(head[0], head[1]) === "PK";
    } catch {
      return false;
    }
  };

  let pixlerNote = "";
  const loadPixlerProject = async (file) => {
    const { importPixlerProject } = await import("../importers/pixler.mjs?v=20260922-pixler1");
    const result = await importPixlerProject(file, { palette: editorService.getPaletteColors?.() || [] });
    const info = result.report;
    window.LibmsPixlerLastReport = info;
    pixlerNote = `已载入 Pixler · ${info.columns}×${info.rows} · ${info.usedColors} 色 / ${info.totalBeads} 颗`;
    if (!info.beadMatchSynced) pixlerNote += " · 文件内色号表与网格不同步，已按 CIEDE2000 重新匹配";
    if (info.unresolvedCells) pixlerNote += ` · ${info.unresolvedCells} 格无匹配色号`;
    if (info.restoredSettings?.gridVisible) bridge.setEditorGridVisible?.(true);
    return JSON.stringify(result.project);
  };

  const projectFileInput = $("#ws-project-file");
  const applyLoadedProject = (payload) => {
    bridge.loadProjectJson(payload);
    editorService.clearHistory();
    store.setState({
      source: { image: "", width: 0, height: 0 },
      status: { hasSource: false, hasPattern: true, dirty: true, generationError: null },
      view: { mode: "blocks" },
      editor: { tool: "select", selectedCell: null, ...buildClearPalettePatch(), selection: null, hoveredCell: null, textLayers: [], activeTextLayerId: null },
      ui: { exportDrawerOpen: false },
    });
    syncResizeInputs();
    viewport.fitToViewport();
  };
  $("#ws-project-import").addEventListener("click", () => projectFileInput.click());
  projectFileInput.addEventListener("change", async () => {
    const file = projectFileInput.files?.[0];
    projectFileInput.value = "";
    if (!file) return;
    if (!await askConfirmation("载入工程存档会替换当前图纸，未保存的手动编辑将丢失。继续吗？")) return;
    try {
      // .pixler 是结构化项目文件：走原生解析，绝不转成图片再识别（避免二次损失）。
      const isPixler = await isPixlerFile(file);
      const payload = isPixler ? await loadPixlerProject(file) : await file.text();
      applyLoadedProject(payload);
      await autoDraft?.discard?.();
      if (pixlerNote) $("#ws-export-message").textContent = pixlerNote;
    } catch (error) {
      $("#ws-export-message").textContent = error.message;
    }
  });
  let autoDraft = null;
  try { autoDraft=createAutoDraftService(); } catch (error) { $("#ws-draft-status").textContent="当前浏览器不支持自动草稿"; }
  const draftSnapshot = () => { const result=bridge.getResult(); return {projectTitle:get().project.name||result.sourceName||"未命名作品",width:result.width,height:result.height,grid:result.grid,paletteId:result.paletteKey,projectSource:{type:result.sourceName==="blank-board"?"blank":result.sourceUrl?"image":"project"},metadata:{usedColors:result.usedColors,totalBeads:result.totalBeads}}; };
  const scheduleDraft = () => { if (autoDraft && bridge.getResult().grid?.length) autoDraft.scheduleSave(draftSnapshot()); };
  window.addEventListener("libms:grid-edited",scheduleDraft);
  top.querySelector("#ws-project-name").addEventListener("change",scheduleDraft);
  $("#ws-save-project").addEventListener("click",()=>{ void autoDraft?.discard?.(); });
  autoDraft?.getRecoveryMetadata().then((metadata)=>{ if(!metadata)return;$("#ws-draft-status").textContent=`检测到未保存的作品：${metadata.projectTitle} · ${metadata.width}×${metadata.height} · ${new Date(metadata.savedAt).toLocaleString()}`;$("#ws-draft-actions").hidden=false; });
  $("#ws-draft-restore").addEventListener("click",async()=>{const record=await autoDraft?.load();if(!record)return;const draft=record.project;const grid=draft.grid.map(row=>row.map(cell=>cell?editorService.resolveColor(cell.paletteId):null));bridge.replaceGridStructure({grid,width:draft.width,height:draft.height});store.setState({project:{name:draft.projectTitle},canvas:{width:draft.width,height:draft.height},status:{hasPattern:true,dirty:true},ui:{activePanel:"project"}});editorService.clearHistory();viewport.fitToViewport();$("#ws-draft-actions").hidden=true;$("#ws-draft-status").textContent="已恢复本地草稿";});
  $("#ws-draft-discard").addEventListener("click",async()=>{await autoDraft?.discard();$("#ws-draft-actions").hidden=true;$("#ws-draft-status").textContent="已放弃本地草稿";});
  let compareMode = null;
  const endCompare = () => { if (compareMode) { store.setState({ view: { mode: compareMode } }); compareMode = null; } };
  const toggleCompare = () => { if (!get().status.hasSource) return; if (compareMode) endCompare(); else { compareMode = get().view.mode; store.setState({ view: { mode: "original" } }); } };
  $("#ws-compare").addEventListener("pointerdown", (event) => { if (!get().status.hasSource) return;
    compareMode = get().view.mode; event.currentTarget.setPointerCapture(event.pointerId); store.setState({ view: { mode: "original" } }); });
  $("#ws-compare").addEventListener("pointerup", endCompare); $("#ws-compare").addEventListener("pointercancel", endCompare);
  const gridToolbar = new GridEditorToolbar({
    root: toolRail,
    variant: "rail",
    activeTool: get().editor.tool,
    brushSize: get().editor.brushSize,
    shapeFilled: get().editor.shapeFilled,
    onToolChange: (tool) => {
      if (["bead", "brush", "fill", "line", "rect", "ellipse", "text"].includes(tool) && !currentPaletteId()) {
        const fallback = bridge.getResult().colors?.[0]?.code || editorService.getPaletteColors()[0]?.code || null;
        // resolveColor 返回 null 说明 fallback 不是当前色板里的真色号。
        // 旧代码此时会把「当前色」写成那个假色号、却把 paletteId 写成 null ——
        // 正是单真源模型不允许的分叉。现在两个都归 null，由上面的守卫继续提示用户选色。
        if (fallback) { const color=editorService.resolveColor(fallback); store.setState({ editor: buildCurrentPalettePatch(color?paletteIdOf(color):null, paletteColors()) }); }
      }
      if (tool === "text" && !get().editor.activeTextLayerId) { addTextLayer(); return; }
      store.setState({ editor: { tool }, ui: { activePanel: tool === "source-eyedropper" ? "source" : tool === "replace" ? "color" : "edit" } });
    },
    onBrushSizeChange: (size) => store.setState({ editor: { brushSize: size } }),
    onShapeFilledChange: (filled) => store.setState({ editor: { shapeFilled: filled } }),
    onPanelAction: (action) => {
      if (action === "undo") { editorService.undo(); return; }
      if (action === "redo") { editorService.redo(); return; }
      if (action === "help") { gridToolbar.openHelp(); return; }
      if (action === "mirror-horizontal") { editorService.flip("horizontal"); return; }
      if (action === "mirror-vertical") { editorService.flip("vertical"); return; }
    },
  });
  // ── 生成尺寸（Generation Size）─────────────────────────────────────────
  //
  // 唯一自由度是**长边格数**。宽高一律由「长边 + 有效裁剪比例」派生
  // （services/generation-size.mjs），所以这里不提供「只改宽」或「只改高」的入口 ——
  // 那必然破坏比例。编辑器画布调整（允许 222×295 → 220×300 宽高独立）走
  // services/grid-resize-service.js，是另一条链路，不经过这里。
  //
  // 触发纪律（B0 §7）：预设 / 滑杆 / 数字框 / 滚轮 / 方向键**只改草稿**，
  // generation 调用次数必须为 0；只有点「应用尺寸」才提交并生成一次。
  // 导入时的首帧生成不在此列 —— 它由 scheduleInitialGeneration() 显式发起。
  const sizeApi = () => window.LibmsGenerationSize;
  const clampLongEdge = (value) => {
    const api = sizeApi();
    if (api) return api.clampLongEdge(value);
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(500, Math.max(10, number)) : null;
  };

  /** 有效裁剪比例（height / width）。**未知时返回 null** —— 不返回 1，那会预览/生成一张方图。 */
  function effectiveSourceRatio() {
    return bridge.getEffectiveSourceRatio?.() ?? null;
  }

  /** 草稿对应的派生尺寸；比例未知时为 null（= unresolved，不是方图）。 */
  function draftSize() {
    const api = sizeApi();
    if (!api) return null;
    return api.deriveGenerationSize(longEdgeDraft, effectiveSourceRatio());
  }

  /**
   * 把草稿写进 bridge。**不生成** —— 生成一律由调用方显式发起，
   * 这样「拖滑杆」和「出图」在代码里就是两件不可能混淆的事。
   */
  function pushDraftToBridge() {
    bridge.setGenerationLongEdge(longEdgeDraft);
  }

  /** 草稿变更入口：只改数、只刷 UI，绝不触发生成。 */
  function setLongEdgeDraft(value) {
    const next = clampLongEdge(value);
    if (next == null) return null;
    longEdgeDraft = next;
    syncSizeUi();
    return next;
  }

  /** 步进（滚轮 / 方向键）。步长由调用方给：±1，Shift 时 ±10。 */
  function stepLongEdgeDraft(delta) {
    const api = sizeApi();
    sizeOrigin = "manual";
    setLongEdgeDraft(api ? api.stepLongEdge(longEdgeDraft, delta) : longEdgeDraft + delta);
  }

  /**
   * 「应用尺寸」= 提交草稿 + 生成一次。这是尺寸链路上唯一的生成入口。
   *
   * 同时把长边升级为 `user-explicit`（B4 §0）：从这一刻起，
   * 像素倍数识别 / 逻辑尺寸估算 / 首帧自动生成**都不得再改这个尺寸**，
   * 直到用户换源图或主动点「自动」档。
   */
  function commitSize() {
    setLongEdgeAuthority(LONG_EDGE_EVENT.USER_APPLIED);
    pushDraftToBridge();
    // 尺寸可能变化很大，出图后要重新适配窗口，否则用户看到的是一角。
    fitOnNextResult = true;
    syncSizeUi();
    scheduleAutoGenerate(0);
  }

  /**
   * 识别原图的像素倍数：像素画里 1 个逻辑像素由 k×k 个真实像素组成。
   *
   * 保留 detectPixelMultiple + logicalSize 的理由：它们不是旧倍数 UI 的残留，
   * 而是「自动」这一档的**唯一依据** —— 像素画被放大 k 倍后，逻辑尺寸 = 原图 ÷ k。
   * 删掉它们，「自动」就只剩猜。识别失败退化为 1×（即按原图像素）。
   *
   * 识别结果只写草稿，不触发生成。
   */
  function ensureMultipleDetection(url) {
    if (!url) return Promise.resolve(null);
    if (multipleDetectionUrl === url && multipleDetection) return multipleDetection;
    multipleDetectionUrl = url;
    multipleDetection = loadImageData(url)
      .then(({ imageData }) => { detectedMultiple = detectPixelMultiple(imageData); })
      .catch(() => { detectedMultiple = 1; })
      // 成功与失败都要走一次 applyLogicalSize()：识别挂了也得把尺寸定下来，
      // 否则首帧生成会一直等下去（B0 §2）。
      .then(() => { applyLogicalSize(); return detectedMultiple; });
    return multipleDetection;
  }

  /**
   * 由倍数推导逻辑尺寸并写进草稿。
   * 倍数识别出的尺寸常常远大于当前视口（180 豆在默认缩放下是 3600px），
   * 所以提交后要重新适配窗口（fitOnNextResult 在 commitSize / 首帧结果里消费）。
   *
   * 提交前必须过权威链（B0.1 §4 / §5）：像素倍数只是**推导**，不是用户尺寸状态。
   * 结构化工程 / 人工标定 / 网格识别已经在位时，applySourceDimensions 会原样退回它，
   * 这时**绝不能**再改草稿 —— 改了就等于用更弱的证据覆盖更强的证据。
   *
   * @returns {{width:number,height:number}|null|object} 采纳时返回推导尺寸，
   *   被否决时返回权威链的现有尺寸（调用方据此判断「这一票没生效」）。
   */
  function applyLogicalSize() {
    // B4 §0：用户显式点过「应用尺寸」→ 自动链一律不得覆盖。
    // 早退在**最前面**：不写草稿、不提交、不改权威。识别结果仍然会算出来（在下面），
    // 但对尺寸不再有发言权。挡住一次就记一次，真机探针据此确认「自动链确实跑过且被挡」，
    // 而不是「自动链压根没跑」—— 后者是另一个 bug，不能混为一谈。
    if (!shouldAutoWriteLongEdge(longEdgeAuthority)) {
      blockedAutoSizeWrites += 1;
      // 刷一次 UI：让探针能读到「被挡了几次」。不刷的话计数器要等下一次
      // 无关的 syncSizeUi() 才可见，真机验收会误判成「没被挡过」。
      syncSizeUi();
      return null;
    }
    const result = bridge.getResult();
    if (!result.sourceWidth || !result.sourceHeight) return null;
    const { width, height } = logicalSize(result.sourceWidth, result.sourceHeight, detectedMultiple || 1);
    const multiple = detectedMultiple || 1;
    const outcome = bridge.applySourceDimensions({
      width, height,
      // multiple === 1 意味着「没识别出周期」，这不是稳定的倍数证据，
      // 只能算逻辑尺寸估算（权威链最低一级）。
      authority: multiple >= 2 ? "pixel-multiple" : "logical-heuristic",
      source: `pixel-multiple:${multiple}`,
    });
    if (!outcome?.applied) {
      // 被更强的证据否决：只刷 UI（让它显示那个更强的尺寸），不动草稿、不提交。
      syncSizeUi();
      return outcome?.dimensions || null;
    }
    sizeOrigin = "auto";
    longEdgeDraft = clampLongEdge(Math.max(width, height));
    pushDraftToBridge();
    syncSizeUi();
    return { width, height };
  }

  /** 识别源图的像素倍数。paint 每次都会调，靠 detectedForUrl / detecting 去重。 */
  function detectMultipleFor(url) {
    if (!url || url === detectedForUrl || detecting) return;
    detectedForUrl = url;
    detecting = true;
    ensureMultipleDetection(url).finally(() => {
      detecting = false;
      // 识别期间若又换了源图（连着导入两张），这里补跑一次，避免新图被跳过。
      const current = get().source.image;
      if (current && current !== detectedForUrl) detectMultipleFor(current);
    });
  }

  /**
   * 导入后的首帧生成：等倍数识别 settle 再跑，全程只跑一次。
   *
   * 出图前**再提交一次草稿**是刻意的：识别回调（applyLogicalSize）与这里的
   * 生成是两个独立的异步链，靠「谁先谁后」维持一致太脆。显式提交一次，
   * 首帧尺寸就恒等于顶栏读数，不会出现「读数 100、图纸 104」这种分叉。
   *
   * **但用户显式确认过的尺寸除外**（B4 §0）。等待期间用户完全可能已经点了
   * 「应用尺寸」—— 那时草稿与权威都属于用户，这里再提交一次就是把它冲掉，
   * 而且会多排一次生成。判断必须写在 `.then` **里面**：
   * 写在 `await` 之前等于在用户点击之前就做了决定，挡不住任何东西。
   */
  function scheduleInitialGeneration() {
    const url = get().source.image;
    const settled = url ? ensureMultipleDetection(url) : Promise.resolve(null);
    settled.catch(() => {}).then(() => {
      if (!shouldAutoWriteLongEdge(longEdgeAuthority)) {
        blockedAutoSizeWrites += 1;
        return;
      }
      pushDraftToBridge();
      scheduleAutoGenerate(0);
    });
  }

  // 预设 chip：只改草稿。**大尺寸不会因为点了个预设就悄悄跑起来**，
  // 必须再点一次「应用尺寸」（B0 §8）。
  topControls.querySelectorAll("[data-size]").forEach((chip) => chip.addEventListener("click", () => {
    if (chip.dataset.size === "auto") {
      // 「自动」= 用户主动交还尺寸控制权（B4 §0 的第二个清除口）。
      // 必须先降级再算，否则 applyLogicalSize() 会被刚设上的 user-explicit 挡住。
      setLongEdgeAuthority(LONG_EDGE_EVENT.RESTORE_AUTO);
      applyLogicalSize();
      return;
    }
    sizeOrigin = "manual";
    setLongEdgeDraft(chip.dataset.size);
  }));
  $("#ws-size-range")?.addEventListener("input", (event) => { sizeOrigin = "manual"; setLongEdgeDraft(event.target.value); });
  $("#ws-size-number")?.addEventListener("input", (event) => { sizeOrigin = "manual"; setLongEdgeDraft(event.target.value); });
  // 滚轮：±1；Shift+滚轮：±10。只改草稿。
  $("#ws-size-controls")?.addEventListener("wheel", (event) => {
    if (!get().status.hasSource || lockedAuthority()) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    stepLongEdgeDraft(event.deltaY < 0 ? step : -step);
  }, { passive: false });
  // 方向键：↑/↓ ±1；Shift+↑/↓ ±10。只改草稿。
  // 左右键不拦，交给 range 的原生行为（同样只走 input → 只改草稿）。
  $("#ws-size-controls")?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (lockedAuthority()) return;
    event.preventDefault();
    stepLongEdgeDraft(event.key === "ArrowUp" ? (event.shiftKey ? 10 : 1) : (event.shiftKey ? -10 : -1));
  });
  $("#ws-size-apply")?.addEventListener("click", commitSize);

  /**
   * 刷新尺寸栏。用函数声明（会提升）而非 const 箭头，避免 paint() 早于定义执行时踩 TDZ。
   * 节点一律现查现用，不闭包捕获 const —— 同样是躲 TDZ。
   * 注意这里**不读图纸尺寸**：生成尺寸与「作品」面板里的图纸尺寸是两条独立链路（B0 §5 / C0 §7）。
   * 名字上也不再混用「画布」——「画布」在这个界面里专指 <canvas>。
   */
  /**
   * 当前尺寸权威（结构化工程 / 人工标定 / 网格识别）是否已经锁定了图纸尺寸。
   * 锁定后长边不再是自由度：滑杆 / 数字框 / 滚轮 / 方向键 / 「应用尺寸」全部让位。
   */
  function lockedAuthority() {
    const dims = bridge.getSourceDimensions?.() || null;
    const api = window.LibmsSourceDimensions;
    return api && dims && api.isAbsoluteAuthority(dims.authority) ? dims : null;
  }

  function syncSizeUi() {
    const locked = lockedAuthority();
    // 长边权威对真机探针可见（B4 §0 验收要证明「用户那一票真的生效了」）。
    // 挂在控件组上而不是别处：它描述的就是这组控件的状态。
    const controlsNode = $("#ws-size-controls");
    if (controlsNode) {
      controlsNode.dataset.longEdgeAuthority = longEdgeAuthority;
      controlsNode.dataset.blockedAutoWrites = String(blockedAutoSizeWrites);
    }
    // 锁定态直接读权威尺寸，不走 draftSize()：那不是「派生」，是**绝对值**。
    const derived = locked
      ? { longEdge: Math.max(locked.width, locked.height), width: locked.width, height: locked.height }
      : draftSize();
    const range = $("#ws-size-range"), number = $("#ws-size-number");
    if (range && document.activeElement !== range) range.value = String(derived?.longEdge ?? longEdgeDraft);
    if (number && document.activeElement !== number) number.value = String(derived?.longEdge ?? longEdgeDraft);
    const sizeValue = $("#ws-size-value");
    if (sizeValue) {
      sizeValue.innerHTML = derived
        ? `<strong>${derived.width}</strong><span>×</span><strong>${derived.height}</strong>`
        : `<strong>—</strong><span>×</span><strong>—</strong>`;
      sizeValue.title = derived
        ? `长边 ${derived.longEdge} 格 · ${derived.width} × ${derived.height}`
        : "等待源图比例，暂不能定尺寸";
    }
    // 控件可用性**只在这里**决定。
    //
    // 不能拆到 paint() 里各写一份：权威变更走 libms:source-dimensions → syncSizeUi()，
    // 那条路径不经过 paint()，于是出现「尺寸已锁定、读数已是 222×295，滑杆却还能拖」
    // 的半锁定态 —— B0.1 真机探针抓到的就是这个。
    // 锁定（工程文件 / 人工标定 / 网格识别在位）或没有源图 → 整套长边控件让位。
    const sizeControlsDisabled = Boolean(locked) || !get().status.hasSource;
    topControls.querySelectorAll("[data-size]").forEach((chip) => {
      const value = chip.dataset.size;
      const active = !locked && (value === "auto" ? sizeOrigin === "auto" : sizeOrigin === "manual" && Number(value) === longEdgeDraft);
      chip.classList.toggle("is-active", active);
      chip.disabled = sizeControlsDisabled;
    });
    // 权威来源说明：锁定态必须说清「这个尺寸是谁定的」，否则用户会以为滑杆坏了。
    const authorityNode = $("#ws-size-authority");
    if (authorityNode) {
      const api = window.LibmsSourceDimensions;
      authorityNode.hidden = !locked;
      authorityNode.dataset.authority = locked ? locked.authority : "";
      authorityNode.textContent = locked && api
        ? `${api.describeSourceDimensions(locked)} · 已锁定`
        : "";
    }
    // 分档提示（B0 §8）：301–400 提示大尺寸，>400 提示超大尺寸，都必须显式点「应用尺寸」。
    const tierNode = $("#ws-size-tier");
    if (tierNode) {
      const tier = locked ? "normal" : (sizeApi()?.sizeWarningTier(longEdgeDraft) || "normal");
      tierNode.hidden = tier === "normal";
      tierNode.dataset.tier = tier;
      tierNode.textContent = tier === "xlarge"
        ? "超大尺寸：生成可能要很久，确认后点「应用尺寸」"
        : tier === "large" ? "大尺寸：生成会明显变慢" : "";
    }
    for (const id of ["#ws-size-range", "#ws-size-number"]) {
      const node = $(id);
      if (node) node.disabled = sizeControlsDisabled;
    }
    const apply = $("#ws-size-apply");
    if (apply) apply.disabled = sizeControlsDisabled || !derived;
  }
  // 选区相关的动作统一走这里：按钮、方向键、快捷键三处共用，避免逻辑分叉。
  const selectionActions = {
    copy: () => { if (editorService.copySelection(get().editor.selection)) notifySelection(`已复制 ${editorService.getClipboard().beads} 颗豆（${editorService.getClipboard().width}×${editorService.getClipboard().height}）`); },
    cut: () => { if (editorService.cutSelection(get().editor.selection)) notifySelection(`已剪切 ${editorService.getClipboard().beads} 颗豆`); },
    paste: () => {
      if (!editorService.hasClipboard() || !get().status.hasPattern) return;
      const selection = get().editor.selection, cell = get().editor.selectedCell;
      const target = selection ? { x: selection.x0, y: selection.y0 } : cell || { x: 0, y: 0 };
      editorService.pasteClipboard(target.x, target.y);
      store.setState({ editor: { selection: null } });
    },
    invert: () => { const { width, height } = bridge.getResult(); store.setState({ editor: { selection: invertSelectionMask(get().editor.selection, width, height) } }); },
    selectAll: () => { const { width, height } = bridge.getResult(); store.setState({ editor: { selection: selectAllCells(width, height) } }); },
  };
  const notifySelection = (message) => { $("#ws-history-label").textContent = message; };
  const nudgeSelection = (dx, dy) => {
    const selection = get().editor.selection;
    const { width, height } = bridge.getResult();
    if (!selection || !get().status.hasPattern || (!dx && !dy)) return;
    const hasContent = selectionCells(selection, width, height).some(({ x, y }) => bridge.getCell(x, y));
    // 选区里有豆子就整体搬移；只是空框则移动选框本身，两种预期都要照顾。
    if (hasContent) editorService.moveSelection(selection, dx, dy);
    store.setState({ editor: { selection: translateSelection(selection, dx, dy, width, height) } });
  };
  const attachSelectionActions = () => {
    $("#ws-copy-selection").addEventListener("click", selectionActions.copy);
    $("#ws-cut-selection").addEventListener("click", selectionActions.cut);
    $("#ws-paste-selection").addEventListener("click", selectionActions.paste);
    $("#ws-invert-selection").addEventListener("click", selectionActions.invert);
    $("#ws-select-all").addEventListener("click", selectionActions.selectAll);
    $("#ws-wand-tolerance").addEventListener("input", (event) => {
      const value = clamp(Math.round(Number(event.target.value) || 0), 0, 100);
      $("#ws-wand-tolerance-value").textContent = String(value);
      store.setState({ editor: { wandTolerance: value } });
    });
    $("#ws-brush-size").addEventListener("input", (event) => {
      const value = clamp(Math.round(Number(event.target.value) || 1), 1, 9);
      gridToolbar.setBrushSize(value);
      store.setState({ editor: { brushSize: gridToolbar.brushSize } });
    });
    $("#ws-shape-filled").addEventListener("change", (event) => {
      store.setState({ editor: { shapeFilled: event.target.checked } });
    });
    $("#ws-pixel-perfect").addEventListener("change", (event) => store.setState({editor:{pixelPerfect:event.target.checked}}));
    const cancelOutlinePreview=()=>store.setState({editor:{outlinePreview:null}});
    for(const id of ["#ws-outline-source","#ws-outline-thickness","#ws-outline-connectivity","#ws-outline-holes"]) $(id).addEventListener("change",cancelOutlinePreview);
    $("#ws-outline-target").addEventListener("change",event=>store.setState({editor:{outlineTargetPaletteId:event.target.value,outlinePreview:null}}));
    $("#ws-outline-preview").addEventListener("click",()=>{
      const target=$("#ws-outline-target").value;if(!target){notify("请先选择描边颜色。");return;}
      const state=get(),plan=editorService.planOutline({sourceMode:$("#ws-outline-source").value,selectedCell:state.editor.selectedCell,selectedPaletteId:state.editor.selectedPaletteId,selection:state.editor.selection,thickness:Number($("#ws-outline-thickness").value),connectivity:Number($("#ws-outline-connectivity").value),includeHoles:$("#ws-outline-holes").checked});
      store.setState({editor:{outlinePreview:{...plan,cells:plan.outlineCells,targetPaletteId:target,candidateCount:plan.candidateCells.length,blockedCount:plan.blockedCells.length}}});renderer.requestDraw();
    });
    $("#ws-outline-cancel").addEventListener("click",cancelOutlinePreview);
    $("#ws-outline-apply").addEventListener("click",()=>{const preview=get().editor.outlinePreview;if(!preview)return;editorService.applyOutlinePlan(preview,preview.targetPaletteId);store.setState({editor:{outlinePreview:null}});renderer.requestDraw();});
    $("#ws-symmetry-mode").addEventListener("change", (event) => {
      const mode = event.target.value;
      store.setState({ editor: { symmetryMode: mode, symmetryHorizontal: ["vertical","both"].includes(mode), symmetryVertical: ["horizontal","both"].includes(mode) } });
    });
    const updateSymmetryAxis = (key, input, maximum) => {
      const value = clamp(Math.round((Number(input.value) || 0) * 2) / 2, 0, maximum);
      input.value = String(value); store.setState({ editor: { [key]: value } });
    };
    $("#ws-symmetry-axis-x").addEventListener("change", (event) => updateSymmetryAxis("symmetryAxisX", event.target, Math.max(0, bridge.getResult().width - 1)));
    $("#ws-symmetry-axis-y").addEventListener("change", (event) => updateSymmetryAxis("symmetryAxisY", event.target, Math.max(0, bridge.getResult().height - 1)));
    $("#ws-symmetry-guides").addEventListener("change", (event) => store.setState({ editor: { symmetryGuideVisible: event.target.checked } }));
  };
  attachSelectionActions();
  window.addEventListener("keydown", (event) => {
    if (confirmDialog.open || gridToolbar?.helpDialog?.open || document.querySelector("#editor-modal")?.open || document.querySelector("#assembly-modal")?.open) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches("input,textarea,select") || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    const withModifier = event.metaKey || event.ctrlKey;
    if (withModifier && key === "z") { event.preventDefault(); event.shiftKey ? editorService.redo() : editorService.undo(); return; }
    if (withModifier && key === "y") { event.preventDefault(); editorService.redo(); return; }
    if (withModifier && ["a", "i", "c", "x", "v", "d"].includes(key)) {
      if (!get().status.hasPattern) return;
      // ⌘D / Esc 是取消选择；其余四个交给统一的选区动作。
      event.preventDefault();
      if (key === "d") { store.setState({ editor: { selection: null } }); return; }
      ({ a: selectionActions.selectAll, i: selectionActions.invert, c: selectionActions.copy, x: selectionActions.cut, v: selectionActions.paste })[key]();
      return;
    }
    if (event.key === " " && !event.repeat) { event.preventDefault(); spaceDown = true; return; }
    if (event.key === "Escape") {
      // 第一次 Esc 只清高亮；第二次清格选中与选区。
      // **不清当前颜色** —— 旧代码只把 selectedPaletteId 置 null、却留着 selectedColor，
      // 画笔靠 `selectedPaletteId || selectedColor` 兜底才没坏。单真源下不允许这种分叉，
      // 于是按「实际可观察行为」保留颜色：清掉颜色会让画笔失能，那是回归不是修复。
      if (get().editor.highlightedPaletteId) store.setState({ editor: buildHighlightOnlyPatch(null, { enabled: false }) });
      else store.setState({ editor: { selectedCell: null, selection: null, shapePreview: null } });
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && get().editor.selection && get().status.hasPattern) {
      event.preventDefault(); editorService.eraseSelection(get().editor.selection); return;
    }
    if (event.key === "[" || event.key === "]") { event.preventDefault(); gridToolbar.stepBrushSize(event.key === "[" ? -1 : 1); return; }
    if (event.key.startsWith("Arrow") && get().editor.selection) {
      const step = event.shiftKey ? 5 : 1;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (delta) { event.preventDefault(); nudgeSelection(delta[0], delta[1]); }
      return;
    }
    if (key === "0") viewport.fitToViewport(); if (key === "1") viewport.resetZoom();
  });
  window.addEventListener("keyup", (event) => { if (event.key === " ") spaceDown = false; });

  /* ============================ 库存（B 批） ============================ */

  const getUsageStats = () => bridge.getResult().colors || [];
  const inventory = createInventoryService({
    getStats: getUsageStats,
    getPaletteColors: () => bridge.getPaletteColors(),
  });
  // OCR 引擎与 worker 都是惰性创建：不点「识别外部图纸」就一个字节都不下载。
  const ocr = createOcrService();
  const recognition = createLegendRecognitionService({ ocr, matchColor: (rgb) => bridge.getNearestPaletteCandidates(rgb) });

  const toast = document.createElement("div");
  toast.className = "ws-toast";
  toast.hidden = true;
  wrap.append(toast);
  let toastTimer = null;
  const notify = (message) => {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
    inventoryPanel?.setMessage(message);
  };

  /* ======================== 文字素材（浮动图层） ======================== */
  // 参考 Pixler 的「添加文字」：文字先作为**浮动图层**摆在画布上（只画在 overlay 层），
  // 调好字体 / 颜色 / 加粗倾斜 / 字号 / 旋转之后点「向下合并」，才一次性写成真实豆格。
  // 三个关键取舍：
  //   · 预览与合并共用 rasterizeText —— 「看到的格子」就是「合下去的格子」，不会差半格；
  //   · 浮动期间一个豆格都不写 grid —— 所以从放到拖全程撤销栈是干净的，合并只产生一步历史；
  //   · 新图层落在当前视口正中 —— 点了「添加文字」立刻就能看到，不用满画布去找。
  function renderTextPanel(state = get()) {
    if (!textPanel) return;
    const layers = state.editor.textLayers || [];
    const active = layers.find((layer) => layer.id === state.editor.activeTextLayerId) || null;
    const { w, h } = gridSize();
    textPanel.render({
      layers,
      activeId: active?.id || null,
      palette: editorService.getPaletteColors(),
      recent: state.editor.textRecentColors || [],
      // 落豆数与画布预览、与合并写进去的格子来自同一次栅格化（带缓存），三处必然一致。
      cells: active ? rasterizeTextCached(active, w, h).cells.length : 0,
    });
  }
  textPanel = new TextPanel({
    root: "#textPanel",
    onAdd: () => addTextLayer(),
    onPatch: (id, patch) => {
      if (!id) return;
      setTextLayers(currentTextLayers().map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)), id);
      renderer.requestDraw();
    },
    onSelect: (id) => { store.setState({ editor: { activeTextLayerId: id, tool: "text" } }); renderer.requestDraw(); },
    onDelete: (id) => {
      if (!id) return;
      const before=currentTextLayers().map(layer=>({...layer})),rest=before.filter((layer)=>layer.id!==id),beforeActive=get().editor.activeTextLayerId,afterActive=rest.at(-1)?.id||null;
      editorService.executeCommand(createEditorCommand({kind:"object",type:"TEXT_DELETE",label:`删除文字：${before.find(layer=>layer.id===id)?.text||"文字"}`,execute:()=>{setTextLayers(rest,afterActive);renderer.requestDraw();return true;},undo:()=>{setTextLayers(before,beforeActive);renderer.requestDraw();return true;},redo:()=>{setTextLayers(rest,afterActive);renderer.requestDraw();return true;}}));
    },
    onMerge: (id) => {
      const layer = currentTextLayers().find((item) => item.id === id);
      if (!layer) return;
      const { w, h } = gridSize();
      const { cells } = rasterizeTextCached(layer, w, h);
      if (!cells.length) { notify("这段文字落在图纸范围内没有豆格：先调小字号，或把它拖回画布内。"); return; }
      const identity = layer.paletteId || layer.color || currentPaletteId();
      const color = identity ? editorService.resolveColor(identity) : null;
      if (!color) { notify("先给文字选一个色号，再向下合并。"); return; }
      // 合并 = 把整块文字一次性写成豆格。走 applyCells → commit，所以是一步可撤销的历史。
      const applied = editorService.applyCells(cells, color.code, "TEXT_MERGE", `文字合并：${(layer.text || "").trim().slice(0, 12) || "空文字"} · ${cells.length} 豆`);
      // 合并后移除该浮动图层：内容已经在图纸上了，再留一份只会重复。
      const rest = currentTextLayers().filter((item) => item.id !== id);
      setTextLayers(rest, rest.at(-1)?.id || null);
      store.setState({ editor: buildCurrentPalettePatch(paletteIdOf(color), paletteColors()) });
      renderer.requestDraw();
      notify(applied ? `已合并 ${cells.length} 颗豆，可撤销` : "文字与图纸现有颜色一致，没有需要写入的豆格。");
    },
    onUseCurrentColor: (id) => {
      const paletteId = currentPaletteId();
      if (!paletteId) { notify("先在「色彩」里选一个色号。"); return; }
      if (!id) return;
      // 工作台上 paletteId 恒等于色号 code，两个字段写同一个值（保留图层既有形状）。
      setTextLayers(currentTextLayers().map((layer) => (layer.id === id ? { ...layer, color: paletteId, paletteId } : layer)), id);
      renderer.requestDraw();
    },
    // 「+」把当前色加进色块行。要与当前显示的候选色**连续**，所以从「已有的最近用色，
    // 没有就用色卡前 4 色」接着往后加，而不是把它整行替换掉。
    onAddCurrentColor: () => {
      const code = currentPaletteId();
      if (!code) { notify("先在「色彩」里选一个色号。"); return; }
      const shown = get().editor.textRecentColors || editorService.getPaletteColors().slice(0, 4).map((color) => color.code);
      store.setState({ editor: { textRecentColors: [code, ...shown.filter((item) => item !== code)].slice(0, 6) } });
    },
  });

  let usageDialog = null;
  const inventoryPanel = new InventoryPanel({
    root: right.querySelector("#inventoryPanel"),
    inventory,
    getStats: getUsageStats,
    getProjectName: () => get().project.name,
    askConfirmation,
    onNotify: notify,
    onOpenUsage: (options) => usageDialog?.open(options),
  });
  inventoryPanel.mount();
  usageDialog = new UsageDialog({
    inventory,
    recognition,
    ocr,
    getStats: getUsageStats,
    getPaletteCodes: () => new Set(bridge.getPaletteColors().map((color) => color.code)),
    askConfirmation,
    onNotify: notify,
  });

  // ===================== 施工模式（参照 Pixler /build） =====================
  // 把图纸切成 cols×rows 个区块，一次只看一块、只放一色。
  // 区块与颜色的选择只作用在「叠加层 + editor.highlightedColor」，不写 state.grid，
  // 所以撤销栈始终干净；「颜色切换」直接复用渲染器已有的 highlightedColor 淡化能力。
  const build = { count: 1, cols: 1, rows: 1, block: 0, color: null, colors: [] };
  // 复用上面已声明的 well / layers，不要重复声明（重复会直接 SyntaxError 导致整个工作台挂不上）
  const buildOverlay = document.createElement("div");
  buildOverlay.className = "ws-build-overlay"; buildOverlay.id = "ws-build-overlay"; buildOverlay.hidden = true;
  buildOverlay.innerHTML = `<div class="ws-build-spot" id="ws-build-spot"></div>`;
  well.append(buildOverlay);
  const rulers = document.createElement("div");
  rulers.className = "ws-rulers"; rulers.id = "ws-rulers"; rulers.hidden = true;
  rulers.innerHTML = ["top", "left", "bottom", "right"].map((side) => `<div class="ws-ruler ws-ruler-${side}" id="ws-ruler-${side}"></div>`).join("");
  well.append(rulers);

  const buildActive = () => document.body.classList.contains("ws-mode-build");
  const gridSize = () => { const r = bridge.getResult(); return { w: r.width || 0, h: r.height || 0, grid: r.grid || [] }; };

  // 按图纸宽高比切块，避免出现极窄的条；块数向上取整到 cols×rows ≥ count。
  function blockLayout() {
    const { w, h } = gridSize();
    const n = Math.max(1, build.count);
    const ratio = w && h ? w / h : 1;
    let cols = Math.max(1, Math.round(Math.sqrt(n * ratio)));
    while (cols * Math.ceil(n / cols) < n) cols += 1;
    const rows = Math.ceil(n / cols);
    build.cols = cols; build.rows = rows;
    build.block = Math.min(build.block, cols * rows - 1);
    return { cols, rows, bw: Math.max(1, Math.ceil(w / cols)), bh: Math.max(1, Math.ceil(h / rows)) };
  }
  function blockRect(index = build.block) {
    const { w, h } = gridSize(); const { cols, bw, bh } = blockLayout();
    const x0 = (index % cols) * bw, y0 = Math.floor(index / cols) * bh;
    return { x0, y0, x1: Math.min(w, x0 + bw), y1: Math.min(h, y0 + bh) };
  }
  function blockColors() {
    const { grid } = gridSize(); const { x0, y0, x1, y1 } = blockRect();
    const seen = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const color = grid[y]?.[x]; if (!color) continue;
      const hit = seen.get(color.code); if (hit) hit.count += 1; else seen.set(color.code, { ...color, count: 1 });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }
  // 建议块数：单块边长不超过 ~30 格时最好拼，据此给一个参考值。
  function advisedBlocks() {
    const { w, h } = gridSize(); if (!w || !h) return 1;
    return Math.max(1, Math.ceil(w / 30) * Math.ceil(h / 30));
  }

  function renderBlockMap() {
    const { cols, rows } = blockLayout();
    const map = $("#ws-block-map"); if (!map) return;
    map.style.setProperty("--ws-block-cols", String(cols));
    map.innerHTML = Array.from({ length: cols * rows }, (_, i) =>
      `<button type="button" data-ws-block-index="${i}" class="${i === build.block ? "active" : ""}" aria-label="区块 ${i + 1}">${i + 1}</button>`).join("");
    const count = $("#ws-block-count"); if (count) count.textContent = String(build.count);
    const advice = $("#ws-block-advice");
    if (advice) advice.textContent = `最佳建议 ${advisedBlocks()} 块 · 当前 ${cols} × ${rows}`;
  }
  function renderBlockColors() {
    build.colors = blockColors();
    const host = $("#ws-block-colors"); if (!host) return;
    host.innerHTML = build.colors.map((color, i) =>
      `<button type="button" data-ws-block-color="${esc(color.code)}" class="${color.code === build.color ? "active" : ""}" title="${esc(color.code)} · ${color.count} 颗"><span style="background:${esc(color.hex)}"></span><small>${esc(color.code)}</small></button>`).join("")
      || '<p class="ws-note">当前区块没有豆子。</p>';
    const focus = $("#ws-build-focus");
    if (focus) {
      const { x0, y0, x1, y1 } = blockRect();
      focus.textContent = build.colors.length
        ? `第 ${build.block + 1} / ${build.cols * build.rows} 块 · 行 ${y0 + 1}–${y1} 列 ${x0 + 1}–${x1} · ${build.colors.length} 色`
        : `第 ${build.block + 1} / ${build.cols * build.rows} 块 · 空`;
    }
  }
  function updateBuildOverlay() {
    const on = buildActive() && gridSize().grid.length;
    buildOverlay.hidden = !on; rulers.hidden = !on;
    if (!on) return;
    const { w, h } = gridSize();
    const o = viewport.origin(), cell = o.cell;
    const { x0, y0, x1, y1 } = blockRect();
    const spot = $("#ws-build-spot");
    spot.style.left = `${o.x + x0 * cell}px`; spot.style.top = `${o.y + y0 * cell}px`;
    spot.style.width = `${(x1 - x0) * cell}px`; spot.style.height = `${(y1 - y0) * cell}px`;
    // 四边标尺：每 5 格一个刻度，10 的倍数用品红强调
    const ticks = (count, horizontal) => Array.from({ length: count }, (_, i) => i + 1)
      .filter((n) => n % 5 === 0)
      .map((n) => {
        const major = n % 10 === 0;
        const pos = o[horizontal ? "x" : "y"] + (n - 1) * cell + cell / 2;
        return pos > -40 && pos < (horizontal ? well.clientWidth : well.clientHeight) + 40
          ? `<span class="${major ? "is-major" : ""}" style="${horizontal ? "left" : "top"}:${pos}px">${n}</span>` : "";
      }).join("");
    $("#ws-ruler-top").innerHTML = ticks(w, true);
    $("#ws-ruler-bottom").innerHTML = ticks(w, true);
    $("#ws-ruler-left").innerHTML = ticks(h, false);
    $("#ws-ruler-right").innerHTML = ticks(h, false);
  }
  function applyBuildColor(code) {
    build.color = code || null;
    // 复用渲染器已有的「高亮色淡化其余」能力，不额外写渲染代码。
    // 走 buildHighlightOnlyPatch 而不是裸写 highlightedColor：
    // 生产网格上 paletteIdOf(cell) === cell.code，两者渲染结果完全等价，
    // 但统一到 paletteId 通道后，高亮只有一套来源，不会再出现两套高亮互相盖。
    store.setState({ editor: buildHighlightOnlyPatch(build.color) });
    renderBlockColors();
  }
  function setWorkspaceMode(mode) {
    const next = mode === "build" ? "build" : "edit";
    document.body.classList.toggle("ws-mode-build", next === "build");
    if (next === "build") {
      build.block = 0; build.color = null;
      renderBlockMap(); applyBuildColor(null);
      store.setState({ ui: { activePanel: "build" } });
    } else {
      store.setState({ ui: { activePanel: "project" }, editor: buildHighlightOnlyPatch(null, { enabled: false }) });
      build.color = null;
    }
    requestAnimationFrame(() => { updateBuildOverlay(); renderer.requestDraw(); });
  }
  // 施工面板事件
  right.querySelector('[data-ws-inspector="build"]').addEventListener("click", (event) => {
    const step = event.target.closest("[data-ws-block]");
    if (step) {
      const total = build.cols * build.rows;
      const action = step.dataset.wsBlock;
      if (action === "inc") build.count = Math.min(64, build.count + 1);
      else if (action === "dec") build.count = Math.max(1, build.count - 1);
      else if (action === "next") build.block = (build.block + 1) % total;
      else if (action === "prev") build.block = (build.block - 1 + total) % total;
      const next = blockLayout();
      $("#ws-block-count").textContent = String(build.count);
      $("#ws-block-advice").textContent = `最佳建议 ${advisedBlocks()} 块 · 当前 ${next.cols} × ${next.rows}`;
      renderBlockMap(); applyBuildColor(null); updateBuildOverlay(); renderer.requestDraw();
      return;
    }
    const pick = event.target.closest("[data-ws-block-index]");
    if (pick) { build.block = Number(pick.dataset.wsBlockIndex); renderBlockMap(); applyBuildColor(null); updateBuildOverlay(); renderer.requestDraw(); return; }
    const swatch = event.target.closest("[data-ws-block-color]");
    if (swatch) { applyBuildColor(swatch.dataset.wsBlockColor === build.color ? null : swatch.dataset.wsBlockColor); return; }
    const colorStep = event.target.closest("[data-ws-color]");
    if (colorStep && build.colors.length) {
      const at = build.colors.findIndex((color) => color.code === build.color);
      const dir = colorStep.dataset.wsColor === "next" ? 1 : -1;
      const next = at < 0 ? (dir > 0 ? 0 : build.colors.length - 1) : (at + dir + build.colors.length) % build.colors.length;
      applyBuildColor(build.colors[next].code);
      return;
    }
    if (event.target.closest("#ws-build-reset")) { build.count = 1; build.block = 0; $("#ws-block-count").textContent = "1"; blockLayout(); renderBlockMap(); applyBuildColor(null); updateBuildOverlay(); renderer.requestDraw(); }
  });

  store.subscribe(paint);
  syncLegacy(); paint(get(), { status: true, stats: true });
  renderPicker();
  // 可复现浏览器 QA 入口只在本机开放；固定夹具不进入工程格式，也不会影响线上用户。
  const qaProject = new URLSearchParams(location.search).get("qaProject");
  if (["localhost", "127.0.0.1"].includes(location.hostname) && qaProject === "editor-104") {
    fetch("./tests/fixtures/editor-104x104.libms-project")
      .then((response) => { if (!response.ok) throw new Error(`QA fixture ${response.status}`); return response.text(); })
      .then((payload) => { applyLoadedProject(payload); $("#ws-export-message").textContent = "已载入固定 104×104 编辑器 QA 工程"; })
      .catch((error) => { $("#ws-export-message").textContent = error.message; });
  }
  delete grid.dataset.workspaceMounting;
  grid.dataset.workspaceReady = "true";
  return {
    mounted: true,
    reused: false,
    openProjectFile: async (file) => {
      if (!file) return false;
      const isPixler = await isPixlerFile(file);
      const payload = isPixler ? await loadPixlerProject(file) : await file.text();
      applyLoadedProject(payload);
      if (pixlerNote) $("#ws-export-message").textContent = pixlerNote;
      return true;
    },
  };
}
