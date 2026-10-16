import { raw } from './workspace-icons.mjs';
import { attachWorkspaceTheme } from './workspace-theme.mjs';
// Navigation only: the existing controls remain the single settings owner.
export function attachWorkspaceV3Layout({ top, controls, navigateSize }) {
  const shortcuts = document.createElement('div');
  shortcuts.className = 'ws-v3-shortcuts';
  for (const [name, label, action] of [['ruler', '尺寸设置', navigateSize], ['image', '底图素材（预留：图片、文字与矢量图形）', null]]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ws-button'; button.title = label; button.ariaLabel = label;
    button.id = name === 'ruler' ? 'ws-toolbar-size' : 'ws-toolbar-overlay';
    button.innerHTML = raw(name);
    if (action) button.addEventListener('click', action);
    else button.disabled = true;
    shortcuts.append(button);
  }
  controls.querySelector('#gridEditorToolbar .sl-toolbar-drawing').prepend(shortcuts);
  return attachWorkspaceTheme(top);
}
