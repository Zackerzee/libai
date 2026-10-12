/** A real event-loop yield, rather than a microtask-only promise boundary. */
export const yieldSmartToleranceTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** Own one output matrix. Never expose a partially materialized result. */
export async function materializeToleranceChunks({ height, width, copyCell, isCurrent = () => true,
  yieldTask = yieldSmartToleranceTask, chunkCells = 8192, onChunk, onYield } = {}) {
  if (!Number.isInteger(chunkCells) || chunkCells < 1) throw new RangeError('chunkCells must be a positive integer');
  const size = height * width;
  const pause = async () => {
    onYield?.('before');
    await yieldTask();
    onYield?.('after');
    return isCurrent();
  };
  if (!isCurrent()) return null;
  // Burst requests must be able to supersede one another before allocating grids.
  if (size >= chunkCells && !await pause()) return null;
  const grid = Array.from({ length: height }, () => new Array(width));
  let cursor = 0;
  while (cursor < size) {
    if (!isCurrent()) return null;
    const started = performance.now(), first = cursor, end = Math.min(size, cursor + chunkCells);
    for (; cursor < end; cursor++) {
      const y = Math.floor(cursor / width), x = cursor % width;
      grid[y][x] = copyCell(y, x);
      // Rich metadata can make a fixed number of cells unexpectedly expensive.
      if ((cursor - first + 1) % 256 === 0 && performance.now() - started >= 8) { cursor++; break; }
    }
    onChunk?.({ cellCount: cursor - first, ms: performance.now() - started });
    if (cursor < size && !await pause()) return null;
  }
  return isCurrent() ? grid : null;
}
