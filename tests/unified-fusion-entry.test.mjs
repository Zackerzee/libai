import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('production selector has exactly one shared fusion entry', () => {
  const selector = workspace.match(/<select id="ws-engine"[^>]*>(.*?)<\/select>/s)?.[1];
  assert.ok(selector);
  assert.equal((selector.match(/<option/g) || []).length, 1);
  assert.match(selector, /value="v2\.5">融合引擎/);
});
test('persisted separate engine migrates without copying its native dimensions', () => {
  const migration = workspace.match(/if \(get\(\)\.generation\.engine !== 'v2\.5'\) \{([^}]*\{[^}]*\}[^}]*\}[^}]*?)\n  \}/s)?.[0];
  assert.ok(migration);
  assert.match(migration, /bridge\.setGenerationEngine\('v2\.5'\)/);
  assert.doesNotMatch(migration, /gridW|gridH|setPindouOptions/);
  assert.match(workspace, /presetRoot: null/);
  assert.match(workspace, /nativeParameterRoot\.hidden = true/);
});
