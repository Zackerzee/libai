// Visual-only overlay: colors and geometry always come from the completed grid.
export function createBirthGate() {
  let identity, pending = false;
  return {
    newSource(value) { identity = value; pending = true; },
    consumeSuccess(value) { if (!pending || value !== identity) return false; pending = false; return true; },
    cancel() {},
    reset() { identity = undefined; pending = false; },
  };
}

const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
const colorOf = color => typeof color === 'string' ? color : color?.hex || (color?.rgb ? `rgb(${color.rgb.join(',')})` : null);

export function createArtworkBirthMotion({ container, getBox, onFinish, maxParticles = 1800 }) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let epoch = 0, frame = 0, canvas = null, image = null, loadingResolve = null, running = false, destroyed = false;
  let resizeObserver, targetCanvas = null, canvasBounds = null;
  function state(value) { if (container.dataset) container.dataset.artworkMotionState = value; }
  function cancel() {
    epoch++;
    const active = running;
    if (active && !['finished', 'error'].includes(container.dataset?.artworkMotionState)) state('cancelled');
    running = false;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    if (image) { image.onload = image.onerror = null; image = null; }
    loadingResolve?.(false); loadingResolve = null;
    if (canvas) { canvas.remove(); canvas.width = canvas.height = 0; canvas = null; }
    canvasBounds = null;
    if (targetCanvas) { targetCanvas.width = targetCanvas.height = 0; targetCanvas = null; }
    if (active) { try { onFinish?.(); } catch { /* Visual completion must not interrupt the editor. */ } }
  }
  const visibility = () => { if (doc.hidden) cancel(); };
  const motionChange = () => { if (reduced.matches) cancel(); };
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('resize', cancel);
  reduced?.addEventListener?.('change', motionChange);
  if (win.ResizeObserver) {
    resizeObserver = new win.ResizeObserver(() => {
      if (!running || !canvas || !canvasBounds) return;
      const current = container.getBoundingClientRect();
      if (Math.abs(current.width - canvasBounds.width) > .5 || Math.abs(current.height - canvasBounds.height) > .5) cancel();
    });
    resizeObserver.observe(container);
  }

  async function play({ sourceUrl, grid, width, height }) {
    cancel();
    if (destroyed || doc.hidden || reduced?.matches || !sourceUrl || !container.isConnected || !width || !height || !grid?.length) return false;
    const token = epoch;
    running = true;
    state('loading');
    let source = new win.Image(); image = source;
    const loaded = await new Promise(resolve => {
      loadingResolve = resolve;
      source.onload = () => resolve(true); source.onerror = () => resolve(false); source.src = sourceUrl;
    });
    if (token !== epoch || destroyed) return false;
    loadingResolve = null; source.onload = source.onerror = null; image = null;
    if (!loaded || doc.hidden || !container.isConnected) { cancel(); return false; }
    try {
    const bounds = container.getBoundingClientRect(), box = getBox();
    if (!box || box.width <= 0 || box.height <= 0 || bounds.width <= 0 || bounds.height <= 0) { cancel(); return false; }
    canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'artwork-birth-motion';
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '8' });
    const dpr = Math.min(win.devicePixelRatio || 1, 1.5, 1600 / Math.max(bounds.width, bounds.height));
    canvas.width = Math.max(1, Math.round(bounds.width * dpr)); canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    container.appendChild(canvas);
    state('playing');
    if (container.dataset) container.dataset.artworkMotionPlays = String((Number(container.dataset.artworkMotionPlays) || 0) + 1);
    canvasBounds = { width: bounds.width, height: bounds.height };
    const ctx = canvas.getContext('2d');
    if (!ctx) { cancel(); return false; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lowPower = (win.navigator?.hardwareConcurrency || 8) <= 4 || (win.navigator?.deviceMemory || 8) <= 4;
    const cap = Math.max(1, Math.min(maxParticles, lowPower ? 700 : 1800));
    // Visual tiles are a display layer, not bead cells. Dense patterns must not
    // turn into dust: the same viewport always gets the same clear tile scale.
    const tileSize = Math.max(lowPower ? 16 : 12, Math.max(box.width, box.height) / 40,
      Math.sqrt(box.width * box.height / cap));
    const tileCols = Math.max(1, Math.floor(box.width / tileSize));
    const tileRows = Math.max(1, Math.floor(box.height / tileSize));
    const particles = [];
    for (let y = 0; y < tileRows; y++) for (let x = 0; x < tileCols; x++) {
      if (particles.length < cap) particles.push({ x, y, seed: (Math.sin(x * 12.9898 + y * 78.233) + 1) / 2, layer: (x + y) % 3 });
    }
    const cw = box.width / tileCols, ch = box.height / tileRows;
    targetCanvas = doc.createElement('canvas');
    // One raster pixel per production cell avoids mixing neighboring palette colors.
    targetCanvas.width = Math.max(1, Math.min(1600, width));
    targetCanvas.height = Math.max(1, Math.min(1600, height));
    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) { cancel(); source = null; return false; }
    const tw = targetCanvas.width / width, th = targetCanvas.height / height;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const color = colorOf(grid[y]?.[x]); if (!color) continue;
      targetCtx.fillStyle = color; targetCtx.fillRect(x * tw, y * th, tw, th);
    }
    let started, previous, slowFrames = 0, skip = 1;
    const tick = now => {
      try {
      frame = 0;
      if (token !== epoch || destroyed) return;
      if (doc.hidden || !container.isConnected || reduced?.matches) { cancel(); return; }
      started ??= now;
      if (previous && now - previous > 35) slowFrames++; previous = now;
      if (slowFrames >= 5) skip = 2;
      const t = Math.min(1, (now - started) / (lowPower ? 2200 : 2800));
      ctx.clearRect(0, 0, bounds.width, bounds.height);
      ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip();
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, box.x, box.y, box.width, box.height);
      // All moving squares carry exact production raster patches. The final
      // reveal includes transparent cells and leaves the real renderer intact.
      const settled = smooth((t - .78) / .2);
      if (settled) {
        ctx.clearRect(box.x, box.y, box.width, box.height);
        ctx.globalAlpha = 1 - settled; ctx.drawImage(source, box.x, box.y, box.width, box.height);
        ctx.globalAlpha = settled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(targetCanvas, box.x, box.y, box.width, box.height);
      }
      for (let i = 0; i < particles.length; i += skip) {
        const p = particles[i], delay = (p.x / tileCols + p.y / tileRows) * .14;
        const q = smooth((t - .10 - delay) / .5); if (!q) continue;
        const envelope = Math.sin(q * Math.PI), angle = p.seed * Math.PI * 2 + q * 2.7;
        const wave = Math.sin(p.y / tileRows * 9 + q * 5);
        const dx = (Math.cos(angle) * 2 + wave) * cw * envelope * (1 + p.layer * .3);
        const dy = Math.sin(angle) * ch * 1.8 * envelope;
        const size = 1 + envelope * (p.layer - 1) * .08;
        const x = box.x + (p.x + .5) * cw + dx - cw * size / 2;
        const y = box.y + (p.y + .5) * ch + dy - ch * size / 2;
        const sx = p.x * targetCanvas.width / tileCols, sy = p.y * targetCanvas.height / tileRows;
        const sw = targetCanvas.width / tileCols, sh = targetCanvas.height / tileRows;
        ctx.imageSmoothingEnabled = false;
        if (p.seed > .96 && envelope > .2) {
          ctx.globalAlpha = q * envelope * .07 * (1 - settled);
          ctx.drawImage(targetCanvas, sx, sy, sw, sh, x - cw * .3, y - ch * .3, cw * 1.6, ch * 1.6);
        }
        ctx.globalAlpha = q * (1 - settled);
        ctx.drawImage(targetCanvas, sx, sy, sw, sh, x, y, cw * size, ch * size);
      }
      ctx.restore();
      if (t >= 1) { state('finished'); cancel(); source = null; } else frame = win.requestAnimationFrame(tick);
      } catch { state('error'); cancel(); source = null; }
    };
    frame = win.requestAnimationFrame(tick);
    return true;
    } catch { state('error'); cancel(); source = null; return false; }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; cancel(); resizeObserver?.disconnect();
    doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('resize', cancel);
    reduced?.removeEventListener?.('change', motionChange);
  }
  return { play, cancel, destroy, get isRunning() { return running; } };
}
