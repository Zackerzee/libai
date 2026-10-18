# Image-to-Pixel CPU sampling subset

Source: https://github.com/Tezumie/Image-to-Pixel

Pinned revision: `3dc4cf82c52b7bcdfc3866a88a8c417d83c3a064`.

`resample.mjs` contains the unchanged `resample` function and its documentation from
`lib/core/cpu/stages.js`. Only a provenance header and the `.mjs` container are added.
No runtime dependencies, GPU, DOM, upstream editor, palette quantizer or dithering
algorithms are included. The adapter uses upstream alpha-weighted box sampling,
not an exact area integral: at most 16 × 16 source samples per output cell.

LIBMS validates dimensions, thresholds sampled alpha and converts float channels
to RGBA bytes. Brand palette matching remains exclusively in the LIBMS pipeline.
