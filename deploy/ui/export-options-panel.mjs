import { raw } from './workspace-icons.mjs';
import { mirroredPreviewGrid } from './export-mirror-preview.mjs';
import { renderPngPatternCanvas } from '../services/png-pattern-export-renderer.js?v=20261007-all-export-r16';
import { constructionSheetLayout, drawConstructionSheetHeader, drawConstructionSheetRulers } from '../services/construction-sheet-layout.js?v=20261007-all-export-r16';

export function renderCompactExportPreview(grid, settings) {
  const layout = constructionSheetLayout(grid, settings.cellSize, settings);
  if (settings.cellSize >= 4) return { canvas: renderPngPatternCanvas(grid, settings), layout };
  // One pixel buffer avoids issuing a million fillRect commands for a thumbnail.
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext('2d'), columns = grid[0]?.length || 0, rows = grid.length;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawConstructionSheetHeader(ctx, grid, layout, settings);
  const pixels = ctx.createImageData(columns, rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const rgb = grid[y][x]?.rgb || [255, 255, 255], at = (y * columns + x) * 4;
    pixels.data[at] = rgb[0]; pixels.data[at + 1] = rgb[1]; pixels.data[at + 2] = rgb[2]; pixels.data[at + 3] = 255;
  }
  if (settings.cellSize === 1) ctx.putImageData(pixels, layout.gridX, layout.gridY);
  else {
    const bitmap = document.createElement('canvas'); bitmap.width = columns; bitmap.height = rows;
    bitmap.getContext('2d').putImageData(pixels, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, layout.gridX, layout.gridY, columns * settings.cellSize, rows * settings.cellSize);
  }
  drawConstructionSheetRulers(ctx, grid, layout, settings.majorGridInterval, settings);
  return { canvas, layout };
}

