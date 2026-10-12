# Smart Color Tolerance opt-in production release

Production base: `baf7aea9b8a9be59bd002c030b80fd12ac783ba1`.
Verified source implementation: P6 `aca1b601cbe59840b86435daf54f3c6ecaac4dff`.
Cache version: `20261012-smart-tolerance-r48`.

This release ports scoped Smart Tolerance changes into the current production tree. It does not replace the production tree with the older development checkout, does not include P7 export performance changes, and preserves the upload/reference/original-image picking hotfixes.

## Behavior

- Default disabled. Manual strength 0–100 is not a Delta E unit or a calibrated recommendation.
- Immutable cleanup/refine-before-budget evidence; hierarchy/evaluation caches are derived, not another editable work grid.
- Unconfirmed preview never alters formal work. Explicit Apply publishes through existing editor history; Undo/Redo restores exact matrices and provenance.
- V2.5 only. No legacy/PW/BGS/editor-reduction integration.
- Applied exports use the formal grid without another color-budget pass; explicit mirror remains presentation-only.
- Applied JSON/drafts add full-cell indexed archives and compact provenance. Own Pixler sidecars preserve identity/nulls and are validated against binary indices/RGBA; external editors may ignore these sidecars.
- Existing production PNG/construction-sheet/PDF/poster/board layouts remain in place. Project-name override remains supported.

## Observed acceptance

- Pure algorithm/session/transport focused run: 190/190 passed.
- Scoped UI/publication/hotfix regression: 42/42 passed.
- Actual production-engine comparison against the production base: complete grids equal with Smart disabled and with capture-only enabled at 52/78/104/250/500. The 52 fixture also tests hard budget 3; other sizes test the default unlimited budget. No claimed large hard-budget performance improvement.
- Real headless Chrome against production base and ported release: all five sizes pass default-off identity, strengths 0/20/40/60/80/100/0 leave formal work untouched, non-increasing color counts, Apply equals preview, exact Undo/Redo, full-cell JSON save/reload and provenance. Actual workspace controls are used (Generate workarea, size control, checkbox, Apply, Undo, Redo).
- The four-color browser fixture may retain four global colors at all strengths under protection; this is not a guarantee that every source must reduce its global color count. Pure algorithm tests cover merging and protected conflicts.
- Reproducible browser harness: `tools/smart-tolerance-release.cjs`. Browser evidence was captured at `/tmp/sct-release-browser-all.json`.
- Source syntax/static build and final regression are checked before publication; actual final counts and release SHA are reported at handoff rather than inferred from historical P6 totals.

## Known limitations accepted for this opt-in release

- 500-size responsiveness is not universally certified; production rendering/inspection differs from the older isolated P6 baseline. No claim that all performance work is complete.
- Existing large hard-budget generation can be very slow (`applyBudgetPlan` searches a flattened grid per merged bead). This release does not alter that shared budget algorithm.
- Strength thresholds have not been calibrated into a real-image recommendation. No AI/best-strength recommendation is added.
- Unsupported external Pixler consumers can discard LIBMS metadata; full external brand identity preservation is not promised.

The user explicitly requested publication despite the documented outstanding large-size performance work. The default remains off.
