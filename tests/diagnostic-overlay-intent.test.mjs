import test from "node:test";
import assert from "node:assert/strict";
import { resolveDiagnosticOverlayIssues } from "../ui/canvas-renderer.js";

const issues = [
  { id: "edge:a", type: "edge-contamination", paletteId: "a", cells: [{ x: 1, y: 2 }] },
  { id: "edge:b", type: "edge-contamination", paletteId: "b", cells: [{ x: 5, y: 7 }] },
];

test("ordinary cell selection does not implicitly show all diagnostic markers", () => {
  assert.deepEqual(resolveDiagnosticOverlayIssues({ issues }), []);
  assert.deepEqual(resolveDiagnosticOverlayIssues({ issues, inspection: { active: false, issues, index: 0 } }), []);
});

test("explicit diagnostic markers preserve all issue colors and cells without mutation", () => {
  const before = structuredClone(issues);
  assert.equal(resolveDiagnosticOverlayIssues({ visible: true, issues }), issues);
  assert.deepEqual(issues, before);
});

test("active inspection displays only current issue and changes with navigation", () => {
  assert.deepEqual(resolveDiagnosticOverlayIssues({ issues, inspection: { active: true, issues, index: 1 } }), [issues[1]]);
  assert.deepEqual(resolveDiagnosticOverlayIssues({ issues, inspection: { active: true, issues, index: 0 } }), [issues[0]]);
});

test("ending or empty inspection clears inspection-only markers", () => {
  assert.deepEqual(resolveDiagnosticOverlayIssues({ issues, inspection: { active: false, issues, index: 1 } }), []);
  assert.deepEqual(resolveDiagnosticOverlayIssues({ inspection: { active: true, issues: [], index: -1 } }), []);
});