// Presentation only: move the original inputs/actions so their existing handlers remain attached.
export function attachCompactExportPanel({ drawer, getGrid, getTitle, getPaletteLabel, getMajorInterval, getRevision, refreshPosterPreview }) {
  drawer.classList.add('ws-export-compact');
  drawer.querySelector('.ws-drawer-head strong').textContent = '导出选项';
  const find = id => drawer.querySelector('#' + id);
  const panels = [...drawer.querySelectorAll('[data-output-panel]')];
  const pattern = panels.find(panel => panel.dataset.outputPanel === 'pattern');
  const titleField = find('ws-export-title').closest('label');
  titleField.classList.add('ws-export-common-name');
  drawer.querySelector('.ws-output-tasks').before(titleField);
  const mirror = find('ws-export-mirror');
  mirror.querySelector('[value="vertical"]')?.remove();
  if (mirror.value !== 'horizontal') mirror.value = 'none';
  mirror.closest('label').hidden = true;
  titleField.after(mirror.closest('label'));
  drawer.querySelector('[data-ws-export="project-json"]')?.remove();

  for (const panel of panels) {
    const actions = document.createElement('div'); actions.className = 'ws-export-actions';
    for (const button of [...panel.children].filter(node => node.tagName === 'BUTTON')) {
      button.classList.add('ws-export-choice');
      button.title = button.textContent.trim();
      const icon = document.createElement('span'); icon.className = 'ws-export-action-icon';
      icon.innerHTML = raw(button.dataset.exportV2 === 'pdf' ? 'doc' : 'download');
      button.prepend(icon); actions.append(button);
    }
    panel.append(actions);
  }

  const preview = document.createElement('figure'); preview.className = 'ws-export-preview ws-export-common-preview';
  preview.innerHTML = '<div class="ws-export-preview-image"></div><figcaption>图纸预览</figcaption>';
  drawer.querySelector('.ws-output-tasks').after(preview);
  const poster = panels.find(panel => panel.dataset.outputPanel === 'poster');
  const posterCanvas = find('ws-poster-preview');
  preview.firstElementChild.append(posterCanvas);
  const styleSwitch = document.createElement('div'); styleSwitch.className = 'ws-export-style-switch';
  styleSwitch.innerHTML = '<button type="button" data-export-style="pattern">图纸</button><button type="button" data-export-style="poster">海报</button>';
  preview.after(styleSwitch);
  const posterNav = drawer.querySelector('[data-output-task="poster"]'); posterNav.hidden = true;
  styleSwitch.addEventListener('click', event => {
    const button = event.target.closest('[data-export-style]');
    if (button) drawer.querySelector(`[data-output-task="${button.dataset.exportStyle}"]`).click();
  });
  const options = pattern.querySelector('.ws-export-options');
  options.classList.add('ws-export-pattern-options');
  options.querySelector(':scope > strong')?.remove();
  const toggles = document.createElement('div'); toggles.className = 'ws-export-toggles';
  for (const [id, label, icon] of [['ws-export-grid', '网格', 'grid'], ['ws-export-codes', '色号', 'text'], ['ws-export-coords', '标尺', 'ruler']]) {
    const input = find(id), owner = input.closest('label');
    input.setAttribute('aria-label', label);
    for (const node of [...owner.childNodes]) if (node !== input) node.remove();
    const content = document.createElement('span'); content.innerHTML = raw(icon); content.append(document.createTextNode(label));
    owner.append(content); owner.classList.add('ws-export-toggle'); toggles.append(owner);
  }
  options.prepend(toggles);
  const mirrorToggle = document.createElement('button'); mirrorToggle.type = 'button'; mirrorToggle.className = 'ws-export-toggle';
  mirrorToggle.innerHTML = raw('mirror') + '镜像'; toggles.append(mirrorToggle);
  mirrorToggle.addEventListener('click', () => {
    mirror.value = mirror.value === 'horizontal' ? 'none' : 'horizontal';
    mirror.dispatchEvent(new Event('change', { bubbles: true }));
    find('ws-export-title').value = getTitle();
  });
  find('ws-export-quality').closest('label').classList.add('ws-export-resolution');
  const pixels = find('ws-export-pixels'); pixels.classList.add('ws-export-resolution-hint');

  const posterOptions = poster.querySelector('.ws-export-options');
  posterOptions.classList.add('ws-export-poster-settings');
  posterOptions.querySelector(':scope > strong')?.remove();
  find('ws-poster-brand').value = 'libms'; find('ws-poster-brand').closest('label').hidden = true;
  function quickOptions(id, label, entries) {
    const select = find(id), owner = select.closest('label'); owner.hidden = true;
    const row = document.createElement('div'); row.className = 'ws-export-quick-row';
    const heading = document.createElement('span'); heading.textContent = label; row.append(heading);
    const choices = document.createElement('div'); choices.className = 'ws-export-quick-options'; row.append(choices);
    for (const [value, name] of entries) {
      if (!select.querySelector(`option[value="${value}"]`)) select.add(new Option(name, value));
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
      button.title = select.querySelector(`option[value="${value}"]`)?.textContent || name;
      button.dataset.quickValue = value;
      button.addEventListener('click', () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
      choices.append(button);
    }
    owner.after(row);
    return () => { for (const button of choices.children) button.setAttribute('aria-pressed', String(button.dataset.quickValue === select.value)); };
  }
  // PNG 清晰度：直接点选，不再收起在下拉里（label 同行展示三档）
  const qualitySync = quickOptions('ws-export-quality', 'PNG清晰度', [['standard','标准'],['hd','高清'],['ultra','超高清']]);
  const syncChoices = [qualitySync,
    quickOptions('ws-poster-ratio', '比例', [['3x4','3:4'],['4x3','4:3'],['1x1','1:1'],['16x9','16:9'],['9x16','9:16']]),
    quickOptions('ws-poster-size', '作品大小', [['large','大'],['standard','中'],['small','小']]),
    quickOptions('ws-poster-backing-paper', '衬纸', [['none','无'],['narrow','窄边'],['standard','标准'],['stamp','齿边']])];
  const background = find('ws-poster-background'); background.closest('label').hidden = true;
  const backgroundRow = document.createElement('div'); backgroundRow.className = 'ws-export-quick-row ws-export-background';
  backgroundRow.innerHTML = '<span>背景</span><div class="ws-export-quick-options"></div>';
  const backgrounds = backgroundRow.lastElementChild;
  // 只保留自动 / 图纸 / 极光 + 末尾自定义取色（纯白/纯黑/透明已去掉）
  for (const [value, label] of [['auto','自动'],['artwork','图纸'],['aurora','极光']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.backgroundValue = value;
    button.addEventListener('click', () => { background.value = value; background.dispatchEvent(new Event('change', { bubbles: true })); });
    backgrounds.append(button);
  }
  const customSwatch = find('ws-poster-solid-color');
  const pickerLabel = customSwatch.closest('label');
  pickerLabel.classList.add('ws-export-background-picker');
  for (const node of [...pickerLabel.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
  customSwatch.addEventListener('click', () => { background.value = 'solid'; background.dispatchEvent(new Event('change', { bubbles: true })); });
  background.closest('label').after(backgroundRow);
  const solidControls = find('ws-poster-solid-controls'); solidControls.hidden = false;
  backgroundRow.append(solidControls); solidControls.classList.add('ws-export-background-custom');
  find('ws-poster-solid-color').setAttribute('aria-label', '自定义背景颜色');
  find('ws-poster-solid-color').addEventListener('input', () => { background.value = 'solid'; background.dispatchEvent(new Event('change', { bubbles: true })); });
  find('ws-poster-solid-hex').addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(find('ws-poster-solid-hex').value)) { background.value = 'solid'; background.dispatchEvent(new Event('change', { bubbles: true })); } });
  posterOptions.append(find('ws-poster-background-status'), find('ws-poster-remove-exterior'));
  // 署名 / 前缀 / 字体等低频项一次性折叠进「更多」，首屏只留 Logo 与去底色（与参考页一致）
  {
    const logoLabel = find('ws-poster-logo').closest('label'), bgOffLabel = find('ws-poster-transparent').closest('label');
    const extraLabels = [...posterOptions.querySelectorAll(':scope > label')]
      .filter(l => l !== logoLabel && l !== bgOffLabel && !l.hidden && !l.closest('.ws-export-quick-row'));
    if (extraLabels.length) {
      const more = document.createElement('details'); more.className = 'ws-export-more';
      const summary = document.createElement('summary'); summary.textContent = '署名与更多'; more.append(summary);
      const body = document.createElement('div'); body.className = 'ws-export-more-body'; more.append(body);
      for (const label of extraLabels) body.append(label);
      posterOptions.append(more);
    }
  }

  let timer = null;
  let gridRevision = null, grid = null, previewKey = null, previewCanvas = null, previewLayout = null;
  let posterContentKey = null;
  function refresh() {
    timer = null;
    const currentId = drawer.dataset.outputCurrent || 'pattern';
    const isPoster = currentId === 'poster';
    styleSwitch.hidden = !['pattern','poster'].includes(currentId);
    posterCanvas.hidden = !isPoster;
    if (previewCanvas) previewCanvas.hidden = isPoster;
    drawer.querySelector('[data-output-task="pattern"]').classList.toggle('active', ['pattern','poster'].includes(currentId));
    drawer.querySelector('[data-output-task="pattern"]').setAttribute('aria-pressed', String(['pattern','poster'].includes(currentId)));
    for (const button of styleSwitch.children) button.setAttribute('aria-pressed', String(button.dataset.exportStyle === currentId));
    mirrorToggle.setAttribute('aria-pressed', String(mirror.value === 'horizontal'));
    syncChoices.forEach(sync => sync());
    solidControls.hidden = false;
    for (const button of backgrounds.children) button.setAttribute('aria-pressed', String(button.dataset.backgroundValue === background.value));
    pickerLabel.classList.toggle('is-active', background.value === 'solid');
    if (!drawer.classList.contains('open')) { grid = null; gridRevision = null; previewKey = null; return; }
    if (isPoster) {
      const nextPosterKey = JSON.stringify([getRevision(), getTitle()]);
      if (nextPosterKey !== posterContentKey) { posterContentKey = nextPosterKey; refreshPosterPreview?.(); }
      preview.lastElementChild.textContent = '海报预览'; return;
    }
    const previewMirror = ['pattern','print'].includes(currentId) ? mirror.value : 'none';
    const revision = JSON.stringify([getRevision(), previewMirror]);
    if (!grid || revision !== gridRevision) {
      grid = mirroredPreviewGrid(getGrid(), previewMirror);
      gridRevision = revision;
    }
    if (!grid.length) { preview.lastElementChild.textContent = '请先创建或打开作品'; return; }
    const columns = grid[0]?.length || 0, rows = grid.length;
    const cellSize = Math.max(1, Math.min(12, Math.floor(480 / Math.max(columns, rows))));
    const settings = {
      cellSize, constructionSheet: true, title: getTitle(), paletteLabel: getPaletteLabel(),
      showGrid: find(currentId === 'print' ? 'ws-board-grid' : 'ws-export-grid').checked && cellSize >= 4,
      showCodes: find(currentId === 'print' ? 'ws-board-codes' : 'ws-export-codes').checked && cellSize >= 8,
      showCoordinates: find('ws-export-coords').checked,
      majorGridInterval: getMajorInterval(),
    };
    const nextKey = JSON.stringify([revision, settings.showGrid, settings.showCodes, settings.showCoordinates, settings.majorGridInterval]);
    if (nextKey !== previewKey) {
      const rendered = renderCompactExportPreview(grid, settings);
      previewCanvas = rendered.canvas; previewLayout = rendered.layout;
      previewCanvas.setAttribute('aria-label', '当前导出图纸缩略预览');
      preview.firstElementChild.replaceChildren(previewCanvas, posterCanvas);
      previewKey = nextKey;
    } else {
      // Naming a work changes only the header, not a million-cell artwork raster.
      const ctx = previewCanvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, previewCanvas.width, previewLayout.headerHeight);
      drawConstructionSheetHeader(ctx, grid, previewLayout, settings);
    }
    preview.lastElementChild.textContent = `${columns} × ${rows} 格 · 预览，导出按所选清晰度生成`;
  }
  function requestRefresh() { clearTimeout(timer); timer = setTimeout(refresh, 40); }
  drawer.addEventListener('input', requestRefresh);
  drawer.addEventListener('change', requestRefresh);
  const onFontLoaded = () => { grid = null; previewKey = null; posterContentKey = null; requestRefresh(); };
  window.addEventListener('libms:text-font-loaded', onFontLoaded);
  const observer = new MutationObserver(requestRefresh);
  observer.observe(drawer, { attributes: true, attributeFilter: ['class', 'data-output-current'] });
  refresh();
  return { refresh: requestRefresh, destroy() { clearTimeout(timer); observer.disconnect(); window.removeEventListener('libms:text-font-loaded', onFontLoaded); drawer.removeEventListener('input', requestRefresh); drawer.removeEventListener('change', requestRefresh); } };
}
