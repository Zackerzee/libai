# Local structural routing calibration — 2026-10-14

Experimental local runner only. No production default, UI, API, deploy or left-panel changes. No OCR or text recognition. Shared source classifier remains unchanged: actual brand logo still reports `illustration`, confidence 1. A separate local structural policy selects dominant sampling.

Reproduce real comparisons: `node tools/local-fusion-calibration.mjs`. The tool uses bundled native `@napi-rs/canvas`; the festive sign remains at the user Downloads path recorded in manifest.json. Source file hashes, dimensions, actual 19 classifier signals and original routing are retained in manifest.json. Output is 104 long-edge with original aspect ratio, MARD 291-color palette, maxColors 16, no crop and no background removal. `contact-sheet.png` contains the source plus four output columns: V2.5, frozen previous auto, calibrated auto, manual dominant. The previous-auto definition uses the pre-calibration confidence selector with the current unchanged production pipeline; it is not a claim to rerun a historical binary.

Eight structural checks must all pass: 2–12 colors cover 95%; large constant-region ratio ≥ .70; local variety ≤ .12; texture ≤ .03; structure thickness ≥ .80; shading coverage ≤ .65; magnification trace exactly zero; edge density ≥ .005. Original high-confidence pixel/logo gate remains first and unchanged. Missing signals fail the check. Score is fraction of structural checks passed, explicitly not probability or semantic confidence.

The initial five structural checks admitted two generated failure fixtures (`rf-anime-hl`, `rf-small-sep`). Their shading coverage was .805/.808, versus logo .572. Adding the limited-shading check rejects them. E/H magnified logo fixtures are left under their existing confidence gate. These are empirical calibration choices from this small corpus, not evidence of universal detection accuracy.

| Real input | Previous auto | Calibrated auto | Code/RGB differences vs V2.5 | Colors V2.5 → calibrated |
| --- | --- | --- | ---: | ---: |
| Brand logo | baseline | dominant | 2305 / 10816 | 16 → 11 |
| Festive sign | baseline | baseline | 0 / 7176 | 16 → 16 |
| Fantasy illustration | baseline | baseline | 0 / 7176 | 16 → 16 |

All 12 real comparison outputs preserve requested dimensions and input bytes, with zero code/RGB colors outside the actual palette. Brand calibrated auto is full-grid identical to manual dominant. Sign and fantasy calibrated auto remain full-grid identical to V2.5 and previous auto. Visual inspection of the sheet shows the selected logo keeps four ring shapes with fewer color variations; no semantic visual-quality score was measured. Manual dominant changes the sign texture and fantasy detail, supporting conservative fallback for those inputs.

## Identity defect found during validation

Code/RGB legality is not equivalent to palette identity consistency. Existing V2.5 outputs contain stale paletteId fields after color changes: example `{code:'F3', rgb:[247,73,65], paletteId:'mard:F2'}` should identify `mard:F3`. Baseline identity mismatches: logo 110, sign 1193, fantasy 2028. Calibrated logo has 0; unchanged sign/fantasy retain 1193/2028. Manual dominant sign has 6 and fantasy 2242. Counts and concrete examples are in metrics.json. This existing defect is outside the sampling-only calibration scope and was reported for separate repair. Do not infer export/identity readiness from code/RGB legality.

## Observed validation

- `node --test tests/local-fusion-calibration.test.mjs tests/local-fusion-routing.test.mjs tests/local-fusion-engine.test.mjs`: 17/17 passed.
- `node --test tests/local-fusion-budget-parity.test.mjs tests/local-fusion-job.test.mjs tests/source-classifier.test.mjs`: 30/30 passed.
- All 25 existing routing fixtures retain previous-auto strategy and exact complete grids at 7×7. Native pixel gate remains unchanged. corpus.json records decisions, signals and provenance. These are synthetic/generated fixtures, including the noisy-photo classes; they are not verified real photographs.
- Real decoded logo at 13×13 verifies deterministic output, source immutability, dimensions and complete code/RGB/paletteId legality; real sign/fantasy at 13×13 verify exact fallback. Existing native sampler tests additionally cover 1×1, smaller and enlarged grids, alpha and raw adapter parity.

Remaining limits: one real raster logo, one festive sign and one fantasy illustration do not establish broad logo/photo/anime generalization. No real photographic/anime corpus was added. No OCR, thin-text enhancement, browser ICC parity, UI responsiveness, formal editor/export end-to-end validation or deployment was performed. Test decode depends on the local bundled canvas path and sign source path. Thresholds need diverse real inputs before any production switch or left-panel removal.
