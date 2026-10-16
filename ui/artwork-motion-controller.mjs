import { createArtworkBirthMotion, createBirthGate } from './artwork-birth-motion.mjs?v=20261013-large-tiles';
import { readEditorPreference, saveEditorPreference } from './editor-interaction.mjs';

export const ARTWORK_MOTION_PREFERENCE = 'firstUploadMotion';
export function artworkMotionEnabled() { return readEditorPreference(ARTWORK_MOTION_PREFERENCE, true) !== false; }
const preferenceEvent = 'libms:artwork-motion-preference';

/** Owns presentation only. The editor/production grid remains the result owner. */
export function attachArtworkBirthController({ container, preferenceHost, compactPreferenceHost, viewport, bridge, onFinish }) {
  const doc = container.ownerDocument, win = doc.defaultView;
  const gate = createBirthGate();
  let uploadRevision = 0, originalUrl = '', identity = '', destroyed = false;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = createArtworkBirthMotion({ container, onFinish, getBox: () => {
    const origin = viewport.origin(), result = bridge.getResult();
    return { x: origin.x, y: origin.y, width: result.width * origin.cell, height: result.height * origin.cell };
  } });
  // 「首次上传动效」的勾选框已从底栏移除：它本来就默认开着（artworkMotionEnabled 缺省 true），
  // 摆在底栏只占地方。偏好键与事件完全保留 —— 以前关过的人仍然关着，跨设备/跨会话的
  // 存储监听、取消正在播放的动效这些行为一个都没变，只是不再提供一个可见开关。
  const listeners = [];
  const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener(type, handler, options)); };
  const stop = () => motion.cancel();
  const reset = () => { stop(); gate.reset(); originalUrl = ''; identity = ''; };
  listen(win, preferenceEvent, event => { if (!Boolean(event.detail)) stop(); });
  listen(win, 'storage', event => { if (event.key === `libms.editor.${ARTWORK_MOTION_PREFERENCE}` && !artworkMotionEnabled()) stop(); });
  const trace = value => { if (container.dataset) container.dataset.artworkBirthGate = value; };
  trace('ready');
  listen(win, 'libms:artwork-upload-started', event => { uploadRevision = event.detail.uploadRevision; reset(); trace('uploading'); });
  listen(win, 'libms:source-loaded', event => {
    const source = event.detail;
    if (source.uploadRevision !== uploadRevision) return;
    reset();
    if (source.importMode !== 'photo') return;
    originalUrl = source.url; identity = `${uploadRevision}:${originalUrl}`; gate.newSource(identity); trace('armed');
  });
  listen(win, 'libms:artwork-generation-completed', event => {
    stop();
    const result = event.detail;
    if (destroyed || !result?.grid?.length || result.manualEdited || !originalUrl || result.sourceOriginalUrl !== originalUrl || result.artworkUploadRevision !== uploadRevision) { trace(`ignored:${Boolean(originalUrl)}:${result?.artworkUploadRevision}:${uploadRevision}`); return; }
    // Consume even if disabled/reduced: toggling later never replays an existing work.
    if (!gate.consumeSuccess(identity)) { trace('consumed'); return; }
    if (!artworkMotionEnabled() || reduced.matches || doc.hidden) { trace('skipped'); return; }
    trace('playing');
    void motion.play({ sourceUrl: result.sourceUrl, grid: result.grid, width: result.width, height: result.height }).catch(stop);
  });
  listen(win, 'libms:project-result', event => { stop(); if (originalUrl && event.detail?.sourceOriginalUrl !== originalUrl) reset(); });
  for (const type of ['libms:grid-edited', 'libms:source-transform-changed', 'libms:generation-error', 'libms:artwork-generation-started', 'libms:artwork-motion-cancel']) listen(win, type, stop);
  listen(win, 'libms:artwork-source-reset', event => { uploadRevision = event.detail?.uploadRevision ?? uploadRevision; reset(); });
  listen(win, 'libms:blank-canvas-created', reset);
  // Capture before editor handlers so a gesture immediately reaches the real canvas.
  for (const type of ['pointerdown', 'keydown', 'input', 'wheel', 'drop']) listen(doc, type, stop, true);
  let removalObserver;
  const destroy = () => { if (destroyed) return; destroyed = true; removalObserver?.disconnect(); for (const remove of listeners) remove(); motion.destroy(); gate.reset(); };
  if (win.MutationObserver && doc.documentElement) { removalObserver = new win.MutationObserver(() => { if (!container.isConnected) destroy(); }); removalObserver.observe(doc.documentElement, { childList: true, subtree: true }); }
  listen(win, 'pagehide', destroy);
  return { cancel: stop, destroy, get isRunning() { return motion.isRunning; } };
}

