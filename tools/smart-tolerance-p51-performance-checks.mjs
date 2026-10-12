export function classifyUiPerformance(records) {
  const values = records.flatMap(record => Object.values(record.phases).map(phase => phase.longestTaskMs));
  const max = Math.max(0, ...values);
  return { gate: max > 150 ? 'FAIL' : max >= 100 ? 'BORDERLINE' : 'PASS', max,
    coldSamples: records.filter(record => record.mode === 'cold').length,
    warmSamples: records.filter(record => record.mode === 'warm').length };
}

export function assertPreviewAndPublication(record) {
  if (!record.previewExact || !record.previewSideEffectsAbsent || !record.undoExact || !record.redoExact)
    throw new Error('Preview/history equivalence failed');
  if (record.phases.apply.renders.length !== 1) throw new Error('Expected exactly one final Apply render');
}
