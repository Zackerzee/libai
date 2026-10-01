export function createGenerationService(bridge, store) {
  return {
    async generate(options = {}) {
      store.setState({ status: { generating: true } });
      try {
        bridge.setProductionOptions?.({
          engine: options.engine ?? store.getState().generation.engine ?? "v2.5",
          generationOptions: store.getState().generation,
        });
        // 尺寸**不是**这个适配层的职责。
        //
        // 生成尺寸的唯一自由度是「长边格数 + 有效裁剪比例」，由 bridge 内部派生
        // （app.js → resolveGenerationDimensions）。`store.canvas.width/height` 是
        // **生成结果的回写命名空间**，不是入参：拿它当 width/height 传下去，等于把
        // 上一版图纸的尺寸当成下一版的输入，会直接把工作台顶栏刚算好的长边冲掉。
        // B0 实测：顶栏读数 100×75（800÷8 的像素倍数识别结果），出图却是 104×78
        // —— 因为挂载时写进 canvas 的 104 被当成显式尺寸又塞了回去。
        //
        // 所以只有调用方**显式**给了尺寸才转发，否则一律让 bridge 自己派生。
        const size = {};
        if (options.width != null) size.width = options.width;
        if (options.height != null) size.height = options.height;
        const result = await bridge.generate({
          ...size,
          maxColors: options.maxColors ?? store.getState().palette.maxColors,
          overwriteApproved: Boolean(options.overwriteApproved),
        });
        if (!result) throw new Error("现有生成链路未返回结果");
        store.setState({
          // 纯回写：canvas.* 记录「这一版图纸实际多少格」，永远不回头当生成入参。
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
