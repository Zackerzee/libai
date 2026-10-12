/** Optional opt-in timing only. No global cache, mutable algorithm data or output. */
export function createToleranceProfiler(callback) {
  if (typeof callback !== 'function') return null;
  const stages = {}, exclusiveStages = {}, calls = {}, stack = [];
  return {
    measure(name, operation) {
      const start = performance.now();
      const frame = { childMs: 0 }; stack.push(frame);
      try { return operation(); }
      finally {
        const elapsed = performance.now() - start; stack.pop();
        if (stack.length) stack.at(-1).childMs += elapsed;
        stages[name] = (stages[name] ?? 0) + elapsed;
        exclusiveStages[name] = (exclusiveStages[name] ?? 0) + elapsed - frame.childMs;
        calls[name] = (calls[name] ?? 0) + 1;
      }
    },
    finish(metadata) { callback({ stages: { ...stages }, exclusiveStages: { ...exclusiveStages }, calls: { ...calls }, ...metadata, uninstrumentedGapMs: metadata.totalMs - Object.values(exclusiveStages).reduce((sum,ms)=>sum+ms,0) }); },
  };
}
