import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectedSelection,selectionCells} from '../services/selection-service.js';
test('double click uses connected selection without switching the current tool or modifying cells',()=>{
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  const handler=source.slice(source.indexOf("well.addEventListener('dblclick'"),source.indexOf('window.addEventListener("blur"',source.indexOf("well.addEventListener('dblclick'")));
  assert.match(handler,/\['select','region'\]\.includes/);
  assert.match(handler,/connectedSelection\(bridge\.getResult\(\)\.grid,cell\.x,cell\.y\)/);
  assert.doesNotMatch(handler,/sameColorSelection|tool:|recolorSelection|fillAt|setCell/);
  assert.match(handler,/event\.target\.closest/);
});
test('disconnected matching beads do not belong to the double-click region',()=>{
  const a={paletteId:'A',code:'A01'},b={paletteId:'B',code:'B01'};
  const grid=[[a,a,b,a],[b,a,b,a]];
  const cells=selectionCells(connectedSelection(grid,0,0),4,2);
  assert.equal(cells.length,3);
  assert.ok(cells.every(cell=>cell.x<2));
});
