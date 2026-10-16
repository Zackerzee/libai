import test from 'node:test';
import assert from 'node:assert/strict';
import { mirroredTitle, mirroredPreviewGrid } from '../ui/export-mirror-preview.mjs';

test('mirror previews preserve canonical rows and cells',()=>{
  const grid=[[{code:'A'},null],[{code:'B'},{code:'C'}]],before=structuredClone(grid);
  assert.deepEqual(mirroredPreviewGrid(grid,'horizontal'),[[null,grid[0][0]],[grid[1][1],grid[1][0]]]);
  assert.deepEqual(mirroredPreviewGrid(grid,'vertical'),[grid[1],grid[0]]);
  assert.deepEqual(grid,before);
  assert.equal(mirroredPreviewGrid(grid,'none'),grid);
});
test('mirror names have a single reversible suffix',()=>{
  assert.equal(mirroredTitle('作品','horizontal'),'作品 · 镜像');
  assert.equal(mirroredTitle('作品 · 镜像','vertical'),'作品 · 镜像');
  assert.equal(mirroredTitle('作品','none'),'作品');
});
