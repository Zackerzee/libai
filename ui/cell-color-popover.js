// Runtime presentation only: selected cell, palette identity and replacement history stay in workspace.
export function positionCellPopover(anchor, size, bounds, gap = 10) {
  const margin = 8;
  const right=anchor.x+anchor.cell+gap, below=anchor.y+anchor.cell+gap;
  const left=anchor.x-size.width-gap, above=anchor.y-size.height-gap;
  // Prefer a 45-degree lower-right offset; flip only when an edge prevents it.
  const positions=[{left:right,top:below},{left,top:below},{left:right,top:above},{left,top:above}];
  const fit=positions.find(p=>p.left>=margin&&p.top>=margin&&p.left+size.width<=bounds.width-margin&&p.top+size.height<=bounds.height-margin);
  if(fit)return fit;
  const clamp=(value,max)=>Math.max(margin,Math.min(value,Math.max(margin,max)));
  // Narrow hosts may not fit any diagonal. Keep the popup below/above the anchor
  // when possible instead of clamping it across the selected cell.
  const clamped=positions.map(p=>({left:clamp(p.left,bounds.width-size.width-margin),top:clamp(p.top,bounds.height-size.height-margin)}));
  const overlaps=p=>Math.max(0,Math.min(p.left+size.width,anchor.x+anchor.cell)-Math.max(p.left,anchor.x))
    *Math.max(0,Math.min(p.top+size.height,anchor.y+anchor.cell)-Math.max(p.top,anchor.y));
  return clamped.reduce((best,p)=>overlaps(p)<overlaps(best)?p:best,clamped[0]);
}

export function groupColorSuggestions(groups, sourceId) {
  const seen = new Map();
  const priority=group=>group.label==='暗一级 / 亮一级'?0:group.label==='对比色'?1:2;
  const mapped=new Map();
  for(const group of [...groups].sort((a,b)=>priority(a)-priority(b))){mapped.set(group,{...group, colors:group.colors.flatMap(color => {
    if (!color?.paletteId || color.paletteId===sourceId) return [];
    const label=color.recommendationLabel||group.label;
    if(seen.has(color.paletteId)){const prior=seen.get(color.paletteId);if(!prior.recommendationLabels.includes(label))prior.recommendationLabels.push(label);return [];}
    const entry={...color,recommendationLabels:[label]};seen.set(color.paletteId,entry);return [entry];
  })});}
  return groups.map(group=>mapped.get(group)).filter(group=>group.colors.length);
}

