# Professional Pattern Optimizer

Stage 4 adds a deterministic, conservative optimizer after palette mapping. It preserves matrix dimensions, existing palette entries, export formats, and the legacy generation path.

## Implemented

- 4-neighbor connected-component analysis
- single/tiny component detection
- single-hole filling when the surrounding color is unambiguous
- checkerboard detection for close colors
- background-aware edit hook
- candidate-based scoring with automatic no-change fallback
- edit coordinate list for future undo/version history
- browser feature flag: `localStorage.setItem("libms:pattern-optimizer", "off")`

The optimizer does not claim face landmarks, OCR, or semantic segmentation. Those protections are not silently simulated; the API accepts future protected/background masks so later stages can add them without changing the optimizer contract.

## Quality policy

The original matrix is always a candidate. A generated candidate is accepted only when its score improves after penalties for isolated components, checkerboard noise, holes, and excessive edits. If it does not improve, the original matrix is returned unchanged.

## Benchmark

```sh
node smart-preprocessing/optimizer-benchmark.mjs
```

The fixed benchmark uses a 104x104 matrix and reports candidate count, elapsed time, and before/after score.

## Rollback

```js
localStorage.setItem("libms:pattern-optimizer", "off");
location.reload();
```

No database migration or runtime dependency is required.
