# Local fusion validation

Reproduce optimized artifacts: `node tools/local-fusion-validation.mjs --out=docs/local-fusion-validation-optimized --compare=docs/local-fusion-validation` from repository root. For isolated phases use `--quality-only` followed by `--performance-only` with the same output directory. Preserve the original comparison directory.

Actual commands were `node tools/local-fusion-validation.mjs --out=docs/local-fusion-validation-optimized --quality-only` and `node tools/local-fusion-validation.mjs --out=docs/local-fusion-validation-optimized --performance-only --compare=docs/local-fusion-validation`; both exited 0. `before-after-grid-comparison.json` confirms all 48 full-grid hashes match original artifacts. Quality runtimes are single observations, not P50.

See manifest.json for provenance and settings, quality.json for 48 comparisons, performance.json for 45 sequential timed runs, and contact-sheet.png for source/result review.

- No verified real photograph or anime source found in inspected fixtures. real-failures metadata explicitly says generated-photographic; excluded.
- Cell differences and palette legality are objective comparisons, not semantic or global visual-quality scores.
- Native canvas decode is not verified browser ICC parity.
- Synchronous Node runtimes measure main-thread blocking compute, not browser UI responsiveness.
- RSS values are before/after process samples, not true peak, and include retained memory from earlier runs.
- Three sequential repetitions, no warmup, fixed ordering; P95 is the maximum of three samples.

Auto selected fusion for 0/6 input/size cases. A fallback equal to V2.5 is not an improvement claim.

| Long edge | Path | P50 ms | P95 ms (n=3 maximum) |
| --- | --- | ---: | ---: |
| 52 | v25 | 2557.6 | 2718.9 |
| 52 | auto | 2391.2 | 2398.9 |
| 52 | fusion-pindou-dominant | 2419.4 | 2427.0 |
| 78 | v25 | 2568.9 | 2808.8 |
| 78 | auto | 2803.3 | 2894.6 |
| 78 | fusion-pindou-dominant | 2556.3 | 3325.6 |
| 104 | v25 | 3080.9 | 3373.5 |
| 104 | auto | 2918.2 | 2928.1 |
| 104 | fusion-pindou-dominant | 2707.8 | 2927.1 |
| 250 | v25 | 4375.2 | 4437.9 |
| 250 | auto | 4593.0 | 4654.4 |
| 250 | fusion-pindou-dominant | 4272.2 | 4456.3 |
| 500 | v25 | 10499.5 | 11188.9 |
| 500 | auto | 11824.1 | 12219.6 |
| 500 | fusion-pindou-dominant | 9441.2 | 9705.2 |
