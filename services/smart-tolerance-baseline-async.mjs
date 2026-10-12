import { cloneToleranceSnapshotAsync, createToleranceBuildScheduler } from './smart-tolerance-build-scheduler.mjs';

/** Same ordinary-array protection evidence convention as freezeToleranceBaseline.
 * The caller must keep its input stable until completion; output is owned/frozen. */
export async function freezeToleranceBaselineAsync(value, options = {}) {
  const scheduler = options.scheduler ?? createToleranceBuildScheduler(options);
  const ownScheduler = !options.scheduler;
  try {
    const result = await cloneToleranceSnapshotAsync(value, { scheduler, stage: 'baseline snapshot' });
    if (!result || !scheduler.current()) {
      if (ownScheduler) scheduler.finish('cancelled');
      return null;
    }
    const seen = new WeakSet(), pending = [result];
    let objects = 0;
    while (pending.length) {
      const object = pending.pop();
      if (!object || typeof object !== 'object' || seen.has(object)) continue;
      seen.add(object);
      let iterations = 0;
      for (const key of Object.keys(object)) {
        if (ArrayBuffer.isView(object[key])) {
          const view = object[key], array = [];
          // DataView is not iterable, matching Array.from(DataView) => [].
          for (let i = 0; i < (view.length ?? 0); i++) {
            array.push(view[i]);
            if ((i & 255) === 255 && !await scheduler.checkpoint('baseline freeze', 256)) {
              if (ownScheduler) scheduler.finish('cancelled');
              return null;
            }
          }
          object[key] = array;
        }
        if (object[key] && typeof object[key] === 'object') pending.push(object[key]);
        if (++iterations % 256 === 0 && !await scheduler.checkpoint('baseline freeze', 256)) {
          if (ownScheduler) scheduler.finish('cancelled');
          return null;
        }
      }
      Object.freeze(object);
      if (++objects % 128 === 0 && !await scheduler.checkpoint('baseline freeze', 128)) {
        if (ownScheduler) scheduler.finish('cancelled');
        return null;
      }
    }
    if (!scheduler.current()) {
      if (ownScheduler) scheduler.finish('cancelled');
      return null;
    }
    if (ownScheduler) scheduler.finish('ready');
    return result;
  } catch (error) {
    if (ownScheduler) scheduler.finish('error');
    throw error;
  }
}
