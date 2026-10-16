import { parseTemplateJson, createTemplateFromGrid, overlayTemplate } from '../services/template-service.mjs';
import { createTemplateLibrary } from '../services/template-library.mjs';
import { createTemplateCommand } from '../services/template-command.mjs';

// Dialog state is disposable preview data, never another editable document/grid.
export function attachTemplatePanel({ host, bridge, editorService, getState, notify }) {
  const library = createTemplateLibrary();
  const style = document.createElement('link');
  style.rel = 'stylesheet'; style.href = new URL('../styles/template-panel.css', import.meta.url).href;
  document.head.append(style);
  const dialog = document.createElement('dialog'); dialog.className = 'ws-template-dialog';
  host.append(dialog);
  let busy = false;
  const el = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });
  const button = (text, action) => { const b = el('button', text, { type: 'button', className: 'ws-button' }); b.onclick = () => safe(action); return b; };
  const error = (message) => { const p = dialog.querySelector('[data-template-message]'); if (p) p.textContent = message; else notify(message); };
  async function safe(action) {
    if (busy) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    try { await action(); } catch (e) { error(e?.message || '母版操作失败，当前作品未改变'); }
    finally { busy = false; dialog.removeAttribute('aria-busy'); }
  }
  function page(title) {
    dialog.replaceChildren();
    const header = el('header', ''); header.append(el('h2', title), button('关闭', () => dialog.close()));
    const message = el('p', '', { className: 'ws-note' }); message.dataset.templateMessage = ''; message.setAttribute('role', 'status');
    dialog.append(header, message);
    if (!dialog.open) dialog.showModal();
    return dialog;
  }
  const snapshot = () => {
    const result = bridge.getResult();
    if (!result.grid?.length) throw new Error('请先打开或创建图纸');
    if (bridge.isGenerating()) throw new Error('请等待生成完成，再操作母版');
    return { grid: structuredClone(result.grid), width: result.width, height: result.height,
      templateLockedMask: bridge.getTemplateLockMask(), paletteKey: result.paletteKey || getState().palette.id,
      name: getState().project.name || '未命名作品' };
  };
  const fingerprint = s => JSON.stringify([s.grid, s.width, s.height, s.templateLockedMask, s.paletteKey, s.name]);
  function draw(grid, label) {
    const box = el('figure', ''); box.append(el('figcaption', label));
    const canvas = el('canvas', ''); canvas.width = grid[0].length; canvas.height = grid.length;
    const ctx = canvas.getContext('2d');
    grid.forEach((row, y) => row.forEach((c, x) => { if (c) { ctx.fillStyle = `rgb(${c.rgb.join(',')})`; ctx.fillRect(x, y, 1, 1); } }));
    box.append(canvas); return box;
  }
  function field(text, control) { const label = el('label', text, { className: 'ws-template-field' }); label.append(control); return label; }
  function transact(before, after, label) {
    if (fingerprint(snapshot()) !== fingerprint(before)) throw new Error('作品已变化，请重新预览后再应用');
    if (!editorService.executeCommand(createTemplateCommand(bridge, before, after, label))) throw new Error('母版未应用，请等待当前操作完成后重试');
    return true;
  }
  async function preview(template) {
    const before = snapshot();
    // Strict identity check before displaying a confirm button; never nearest-match.
    parseTemplateJson(template, { paletteKey: before.paletteKey, palette: bridge.getPaletteColors() });
    page('母版叠加预览');
    const x = el('input', '', { type: 'number', value: '0', step: '1', ariaLabel: '母版横向偏移' });
    const y = el('input', '', { type: 'number', value: '0', step: '1', ariaLabel: '母版纵向偏移' });
    const lock = el('input', '', { type: 'checkbox' });
    const controls = el('div', '', { className: 'ws-template-actions' });
    controls.append(field('横向偏移', x), field('纵向偏移', y), button('原始坐标', () => { x.value = y.value = '0'; render(); }),
      button('居中', () => { x.value = String(Math.floor((before.width - template.width) / 2)); y.value = String(Math.floor((before.height - template.height) / 2)); render(); }), field('应用后锁定母版', lock));
    const previews = el('div', '', { className: 'ws-template-previews' });
    const summary = el('p', '', { className: 'ws-note' });
    let plan;
    const render = () => {
      plan = overlayTemplate({ grid: before.grid, paletteKey: before.paletteKey }, template,
        { offsetX: Number(x.value), offsetY: Number(y.value), lockedMask: before.templateLockedMask });
      previews.replaceChildren(draw(template.grid, `母版 ${template.width} × ${template.height}`), draw(plan.grid, `叠加效果 ${before.width} × ${before.height}`));
      summary.textContent = `色卡：${template.paletteKey}；将修改 ${plan.changes} 格。透明区域不覆盖；超出画布的部分不写入。`;
    };
    x.oninput = y.oninput = () => { try { render(); error(''); } catch (e) { plan = null; error(e.message); } };
    dialog.append(controls, previews, summary, button('确认应用', () => {
      render();
      const mask = before.grid.map((row, cy) => row.map((_, cx) => Boolean(before.templateLockedMask?.[cy]?.[cx] || (lock.checked && plan.mask[cy][cx]))));
      transact(before, { ...before, grid: plan.grid, templateLockedMask: mask }, lock.checked ? '应用并锁定母版' : '应用母版');
      dialog.close(); notify('母版已应用，可撤销；当前作品名称与尺寸保持不变');
    }), button('取消', () => dialog.close()));
    render();
  }
  async function saveCanvas({ updateId = null, blank = false } = {}) {
    const current = snapshot();
    const selection = structuredClone(getState().editor.selection);
    const target = updateId ? await library.get(updateId) : null;
    if (updateId && !target) throw new Error('待更新母版不存在');
    page(target ? `更新母版：${target.name}` : '另存为母版');
    const name = el('input', '', { value: target?.name || current.name, maxLength: 100, ariaLabel: '母版名称' });
    const scope = el('select', '', { ariaLabel: '母版保存范围' });
    for (const [value, text] of [['canvas', '保存整个画布'], ['selection', '仅保存选区'], ['opaque', '仅保存非透明像素（保留画布尺寸）'], ['locked', '仅保存锁定区域']]) {
      scope.append(el('option', text, { value, disabled: (value === 'selection' && !selection) || (value === 'locked' && !current.templateLockedMask?.some(row => row.some(Boolean))) }));
    }
    const previews = el('div', '', { className: 'ws-template-previews' });
    let captured;
    const capture = () => {
      captured = createTemplateFromGrid({ ...current, name: name.value.trim(), selection, lockedMask: current.templateLockedMask, scope: scope.value,
        ...(blank ? { grid: current.grid.map(row => row.map(() => null)) } : {}) });
      previews.replaceChildren(draw(captured.grid, `${captured.width} × ${captured.height} · ${captured.paletteKey}`));
    };
    scope.onchange = capture;
    dialog.append(field('母版名称', name), field('保存范围', scope), previews,
      el('p', '保存当前豆格底图，不包含独立文字和二维码对象。非透明模式会保存所有有色格，不会自动识别边框。母版仅保存在此浏览器，请定期导出 JSON 备份。', { className: 'ws-note' }),
      button(target ? '确认更新此母版' : '确认保存', async () => {
        if (!name.value.trim()) throw new Error('请输入母版名称');
        capture();
        let update = updateId;
        const names = (await library.list()).filter(item => item.name === name.value.trim());
        if (!update && names.length) {
          const choice = el('div', '', { className: 'ws-template-actions' });
          choice.append(el('p', '同名母版已存在，请明确选择：'), button('另存为新母版', async () => { await persist(null); }),
            ...names.map(item => button(`更新现有母版：${item.name}（${item.id.slice(-8)}）`, async () => {
              if (window.confirm(`确认更新母版「${item.name}」？会保留上一个版本，不影响已应用的作品。`)) await persist(item.id);
            })));
          dialog.append(choice); return;
        }
        if (update && !window.confirm(`确认更新「${target.name}」？保留上一个版本，其他作品不受影响。`)) return;
        await persist(update);
      }), button('取消', () => dialog.close()));
    async function persist(update) {
      capture();
      await library.save(captured, { name: name.value.trim(), updateId: update, confirmed: Boolean(update), thumbnail: previews.querySelector('canvas').toDataURL('image/png') });
      await showLibrary(); notify('母版已保存，当前作品未改变');
    }
    capture();
  }
  const download = record => {
      const blob = new Blob([JSON.stringify({ ...record.template, name: record.name }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = el('a', '', { href: url, download: `${record.name.replace(/[\\/:*?"<>|]/g, '-')}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const file = el('input', '', { type: 'file', accept: '.json,application/json', hidden: true });
  host.append(file); let importToLibrary = false;
  file.onchange = () => safe(async () => {
    const selected = file.files[0]; file.value = ''; if (!selected) return;
    if (selected.size > 32 * 1024 * 1024) throw new Error('母版文件过大，请使用小于 32MB 的 JSON');
    const template = parseTemplateJson(await selected.text());
    if (importToLibrary) { await library.save(template, { name: template.name || selected.name.replace(/\.json$/i, ''), thumbnail: draw(template.grid, '').querySelector('canvas').toDataURL('image/png') }); await showLibrary(); }
    else await preview(template);
  });
  const importFile = libraryOnly => { importToLibrary = libraryOnly; file.click(); };
  async function showLibrary() {
    const records = await library.list(); page('我的母版');
    const actions = el('div', '', { className: 'ws-template-actions' });
    actions.append(button('保存当前画布为母版', () => saveCanvas()), button('新建空白母版', () => saveCanvas({ blank: true })), button('导入母版 JSON', () => importFile(true)));
    dialog.append(actions, el('p', '本地浏览器存储，不是云端备份。删除浏览器数据会清空母版，请导出 JSON 留存。', { className: 'ws-note' }));
    if (!records.length) dialog.append(el('p', '还没有母版，请保存当前画布或导入 JSON。'));
    for (const item of records) {
      const row = el('section', '', { className: 'ws-template-row' });
      const thumbnail = el('figure', '');
      thumbnail.append(el('figcaption', `${item.name} · ${item.template.width} × ${item.template.height} · ${item.template.paletteKey}`));
      if (item.thumbnail) thumbnail.append(el('img', '', { src: item.thumbnail, alt: `${item.name}母版预览` }));
      else thumbnail.append(draw(item.template.grid, '').querySelector('canvas'));
      row.append(thumbnail);
      const tools = el('div', '', { className: 'ws-template-actions' });
      tools.append(button('预览 / 应用', () => preview(item.template)), button('重命名', async () => {
        const name = window.prompt('母版名称', item.name); if (name !== null) { await library.rename(item.id, name); await showLibrary(); }
      }), button('复制', async () => { await library.copy(item.id, `${item.name} 副本`); await showLibrary(); }),
      button('更新为当前画布', () => saveCanvas({ updateId: item.id })), button('导出 JSON', () => download(item)),
      button('删除', async () => { if (window.confirm(`删除母版「${item.name}」？请先导出备份。`)) { await library.remove(item.id); await showLibrary(); } }));
      if (item.previous) tools.append(button('恢复上一版', async () => { if (window.confirm(`恢复「${item.name}」的上一版？`)) { await library.restorePrevious(item.id); await showLibrary(); } }));
      row.append(tools); dialog.append(row);
    }
  }
  function setLocks(locked) {
    const before = snapshot();
    const selection = getState().editor.selection;
    if (locked && !selection) throw new Error('请先框选要锁定的母版区域，或使用「应用后锁定」');
    const mask = before.grid.map((row, y) => row.map((cell, x) => {
      const inside = selection && x >= selection.x0 && x <= selection.x1 && y >= selection.y0 && y <= selection.y1 && (!selection.mask || selection.mask.has(`${x},${y}`));
      return locked ? Boolean(before.templateLockedMask?.[y]?.[x] || (cell && inside)) : Boolean(before.templateLockedMask?.[y]?.[x] && selection && !inside);
    }));
    transact(before, { ...before, templateLockedMask: mask }, locked ? '锁定母版区域' : '解除母版锁定'); notify(locked ? '区域已锁定，可撤销' : '锁定已解除，可撤销');
  }
  const menu = el('details', '', { className: 'ws-project-menu ws-template-menu' });
  menu.append(el('summary', '母版', { className: 'ws-button' }));
  const content = el('div', '', { className: 'ws-project-popover' });
  for (const [label, action] of [['我的母版', showLibrary], ['保存当前画布为母版', () => saveCanvas()], ['导入为图层（JSON）', () => importFile(false)], ['锁定选区', () => setLocks(true)], ['解除锁定（有选区时仅解除选区）', () => setLocks(false)]]) {
    content.append(button(label, () => { menu.open = false; return action(); }));
  }
  menu.append(content);
  const saveNow = host.querySelector('#ws-save-now');
  if (saveNow) {
    const saveMenu = el('details', '', { className: 'ws-project-menu' }); saveMenu.append(el('summary', '保存', { className: 'ws-button' }));
    const items = el('div', '', { className: 'ws-project-popover' }); saveNow.before(saveMenu); saveNow.textContent = '保存当前作品';
    items.append(saveNow, button('另存为母版', () => { saveMenu.open = false; return saveCanvas(); })); saveMenu.append(items); saveMenu.before(menu);
    saveNow.addEventListener('click', () => { saveMenu.open = false; });
  }
  // New menus share the existing topbar; never let their popovers cover each other.
  const menus = [...menu.parentElement.querySelectorAll('.ws-project-menu')];
  for (const detail of menus) detail.addEventListener('toggle', () => {
    if (detail.open) for (const other of menus) if (other !== detail) other.open = false;
  });
  const importMenu = host.querySelector('#ws-new-blank')?.parentElement;
  importMenu?.append(button('导入为图层（JSON）', () => importFile(false)));
  return { showLibrary, saveCanvas, preview };
}
