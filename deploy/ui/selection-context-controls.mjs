// Only display preferences live here. Selection, clipboard and commands retain
// their existing service/store owners.
export const selectionCombineMode = (event, preference = 'replace') => event.altKey ? 'subtract' : event.shiftKey ? 'add' : preference;
export function attachSelectionContextControls({ host, transform, selectHistory, paste, clearHistory, history, resolveColor }) {
  const icon = (name) => ({ marquee:'<path d="M5 11V5h6m10 0h6v6m0 10v6h-6m-10 0H5v-6M5 15v2m22-2v2M15 5h2m-2 22h2"/>', addsel:'<path d="M5 5h14v14H5zM20 20h7M23.5 16.5v7"/>', subtract:'<path d="M5 5h14v14H5zM20 21h7"/>', moveT:'<path d="M16 3v26M3 16h26M16 3l-4 4m4-4 4 4M16 29l-4-4m4 4 4-4M3 16l4-4m-4 4 4 4m22-4-4-4m4 4-4 4"/>', rotateL:'<path d="M8 8H3V3M3 8a12 12 0 1 1-1 9"/>', flipH:'<path d="M16 3v26M12 8 4 12v9l8 4V8Zm8 0 8 4v9l-8 4V8Z"/>', flipV:'<path d="M3 16h26M8 12l4-8h9l4 8H8Zm0 8 4 8h9l4-8H8Z"/>', copy:'<rect x="8" y="8" width="17" height="17" rx="2"/><path d="M19 8V5H5v14h3"/>', trash:'<path d="M5 8h22M12 8V5h8v3m-12 0 1 19h14l1-19M13 13v9m6-9v9"/>' })[name] || '';
  const svg = (name) => `<svg viewBox="0 0 32 32" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(name)}</svg>`;
  const button = (parent, name, label, action, dataName) => { const el=document.createElement('button');el.type='button';el.className='ws-icon-tool-options-button';el.title=label;el.setAttribute('aria-label',label);el.innerHTML=`${svg(name)}<span class="ws-sr-only">${label}</span>`;if(dataName)el.dataset[dataName]=action;else el.addEventListener('click',action);parent.append(el);return el; };
  const group = document.createElement('div');
  group.className = 'ws-context-group ws-selection-context-controls'; group.dataset.tools = 'select region lasso closed-lasso wand same connected selection-move'; group.dataset.menu='selection';
  group.innerHTML = '<label hidden>选区组合<select aria-label="选区组合"><option value="replace">重新选择</option><option value="add">添加选区</option><option value="subtract">减去选区</option></select></label><label><input type="checkbox">仅原选区内（同色／连通）</label>';
  const mode = group.querySelector('select'), within = group.querySelector('input');
  const modes=document.createElement('div');modes.className='ws-icon-tool-options ws-selection-mode-options';modes.setAttribute('role','group');modes.setAttribute('aria-label','选区组合');
  for(const [value,name,label] of [['replace','marquee','重新选择'],['add','addsel','添加选区'],['subtract','subtract','减去选区']]) button(modes,name,label,()=>{mode.value=value;mode.dispatchEvent(new Event('change',{bubbles:true}));});
  group.prepend(modes);
  for (const [kind, label] of [['move', '拖动移动'], ['rotate', '旋转 90°'], ['flipX', '水平翻转'], ['flipY', '垂直翻转']]) {
    const glyph=kind==='move'?'moveT':kind==='rotate'?'rotateL':kind==='flipX'?'flipH':'flipV';
    button(group,glyph,label,()=>transform(kind));group.lastElementChild.dataset.selectionTransform=kind;
  }
  const details = document.createElement('details'); details.className = 'ws-clipboard-history';
  const summary = document.createElement('summary'); summary.innerHTML = `${svg('copy')}<span class="ws-sr-only">复制历史</span>`;summary.title='复制历史'; details.append(summary);
  const entries = document.createElement('div'); details.append(entries);
  button(details,'trash','清空复制历史',()=>{clearHistory();refresh();});
  group.append(details); host.append(group);
  const refresh = () => {
    entries.replaceChildren();
    history().forEach((entry, index) => {
      const button = document.createElement('button'); button.type = 'button';
      const canvas = document.createElement('canvas'); canvas.width = Math.min(80, entry.width * 4); canvas.height = Math.min(80, entry.height * 4);
      const ctx = canvas.getContext('2d'); const cw = canvas.width / entry.width, ch = canvas.height / entry.height;
      for (const { dx, dy, color: original } of entry.entries || []) {
        const color = original && (resolveColor(original.paletteId || original.code) || original);
        if (color) { ctx.fillStyle = color.hex || 'rgb(' + color.rgb.join(',') + ')'; ctx.fillRect(dx * cw, dy * ch, cw, ch); }
      }
      button.setAttribute('aria-label',entry.width + '×' + entry.height + ' · ' + entry.beads + ' 颗 · 选择并粘贴');button.append(canvas,document.createElement('span'));button.lastElementChild.innerHTML=svg('copy');
      button.addEventListener('click', () => { selectHistory(index); paste(); }); entries.append(button);
    });
    if (!entries.childElementCount) entries.textContent = '复制选区后会保留最近 8 条，本次会话有效。';
  };
  details.addEventListener('toggle', refresh);
  const refreshModes=()=>modes.querySelectorAll('button').forEach((item,index)=>item.setAttribute('aria-pressed',String(['replace','add','subtract'][index]===mode.value)));
  mode.addEventListener('change',refreshModes);refreshModes();
  return { mode: () => mode.value, within: () => within.checked, refresh, refreshModes };
}
