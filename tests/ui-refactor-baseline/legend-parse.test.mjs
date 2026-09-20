import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeToken, parseLegendText, tokenKind } from "../../services/legend-text-parse.js";

// 本文件逐条对齐后端测试 parse.test.ts，纯字符串用例，必须 100% 原样通过。
// vitest 的 describe/it 直接对应 node:test 的 describe/it。

describe("normalizeToken", () => {
  it("uppercases and strips illegal chars", () => {
    assert.equal(normalizeToken("a10 "), "A10");
    assert.equal(normalizeToken("A11(202)"), "A11202");
  });

  it("corrects digit confusions", () => {
    assert.equal(normalizeToken("a1o"), "A10");
    assert.equal(normalizeToken("2O2"), "202");
    assert.equal(normalizeToken("1I"), "11");
  });

  it("keeps letter prefixes as letters", () => {
    assert.equal(normalizeToken("B03"), "B03");
    assert.equal(normalizeToken("b0b"), "B08");
  });
});

describe("tokenKind", () => {
  it("classifies ids vs counts", () => {
    assert.equal(tokenKind("A11"), "id");
    assert.equal(tokenKind("A"), "id");
    assert.equal(tokenKind("202"), "count");
    assert.equal(tokenKind(""), "none");
    assert.equal(tokenKind("12A"), "none");
  });
});

describe("parseLegendText", () => {
  it("parses id(count) forms", () => {
    assert.deepEqual(parseLegendText("A11(202)"), { id: "A11", count: 202 });
    assert.deepEqual(parseLegendText("A11 （202）"), { id: "A11", count: 202 });
    assert.deepEqual(parseLegendText("a11(202"), { id: "A11", count: 202 });
  });

  it("parses space separated id count", () => {
    assert.deepEqual(parseLegendText("A11 202"), { id: "A11", count: 202 });
    assert.deepEqual(parseLegendText("B03 56"), { id: "B03", count: 56 });
  });

  it("parses digitless ids like M(64)", () => {
    assert.deepEqual(parseLegendText("M(64)"), { id: "M", count: 64 });
  });

  it("parses OCR that dropped the letter prefix", () => {
    assert.deepEqual(parseLegendText("29(173)"), { id: "29", count: 173 });
  });

  it("parses bare id and bare count", () => {
    assert.deepEqual(parseLegendText("A11"), { id: "A11", count: null });
    assert.deepEqual(parseLegendText("(202)"), { id: null, count: 202 });
    assert.deepEqual(parseLegendText("202"), { id: null, count: 202 });
  });

  it("fixes confusions inside tokens", () => {
    assert.deepEqual(parseLegendText("A1O(2O2)"), { id: "A10", count: 202 });
  });

  it("rejects empty / garbage", () => {
    assert.equal(parseLegendText(""), null);
    assert.equal(parseLegendText("---"), null);
    assert.equal(parseLegendText("abc xyz"), null);
  });
});
