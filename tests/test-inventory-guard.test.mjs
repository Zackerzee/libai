import test from "node:test";
import assert from "node:assert/strict";
import { auditTestInventory, TEST_ROOTS } from "../tools/test-inventory.mjs";

test("test inventory command includes every repository test file and the state suite",async()=>{
  const inventory=await auditTestInventory(new URL("..",import.meta.url).pathname);
  assert.deepEqual(inventory.omitted,[]);
  assert.deepEqual(inventory.missing,[]);
  assert.ok(TEST_ROOTS.includes("state"),"state/store.test.mjs must not silently fall outside the canonical command");
  assert.ok(inventory.configured.length>=70,`unexpected test-file loss: ${inventory.configured.length}`);
});
