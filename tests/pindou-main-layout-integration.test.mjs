import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pindouControlsMarkup, PINDOU_FIELD_GROUPS } from '../ui/pindou-full-controls.mjs';

const workspace = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('native parameters use the existing numbered cards rather than replacing the layout', () => {
  assert.match(workspace, /steps\.get\('5'\)\.prepend\(nativeEngineField\)/);
  assert.match(workspace, /steps\.get\('8'\)\.append\(nativeParameterRoot\)/);
  assert.match(workspace, /attachWorkspaceV3Layout/);
  assert.match(workspace, /if \(get\(\)\.generation\.engine === 'pindou'\) return/);
});
test('all native algorithm parameters and scenes have Chinese controls', () => {
  const markup = pindouControlsMarkup();
  for (const [, keys] of PINDOU_FIELD_GROUPS) for (const key of keys) assert.ok(markup.includes(`data-pindou-field="${key}"`), key);
  for (const mode of ['area','nearest','dominant','edge','dpid','ssim','kmeans','mediancut','direct','none','fs','ordered']) assert.ok(markup.includes(`value="${mode}"`), mode);
  assert.ok(markup.includes('恢复引擎默认值'));
});
test('both engines share the existing preset grid with engine-specific click guards', () => {
  const controls = readFileSync(new URL('../ui/pindou-full-controls.mjs', import.meta.url), 'utf8');
  assert.match(workspace, /presetRoot: presetSection\.querySelector\('\.sl-preset-grid'\)/);
  assert.match(workspace, /button\.disabled = state\.generation\.engine !== 'v2\.5'/);
  assert.match(controls, /button\.disabled = !isActive\(\)/);
  assert.match(controls, /if \(!isActive\(\)\) return/);
  assert.match(controls, /data-pindou-scene.*closest\('label'\)\.hidden = true/);
});
