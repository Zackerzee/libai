export function createGenerationService(bridge, store) {
  return {
    async generate(options = {}) {
      store.setState({ status: { generating: true } });
      try {
        bridge.setProductionOptions?.({
          engine: options.engine ?? store.getState().generation.engine ?? "v2.5",
          generationOptions: store.getState().generation,
        });
        const result = await bridge.generate({
          width: options.width ?? store.getState().canvas.width,
          height: options.height ?? store.getState().canvas.height,
          maxColors: options.maxColors ?? store.getState().palette.maxColors,
          overwriteApproved: Boolean(options.overwriteApproved),
        });
        if (!result) throw new Error("现有生成链路未返回结果");
        store.setState({
          canvas: { width: result.width, height: result.height },
          palette: { id: result.paletteKey, usedColors: result.usedColors },
          stats: { totalBeads: result.totalBeads, usedColors: result.usedColors, colors: result.colors },
          status: { generating: false, hasSource: Boolean(result.sourceUrl), hasPattern: true, dirty: false },
        });
        return result;
      } catch (error) {
        store.setState({ status: { generating: false } });
        throw error;
      }
    },
    getResult: () => bridge.getResult(),
  };
}
