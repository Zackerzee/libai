export function createPaletteService(bridge, store) {
  return {
    getPalettes: () => bridge.getPalettes(),
    getActivePalette: () => bridge.getActivePalette(),
    getPaletteColors: () => bridge.getActivePalette().colors,
    getColorByCode: (code) => bridge.getActivePalette().colors.find((color) => color.code === code) || null,
    getColorUsage: (code) => store.getState().stats.colors.find((color) => color.code === code)?.count || 0,
    setMaxColors(value) {
      const maxColors = Math.max(0, Math.min(bridge.getActivePalette().colors.length, Number(value) || 0));
      bridge.setMaxColors(maxColors);
      store.setState({ palette: { maxColors }, status: { dirty: true } });
      return maxColors;
    },
    setActivePalette(brand, size) {
      const active = bridge.setActivePalette(brand, size);
      store.setState({ palette: { id: active.key }, status: { dirty: true } });
      return active;
    },
  };
}
