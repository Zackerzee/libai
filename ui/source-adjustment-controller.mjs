export const SOURCE_ADJUSTMENT_KEYS = ['brightness', 'contrast', 'saturation', 'sharpen'];

// Owns controls only. The bridge owns the immutable source and generation state.
export function attachSourceAdjustmentControls({ root, getTransform, setTransform, requestPreview, scheduleGenerate, hasSource }) {
  const inputs = [...root.querySelectorAll('[data-ws-source-adjust]')];
  const reset = root.querySelector('#ws-source-reset');
  const sync = () => {
    const transform = getTransform();
    for (const input of inputs) {
      const key = input.dataset.wsSourceAdjust;
      input.value = String(transform[key] ?? 0);
      input.disabled = !hasSource();
      root.querySelector(`#ws-source-${key}-value`).textContent = input.value;
    }
    reset.disabled = !hasSource();
  };
  const onInput = event => {
    const input = event.target;
    const key = input.dataset.wsSourceAdjust;
    if (!SOURCE_ADJUSTMENT_KEYS.includes(key) || !hasSource()) return;
    setTransform({ [key]: Number(input.value) });
    sync();
    requestPreview();
    scheduleGenerate(320);
  };
  const onReset = () => {
    if (!hasSource()) return;
    setTransform(Object.fromEntries(SOURCE_ADJUSTMENT_KEYS.map(key => [key, 0])));
    sync();
    requestPreview();
    scheduleGenerate(0);
  };
  inputs.forEach(input => input.addEventListener('input', onInput));
  reset.addEventListener('click', onReset);
  sync();
  return { sync, dispose() { inputs.forEach(input => input.removeEventListener('input', onInput)); reset.removeEventListener('click', onReset); } };
}
