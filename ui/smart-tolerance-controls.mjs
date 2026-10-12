/** Derived preview controls; formal grids and command history remain in the bridge. */
export const SMART_TOLERANCE_DEBOUNCE_MS = 100;

export function smartToleranceControlsMarkup() {
  return `<div data-smart-tolerance-controls>
    <label class="sl-switch-row"><span><strong>智能色彩容差</strong></span><input type="checkbox" data-smart-enabled aria-label="智能色彩容差"><span class="sl-switch-ui"></span></label>
    <div data-smart-body hidden>
      <div class="sl-range-setting"><div class="sl-range-heading"><strong>强度 · 弱到强</strong><output data-smart-value>0</output></div>
        <div class="sl-range-row" style="grid-template-columns: minmax(0, 1fr)"><input type="range" min="0" max="100" step="1" value="0" data-smart-strength aria-label="智能色彩容差强度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
      </div>
      <p class="sl-info-box">0 表示清理后、颜色上限前基线，不是原始图片。</p>
      <p data-smart-status role="status" aria-live="polite"></p>
      <div data-smart-stats><p>基线颜色：<output data-smart-baseline>—</output></p><p>智能容差后：<output data-smart-tolerance>—</output></p><p>颜色上限后：<output data-smart-final>—</output></p></div>
      <p class="sl-info-box" data-smart-warning hidden>颜色上限进一步合并了受保护颜色。</p>
      <div class="sl-color-presets"><button type="button" data-smart-reset>恢复</button><button type="button" data-smart-cancel>取消预览</button><button type="button" data-smart-apply disabled>应用</button></div>
    </div><p data-smart-error role="alert" hidden></p>
  </div>`;
}

export function bindSmartToleranceControls({ root, bridge, editorService, events = window, onPreview = () => {}, debounceMs = SMART_TOLERANCE_DEBOUNCE_MS }) {
  const q = (name) => root.querySelector(`[data-smart-${name}]`);
  let timer = null;
  let renderedGrid = Symbol('unpainted');
  const clearPending = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const invoke = (action) => Promise.resolve().then(action).catch(() => paint());
  function paint() {
    const state = bridge.getSmartToleranceUiState?.() || {};
    const strength = Math.max(0, Math.min(100, Number(state.previewStrength ?? state.strength) || 0));
    q('enabled').checked = Boolean(state.enabled);
    q('body').hidden = !state.enabled;
    // Do not overwrite the immediate slider readout while a debounced preview is pending.
    if (timer === null) { q('strength').value = String(strength); q('value').textContent = String(strength); q('strength').setAttribute('aria-valuenow', String(strength)); }
    const status = state.status;
    q('status').textContent = status === 'building' ? '正在分析可安全合并的颜色…' : status === 'evaluating' ? '正在更新预览…' : status === 'applying' ? '正在准备应用，可取消…' : status === 'ready' ? '预览就绪；应用后才修改作品。' : '';
    q('body').setAttribute('aria-busy', String(['building', 'evaluating', 'applying'].includes(status)));
    const stats = state.previewStats || state.stats || {};
    q('baseline').textContent = String(stats.colorsBefore ?? stats.colorsAfterCleanup ?? '—');
    q('tolerance').textContent = String(stats.colorsAfterTolerance ?? '—');
    q('final').textContent = String(stats.colorsAfterBudget ?? '—');
    q('warning').hidden = !(Number(stats.forcedProtected ?? stats.budgetForcedProtected) > 0);
    q('apply').disabled = !state.enabled || !state.canApply || ['building', 'evaluating'].includes(status) || timer !== null;
    q('error').hidden = !state.error;
    q('error').textContent = state.error ? '智能色彩容差未能完成，请重新启用。' : '';
    // Status-only notifications (especially Apply preparation) do not change
    // the displayed grid. Do not redraw the same 250k-cell preview for them.
    const hasGridReader = typeof bridge.getSmartTolerancePreviewResult === 'function';
    const grid = hasGridReader
      ? (bridge.getSmartTolerancePreviewResult()?.grid ?? bridge.getResult?.()?.grid) : null;
    if (!hasGridReader || grid !== renderedGrid) { renderedGrid = grid; onPreview(); }
  }
  const enabled = () => { clearPending(); invoke(() => bridge.setSmartToleranceEnabled(q('enabled').checked)); };
  const input = () => {
    clearPending();
    const strength = Number(q('strength').value);
    q('value').textContent = String(strength); q('strength').setAttribute('aria-valuenow', String(strength)); q('apply').disabled = true;
    timer = setTimeout(() => { timer = null; invoke(() => bridge.previewSmartTolerance(strength)); }, debounceMs);
  };
  const reset = () => { clearPending(); invoke(() => bridge.resetSmartTolerancePreview()); };
  const cancel = () => { clearPending(); invoke(() => bridge.cancelSmartTolerancePreview()); };
  const apply = () => { clearPending(); invoke(() => bridge.applySmartTolerancePreview(editorService)); };
  q('enabled').addEventListener('change', enabled);
  q('strength').addEventListener('input', input);
  q('reset').addEventListener('click', reset); q('cancel').addEventListener('click', cancel); q('apply').addEventListener('click', apply);
  events.addEventListener('libms:smart-tolerance-ui', paint);
  paint();
  return { paint, invalidate(reason) { clearPending(); bridge.invalidateSmartTolerancePreview?.(reason); }, destroy() { clearPending(); events.removeEventListener('libms:smart-tolerance-ui', paint); q('enabled').removeEventListener('change', enabled); q('strength').removeEventListener('input', input); q('reset').removeEventListener('click', reset); q('cancel').removeEventListener('click', cancel); q('apply').removeEventListener('click', apply); } };
}
