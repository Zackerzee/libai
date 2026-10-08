export function mirroredTitle(name, mode) {
  const title = name || '未命名作品';
  return mode === 'none' || !mode ? title : `${title.replace(/·?\s*镜像$/, '').trim()} · 镜像`;
}

export function mirroredPreviewGrid(grid, mode) {
  if (mode === 'horizontal') return grid.map(row => [...row].reverse());
  if (mode === 'vertical') return [...grid].reverse().map(row => [...row]);
  return grid;
}
