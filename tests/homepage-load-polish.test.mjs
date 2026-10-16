import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/homepage.css", import.meta.url), "utf8");

test("homepage allows browser zoom and uses async decoding for its real brand asset", () => {
  assert.doesNotMatch(html, /maximum-scale=1|user-scalable=no/);
  const marks = [...html.matchAll(/<img[^>]+libms-logo\.png[^>]+alt="时里白造物四色圆环标志"[^>]*>/g)].map(match => match[0]);
  assert.equal(marks.length, 2);
  for (const mark of marks) {
    assert.match(mark, /width="\d+"/);
    assert.match(mark, /height="\d+"/);
    assert.match(mark, /decoding="async"/);
  }
  assert.match(marks[1], /loading="lazy"/);
  assert.match(marks[1], /fetchpriority="low"/);
});

test("below-fold landing layout is deferred and reduced motion stays available", () => {
  assert.match(css, /body:not\(\.phase2-workspace\) \.homepage-workflow/);
  assert.match(css, /content-visibility: auto/);
  assert.match(css, /contain-intrinsic-size: auto 500px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
});