export function createCellColorPopover({host, viewport, surfaces, onPreviewChange=()=>{}, getEditor, getColor, getTarget = () => null, getContextGroups = () => [], getContextKey = () => '', targetInput, localButton, globalButton, isAvailable}) {
  const popup = document.createElement('aside');
  popup.className = 'ws-cell-color-popover'; popup.hidden = true;
  popup.setAttribute('aria-label', '改色建议');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  marker.classList.add('ws-cell-selected-marker'); marker.setAttribute('aria-hidden','true'); marker.hidden = true;
  marker.innerHTML = '<rect class="ws-cell-ant-base"/><rect class="ws-cell-ant-dashes"/>';
  host.append(marker, popup);
  let open = false, signature = '', similarKey = '', similarColors = [], previewTarget = null;
  const close = () => { open = false; previewTarget=null; popup.hidden = true; marker.style.display = 'none'; onPreviewChange(); };
  surfaces?.register('cell-color',{element:popup,isOpen:()=>open&&!popup.hidden,close,restoreFocus:()=>{host.tabIndex=-1;host.focus();}});
  const update = () => {
    const editor = getEditor(), cell = editor.selectedCell, color = cell && getColor(cell.x,cell.y);
    if (!open || !cell || !color || !isAvailable()) { close(); return; }
    const key = JSON.stringify([color.paletteId,color.code,color.hex,color.rgb,cell,getContextKey()]);
    if(key!==similarKey){similarKey=key;similarColors=groupColorSuggestions(getContextGroups(color),color.paletteId);}
    const groups = similarColors;
    const nextSignature = JSON.stringify([cell,color.paletteId,color.code,groups]);
    if (signature !== nextSignature) {
      signature = nextSignature; previewTarget=null; popup.replaceChildren();
      const header = document.createElement('div'); header.className = 'ws-cell-color-popover-head';
      const title = document.createElement('strong'); title.textContent = `${color.code} · 改色建议`;
      const exit = document.createElement('button'); exit.type='button';exit.textContent='×';exit.setAttribute('aria-label','关闭改色建议');exit.addEventListener('click',close);
      const target=document.createElement('span');target.className='ws-cell-color-target';
      header.append(title,target,exit); popup.append(header);
      const grouped=document.createElement('div');grouped.className='ws-cell-color-groups';
      for (const group of groups) {
      const section=document.createElement('section');section.className='ws-cell-color-group';
      section.setAttribute('aria-label',group.label);section.title=group.label;
      const label=document.createElement('small');label.className='ws-cell-color-group-label';label.textContent=group.label;section.append(label);
      const row=document.createElement('div');row.className='ws-cell-color-suggestions';
      for (const candidate of group.colors) {
        const button=document.createElement('button');button.type='button';button.dataset.paletteId=candidate.paletteId;button.title=`${candidate.recommendationLabels.join(' / ')} · 选择 ${candidate.code} 作为替换色`;button.setAttribute('aria-label',button.title);
        const swatch=document.createElement('span');swatch.style.backgroundColor=candidate.hex;
        const code=document.createElement('small');code.textContent=candidate.code;
        const hex=candidate.hex.replace('#','');
        const channels=[0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
        code.style.color=channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>.179?'#000':'#fff';
        swatch.append(code);button.append(swatch);
        // Hover/focus only previews the destination, never writes editor state or history.
        const preview=()=>{previewTarget=candidate;update();onPreviewChange();};
        const restore=()=>{if(previewTarget===candidate){previewTarget=null;update();onPreviewChange();}};
        button.addEventListener('pointerenter',preview);button.addEventListener('pointerleave',restore);
        button.addEventListener('focus',preview);button.addEventListener('blur',restore);
        button.addEventListener('click',()=>{previewTarget=null;targetInput.value=candidate.code;targetInput.dispatchEvent(new Event('change',{bubbles:true}));if(!localButton.disabled)localButton.click();update();});row.append(button);
      }
      section.append(row);grouped.append(section);
      }
      popup.append(grouped);
      const actions=document.createElement('div');actions.className='ws-cell-color-actions';
      for (const [label,original] of [['仅选区替换',localButton],['全局替换',globalButton]]) {
        const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.action=original.id;
        button.addEventListener('click',()=>{if(!original.disabled)original.click();update();});actions.append(button);
      }
      popup.append(actions);
      const reason=document.createElement('small');reason.className='ws-cell-color-reason';popup.append(reason);
    }
    popup.hidden=false;
    const target=previewTarget||getTarget(),targetLabel=popup.querySelector('.ws-cell-color-target');
    targetLabel.textContent=target?`→ ${target.code}`:'';
    targetLabel.title=previewTarget?'悬停预览 · 点击换色':target?'当前替换目标':'';
    targetLabel.style.borderLeft=target?`12px solid ${target.hex}`:'';
    for(const button of popup.querySelectorAll('[data-action]'))button.disabled=(button.dataset.action===localButton.id?localButton:globalButton).disabled;
    const local=popup.querySelector(`[data-action="${localButton.id}"]`);local.textContent=localButton.dataset.scope||localButton.textContent;
    popup.querySelector('.ws-cell-color-reason').textContent=previewTarget?`预览 ${previewTarget.code} · 点击换色，可撤销`:localButton.disabled?(localButton.title||'请选择不同颜色'):'点击建议色立即换色 · 可撤销';
    for(const button of popup.querySelectorAll('[data-palette-id]'))button.classList.toggle('is-target',previewTarget?button.dataset.paletteId===previewTarget.paletteId:button.dataset.paletteId===targetInput.value||button.querySelector('small').textContent===targetInput.value);
    const point=viewport.gridToScreen(cell.x,cell.y), end=viewport.gridToScreen(cell.x+1,cell.y+1), side=end.x-point.x;
    const visible=point.x+side>0&&point.y+side>0&&point.x<host.clientWidth&&point.y<host.clientHeight;
    popup.hidden=!visible; marker.style.display=visible?'block':'none'; if(!visible)return;
    marker.style.left=`${point.x}px`;marker.style.top=`${point.y}px`;marker.style.width=`${side}px`;marker.style.height=`${side}px`;
    for(const rect of marker.children){rect.setAttribute('x','1');rect.setAttribute('y','1');rect.setAttribute('width',Math.max(0,side-2));rect.setAttribute('height',Math.max(0,side-2));}
    const position=positionCellPopover({...point,cell:side},{width:popup.offsetWidth,height:popup.offsetHeight},{width:host.clientWidth,height:host.clientHeight});
    popup.style.left=`${position.left}px`;popup.style.top=`${position.top}px`;
  };
  popup.addEventListener('pointerdown',event=>event.stopPropagation());
  new ResizeObserver(update).observe(host);
  return {open(){surfaces?.open('cell-color');similarKey='';open=true;update();},close,update,isOpen:()=>open,getPreview:()=>open?previewTarget:null};
}
