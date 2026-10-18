const pendingScripts = new Map();

function loadBundle(file, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  const url = new URL(`../vendor/creative-tools/${file}`, import.meta.url).href;
  if (!pendingScripts.has(url)) {
    const task = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => window[globalName]
        ? resolve(window[globalName]) : reject(new Error('创意工具加载不完整，请重试'));
      script.onerror = () => { script.remove(); reject(new Error('创意工具加载失败，请检查网络后重试')); };
      document.head.append(script);
    }).catch(error => { pendingScripts.delete(url); throw error; });
    pendingScripts.set(url, task);
  }
  return pendingScripts.get(url);
}

export function createCreativeToolsPanel({ getPalette, onConfirm, onOpenText }) {
  const styleUrl = new URL('../styles/creative-tools-panel.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === styleUrl)) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = styleUrl;
    document.head.append(link);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'ws-creative-dialog';
  dialog.setAttribute('aria-label', '创意工具');
  const header = document.createElement('header');
  const title = document.createElement('h2'); title.textContent = '创意工具';
  const closeButton = document.createElement('button');
  closeButton.type = 'button'; closeButton.textContent = '关闭';
  header.append(title, closeButton);
  const tabs = document.createElement('nav'); tabs.setAttribute('aria-label', '创意工具类型');
  const buttons = new Map();
  for (const [kind, label] of [['text', '文字图纸'], ['pattern', '识别图纸图片']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { void open(kind); });
    buttons.set(kind, button); tabs.append(button);
  }
  const message = document.createElement('p'); message.className = 'ws-creative-status';
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const mountPoint = document.createElement('div'); mountPoint.className = 'ws-creative-content';
  dialog.append(header, tabs, message, mountPoint); document.body.append(dialog);
  let instance = null, revision = 0, confirming = false, destroyed = false;
  function cleanup() {
    revision += 1;
    instance?.destroy(); instance = null; mountPoint.replaceChildren();
  }
  function close() { if (confirming) return; if (dialog.open) dialog.close(); else cleanup(); }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', cleanup);
  dialog.addEventListener('cancel', event => { if (confirming) event.preventDefault(); });
  function paletteSnapshot() {
    const palette = getPalette();
    if (!Array.isArray(palette) || !palette.length || palette.some(color => !color?.code || !/^#[0-9a-f]{6}$/i.test(color.hex))) {
      throw new Error('当前色卡不可用，请先选择有效色卡');
    }
    return palette.map(({ code, hex, name }) => ({ code, hex, name: name || code }));
  }
  async function open(kind = 'text') {
    if (destroyed || confirming) return;
    kind = kind === 'pattern' ? 'pattern' : 'text';
    if (kind === 'text' && onOpenText) {
      close(); onOpenText(); return;
    }
    cleanup();
    const request = revision;
    if (!dialog.open) dialog.showModal();
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === kind));
    message.textContent = '正在加载创意工具…';
    try {
      const palette = paletteSnapshot();
      const signature = JSON.stringify(palette);
      const api = await loadBundle(kind === 'pattern' ? 'bead-pattern-importer.js' : 'bead-text-tool.js', kind === 'pattern' ? 'BeadPattern' : 'BeadTextUI');
      if (destroyed || request !== revision || !dialog.open) return;
      instance = api.mount(mountPoint, {
        palette, widthBeads: 40, sampleAlgo: 'ring', whiteBalance: 'auto',
        onConfirm(result) {
          if (confirming || request !== revision || !dialog.open) return;
          confirming = true; dialog.setAttribute('aria-busy', 'true');
          closeButton.disabled = true;
          for (const button of buttons.values()) button.disabled = true;
          message.textContent = '正在将图纸填入画布…';
          void Promise.resolve().then(() => {
            if (signature !== JSON.stringify(paletteSnapshot())) throw new Error('色卡已改变，请关闭后重新打开创意工具');
            return onConfirm(result, kind);
          }).then(() => {
            confirming = false; close();
          }).catch(error => {
            message.textContent = error?.message || '填入画布失败，请检查图纸后重试';
          }).finally(() => {
            confirming = false; dialog.removeAttribute('aria-busy'); closeButton.disabled = false;
            for (const button of buttons.values()) button.disabled = false;
          });
        },
      });
      message.textContent = kind === 'pattern' ? '请上传图纸并核对待确认格子，再确认填入画布。' : '输入文字并确认预览后，填入画布。中文请选择中文像素字体。';
    } catch (error) {
      if (request === revision && !destroyed) message.textContent = error?.message || '创意工具无法打开，请重试';
    }
  }
  return { open, close, destroy() { destroyed = true; cleanup(); dialog.remove(); } };
}
