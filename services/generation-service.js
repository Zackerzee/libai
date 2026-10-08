export function createGenerationService(bridge, store) {
  return {
    async generate(options = {}) {
      // 新一轮生成开始：清掉上一次的提示与阶段文案，否则「已取消生成」会一直挂着，
      // 或者上一轮的「正在匹配真实色号…」会串到这一轮的进度里。
      store.setState({ status: { generating: true, notice: "", generationPhase: "" } });
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
        // 取消 / 过期 / 延后都不是失败：它们只是「这一轮没有图纸」。
        // 早期版本把取消咽成 false，这里就抛「现有生成链路未返回结果」——
        // 用户主动点取消，界面却报一条他没犯过的错（B3 §29 修掉）。
        // 现在 bridge.generate() 会对这三种情况抛**带 name 的**错误，
        // 所以这里只保留一个兜底：真的什么都没返回才报链路故障。
        if (!result) throw new Error("现有生成链路未返回结果");
        store.setState({
          // 纯回写：canvas.* 记录「这一版图纸实际多少格」，永远不回头当生成入参。
          canvas: { width: result.width, height: result.height },
          palette: { id: result.paletteKey, usedColors: result.usedColors },
          stats: { totalBeads: result.totalBeads, usedColors: result.usedColors, colors: result.colors },
          status: { generating: false, hasSource: Boolean(result.sourceUrl), hasPattern: true, dirty: false, notice: "", generationPhase: "" },
        });
        return result;
      } catch (error) {
        store.setState({ status: { generating: false, generationPhase: "" } });
        // 预期结局（取消 / 过期 / 延后）：把 generating 放下就结束，
        // **不抛**。抛出去会让调用方（自动生成 / 状态栏）把它渲染成「生成失败」。
        if (bridge.isExpectedGenerationOutcome?.(error)) return null;
        throw error;
      }
    },
    getResult: () => bridge.getResult(),
  };
}
