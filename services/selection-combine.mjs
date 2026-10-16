import { selectionCells } from './selection-service.js';
import { fitSelectionBox } from './shapes-service.js';

// Modifier semantics apply equally to rectangles and explicit masks.
export function combineSelections(current, hits, width, height, operation = 'replace') {
  if (operation === 'replace') return hits;
  const before = selectionCells(current, width, height), after = selectionCells(hits, width, height);
  const key = ({x,y}) => `${x},${y}`;
  const cells = new Map(before.map(cell => [key(cell), cell]));
  if (operation === 'add') for (const cell of after) cells.set(key(cell), cell);
  else if (operation === 'subtract') for (const cell of after) cells.delete(key(cell));
  else throw new TypeError('Unknown selection operation');
  return fitSelectionBox([...cells.values()], 'magic-wand');
}
