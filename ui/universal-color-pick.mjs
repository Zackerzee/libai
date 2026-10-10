// Delegate only from explicitly labelled palette swatches, never arbitrary CSS colours.
export function attachUniversalColorPick(root, { pick, delay = 800, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let pending = null, timer = null;
  const clear = () => { if (timer !== null) cancel(timer); timer = null; pending = null; };
  const swatch = target => target?.closest?.('[data-ws-color-pick]');
  const over = event => {
    if (event.pointerType === 'touch') return;
    const node = swatch(event.target);
    if (!node || node === pending || node.contains?.(event.relatedTarget)) return;
    clear();
    if (node.closest('#ws-canvas-area')) return;
    pending = node;
    timer = schedule(() => {
      timer = null; pending = null;
      if (node.isConnected && root.contains(node)) pick(node.dataset.wsColorPick);
    }, delay);
  };
  const out = event => { if (pending && pending.contains(event.target) && !pending.contains(event.relatedTarget)) clear(); };
  const menu = event => {
    const node = swatch(event.target);
    if (!node || !root.contains(node)) return;
    clear();
    if (pick(node.dataset.wsColorPick) !== false) { event.preventDefault(); event.stopPropagation(); }
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('pointerout', out);
  root.addEventListener('pointerdown', clear);
  root.addEventListener('contextmenu', menu);
  root.addEventListener('scroll', clear, true);
  return () => { clear(); root.removeEventListener('pointerover', over); root.removeEventListener('pointerout', out); root.removeEventListener('pointerdown', clear); root.removeEventListener('contextmenu', menu); root.removeEventListener('scroll', clear, true); };
}
