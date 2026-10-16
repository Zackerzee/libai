import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
test('all selection methods are visible buttons with active tool feedback',()=>{
  assert.match(source,/for\(const option of selectionType.options\)/);
  assert.match(source,/selectionType.closest\('label'\).hidden=true/);
  assert.match(source,/gridToolbar.setTool\(button.dataset.selectionTool\)/);
  assert.match(source,/String\(button.dataset.selectionTool===tool\)/);
});
