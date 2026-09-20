# Professional Palette Engine

## Scope

Stage 3 adds a deterministic, optional palette engine to the existing static generator. It preserves all existing palette entries, source codes, grid shape, exports, and the legacy RGB matcher as a fallback.

## Current implementation

- Color profile: sRGB -> linear RGB -> XYZ (D65) -> CIE Lab.
- Matching: CIEDE2000 with a deterministic candidate shortlist and stable tie-breaking.
- Context correction: warm skin-tone candidates are protected from accidental green/cyan substitutions; callers can mark `region`, `importance`, `protected`, and `isBackground`.
- Cache: bounded per-palette cache with quantized RGB/context keys.
- Palette reducer: graph-like nearest-color merges, lowest-frequency colors first, with protected codes excluded.
- Statistics: total beads, used color count, and ranked per-color counts.
- Feature flag: set `localStorage.libms:palette-engine` to `off` to disable the enhancement and use the original RGB matcher.
- No new runtime dependency and no API key or image upload is involved.

## Integration and fallback

The browser module is loaded before the existing app. The existing `nearestColor` call sites remain intact. If the module is unavailable or throws, the original matcher is used and generation continues.

This stage does not claim full face landmark protection: the current static project has no face-landmark dependency. Skin protection is a conservative color heuristic and is intentionally isolated so MediaPipe can be added in a later stage.

## Benchmark

Run:

```sh
node smart-preprocessing/benchmark.mjs
```

The current fixed benchmark result for 291 colors and 104x104 cells is approximately 170.61 ms on the development machine, with an 88.17% cache hit rate. Compare the output with the legacy path before enabling a new release. The target is no more than 20% additional generation time in standard mode.

## Rollback

In the browser console:

```js
localStorage.setItem("libms:palette-engine", "off");
location.reload();
```

Remove the optional module script only in a code rollback; no database migration is required.
