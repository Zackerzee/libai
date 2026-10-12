import { paletteIdOf } from './palette-identity.js';

export const emptySmartDiagnostics = () => ({ isolated: [], tiny: [], edge: [] });

// Only the opt-in publication path uses this transport. No editable grid copy is retained.
export async function encodeSmartDiagnostics(grid, isCurrent, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))) {
  const lengths = grid.map(row => row?.length || 0);
  const indices = new Int32Array(lengths.reduce((sum, length) => sum + length, 0));
  const colors = [], byIdentity = new Map();
  let offset = 0;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < lengths[y]; x++) {
      const cell = grid[y][x], id = paletteIdOf(cell);
      if (!id) indices[offset++] = -1;
      else {
        // Labels may differ for legacy cells sharing an identity: preserve both.
        const key = JSON.stringify([id, cell.code]);
        if (!byIdentity.has(key)) {
          byIdentity.set(key, colors.length);
          colors.push({ paletteId: id, code: cell.code });
        }
        indices[offset++] = byIdentity.get(key);
      }
      if (offset % 2048 === 0) { await yieldTask(); if (!isCurrent()) return null; }
    }
  }
  return isCurrent() ? { lengths, indices, colors } : null;
}

export function decodeSmartDiagnostics({ lengths, indices, colors }) {
  let offset = 0;
  return lengths.map(length => Array.from({ length }, () => {
    const index = indices[offset++];
    return index < 0 ? null : colors[index];
  }));
}

export function createSmartDiagnostics({ createWorker = () => new Worker(new URL('./smart-tolerance-diagnostics.worker.mjs', import.meta.url), { type: 'module' }), onResult, onError = () => {} } = {}) {
  let token = 0, worker = null;
  const cancel = () => { token++; worker?.terminate(); worker = null; };
  const request = async ({ grid, palette, tinyMaxSize, revision, isCurrent }) => {
    cancel();
    const requestToken = token;
    const current = () => token === requestToken && isCurrent();
    try {
      // Start after publication/paint has returned, not inside the commit task.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!current()) return;
      const encoded = await encodeSmartDiagnostics(grid, current);
      if (!encoded || !current()) return;
      const taskWorker = createWorker(); worker = taskWorker;
      taskWorker.onmessage = ({ data }) => {
        if (!current()) return;
        taskWorker.terminate(); worker = null;
        if (data.error) onError(new Error(data.error));
        else onResult({ revision, tinyMaxSize, value: data.value });
      };
      taskWorker.onerror = error => { if (current()) { cancel(); onError(error); } };
      taskWorker.postMessage({ encoded, palette, tinyMaxSize }, [encoded.indices.buffer]);
    } catch (error) { if (current()) { cancel(); onError(error); } }
  };
  return { request, cancel };
}
