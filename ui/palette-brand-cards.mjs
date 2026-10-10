const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// User-supplied reconstructed display marks, not certified original brand artwork.
export const BRAND_LOGOS = Object.freeze({mard:'mard-display.png',coco:'coco-display.png',manman:'manman-display.png',panpan:'panpan-display.png',mixiaowo:'mixiaowo-display.png',artkal:'artkal-display.png',youken:'artkal-display.png',nabbi:'nabbi-display.png',perler:'perler-display.png',yant:'yant-display.png',hama:'hama-display.png'});
export function brandLogo(brand) {
  const key = String(brand).toLowerCase().replace(/official$/, '').replace(/^(artkal|youken)\d+$/, '$1');
  return BRAND_LOGOS[key] ? `./assets/brand/${BRAND_LOGOS[key]}` : null;
}
export const paletteKitLabel = key => key === 'mard-221' ? 'Standard 221' : key === 'mard-291' ? 'Complete 291' : key.startsWith('mard-') ? `Kit ${key.split('-')[1]}` : `色卡 ${key.split('-').slice(1).join('-')}`;
export function compactPaletteLabel(entry) {
  const name = entry.tierLabel || paletteKitLabel(entry.key);
  const count = String(entry.colors.length);
  return new RegExp(`(^|\\D)${count}(\\D|$)`).test(name) ? name : `${name} · ${count} 色`;
}
export function paletteCardGroups(catalog, label = key => key, query = '') {
  const groups = new Map();
  for (const entry of catalog || []) {
    const brand = entry.key.split('-')[0];
    if (!groups.has(brand)) groups.set(brand, { brand, label: label(brand), entries: [] });
    groups.get(brand).entries.push(entry);
  }
  return [...groups.values()].filter(group => `${group.brand} ${group.label} ${group.entries.map(e => e.colors.length).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
}
export function paletteSpectrum(colors, count = 24) {
  const valid = colors.filter(c => Array.isArray(c.rgb) && c.rgb.length === 3);
  if (!valid.length) return [];
  const hue = ({rgb:[r,g,b]}) => {const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d)return -1;return ((max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)+6)%6;};
  const ordered = [...valid].sort((a,b) => hue(a)-hue(b));
  return Array.from({length:Math.min(count,ordered.length)},(_,i)=>ordered[Math.round(i*(ordered.length-1)/Math.max(1,Math.min(count,ordered.length)-1))].rgb);
}
export function attachPaletteBrandCards({host,getCatalog,getActiveKey,label,onSelect}) {
  const search=document.createElement('input');search.type='search';search.placeholder='搜索品牌 / 色卡色数';search.setAttribute('aria-label','搜索品牌色卡');
  const list=document.createElement('div');list.className='ws-brand-card-list';host.append(search,list);
  function render(){list.innerHTML=paletteCardGroups(getCatalog(),label,search.value).map(group=>`<section class="ws-brand-card"><header>${brandLogo(group.brand)?`<img class="ws-brand-official-logo" loading="lazy" decoding="async" src="${brandLogo(group.brand)}" alt="${escape(group.label)} 品牌标识">`:`<span class="ws-brand-text-badge" aria-label="品牌名称标识">${escape(group.brand.slice(0,4).toUpperCase())}</span>`}<strong>${escape(group.label)}</strong></header><div class="ws-brand-series">${group.entries.map(entry=>`<button type="button" title="${escape(entry.summary || '')}" data-palette-key="${escape(entry.key)}" aria-pressed="${entry.key===getActiveKey()}"><span>${escape(entry.tierLabel || paletteKitLabel(entry.key))}</span><strong>${entry.colors.length} 色</strong><span class="ws-brand-spectrum" aria-hidden="true">${paletteSpectrum(entry.colors).map(rgb=>`<i style="background:rgb(${rgb.join(',')})"></i>`).join('')}</span></button>`).join('')}</div></section>`).join('') || '<p>没有匹配的品牌色卡</p>';}
  const renderCompact = () => { render(); for (const button of list.querySelectorAll('[data-palette-key]')) { const entry = getCatalog().find(item => item.key === button.dataset.paletteKey); button.querySelector('span').textContent = compactPaletteLabel(entry); button.querySelector('strong')?.remove(); } };
  search.addEventListener('input',renderCompact);list.addEventListener('click',event=>{const button=event.target.closest('[data-palette-key]');if(button)onSelect(button.dataset.paletteKey);});renderCompact();return {render:renderCompact};
}
