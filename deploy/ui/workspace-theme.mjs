import { raw } from './workspace-icons.mjs';
export const THEME_MODES = ['light', 'dark'];
export const resolveTheme = (mode, dark) => mode === 'system' ? (dark ? 'dark' : 'light') : mode;
export function attachWorkspaceTheme(top, { root = document.documentElement, storage = localStorage, media = matchMedia('(prefers-color-scheme: dark)') } = {}) {
  const key = 'libms-workspace-theme';
  let mode = 'light';
  try { const saved = storage.getItem(key); if (THEME_MODES.includes(saved)) mode = saved; else if (saved === 'system') mode = resolveTheme(saved, media.matches); } catch {}
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'ws-theme-cycle'; button.className = 'ws-button';
  const labels = { light: '明亮', dark: '黑暗', system: '跟随系统' };
  const icons = { light: 'sun', dark: 'moon', system: 'auto' };
  const apply = () => {
    root.classList.add('ws-theme-no-transition');
    root.dataset.theme = resolveTheme(mode, media.matches);
    root.style.colorScheme = root.dataset.theme;
    button.innerHTML = raw(icons[mode]);
    button.title = button.ariaLabel = '主题：' + labels[mode] + '；点击切换为' + labels[THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]];
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('ws-theme-no-transition')));
  };
  button.addEventListener('click', () => { mode = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]; try { storage.setItem(key, mode); } catch {} apply(); });
  const onSystem = () => { if (mode === 'system') apply(); };
  media.addEventListener('change', onSystem);
  top.append(button); apply();
  return () => { media.removeEventListener('change', onSystem); button.remove(); };
}
