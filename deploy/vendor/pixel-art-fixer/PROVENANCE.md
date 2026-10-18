# Pixel Art Fixer selected reconstruction port

Source: https://github.com/Retro-Diffusion/pixel-art-fixer

Pinned upstream revision: `ef376e57e1c272633ca2dbf5f29ec3fcf6596465`.
License: MIT, copyright Astropulse, LLC (see LICENSE).

The LIBMS pure JavaScript module `smart-preprocessing/pixel-art-fixer-sampler.mjs`
adapts `python/pixelfixer/reconstruct.py` functions `adaptive_k` and
`two_stage_pack`, reading the RGB quantizer in `python/pixelfixer/quantize.py`.
It preserves the selected algorithm's two distinct stages: global structural
RGB labels vote with triangular cell-center weighting; the winning region is
colored from original pixels, not from its quantized center.

This is NOT the complete upstream engine, neural-network model, automatic
grid detector, phase arbiter, warped-cut reconstructor, or native Rust port.
The requested target dimensions define a regular grid directly, so the
detectors and legacy phase/snapping reconstruction are deliberately excluded.

## Explicit differences

- Input/output dimensions are caller-controlled; non-square grids and enlargement
  are supported. Empty enlarged cells use their nearest source center, rather
  than upstream's black/transparent empty-cell fallback.
- Structural clustering uses weighted means of occupied 4-bit RGB histogram
  bins (at most 4096), deterministic farthest-point initialization and at most
  12 Lloyd iterations. Upstream runs cv2/sklearn on up to 60,000 source samples.
  Bin means receive labels, not each exact original RGB. This bounds browser
  cost but is not a claim of numerical parity with cv2 or sklearn.
- Invisible RGB never participates in clustering or color votes. The caller's
  alpha threshold (default 8) replaces upstream's alpha >127 output mask;
  a cell still requires a strict majority of visible source pixels. Fully
  transparent output RGB is zero. Opaque white remains opaque.
- Exact target size, original source bytes, and null semantics are preserved.
  Returned RGB is a sampling intermediate; the existing LIBMS brand palette
  matching stage must map it to legal palette identities. No brand code is
  generated or inferred in this module.
- Source input is bounded to 4,000,000 pixels; target axes are 1–1000. Invalid
  sizes throw an explicit error instead of silently resizing. Complexity is
  O(source pixels + occupied bins × K × 12 + target cells × K), K ≤48;
  memory does not allocate a targetCells × K vote matrix. Production callers
  should run the sampler in a worker, not synchronously on the UI thread.

Independent local tests check deterministic output, immutable input, explicit
size including enlargement, transparency, opaque whites, and rare details.
They are contract tests, not proof of upstream full-engine image parity.
