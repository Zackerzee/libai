import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_DIALOG_IDS, markLegacyUi, openLegacyDialog } from "../ui/legacy-ui-policy.js";

const makeRoot = () => {
  const nodes = new Map(LEGACY_DIALOG_IDS.map((id) => [id, {
    id, dataset: {}, open: false, showModal() { this.open = true; },
  }]));
  const shell = { dataset: {} };
  return { nodes, shell, getElementById: (id) => nodes.get(id) || null, querySelector: () => shell };
};

test("legacy UI inventory is explicit and marked as compatibility-owned", () => {
  const root = makeRoot();
  markLegacyUi(root);
  for (const node of root.nodes.values()) assert.deepEqual(node.dataset, { legacyUi: "compat", legacyOwner: "app" });
  assert.equal(root.shell.dataset.legacyAdapter, "active");
});

test("only registered legacy dialogs can be opened", () => {
  const root = makeRoot();
  assert.equal(openLegacyDialog("editor-modal", root).open, true);
  assert.throws(() => openLegacyDialog("unknown-modal", root), /未登记/);
});
