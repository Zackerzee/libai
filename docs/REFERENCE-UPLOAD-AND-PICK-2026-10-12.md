# Upload readiness, reference comparison and original-image picking

Production base: `bdbcfec9a81e45ccbd7f9b8d3bf4987db49cf63b` (Vercel `libai`, GitHub `Zackerzee/libai/main`). This isolated release does not include Smart Color Tolerance P6 or unrelated local changes.

## Behavior

- Reference is still hidden by default. Enabling it uses the already-uploaded image; a second upload is unnecessary. Separate reference uploads remain supported.
- Reference comparison is linked: 0% means full artwork, 100% means full reference with artwork/codes faded out. Intermediate opaque bead pixels use a linear crossfade: reference lower layer is opaque, upper artwork alpha is `1 - p`. Fading both layers would produce an incorrect p-squared reference contribution and washed-out background; the review caught this and it was corrected.
- Pattern/beads/blocks support explicit reference comparison. Hidden, unavailable, not-yet-decoded or grid-only references never hide artwork. The independent original-image view remains fully opaque. Guides/selection overlays remain separate; no matrix or export data changes.
- Shift + right-click samples the actual displayed reference/original image pixel, not the blended screenshot or quantized bead. It respects clipping, contain/cover, pan/zoom, reference offset and scale, ignores fully transparent pixels, then calls the existing active-palette matching/selection path. Normal right-click still picks the artwork bead. Tool, selection and artwork are unchanged. Stale image/grid results are rejected. Shift pointer-down suppresses native text-range selection.

## First upload

The real sequence was workspace dependency loading followed by serial safety-script/model preparation, then classification and generation. The first safety preparation dominated the measured delay.

On an intentional upload gesture only, the existing four script assets are preloaded in parallel while the file chooser is open, with the same CORS mode as execution. Workspace dependency promises are shared; the workspace is not mounted during the picker. Model execution order, thresholds, timeouts, existing failure semantics, and the awaited safety check before publishing/generating the source remain unchanged. No homepage background warmup and no image transmission to external services were added. The existing progress spinner is shown during local checking and cleared on completion/failure.

## Evidence

- `node --test tests/*.test.mjs`: **27/27 passed**, 0 fail/skip. Default toggle3, linked actual-renderer opacity15, pixel geometry/shortcut3, upload cold/warm/retry/safety6.
- Source syntax checks, `npm run check`, production static build and `git diff --check` passed.
- Real headless Chrome against two local copies with the exact Vercel CSP, viewport1440×1000, fresh browser contexts and a64×64 two-color image. A reproducible **3000ms file-selection interval** is part of this fixture, not a claimed user average.
- Final comparison: old selection-to-generated-grid **3692ms**, new **627ms**; chooser response **32.4/46.6ms**. Old first model preparation **2991.9ms**; new **2690.1ms**, overlapped with the chooser. Both actually loaded the model, and both classified the image. The warm model lookup had no measurable wait in the final run (0ms; an earlier observation was0.1ms). These are single controlled observations, not P50/P95 or an all-network speed guarantee. Prior exploratory new measurements ranged ~0.64–4.64seconds depending on CDN response; weak networks can still take longer. No artificial shortening of security timeouts was used.
- Browser comparison/picking: initial reference unchecked; at100%, actual artwork canvas maximum alpha=0; source RGB `[24,176,76]` selected legal color `B08` through Shift+right-click. Complete matrix, preview/pattern export URLs, tool and selection remained identical. Actual screenshot `/tmp/libms-reference-after.png`; detailed timings/flags `/tmp/libms-reference-upload-browser.json`; reproducible harness `tools/reference-upload-browser.cjs`.
- One CSP string-evaluation error appeared in **both baseline and changed** browser runs. It was not waived as a new fix and security policy was not weakened; the safety model remained loaded and classification completed. Broader existing CSP/library compatibility is outside this release.
- Independent read-only review completed. The only suggested blending correction (linear compositing) was applied and retested. No unverified broad algorithm, editor/export, or release-readiness claim is made.

## Publication

Cache chain updated consistently to `20261012-reference-upload-r47` (index → app → workspace bootstrap → workspace → renderer/reference service). Only the scoped runtime files, tests, browser harness and this report enter the release. Git commit/production status and deployed source hashes are checked at handoff.
