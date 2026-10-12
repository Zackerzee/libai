import assert from 'node:assert/strict';
export function assertGridIdentityEqual(actual, expected) {
  assert.equal(actual.length, expected.length, 'grid height');
  for (let y = 0; y < expected.length; y++) {
    assert.equal(actual[y].length, expected[y].length, `row ${y} width`);
    for (let x = 0; x < expected[y].length; x++) {
      const a = actual[y][x], b = expected[y][x];
      assert.equal(a === null, b === null, `null at ${x},${y}`);
      if (b === null) continue;
      assert.equal(a.paletteId, b.paletteId, `palette identity at ${x},${y}`);
      assert.equal(a.code, b.code, `code at ${x},${y}`);
      assert.deepEqual(a.rgb, b.rgb, `rgb at ${x},${y}`);
    }
  }
}
