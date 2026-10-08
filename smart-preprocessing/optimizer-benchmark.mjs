import { createPatternOptimizer } from "./pattern-optimizer.mjs";

const colors = Array.from({ length: 30 }, (_, index) => ({ code: `C${index + 1}`, rgb: [index * 7 % 255, index * 11 % 255, index * 17 % 255] }));
const grid = Array.from({ length: 104 }, (_, y) => Array.from({ length: 104 }, (_, x) => colors[(x * 13 + y * 7) % colors.length]));
const optimizer = createPatternOptimizer();
const start = performance.now();
const result = optimizer.optimize(grid);
const milliseconds = performance.now() - start;
console.log(JSON.stringify({ engine: "4.0.0-stage4", cells: 104 * 104, milliseconds: Number(milliseconds.toFixed(2)), changed: result.changed, scoreBefore: result.scoreBefore.score, scoreAfter: result.scoreAfter.score, candidateCount: result.candidates.length }, null, 2));