/** Gallery sources come only from existing session data; missing originals stay static. */
export function attachGalleryBirthMotion(container, resolveArtwork) {
  const doc = container.ownerDocument, win = doc.defaultView, cleanups = [];
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  for (const card of container.querySelectorAll('[data-artwork-id]')) {
    const artwork = resolveArtwork(card.dataset.artworkId), image = card.querySelector('img');
    if (!artwork?.sourceUrl || !artwork.grid?.length || !image) continue;
    let timer = 0, played = false, touch = false;
    const getBox = () => {
      const r = image.getBoundingClientRect(), parent = card.getBoundingClientRect();
      // Existing thumbnail has 12px padding, and object-fit:contain in the workbench.
      const cell = Math.max(2, Math.min(8, Math.floor(420 / Math.max(artwork.width, artwork.height))));
      const tw = artwork.width * cell + 24, th = artwork.height * cell + 24;
      const scale = Math.min(r.width / tw, r.height / th);
      return { x: r.left - parent.left + (r.width - tw * scale) / 2 + 12 * scale,
        y: r.top - parent.top + (r.height - th * scale) / 2 + 12 * scale,
        width: artwork.width * cell * scale, height: artwork.height * cell * scale };
    };
    const motion = createArtworkBirthMotion({ container: card, getBox, maxParticles: 700 });
    const stop = () => { win.clearTimeout(timer); timer = 0; motion.cancel(); };
    const leave = () => { stop(); played = false; };
    const play = () => {
      win.clearTimeout(timer); timer = 0;
      if (played || !artworkMotionEnabled() || reduced.matches || doc.hidden) return;
      played = true; void motion.play(artwork).catch(stop);
    };
    const handlers = {
      pointerenter: event => { if (event.pointerType !== 'touch' && !played) timer = win.setTimeout(play, 160); },
      pointerleave: leave,
      focus: () => { if (!touch) play(); },
      blur: leave,
      pointerdown: event => { touch = event.pointerType === 'touch'; },
      click: event => { if (touch && !played && artworkMotionEnabled() && !reduced.matches) { event.preventDefault(); event.stopImmediatePropagation(); play(); } touch = false; },
    };
    for (const [type, handler] of Object.entries(handlers)) card.addEventListener(type, handler, type === 'click');
    const disable = () => { if (!artworkMotionEnabled() || reduced.matches || doc.hidden) stop(); };
    win.addEventListener(preferenceEvent, disable); doc.addEventListener('visibilitychange', disable); reduced.addEventListener('change', disable);
    cleanups.push(() => { stop(); motion.destroy(); for (const [type, handler] of Object.entries(handlers)) card.removeEventListener(type, handler, type === 'click'); win.removeEventListener(preferenceEvent, disable); doc.removeEventListener('visibilitychange', disable); reduced.removeEventListener('change', disable); });
  }
  let removalObserver;
  const cards = [...container.querySelectorAll('[data-artwork-id]')];
  const destroy = () => { removalObserver?.disconnect(); for (const cleanup of cleanups.splice(0)) cleanup(); win.removeEventListener('pagehide', destroy); };
  if (win.MutationObserver && doc.documentElement) { removalObserver = new win.MutationObserver(() => { if (!container.isConnected || cards.some(card => !card.isConnected)) destroy(); }); removalObserver.observe(doc.documentElement, { childList: true, subtree: true }); }
  win.addEventListener('pagehide', destroy);
  return destroy;
}
