import { projectStore } from "../state/project-store.js?v=20260918-usage2";
import { createGenerationService } from "../services/generation-service.js?v=20260918-usage2";
import { createPaletteService } from "../services/palette-service.js";
import { createExportService } from "../services/export-service.js?v=20260917-batchA";
import { createEditorService } from "../services/editor-service.js?v=20260918-usage2";
import { createViewportService } from "../services/viewport-service.js?v=20260918-usage2";
import { createCanvasRenderer } from "./canvas-renderer.js?v=20260918-usage2";
import { rectangularSelection, sameColorSelection, connectedSelection, selectionContains, selectionCells } from "../services/selection-service.js?v=20260916-phase35-5";
import { magicWandSelection, fitSelectionBox, invertSelection as invertSelectionMask, selectAll as selectAllCells, translateSelection } from "../services/shapes-service.js?v=20260918-usage2";
import { renderSourceTransform, defaultSourceTransform, cropFromDrag, sourceOutputGeometry } from "../services/source-editor-service.js?v=20260916-phase35-5";
import { GenerationPanel } from "./generation-panel.js?v=20260918-usage2";
import { GridEditorToolbar, SHAPE_TOOLS } from "./grid-editor-toolbar.js?v=20260918-usage2";
import { ZoomControls } from "./zoom-controls.js?v=20260916-phase35-6";
import { createInventoryService } from "../services/inventory-service.js?v=20260917-inventory";
import { createOcrService } from "../services/ocr-service.js?v=20260917-inventory";
import { createLegendRecognitionService } from "../services/legend-recognition-service.js?v=20260917-inventory";
import { InventoryPanel } from "./inventory-panel.js?v=20260917-inventory";
import { UsageDialog } from "./usage-dialog.js?v=20260917-inventory";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function mountWorkspace(bridge) {
  const store = projectStore, generation = createGenerationService(bridge, store);
  const palettes = createPaletteService(bridge, store), exports = createExportService(bridge, store), editorService = createEditorService(bridge, { onHistoryChange: () => updateHistory() });
  const wrap = document.querySelector(".workspace-wrap"), grid = wrap?.querySelector(".workspace-grid");
  const top = wrap?.querySelector(".main-global-toolbar"), left = grid?.querySelector(".main-left-toolbar");
  const center = grid?.querySelector(".main-center-workspace"), right = grid?.querySelector(".main-right-inspector");
  if (!wrap || !grid || !top || !left || !center || !right || grid.dataset.phase2Ready) return;
  grid.dataset.phase2Ready = "true";
  bridge.setLockAspectRatio(false);
  bridge.setWidth(104); bridge.setHeight(104);
  store.setState({ canvas: { width: 104, height: 104, lockAspectRatio: false }, generation: { engine: "v2.5", algorithm: "current" } });
  document.body.classList.add("phase2-workspace");

  const legacy = document.createElement("details"); legacy.className = "ws-legacy";
  legacy.innerHTML = "<summary>更多现有工具与参数</summary>";
  [...top.children].forEach((node) => legacy.append(node));
  [...left.children].forEach((node) => legacy.append(node));
  [...right.children].forEach((node) => legacy.append(node));

  top.className = "ws-topbar";
  top.innerHTML = `<div class="ws-brand"><span class="ws-brand-mark" aria-hidden="true">▦</span><span>时里白拼豆生成器</span></div>
    <input class="ws-name" id="ws-project-name" aria-label="作品名称" value="未命名作品" maxlength="40">
    <span class="ws-status" id="ws-status">未开始</span>
    <button type="button" class="ws-button" id="ws-source-open">图片调整</button>
    <button type="button" class="ws-button" id="ws-import-again">换图</button>
    <label class="ws-engine-label">引擎<select id="ws-engine"><option value="v2.5">智能 V2.5</option><option value="legacy">Legacy</option></select></label>
    <label class="ws-engine-label" title="选择生成算法">算法<select id="ws-algorithm"><option value="current">现有算法</option><option value="bgs">BGS 算法</option><option value="pindou-workbench">PW 算法</option><option value="hybrid-pw">HYBRID-PW 混合</option></select></label>
    <button type="button" class="ws-button ws-button-primary" id="ws-generate">生成 / 更新</button>
    <button type="button" class="ws-button" id="ws-legacy-retry" hidden>Legacy 重试</button>
    <button type="button" class="ws-button" id="ws-making" disabled>开始拼</button>
    <button type="button" class="ws-button" id="ws-export" disabled>导出</button>`;

  left.className = "ws-rail";
  left.setAttribute("aria-label", "工作台功能");
  left.innerHTML = [["project", "▦", "作品"], ["source", "▧", "图片调整"], ["color", "◉", "色彩"], ["edit", "✎", "编辑"], ["check", "◇", "检查"], ["inventory", "▤", "库存"]]
    .map(([id, icon, name]) => `<button type="button" class="ws-rail-button" data-ws-panel="${id}" aria-label="${name}" title="${name}"><span aria-hidden="true">${icon}</span><small>${name}</small></button>`).join("");

  center.className = "ws-center";
  const oldTabs = center.querySelector(".main-view-tabs"); if (oldTabs) oldTabs.hidden = true;
  const oldPreview = center.querySelector(".preview-column"); if (oldPreview) oldPreview.classList.add("ws-old-preview");
  const importView = document.createElement("section"); importView.className = "ws-import"; importView.id = "ws-import";
  importView.innerHTML = `<div class="ws-import-inner"><p class="ws-eyebrow">创作工作台</p><h1>从一张图片开始</h1><p>图片只在本地浏览器处理。拖入图片，或点击选择。</p><div class="ws-drop-slot"></div><span>PNG · JPG · WEBP</span></div>`;
  const oldUpload = document.querySelector("#upload-zone"); importView.querySelector(".ws-drop-slot").append(oldUpload);
  const canvas = document.createElement("section"); canvas.className = "ws-canvas-area"; canvas.id = "ws-canvas-area";
  canvas.innerHTML = `<div class="ws-canvas-well" id="ws-canvas-well" role="img" aria-label="当前拼豆作品画布"><div class="ws-canvas-layers" id="ws-canvas-layers"></div><canvas id="ws-source-canvas" class="ws-source-canvas" aria-label="原图裁剪画布" hidden></canvas></div><div class="ws-canvas-stats" id="ws-canvas-stats"><span>已使用颜色</span> <strong id="ws-stats-colors">0</strong> <span>种</span> <i aria-hidden="true">/</i> <strong id="ws-stats-beads">0</strong> <span>颗</span></div><p class="ws-canvas-hint" id="ws-canvas-hint"></p>`;
  center.append(importView, canvas);
  const viewBar = document.createElement("nav"); viewBar.className = "ws-viewbar"; viewBar.setAttribute("aria-label", "画布视图与缩放");
  viewBar.innerHTML = `<div id="zoomControls"></div>
    <div class="ws-view-modes">${[["original","原图"],["blocks","色块"],["beads","拼豆"],["pattern","图纸"]].map(([id,name])=>`<button type="button" data-ws-view="${id}">${name}</button>`).join("")}<button type="button" id="ws-compare" title="按住临时看原图">对照</button></div>
    <div class="ws-view-toggles"><label><input type="checkbox" id="ws-grid">网格</label><label><input type="checkbox" id="ws-codes">色号</label></div>`;
  wrap.append(viewBar);

  right.className = "ws-inspector";
  right.innerHTML = `<div class="ws-inspector-head"><strong id="ws-inspector-title">作品</strong><small id="ws-inspector-subtitle">当前设计</small></div>
    <div class="ws-inspector-scroll">
      <section class="ws-panel" data-ws-inspector="project"><div id="generationPanel"></div><div class="ws-section-title">拼豆规格</div><label class="ws-field">单豆直径<select id="ws-bead-size"><option value="2.6">小豆 · 2.6 mm</option><option value="5">大豆 · 5.0 mm</option></select></label><div class="ws-readout" id="ws-physical-size">—</div><div class="ws-section-title">已有作品</div><div class="ws-project-gallery-slot"></div></section>
      <section class="ws-panel" data-ws-inspector="source"><div class="ws-section-title">非破坏式原图修整</div><p class="ws-note">在中央原图拖动裁剪。原文件不变，应用后重新生成图纸。</p><label class="ws-field">裁剪比例<select id="ws-source-ratio"><option value="free">自由</option><option>1:1</option><option>4:3</option><option>3:4</option><option>16:9</option><option>9:16</option></select></label><div class="ws-source-buttons"><button type="button" data-ws-source-rotate="-90">左转 90°</button><button type="button" data-ws-source-rotate="90">右转 90°</button><button type="button" data-ws-source-flip="flipX">水平翻转</button><button type="button" data-ws-source-flip="flipY">垂直翻转</button><button type="button" id="ws-source-pick-mode">原图取色</button></div><div id="ws-source-sample" class="ws-source-sample"></div><div class="ws-section-title">画面调整</div>${[["brightness","亮度",-100,100],["contrast","对比度",-100,100],["saturation","饱和度",-100,100],["sharpen","锐化",0,100]].map(([key,label,min,max])=>`<label class="ws-source-slider">${label}<span id="ws-source-${key}-value">0</span><input type="range" data-ws-source-adjust="${key}" min="${min}" max="${max}" value="0"></label>`).join("")}<div class="ws-section-title">扩容画布 · 原图像素</div><div class="ws-expand-grid">${["top","bottom","left","right"].map((side)=>`<label>${{top:"上",bottom:"下",left:"左",right:"右"}[side]}<input type="number" data-ws-source-expand="${side}" min="0" max="500" value="0"></label>`).join("")}</div><label class="ws-field">背景色<input id="ws-source-background" type="color" value="#ffffff"></label><div class="ws-section-title">处理后预览</div><canvas id="ws-source-preview" class="ws-source-preview" aria-label="处理后图片预览"></canvas><div id="ws-source-size" class="ws-note"></div><div class="ws-source-buttons"><button type="button" id="ws-source-reset">恢复原图</button><button type="button" class="ws-button-primary" id="ws-source-apply">应用并生成</button></div></section>
      <section class="ws-panel" data-ws-inspector="color"><div class="ws-section-title">实体色卡</div><label class="ws-field">品牌<select id="ws-brand"></select></label><label class="ws-field">色数<select id="ws-palette-size"></select></label><div class="ws-readout" id="ws-used-colors">尚未生成</div><div class="ws-section-title">实际用豆颜色</div><div class="ws-color-list" id="ws-color-list"></div><div class="ws-section-title">全局换色</div><label class="ws-field">来源色号<input id="ws-replace-from" type="text" placeholder="H07"></label><label class="ws-field">替换为<input id="ws-replace-to" type="text" placeholder="A03"></label><p class="ws-note" id="ws-replace-impact">选择来源色后显示影响颗数。</p><button type="button" class="ws-button ws-wide" id="ws-replace-confirm">确认替换</button></section>
      <section class="ws-panel" data-ws-inspector="edit"><div class="ws-section-title">当前工具</div><div id="ws-tool-details" class="ws-cell-details">选择工具 · 点击查看单豆</div><div class="ws-section-title">选中拼豆 / 区域</div><div id="ws-cell-details" class="ws-cell-details">用选择工具点击画布中的一颗豆。</div><div class="ws-section-title">颜色选择</div><input id="ws-color-search" type="search" placeholder="搜索色号 · H7 / H07" aria-label="搜索色号"><div id="ws-palette-categories" class="ws-palette-categories"></div><div id="ws-recent-colors" class="ws-recent-colors"></div><div id="ws-bead-picker" class="ws-bead-picker"></div><div class="ws-section-title">工具选项</div><label class="ws-source-slider">笔宽<span id="ws-brush-size-value">1</span><input type="range" id="ws-brush-size" min="1" max="9" step="2" value="1" aria-label="画笔大小（格）"></label><label class="ws-switch-row"><input type="checkbox" id="ws-shape-filled"> 形状实心（矩形 / 圆形）</label><label class="ws-source-slider">魔棒容差<span id="ws-wand-tolerance-value">12</span><input type="range" id="ws-wand-tolerance" min="0" max="100" value="12"></label><div class="ws-selection-actions"><button type="button" id="ws-erase-selection">擦除选区</button><button type="button" id="ws-clear-selection">清除选择</button></div><div class="ws-selection-actions"><button type="button" id="ws-copy-selection">复制</button><button type="button" id="ws-cut-selection">剪切</button><button type="button" id="ws-paste-selection">粘贴</button></div><div class="ws-selection-actions"><button type="button" id="ws-invert-selection">反选</button><button type="button" id="ws-select-all">全选</button></div><div class="ws-outline-options"><label><input id="ws-outline-diagonal" type="checkbox">描边包含对角</label><button type="button" id="ws-apply-outline">外描边</button></div><div class="ws-editor-actions"><button type="button" id="ws-undo" disabled>撤销</button><button type="button" id="ws-redo" disabled>重做</button></div><div id="ws-history-label" class="ws-note"></div><div class="ws-section-title">参考底图描图</div><p class="ws-note">底图垫在豆格下方，空白处透出，照着描就行。底图只作参考，不会写进图纸。</p><div class="ws-source-buttons"><button type="button" id="ws-ref-pick">选择底图</button><button type="button" id="ws-ref-clear">移除底图</button></div><input type="file" id="ws-ref-file" accept="image/*" hidden><label class="ws-field">贴合方式<select id="ws-ref-fit"><option value="contain">适应 · 保持比例居中</option><option value="stretch">拉伸 · 铺满整块画布</option></select></label><label class="ws-source-slider">透明度<span id="ws-ref-opacity-value">40%</span><input type="range" id="ws-ref-opacity" min="0" max="100" value="40"></label><label class="ws-switch-row"><input type="checkbox" id="ws-ref-visible" checked> 显示底图</label><div class="ws-section-title">旧画板高级工具</div><button type="button" class="ws-button ws-wide" id="ws-open-editor" disabled>打开原画板</button></section>
      <section class="ws-panel" data-ws-inspector="check"><div class="ws-section-title">真实检查结果</div><div id="ws-check-results" class="ws-check-results">生成后显示可验证的尺寸、色数与结构报告。</div></section>
      <section class="ws-panel" data-ws-inspector="inventory"><div id="inventoryPanel"></div></section>
    </div>`;
  const gallery = document.querySelector(".gallery-section"); if (gallery) right.querySelector(".ws-project-gallery-slot").append(gallery);
  right.querySelector(".ws-inspector-scroll").append(legacy);

  const toolRail = document.createElement("div"); toolRail.className = "ws-grid-toolbar-host"; toolRail.id = "gridEditorToolbar"; toolRail.setAttribute("aria-label", "画布编辑工具");
  center.append(toolRail);

  const drawer = document.createElement("aside"); drawer.className = "ws-export-drawer"; drawer.id = "ws-export-drawer";
  drawer.setAttribute("aria-label", "导出作品");
  drawer.innerHTML = `<div class="ws-drawer-head"><strong>导出作品</strong><button type="button" id="ws-export-close" aria-label="关闭导出">×</button></div><p class="ws-note">导出设置与屏幕色号开关相互独立。</p><button type="button" class="ws-export-choice" data-ws-export="preview-png"><strong>成品预览 · PNG</strong><small>默认无色号、无网格</small></button><div class="ws-export-options"><strong>图纸内容</strong><label><input type="checkbox" id="ws-export-grid" checked>网格</label><label><input type="checkbox" id="ws-export-codes" checked>色号</label><label><input type="checkbox" id="ws-export-coords" checked>坐标</label></div><button type="button" class="ws-export-choice" data-ws-export="pattern-png"><strong>拼豆图纸 · PNG</strong><small>使用上方独立的图纸设置</small></button><button type="button" class="ws-export-choice" data-ws-export="pattern-jpg"><strong>拼豆图纸 · JPG</strong><small>含表头与色块 / 色号 / 颗数图例，便于分享打印</small></button><button type="button" class="ws-export-choice" data-ws-export="usage-csv"><strong>用豆清单 · CSV</strong><small>色号、名称、HEX、RGB 与颗数，可用 Excel 打开</small></button><button type="button" class="ws-export-choice" data-ws-export="project-json"><strong>工程存档 · JSON</strong><small>保存画布尺寸、色卡与整幅矩阵，可再次载入继续编辑</small></button><button type="button" class="ws-export-choice" data-ws-export="boards-zip" id="ws-boards-choice"><strong>分板图 · ZIP</strong><small>按现有板规格导出各板 PNG</small></button><div class="ws-export-options"><strong>继续编辑</strong><button type="button" id="ws-project-import">载入工程存档 / Pixler…</button><input type="file" id="ws-project-file" accept="application/json,.json,.pixler" hidden></div><p class="ws-note" id="ws-export-message"></p>`;
  wrap.append(drawer);
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
  const get = () => store.getState();
  function updateHistory() {
    store.setState({ editor: { history: { canUndo: editorService.canUndo(), canRedo: editorService.canRedo() } } });
  }
  const syncLegacy = (result = bridge.getResult()) => {
    if (!result) return;
    store.setState({
      project: { name: result.sourceName?.replace(/\.[^.]+$/, "") || get().project.name },
      source: { image: result.sourceUrl || null, width: result.sourceWidth || 0, height: result.sourceHeight || 0 },
      canvas: { width: result.width || Number(document.querySelector("#granularity-input")?.value || 50), height: result.height || get().canvas.height || 50 },
      palette: { id: result.paletteKey, maxColors: result.maxColors, usedColors: result.usedColors },
      stats: { totalBeads: result.totalBeads, usedColors: result.usedColors, colors: result.colors },
      status: { hasSource: Boolean(result.sourceUrl), hasPattern: Boolean(result.grid?.length), generating: false, dirty: Boolean(result.manualEdited), generationError: null },
    });
  };
  window.addEventListener("libms:source-loaded", (event) => {
    editorService.clearHistory();
    store.setState({
      source: { image: event.detail.url, width: event.detail.width, height: event.detail.height },
      project: { name: event.detail.name.replace(/\.[^.]+$/, "") },
      stats: { totalBeads: 0, usedColors: 0, colors: [] },
      status: { hasSource: true, hasPattern: false, dirty: false, generationError: null },
      editor: { selectedCell: null, selection: null, hoveredCell: null },
    });
  });
  window.addEventListener("libms:source-transform-changed", () => { store.setState({ status: { dirty: true } }); });
  window.addEventListener("libms:project-result", (event) => { const first = !get().status.hasPattern;
    if (!event.detail.manualEdited) { editorService.clearHistory(); store.setState({ editor: { tool: "select", hoveredCell: null, selectedCell: null, selectedColor: null, highlightedColor: null, selection: null } }); }
    syncLegacy(event.detail); updateHistory();
    if (first && event.detail.grid?.length) viewport.fitToViewport(); });
  window.addEventListener("libms:generation-error", (event) => store.setState({ status: { generating: false, generationError: event.detail } }));
  window.addEventListener("libms:grid-edited", (event) => { syncLegacy(event.detail); updateHistory(); });
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

  left.querySelectorAll("[data-ws-panel]").forEach((button) => button.addEventListener("click", () => store.setState({ ui: { activePanel: button.dataset.wsPanel } })));
  center.addEventListener("click", (event) => { const button = event.target.closest("[data-ws-view]"); if (button) store.setState({ view: { mode: button.dataset.wsView } }); });
  $("#ws-project-name").addEventListener("input", (event) => store.setState({ project: { name: event.target.value }, status: { dirty: true } }));
  const sourceRatio = () => { const result = bridge.getResult(); return result.sourceWidth && result.sourceHeight ? result.sourceHeight / result.sourceWidth : 1; };
  let generationPanel;
  generationPanel = new GenerationPanel({
    root: "#generationPanel",
    initialState: { width: get().canvas.width || 104, height: get().canvas.height || 104, maxColors: get().palette.maxColors || 0 },
    onChange: (settings) => {
      const rawW = clamp(Math.round(Number(settings.width)) || 104, 10, 500);
      const rawH = clamp(Math.round(Number(settings.height)) || 104, 10, 500);
      const lock = Boolean(settings.lockAspectRatio);
      const prev = get().canvas;
      let w = rawW, h = rawH;
      if (lock) {
        if (rawW !== prev.width) { w = rawW; h = clamp(Math.round(rawW * sourceRatio()), 10, 500); }
        else if (rawH !== prev.height) { h = rawH; w = clamp(Math.round(rawH / sourceRatio()), 10, 500); }
      }
      if (w !== prev.width) bridge.setWidth(w);
      if (h !== prev.height) bridge.setHeight(h);
      bridge.setLockAspectRatio(lock);
      if (Number(settings.maxColors) !== get().palette.maxColors) palettes.setMaxColors(Number(settings.maxColors) || 0);
      store.setState({
        canvas: { width: w, height: h, lockAspectRatio: lock },
        generation: { engine: get().generation.engine, algorithm: get().generation.algorithm || "current", preset: settings.preset, sampling: ({ edge: "edge-aware", mean: "linear-mean" })[settings.sampling] || settings.sampling, detailProtection: settings.detailProtection, edgeProtection: settings.edgeProtection, cleanupStrength: settings.cleanupStrength, preserveHighlights: settings.preserveHighlights, preserveEyes: settings.preserveEyes, preserveMicroDetails: settings.preserveMicroDetails, backgroundRemoval: settings.backgroundRemoval, subjectCrop: Boolean(settings.subjectCrop), autoBackground: Boolean(settings.autoBackground), strokeProtection: Boolean(settings.strokeProtection), accentProtection: Boolean(settings.accentProtection), brightness: settings.brightness, contrast: settings.contrast, saturation: settings.saturation },
        status: { dirty: true },
      });
      if (w !== rawW || h !== rawH) generationPanel.setState({ width: w, height: h }, false);
    },
    onGenerate: async () => {
      if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
      try { await generation.generate({ overwriteApproved: true }); } catch (error) { $("#ws-status").textContent = error.message; }
    },
  });
  $("#ws-engine").addEventListener("change", (event) => {
    const engine = event.target.value;
    bridge.setGenerationEngine(engine);
    store.setState({ generation: { engine }, status: { dirty: true } });
  });
  // 算法引擎：与「引擎」正交。默认 current，选 bgs 才会走新算法模块。
  $("#ws-algorithm").addEventListener("change", (event) => {
    const algorithm = bridge.setAlgorithmEngine(event.target.value);
    store.setState({ generation: { algorithm }, status: { dirty: true } });
  });
  $("#ws-legacy-retry").addEventListener("click", async () => {
    $("#ws-engine").value = "legacy";
    bridge.setGenerationEngine("legacy");
    store.setState({ generation: { engine: "legacy" }, status: { generationError: null } });
    try { await generation.generate({ engine: "legacy", overwriteApproved: true }); }
    catch (error) { store.setState({ status: { generationError: error.message } }); }
  });
  $("#ws-bead-size").addEventListener("change", (event) => store.setState({ canvas: { beadSize: Number(event.target.value) } }));
  $("#ws-brand").addEventListener("change", (event) => { palettes.setActivePalette(event.target.value); refreshPaletteOptions(); });
  $("#ws-palette-size").addEventListener("change", (event) => { palettes.setActivePalette($("#ws-brand").value, Number(event.target.value)); refreshPaletteOptions(); });
  $("#ws-generate").addEventListener("click", async () => { if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
    try { await generation.generate({ overwriteApproved: true }); } catch (error) { $("#ws-status").textContent = error.message; } });
  $("#ws-import-again").addEventListener("click", async () => {
    if (bridge.getResult().manualEdited && !await askConfirmation("换图会移除当前手动修改。继续吗？")) return;
    bridge.importImage({ overwriteApproved: true });
  });
  $("#ws-source-open").addEventListener("click", () => store.setState({ ui: { activePanel: "source" } }));
  $("#ws-open-editor").addEventListener("click", () => bridge.openEditor());
  $("#ws-making").addEventListener("click", () => bridge.openMaking());
  $("#ws-export").addEventListener("click", () => store.setState({ ui: { exportDrawerOpen: true } }));
  $("#ws-export-close").addEventListener("click", () => store.setState({ ui: { exportDrawerOpen: false } }));
  drawer.addEventListener("click", async (event) => { const button = event.target.closest("[data-ws-export]"); if (!button) return; try { $("#ws-export-message").textContent = "正在准备导出…"; await exports.export(button.dataset.wsExport); $("#ws-export-message").textContent = "已启动下载"; } catch (error) { $("#ws-export-message").textContent = error.message; } });
  [["#ws-export-grid","showGrid"],["#ws-export-codes","showCodes"],["#ws-export-coords","showCoordinates"]].forEach(([selector, field]) => $(selector).addEventListener("change", (event) => store.setState({ exportSettings: { pattern: { ...get().exportSettings.pattern, [field]: event.target.checked } } })));
  $("#ws-grid").addEventListener("change", (event) => store.setState({ view: { showGrid: event.target.checked } }));
  $("#ws-codes").addEventListener("change", (event) => store.setState({ view: { showCodes: event.target.checked } }));
  viewBar.addEventListener("click", (event) => { const button = event.target.closest("[data-ws-view]"); if (button) store.setState({ view: { mode: button.dataset.wsView } }); });
  const well = $("#ws-canvas-well"), layers = $("#ws-canvas-layers");
  const viewport = createViewportService(store, () => ({ viewportWidth: well.clientWidth, viewportHeight: well.clientHeight,
    gridWidth: bridge.getResult().width || 0, gridHeight: bridge.getResult().height || 0 }));
  const renderer = createCanvasRenderer(layers, viewport, () => bridge.getResult(), () => get().view, () => get().editor, () => get().reference);
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
  let drag = null, spaceDown = false;
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
    const color = get().editor.selectedColor ? editorService.resolveColor(get().editor.selectedColor) : null;
    store.setState({ editor: { shapePreview: { cells, hex: color?.hex || null } } });
  };
  well.addEventListener("pointerdown", (event) => {
    if (get().ui.activePanel === "source") { const norm=sourceNorm(event); if (!norm || !sourceImage || !sourceLayout || event.button !== 0) return;
      if (get().editor.tool === "source-eyedropper") { sampleOriginalSource(norm); return; }
      well.setPointerCapture(event.pointerId); sourceDrag={ start:norm, previous:bridge.getSourceTransform().crop, moved:false }; return; }
    if (!get().status.hasPattern) return;
    const tool = get().editor.tool, p = point(event), cell = viewport.screenToGrid(p.x, p.y);
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
      if (!get().editor.selectedColor) { store.setState({ ui: { activePanel: "edit" } }); return; }
      well.setPointerCapture(event.pointerId);
      drag = { type: "shape", kind: SHAPE_TOOLS[tool], start: cell, end: cell };
      updateShapePreview(cell, event.shiftKey);
      return;
    }
    if (["same","connected"].includes(tool) && cell) { const original = get().editor.selection, selection = tool === "same" ? sameColorSelection(bridge.getResult().grid, cell.x, cell.y, original) : connectedSelection(bridge.getResult().grid, cell.x, cell.y, original); store.setState({ editor: { selection, selectedCell: cell }, ui: { activePanel: "edit" } }); return; }
    if (tool === "fill" && cell) { const selected = get().editor.selectedColor; if (selected) editorService.fillAt(cell.x, cell.y, selected); store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "edit" } }); return; }
    if (["brush","eraser"].includes(tool) && cell) {
      const selected = get().editor.selectedColor;
      if (tool === "brush" && !selected) { store.setState({ ui: { activePanel: "edit" } }); return; }
      well.setPointerCapture(event.pointerId); drag = { type: "stroke" };
      editorService.beginStroke(tool === "brush" ? selected : null, { size: get().editor.brushSize, shape: "round" });
      editorService.strokeCell(cell.x, cell.y); renderer.requestDraw();
      return;
    }
    if (tool === "eyedropper" && cell) {
      const color = editorService.getCell(cell.x, cell.y); if (color) activateColor(color.code,false);
      store.setState({ editor: { selectedCell: cell, tool: "brush" }, ui: { activePanel: "edit" } }); return;
    }
    if (tool === "bead" && cell) {
      const selected = get().editor.selectedColor;
      if (selected) editorService.setCellColor(cell.x, cell.y, selected);
      store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "edit" } }); return;
    }
    store.setState({ editor: { selectedCell: cell, selection: null }, ui: { activePanel: cell ? "edit" : get().ui.activePanel } });
  });
  well.addEventListener("pointermove", (event) => {
    if (sourceDrag) { const norm=sourceNorm(event); if (!norm || !sourceImage) return;
      if (Math.abs(norm.x-sourceDrag.start.x)*sourceLayout.width+Math.abs(norm.y-sourceDrag.start.y)*sourceLayout.height < 5) return;
      sourceDrag.moved=true; setSourcePatch({crop:cropFromDrag(sourceDrag.start.x,sourceDrag.start.y,norm.x,norm.y,sourceImage.naturalWidth,sourceImage.naturalHeight,$("#ws-source-ratio").value)}); return; }
    if (!get().status.hasPattern) return;
    const p = point(event), cell = viewport.screenToGrid(p.x, p.y);
    if (drag?.type === "pan") { viewport.setPan(drag.panX + event.clientX - drag.x, drag.panY + event.clientY - drag.y); return; }
    if (drag?.type === "region" && cell) { store.setState({ editor: { selection: rectangularSelection(drag.start.x, drag.start.y, cell.x, cell.y, bridge.getResult().width, bridge.getResult().height) } }); return; }
    if (drag?.type === "stroke") { if (cell) { editorService.strokeCell(cell.x, cell.y); renderer.requestDraw(); } return; }
    if (drag?.type === "shape") {
      // 形状用夹取后的坐标：拖出画布边界时端点停在边界格上，继续跟随鼠标。
      updateShapePreview(viewport.screenToGridClamped(p.x, p.y), event.shiftKey);
      return;
    }
    const old = get().editor.hoveredCell;
    if (old?.x !== cell?.x || old?.y !== cell?.y) store.setState({ editor: { hoveredCell: cell } });
  });
  const endDrag = (cancel = false) => { if (sourceDrag) { if (cancel && sourceDrag.moved) setSourcePatch({crop:sourceDrag.previous}); sourceDrag=null; requestSourceDraw(); }
    if (drag?.type === "stroke") cancel ? editorService.cancelStroke() : editorService.endStroke();
    if (drag?.type === "shape") {
      const selected = get().editor.selectedColor;
      // 预览只活在 overlay 层，所以这里才产生唯一的一步历史；取消则直接丢弃预览。
      if (!cancel && selected) editorService.applyShape(drag.kind, drag.start, drag.end || drag.start, selected, shapeOptions());
      store.setState({ editor: { shapePreview: null } });
    }
    drag = null; well.classList.remove("is-panning"); renderer.requestDraw(); };
  well.addEventListener("pointerup", () => endDrag()); well.addEventListener("pointercancel", () => endDrag(true));

  function renderPicker() {
    const query = $("#ws-color-search").value.trim().toUpperCase();
    const normalized = query.replace(/^([A-Z]+)(\d{1,2})$/, (_, series, number) => series + number.padStart(2,"0"));
    const palette = editorService.getPaletteColors(), categories = ["all", ...new Set(palette.map((color) => color.code.match(/^[A-Z]+/)?.[0]).filter(Boolean))];
    $("#ws-palette-categories").innerHTML = categories.map((category) => `<button type="button" data-ws-category="${esc(category)}" class="${get().editor.paletteCategory === category ? "active" : ""}">${category === "all" ? "全部" : esc(category)}</button>`).join("");
    $("#ws-recent-colors").innerHTML = get().editor.recentColors.length ? `最近 · ${get().editor.recentColors.map((code)=>`<button type="button" data-ws-pick="${esc(code)}">${esc(code)}</button>`).join("")}` : "";
    const colors = palette.filter((color) => (get().editor.paletteCategory === "all" || color.code.startsWith(get().editor.paletteCategory)) && (!query || color.code.toUpperCase().includes(query) || color.code.toUpperCase().includes(normalized) || String(color.name || "").toUpperCase().includes(query)));
    $("#ws-bead-picker").innerHTML = colors.map((color) => `<button type="button" data-ws-pick="${esc(color.code)}" title="${esc(color.name || color.code)} · 使用 ${editorService.getColorUsage(color.code)} 颗" class="${get().editor.selectedColor === color.code ? "active" : ""}"><span style="background:${esc(color.hex)}"></span><small>${esc(color.code)}</small></button>`).join("") || '<p class="ws-note">没有匹配的色号。</p>';
  }
  const paint = (state, patch = {}) => {
    // 拖拽过程中的高频更新（悬停格、形状预览）只重绘画布，不走整块面板重建，
    // 否则每移动一格就要重排一次调色板与库存表，手感会拖沓。
    if (patch.editor && Object.keys(patch).length === 1 && Object.keys(patch.editor).every((key) => key === "hoveredCell" || key === "shapePreview")) { renderer.requestDraw(); return; }
    if (patch.view && Object.keys(patch).length === 1 && Object.keys(patch.view).every((key) => ["zoom","panX","panY"].includes(key))) {
      zoomControls.setZoom(Math.round(state.view.zoom * 100), false);
      $("#ws-canvas-hint").textContent = state.view.showCodes && state.view.zoom * 20 < state.view.codeVisibilityThreshold ? "放大以查看色号" : "拖动画布平移 · 滚轮缩放";
      renderer.requestDraw(); return;
    }
    const hasSource = state.status.hasSource, hasPattern = state.status.hasPattern;
    importView.hidden = hasSource || hasPattern; canvas.hidden = !hasSource && !hasPattern;
    $("#ws-generate").disabled = !hasSource || state.status.generating;
    $("#ws-engine").value = state.generation.engine || "v2.5";
    $("#ws-algorithm").value = state.generation.algorithm || "current";
    $("#ws-source-open").hidden = !hasSource;
    left.querySelector('[data-ws-panel="source"]').disabled = !hasSource;
    $("#ws-import-again").hidden = !hasSource;
    $("#ws-making").disabled = !hasPattern; $("#ws-export").disabled = !hasPattern; $("#ws-open-editor").disabled = !hasPattern;
    $("#ws-status").textContent = state.status.generationError ? `生成失败：${state.status.generationError}` : state.status.generating ? "正在生成" : bridge.getResult().manualEdited ? "已手动编辑" : state.status.dirty ? "参数待更新" : hasPattern ? "已生成" : hasSource ? "图片已导入" : "未开始";
    $("#ws-legacy-retry").hidden = !state.status.generationError;
    if (document.activeElement !== top.querySelector("#ws-project-name")) top.querySelector("#ws-project-name").value = state.project.name;
    left.querySelectorAll("[data-ws-panel]").forEach((button) => button.classList.toggle("active", button.dataset.wsPanel === state.ui.activePanel));
    right.querySelectorAll("[data-ws-inspector]").forEach((panel) => { panel.hidden = panel.dataset.wsInspector !== state.ui.activePanel; });
    const titles = { project: "作品", source: "图片调整", color: "色彩", edit: "编辑", check: "检查", inventory: "库存" }; $("#ws-inspector-title").textContent = titles[state.ui.activePanel];
    const sourceActive=state.ui.activePanel === "source" && hasSource;
    sourceCanvas.hidden = !sourceActive; layers.style.visibility = sourceActive ? "hidden" : "visible";
    if (sourceActive) requestSourceDraw();
    $("#ws-bead-size").value = String(state.canvas.beadSize);
    $("#ws-physical-size").textContent = state.status.dirty && !bridge.getResult().manualEdited ? "参数已修改 · 重新生成后显示实际尺寸" : hasPattern ? `${state.canvas.width} × ${state.canvas.height} 豆 · 约 ${(state.canvas.width * state.canvas.beadSize / 10).toFixed(1)} × ${(state.canvas.height * state.canvas.beadSize / 10).toFixed(1)} cm` : "导入后显示实际尺寸";
    $("#ws-used-colors").textContent = hasPattern ? `实际使用 ${state.stats.usedColors} 色 · ${state.stats.totalBeads.toLocaleString("zh-CN", { useGrouping: false })} 颗${state.palette.maxColors > 0 && state.stats.usedColors > state.palette.maxColors ? ` · 手动编辑超过生成限制 ${state.palette.maxColors} 色` : ""}` : "尚未生成";
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
    if (patch.stats || patch.status || patch.editor?.highlightedColor) $("#ws-color-list").innerHTML = state.stats.colors.map((color) => `<button type="button" data-ws-color="${esc(color.code)}" class="ws-color-row ${state.editor.highlightedColor === color.code ? "active" : ""}"><span class="ws-swatch" style="background:${esc(color.hex)}"></span><span>${esc(color.code)}</span><small>${color.count.toLocaleString("zh-CN", { useGrouping: false })}</small></button>`).join("") || '<p class="ws-note">生成图纸后显示色号与数量。</p>';
    const checks = bridge.getChecks(); $("#ws-check-results").innerHTML = hasPattern ? `<p>尺寸：${state.canvas.width} × ${state.canvas.height}</p><p>颜色：${state.stats.usedColors} 色${checks.validation?.valid === false ? " · 超出当前上限" : " · 已校验"}</p>${checks.structural ? `<p>结构检测：${esc(JSON.stringify(checks.structural))}</p>` : ""}` : "生成后显示可验证的尺寸、色数与结构报告。";
    viewBar.querySelectorAll("[data-ws-view]").forEach((button) => { button.classList.toggle("active", button.dataset.wsView === state.view.mode); button.disabled = button.dataset.wsView === "original" && !hasSource; });
    $("#ws-grid").checked = state.view.showGrid; $("#ws-codes").checked = state.view.showCodes;
    zoomControls.setZoom(Math.round(state.view.zoom * 100), false);
    gridToolbar.setActiveTool(state.editor.tool);
    // 只在值真的变了才写 DOM：paint 会在每次状态变化时被调用，无条件赋值会白刷控件。
    if (gridToolbar.brushSize !== state.editor.brushSize) gridToolbar.setBrushSize(state.editor.brushSize);
    gridToolbar.setShapeFilled(state.editor.shapeFilled);
    $("#ws-brush-size").disabled = !hasPattern;
    $("#ws-brush-size").value = String(state.editor.brushSize);
    $("#ws-brush-size-value").textContent = String(state.editor.brushSize);
    $("#ws-shape-filled").disabled = !hasPattern;
    $("#ws-shape-filled").checked = state.editor.shapeFilled;
    $("#ws-wand-tolerance").disabled = !hasPattern;
    $("#ws-wand-tolerance-value").textContent = String(state.editor.wandTolerance);
    const hasSelection = Boolean(state.editor.selection);
    ["#ws-erase-selection", "#ws-clear-selection", "#ws-copy-selection", "#ws-cut-selection"].forEach((selector) => { $(selector).disabled = !hasSelection; });
    // 反选在「没有选区」时等价于全选，所以只要有图纸就可用。
    $("#ws-invert-selection").disabled = !hasPattern;
    $("#ws-paste-selection").disabled = !editorService.hasClipboard() || !hasPattern;
    $("#ws-select-all").disabled = !hasPattern;
    const selected = state.editor.selectedCell;
    const selectedColor = selected ? editorService.getCell(selected.x, selected.y) : null;
    $("#ws-cell-details").innerHTML = state.editor.selection ? `<strong>${esc({rectangle:"矩形", "same-color":"同色",connected:"连通", "magic-wand":"魔棒", inverse:"反选", selection:"区域"}[state.editor.selection.kind] || "区域")}选区 · ${selectionCells(state.editor.selection, state.canvas.width, state.canvas.height).length.toLocaleString("zh-CN", { useGrouping: false })} 豆</strong><p>X ${state.editor.selection.x0 + 1}–${state.editor.selection.x1 + 1} · Y ${state.editor.selection.y0 + 1}–${state.editor.selection.y1 + 1}</p><p>选区换色、擦除与描边仅影响对应豆格。方向键可整体搬移。</p>` : selected ? `<strong>${esc(selectedColor?.code || "空白")}</strong><p>位置 · X ${selected.x + 1} / Y ${selected.y + 1}</p><p>${selectedColor ? `${esc(selectedColor.hex || "")} · RGB ${esc(selectedColor.rgb?.join(",") || "")}` : "真正空豆"}</p><p>使用 · ${selectedColor ? editorService.getColorUsage(selectedColor.code).toLocaleString("zh-CN", { useGrouping: false }) : 0} 颗</p>` : "用选择工具点击画布中的一颗豆。";
    const toolInfo = {select:"选择 · 点击查看豆格",bead:"单豆 · 选中色号后点击豆格",brush:"画笔 · 拖动为一笔历史，笔宽见检查器",eraser:"橡皮 · 拖动擦成真正空豆，笔宽见检查器",fill:"填充 · 四方向连续色块",line:"直线 · 从起点拖到终点，Shift 吸附 45°",rect:"矩形 · 拖出外接框，Shift 约束正方形",ellipse:"圆形 · 拖出外接框，Shift 约束正圆",region:"框选 · 拖出矩形选区",wand:"魔棒 · 按色差容差圈选连续区域，Shift 叠加 / Alt 减掉",same:"同色选择 · 点击任意豆格",connected:"连通选择 · 点击连续色块",eyedropper:"取色 · 点击豆格设置当前色","source-eyedropper":"原图取色 · 点击中央原图",outline:"描边 · 先选择区域再应用",replace:"换色 · 在色彩面板设置色号",pan:"移动 · 拖动画布"};
    $("#ws-tool-details").textContent = `${toolInfo[state.editor.tool] || state.editor.tool}${state.editor.selectedColor ? ` · 当前 ${state.editor.selectedColor}` : ""}`;
    $("#ws-history-label").textContent = editorService.getHistory().at(-1)?.label || "";
    $("#ws-undo").disabled = !state.editor.history.canUndo; $("#ws-redo").disabled = !state.editor.history.canRedo;
    gridToolbar.setHistory(state.editor.history.canUndo, state.editor.history.canRedo);
    ["mirror", "mirror-vertical", "rotate-cw", "rotate-ccw"].forEach((action) => {
      const button = toolRail.querySelector(`[data-panel="${action}"]`);
      if (button) button.disabled = !hasPattern;
    });
    syncReferenceUi(state);
    if (patch.editor?.selectedColor || patch.editor?.paletteCategory || patch.stats || patch.ui?.activePanel === "edit") renderPicker();
    drawer.classList.toggle("open", state.ui.exportDrawerOpen); const tileSize = bridge.getTileSize() || 52; $("#ws-boards-choice").hidden = !hasPattern || (state.canvas.width <= tileSize && state.canvas.height <= tileSize);
    drawer.querySelectorAll("[data-ws-export]").forEach((button) => { button.disabled = !exports.isAvailable(button.dataset.wsExport); });
    if (patch.view || patch.editor || patch.stats || patch.status || patch.source || patch.reference) renderer.requestDraw();
    // 库存面板只在图纸/项目状态变化时重建；库存自身的变更由它自己订阅，避免每次鼠标移动都重排表格
    if (patch.status || patch.stats) inventoryPanel?.render();
    $("#ws-canvas-hint").textContent = state.view.showCodes && state.view.zoom * 20 < state.view.codeVisibilityThreshold ? "放大以查看色号" : "拖动画布平移 · 滚轮缩放";
  };
  const affectedCount = (code) => {
    const selection = get().editor.selection;
    if (!selection) return editorService.getColorUsage(code);
    let count = 0; bridge.getResult().grid.forEach((row, y) => row.forEach((color, x) => {
      if (color?.code === code && selectionContains(selection, x, y)) count++;
    })); return count;
  };
  $("#ws-color-list").addEventListener("click", (event) => { const row = event.target.closest("[data-ws-color]"); if (!row) return;
    const code = row.dataset.wsColor; $("#ws-replace-from").value = code; $("#ws-replace-impact").textContent = `影响 ${affectedCount(code).toLocaleString("zh-CN", { useGrouping: false })} 颗`;
    store.setState({ editor: { highlightedColor: get().editor.highlightedColor === code ? null : code } }); });
  $("#ws-replace-from").addEventListener("input", (event) => { $("#ws-replace-impact").textContent = `影响 ${affectedCount(event.target.value.trim().toUpperCase()).toLocaleString("zh-CN", { useGrouping: false })} 颗`; });
  $("#ws-replace-confirm").addEventListener("click", () => {
    const from = $("#ws-replace-from").value.trim().toUpperCase(), to = $("#ws-replace-to").value.trim().toUpperCase();
    const count = affectedCount(from);
    if (!count || !editorService.resolveColor(to)) { $("#ws-replace-impact").textContent = "请填写作品中存在的来源色号和当前色卡中的目标色号。"; return; }
    askConfirmation(`将 ${count} 颗 ${from} 替换为 ${to}？`).then((accepted) => { if (accepted) editorService.replaceColor(from, to, get().editor.selection); });
  });
  $("#ws-color-search").addEventListener("input", renderPicker);
  $("#ws-palette-categories").addEventListener("click", (event) => { const button = event.target.closest("[data-ws-category]"); if (button) store.setState({ editor: { paletteCategory: button.dataset.wsCategory } }); });
  const activateColor = (code, applySelected = true) => {
    const color = editorService.resolveColor(code); if (!color) return;
    const selected = get().editor.selectedCell, tool = get().editor.tool;
    store.setState({ editor: { selectedColor: color.code, recentColors: [color.code, ...get().editor.recentColors.filter((item) => item !== color.code)].slice(0,10), tool: tool === "select" && selected ? "bead" : tool } });
    if (applySelected && selected && ["select","bead"].includes(tool)) editorService.setCellColor(selected.x, selected.y, color.code);
  };
  ["#ws-bead-picker","#ws-recent-colors"].forEach((selector) => $(selector).addEventListener("click", (event) => { const button = event.target.closest("[data-ws-pick]"); if (button) activateColor(button.dataset.wsPick); }));
  $("#ws-erase-selection").addEventListener("click", () => editorService.eraseSelection(get().editor.selection));
  $("#ws-clear-selection").addEventListener("click", () => store.setState({ editor: { selection: null, shapePreview: null } }));
  $("#ws-apply-outline").addEventListener("click", () => editorService.outline(get().editor.selection, get().editor.selectedColor, $("#ws-outline-diagonal").checked));
  $("#ws-undo").addEventListener("click", () => editorService.undo()); $("#ws-redo").addEventListener("click", () => editorService.redo());

  const rotateGridAction = async (turns) => {
    if (!get().status.hasPattern) return;
    if (!editorService.canRotate()) { $("#ws-history-label").textContent = "当前页面不支持整幅旋转。"; return; }
    const { width, height } = bridge.getResult();
    // 90°/270° 会交换宽高，按旧宽高记录的豆格级历史坐标不再可信，需要用户知情。
    if (turns % 2 === 1 && width !== height) {
      const accepted = await askConfirmation(`旋转后画布由 ${width} × ${height} 变为 ${height} × ${width}，按旧宽高记录的编辑历史会被清除（旋转本身仍可撤销）。继续吗？`);
      if (!accepted) return;
    }
    if (!editorService.rotate(turns)) $("#ws-history-label").textContent = "旋转未执行。";
  };

  const referenceInput = $("#ws-ref-file");
  const syncReferenceUi = (state = get()) => {
    const hasReference = Boolean(state.reference.url);
    $("#ws-ref-fit").value = state.reference.fit;
    $("#ws-ref-opacity").value = String(state.reference.opacity);
    $("#ws-ref-opacity-value").textContent = `${state.reference.opacity}%`;
    $("#ws-ref-visible").checked = state.reference.visible !== false;
    ["#ws-ref-clear", "#ws-ref-fit", "#ws-ref-opacity", "#ws-ref-visible"].forEach((selector) => { $(selector).disabled = !hasReference; });
  };
  $("#ws-ref-pick").addEventListener("click", () => referenceInput.click());
  referenceInput.addEventListener("change", () => {
    const file = referenceInput.files?.[0];
    referenceInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => store.setState({ reference: { url: String(reader.result || ""), visible: true, fit: get().reference.fit } });
    reader.readAsDataURL(file);
  });
  $("#ws-ref-clear").addEventListener("click", () => store.setState({ reference: { url: "", visible: true } }));
  $("#ws-ref-fit").addEventListener("change", (event) => store.setState({ reference: { fit: event.target.value } }));
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
      bridge.loadProjectJson(payload);
      editorService.clearHistory();
      store.setState({
        editor: { tool: "select", selectedCell: null, selection: null, hoveredCell: null, highlightedColor: null },
        ui: { exportDrawerOpen: false },
      });
      viewport.fitToViewport();
      if (pixlerNote) $("#ws-export-message").textContent = pixlerNote;
    } catch (error) {
      $("#ws-export-message").textContent = error.message;
    }
  });
  let compareMode = null;
  const endCompare = () => { if (compareMode) { store.setState({ view: { mode: compareMode } }); compareMode = null; } };
  const toggleCompare = () => { if (!get().status.hasSource) return; if (compareMode) endCompare(); else { compareMode = get().view.mode; store.setState({ view: { mode: "original" } }); } };
  $("#ws-compare").addEventListener("pointerdown", (event) => { if (!get().status.hasSource) return;
    compareMode = get().view.mode; event.currentTarget.setPointerCapture(event.pointerId); store.setState({ view: { mode: "original" } }); });
  $("#ws-compare").addEventListener("pointerup", endCompare); $("#ws-compare").addEventListener("pointercancel", endCompare);
  const gridToolbar = new GridEditorToolbar({
    root: toolRail,
    activeTool: get().editor.tool,
    brushSize: get().editor.brushSize,
    shapeFilled: get().editor.shapeFilled,
    onToolChange: (tool) => store.setState({ editor: { tool }, ui: { activePanel: tool === "source-eyedropper" ? "source" : tool === "replace" ? "color" : "edit" } }),
    onBrushSizeChange: (size) => store.setState({ editor: { brushSize: size } }),
    onShapeFilledChange: (filled) => store.setState({ editor: { shapeFilled: filled } }),
    onPanelAction: (action) => {
      if (action === "undo") { editorService.undo(); return; }
      if (action === "redo") { editorService.redo(); return; }
      if (action === "help") { gridToolbar.openHelp(); return; }
      if (action === "mirror") { editorService.flip("horizontal"); return; }
      if (action === "mirror-vertical") { editorService.flip("vertical"); return; }
      if (action === "rotate-cw") { rotateGridAction(1); return; }
      if (action === "rotate-ccw") { rotateGridAction(3); return; }
      if (action === "replace") { store.setState({ editor: { tool: "replace" }, ui: { activePanel: "color" } }); return; }
      if (action === "outline") { editorService.outline(get().editor.selection, get().editor.selectedColor, $("#ws-outline-diagonal").checked); return; }
      if (action === "guides") { store.setState({ view: { showGrid: !get().view.showGrid } }); return; }
      if (action === "compare") { toggleCompare(); return; }
    },
  });
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
    if (event.key === "Escape") { store.setState({ editor: { selectedCell: null, selection: null, shapePreview: null } }); return; }
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

  store.subscribe(paint);
  syncLegacy(); paint(get(), { status: true, stats: true });
  renderPicker();
}
