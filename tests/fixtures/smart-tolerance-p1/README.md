# Performance P1 fixed oracle

Generated before optimization from a separate `git archive` of checkpoint
`9d46a5c5e5d077c72b948789e6bdba449558da2d`, not from the mutable performance tree.

`golden.json` SHA-256:
`3186f37aa32f8c99fdc48a76f241b7766827dbd03e6f051d744594b7307a0b92`.

42 deterministic fixtures save complete hierarchy and compiled data (including
strength thresholds, mapping, rejection details and color counts), plus full
evaluation objects at 0, 10, ..., 100. Full-object deep equality includes every
cell's palette identity, code, RGB, null placement, extra metadata and protected
conflict diagnostics. Additional tests cover palette-order independence,
compiled restore, non-accumulating mutation isolation, frozen typed protection,
and all nine required context invalidation dimensions.

These fixtures are semantic edge cases, not calibrated photographic quality
benchmarks. Performance measurements use separate large fixtures.

To reproduce: archive the exact checkpoint to an independent directory, then run
`node tests/fixtures/smart-tolerance-p1/generate-golden.mjs <checkpoint-directory>`.
The generator rejects changed algorithm modules by checkpoint source hashes.
Never regenerate this oracle from optimized code.
