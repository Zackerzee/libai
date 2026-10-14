# Local fusion validation

Reproduce: `node tools/local-fusion-validation.mjs` from repository root.

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
| 52 | v25 | 3465.2 | 3772.9 |
| 52 | auto | 3166.1 | 3414.8 |
| 52 | fusion-pindou-dominant | 3352.2 | 3539.4 |
| 78 | v25 | 4343.5 | 4358.5 |
| 78 | auto | 4442.4 | 4547.4 |
| 78 | fusion-pindou-dominant | 3686.8 | 3840.4 |
| 104 | v25 | 3917.9 | 4353.6 |
| 104 | auto | 3580.2 | 4064.4 |
| 104 | fusion-pindou-dominant | 3046.9 | 3379.5 |
| 250 | v25 | 8763.6 | 9901.9 |
| 250 | auto | 9641.9 | 11564.2 |
| 250 | fusion-pindou-dominant | 6043.8 | 7304.0 |
| 500 | v25 | 39116.4 | 42021.8 |
| 500 | auto | 41479.2 | 52779.2 |
| 500 | fusion-pindou-dominant | 29355.3 | 31479.5 |
