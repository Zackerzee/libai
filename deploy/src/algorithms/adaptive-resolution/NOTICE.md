# AdaptiveResolutionAdvisor attribution

The `bead-grid-studio` benchmark baseline in `advisor.mjs` is an independent, pure-function adaptation of the classification and grid-size rules in:

- Bead Grid Studio / 豆格工坊, `zwhy149/bead-grid-studio`, commit `515e1800c194651a4b2542e99d53c1701a3127e8`
- `src/app.js`: `analyzeSourceComplexity`, `recommendDocumentGrid`, `recommendAutoHdSettings`
- `src/core/geometry.js`: `gridForLongSide`

Upstream is Apache-2.0. Preserve its [LICENSE](../bgs/LICENSE-APACHE-2.0.txt) and [NOTICE](../bgs/NOTICE) when redistributing adapted code. This module adds a manual-size guard, explicit diagnostics, and a separate measured-candidate interface; those are local changes, not upstream behavior. It does not copy the upstream palette or UI.
