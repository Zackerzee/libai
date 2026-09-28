import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const bootstrap = readFileSync(new URL("../ui/workspace-bootstrap.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../ui/canvas-renderer.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("production has one workspace bootstrap entry", () => {
  assert.match(app, /workspace-bootstrap\.js/);
  assert.doesNotMatch(app, /import\("\.\/ui\/workspace\.js/);
});

test("bootstrap prepares compatibility shell before mounting workspace", () => {
  assert.ok(bootstrap.indexOf("prepareLegacyShell?.()") < bootstrap.indexOf("mountWorkspace(bridge)"));
  assert.match(bootstrap, /workspaceState = "failed"/);
});

test("workspace fails loudly when its required shell is incomplete", () => {
  assert.match(workspace, /工作台骨架不完整/);
  assert.match(workspace, /dataset\.workspaceShell = "v3"/);
});

test("render policy has one canonical browser module identity", () => {
  const canonical = "render-policy.mjs?v=20260928-v3";
  assert.match(index, new RegExp(canonical.replace("?", "\\?")));
  assert.match(workspace, new RegExp(canonical.replace("?", "\\?")));
  assert.match(renderer, new RegExp(canonical.replace("?", "\\?")));
  assert.doesNotMatch(index, /render-policy\.mjs\?v=20260915/);
});
