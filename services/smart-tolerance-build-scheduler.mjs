/** Cooperative build infrastructure; no algorithm, store or editable grid state. */
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get;
const typedConstructors = Object.fromEntries(['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Float16Array']
  .filter(name => typeof globalThis[name] === 'function').map(name => [name, globalThis[name]]));
const viewSlot = (item, prototype, name) => Object.getOwnPropertyDescriptor(prototype, name).get.call(item);
export function yieldToleranceBuildTask() {
  return new Promise(resolve => {
    if (typeof MessageChannel === 'function') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
      channel.port2.postMessage(null);
    } else setTimeout(resolve, 0);
  });
}

export function createToleranceBuildScheduler({ signal, isCurrent = () => true, context = {},
  yieldTask = yieldToleranceBuildTask, timeBudgetMs = 6, onProgress, onProfile, onState } = {}) {
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0) throw new RangeError('timeBudgetMs must be positive');
  const started = performance.now(), chunks = [], stages = {};
  let segmentStart = started, phaseStart = started, phase = 'initialization', phaseIterations = 0;
  let yieldCount = 0, cpuMs = 0, longestSyncTaskMs = 0, lastProgress = started, nativeFallbackCount = 0, finished = false;
  const current = () => !signal?.aborted && isCurrent(context);
  const closePhase = now => {
    const ms = now - phaseStart;
    const entry = stages[phase] ?? (stages[phase] = { cpuMs: 0, iterations: 0 });
    entry.cpuMs += ms; entry.iterations += phaseIterations;
    chunks.push({ stage: phase, ms, iterations: phaseIterations });
    phaseIterations = 0; phaseStart = now;
  };
  const closeSegment = now => {
    const ms = now - segmentStart;
    cpuMs += ms; longestSyncTaskMs = Math.max(longestSyncTaskMs, ms);
  };
  onState?.({ status: 'building', context });
  return {
    current,
    async checkpoint(stage, iterations = 1, force = false) {
      if (!current()) return false;
      let now = performance.now();
      if (stage !== phase) { closePhase(now); phase = stage; }
      phaseIterations += iterations;
      if (!force && now - segmentStart < timeBudgetMs) return true;
      if (onProgress && now - lastProgress >= 75) { onProgress({ stage: phase, context }); lastProgress = now; }
      now = performance.now(); closePhase(now); closeSegment(now); yieldCount++;
      await yieldTask();
      segmentStart = phaseStart = performance.now();
      return current();
    },
    nativeFallback() { nativeFallbackCount++; },
    finish(status = 'ready') {
      if (finished) return;
      finished = true;
      const now = performance.now(); closePhase(now); closeSegment(now);
      const report = { mode: 'async', wallClockMs: now - started, cpuMs, longestSyncTaskMs,
        yieldCount, chunks, stages, nativeFallbackCount, cancelled: status === 'cancelled', context };
      onState?.({ status, context }); onProfile?.(report);
      return report;
    },
  };
}

/** Inputs must remain stable until this promise settles. Session callers supply
 * immutable baselines. Ordinary data graphs preserve aliases, cycles and sparse
 * slots; exotic/accessor graphs use native structuredClone, never lossy copying.
 * That compatibility fallback is intentionally reported as an indivisible task. */
export async function cloneToleranceSnapshotAsync(value, options = {}) {
  const ownScheduler = !options.scheduler;
  const scheduler = options.scheduler ?? createToleranceBuildScheduler(options);
  const stage = options.stage ?? 'snapshot';
  const seen = new WeakMap(), queue = [];
  let exotic = false;
  const copy = item => {
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'function' || typeof item === 'symbol') exotic = true;
      return item;
    }
    if (seen.has(item)) return seen.get(item);
    if (item instanceof ArrayBuffer || typeof SharedArrayBuffer === 'function' && item instanceof SharedArrayBuffer) {
      const result = structuredClone(item); seen.set(item, result); return result;
    }
    if (ArrayBuffer.isView(item)) {
      const tag = typedTag.call(item), prototype = tag ? typedPrototype : DataView.prototype;
      const buffer = copy(viewSlot(item, prototype, 'buffer'));
      if (exotic) return null;
      const offset = viewSlot(item, prototype, 'byteOffset');
      const result = tag ? new typedConstructors[tag](buffer, offset, viewSlot(item, prototype, 'length'))
        : new DataView(buffer, offset, viewSlot(item, prototype, 'byteLength'));
      seen.set(item, result); return result;
    }
    const proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== Array.prototype) { exotic = true; return null; }
    const result = Array.isArray(item) ? new Array(item.length) : {};
    seen.set(item, result); queue.push([item, result]); return result;
  };
  try {
    if (!await scheduler.checkpoint(stage, 0, true)) { if (ownScheduler) scheduler.finish('cancelled'); return null; }
    const result = copy(value);
    let properties = 0;
    for (let cursor = 0; cursor < queue.length && !exotic; cursor++) {
      const [source, target] = queue[cursor];
      for (const key of Object.keys(source)) {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!Object.hasOwn(descriptor, 'value')) { exotic = true; break; }
        Object.defineProperty(target, key, { value: copy(descriptor.value), enumerable: true, writable: true, configurable: true });
        if (exotic) break;
        if (++properties % 256 === 0 && !await scheduler.checkpoint(stage, 256)) { if (ownScheduler) scheduler.finish('cancelled'); return null; }
      }
      if ((cursor & 127) === 127 && !await scheduler.checkpoint(stage, 128)) { if (ownScheduler) scheduler.finish('cancelled'); return null; }
    }
    let output = result;
    if (exotic) {
      if (!await scheduler.checkpoint(stage, 0, true)) { if (ownScheduler) scheduler.finish('cancelled'); return null; }
      scheduler.nativeFallback(); output = structuredClone(value);
    }
    if (!scheduler.current()) { if (ownScheduler) scheduler.finish('cancelled'); return null; }
    if (ownScheduler) scheduler.finish();
    return output;
  } catch (error) { if (ownScheduler) scheduler.finish('error'); throw error; }
}
