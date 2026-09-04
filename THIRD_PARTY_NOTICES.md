# Third-party notices

## Cartoon Engine: perler-beads-ai

Source: https://github.com/liangdabiao/perler-beads-ai

Reviewed revision: 573006fec96eb59552862556a7a3e438077328a4

Copyright 2024 Zippland (retained from upstream LICENSE).

Licensed under the Apache License, Version 2.0. Full upstream license is
included in `licenses/perler-beads-ai-Apache-2.0.txt`.

Adapted source: `src/utils/pixelation.ts` (cell division, dominant and average
pooling), `src/app/page.tsx` (`handleAutoRemoveBackground`, border-connected fill).
Upstream repository has no separate NOTICE file at the reviewed revision.

Modifications on 2026-09-04 in `lib/cartoon-engine.js`: extracted pure RGBA/crop
interface, injected existing MARD Lab/DeltaE2000 matching, added center and
optional dominantQuantized pooling, four-neighbour BFS region majority merging,
structural color reduction, input validation, exclusion filtering and diagnostics.
BFS region merging is a local extension, not upstream main's global frequency merge.

No upstream UI, AI service, Cloudflare integration, export system, or palette data
is incorporated into the production engine. Upstream palettes may be used solely
in separately labeled source-baseline regression artifacts.
