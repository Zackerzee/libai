const FORMATS = ["preview-png", "pattern-png", "pattern-jpg", "usage-csv", "project-json", "boards-zip"];

// 每个格式对应的桥接层方法。能力探测与执行共用同一张表，避免「按钮能点但导出抛 TypeError」。
const REQUIRED_METHOD = {
  "preview-png": "downloadPreview",
  "pattern-png": "downloadPattern",
  "pattern-jpg": "downloadPatternJpg",
  "usage-csv": "downloadUsageCsv",
  "project-json": "downloadProjectJson",
  "boards-zip": "downloadPattern",
};

export function createExportService(bridge, store) {
  return {
    getFormats: () => [...FORMATS],
    isAvailable(type) {
      if (!FORMATS.includes(type)) return false;
      if (!store.getState().status.hasPattern) return false;
      const method = REQUIRED_METHOD[type];
      return !method || typeof bridge[method] === "function";
    },
    async export(type) {
      const state = store.getState();
      if (!state.status.hasPattern) throw new Error("请先生成图纸");
      if (!FORMATS.includes(type) || !this.isAvailable(type)) throw new Error(`当前不支持 ${type}`);
      if (type === "preview-png") return bridge.downloadPreview();
      if (type === "pattern-png") return bridge.downloadPattern({ split: false, settings: state.exportSettings.pattern });
      if (type === "pattern-jpg") return bridge.downloadPatternJpg(state.exportSettings.pattern);
      if (type === "usage-csv") return bridge.downloadUsageCsv();
      if (type === "project-json") return bridge.downloadProjectJson();
      return bridge.downloadPattern({ split: true });
    },
  };
}
