// Enhance the existing input; its value and original change handler remain authoritative.
export function attachPaletteColorPicker(input, { getColors, surfaces, valueMode = 'identity' }) {
  if (!input || input.dataset.colorPicker) return;
  input.dataset.colorPicker = "true";
  input.removeAttribute("list");
  const host = document.createElement("div"); host.className = "ws-color-picker";
  input.before(host); host.append(input);
  const preview = document.createElement("span"); preview.className = "ws-color-picker-preview"; host.prepend(preview);
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = "选色"; toggle.setAttribute("aria-label", "打开颜色色盘"); toggle.setAttribute("aria-expanded", "false"); host.append(toggle);
  const popup = document.createElement("div"); popup.className = "ws-color-picker-popup"; popup.hidden = true; host.append(popup);
  const results = document.createElement("div"); results.className = "ws-color-picker-results"; popup.append(results);
  const close = () => { popup.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
  const surfaceId=`palette-${input.id}`;
  surfaces?.register(surfaceId,{element:host,isOpen:()=>!popup.hidden,close,restoreFocus:()=>input.focus()});
  const colors = () => getColors() || [];
  const colorCss = color => color?.hex || (color?.rgb ? `rgb(${color.rgb.join(',')})` : 'transparent');
  function sync() {
    const key = input.value.trim().toUpperCase();
    const color = colors().find(c => String(c.paletteId || c.code).toUpperCase() === key || String(c.code).toUpperCase() === key);
    preview.style.backgroundColor = colorCss(color);
    preview.title = color ? color.code : "尚未选择颜色";
  }
  function render() {
    results.replaceChildren();
    const query = input.value.trim().toUpperCase();
    const palette = colors();
    const exact = palette.some(c => String(c.paletteId || c.code).toUpperCase() === query || String(c.code).toUpperCase() === query);
    for (const color of palette.filter(c => !query || exact || String(c.code).toUpperCase().includes(query))) {
      const button = document.createElement("button"); button.type = "button"; button.className = "ws-color-picker-option"; button.title = color.code;
      const swatch = document.createElement("i"); swatch.style.backgroundColor = color.hex || colorCss(color); button.append(swatch, document.createTextNode(color.code));
      button.addEventListener("click", () => {
        if (valueMode === 'code') input.value = String(color.code);
        else input.value = String(color.paletteId || color.code);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true })); sync(); close(); input.focus();
      });
      results.append(button);
    }
    if (!results.childElementCount) results.textContent = "没有匹配的色号";
  }
  toggle.addEventListener("click", () => {
    if (input.disabled) return;
    if (!popup.hidden) { close(); return; }
    surfaces?.open(surfaceId);render(); popup.hidden = false; toggle.setAttribute("aria-expanded", "true");
  });
  input.addEventListener("input", () => { sync(); if (!popup.hidden) render(); });
  input.addEventListener("change", sync);
  host.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); input.focus(); } });
  document.addEventListener("pointerdown", e => { if (!host.contains(e.target)) close(); });
  const observer = new MutationObserver(() => { toggle.disabled = input.disabled; sync(); });
  observer.observe(input, { attributes: true, attributeFilter: ["disabled"] });
  toggle.disabled = input.disabled; sync();
  return { sync, close };
}
