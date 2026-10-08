import { lineCells } from "./shapes-service.js";

const sameCell = (a, b) => a?.x === b?.x && a?.y === b?.y;
const direction = (a, b) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
const cardinal = (step) => Math.abs(step.x) + Math.abs(step.y) === 1;

export function interpolateStrokeSegment(from, to) {
  if (!from || !to) return to ? [{ ...to }] : [];
  return lineCells(from.x, from.y, to.x, to.y);
}

// 基础 Pixel Perfect：只清理当前笔迹中一格长的 staircase corner。
// 长水平/垂直线形成的明确 L 形转角会保留，已存在图纸内容完全不参与计算。
export function cleanPixelPerfectPath(path = []) {
  const input = path.filter((cell, index) => !sameCell(cell, path[index - 1])).map((cell) => ({ ...cell }));
  if (input.length < 4) return input;
  const output = [input[0]];
  for (let index = 1; index < input.length - 1; index += 1) {
    const a = output.at(-1), b = input[index], c = input[index + 1];
    const incoming = direction(a, b), outgoing = direction(b, c);
    const diagonalShortcut = Math.abs(c.x - a.x) === 1 && Math.abs(c.y - a.y) === 1;
    const turnsCorner = cardinal(incoming) && cardinal(outgoing) && incoming.x !== outgoing.x && incoming.y !== outgoing.y;
    const prior = output.at(-2), next = input[index + 2];
    const incomingRunContinues = prior && sameCell(direction(prior, a), incoming);
    const outgoingRunContinues = next && sameCell(direction(c, next), outgoing);
    if (diagonalShortcut && turnsCorner && !incomingRunContinues && !outgoingRunContinues) continue;
    output.push(b);
  }
  output.push(input.at(-1));
  return output;
}
