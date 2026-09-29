import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_MEMBERSHIP, FREE_ACCESS_MODE, MEMBERSHIP_FEATURES, MEMBERSHIP_PLANS, MEMBERSHIP_STORAGE_KEY } from "../config/membership-config.js";
import { createMembershipService } from "../services/membership-service.js";

const memoryStorage = (raw = null) => ({ getItem: key => key === MEMBERSHIP_STORAGE_KEY ? raw : null, setItem() {} });
const silentLogger = { warn() {} };
const service = options => createMembershipService({ storage: memoryStorage(), logger: silentLogger, ...options });

test("free access mode is the single enabled release policy", () => assert.equal(FREE_ACCESS_MODE, true));
test("feature registry is unique and every known feature is available", () => {
  const keys = Object.keys(MEMBERSHIP_FEATURES);
  assert.equal(new Set(keys).size, keys.length);
  const membership = service(); membership.init();
  for (const feature of keys) assert.equal(membership.canUse(feature), true, feature);
});
test("free, monthly and yearly plans expose valid entitlement arrays", () => {
  for (const id of ["free", "pro_monthly", "pro_yearly"]) {
    assert.equal(MEMBERSHIP_PLANS[id].id, id);
    assert.ok(Array.isArray(MEMBERSHIP_PLANS[id].entitlements));
  }
});
test("unknown features warn but fail open", () => assert.equal(service().canUse("future_feature"), true));
test("empty storage restores active free membership", () => {
  const membership = service(); assert.deepEqual(membership.init(), DEFAULT_MEMBERSHIP);
});
test("damaged storage JSON fails open", () => {
  const membership = service({ storage: memoryStorage("{bad") }); membership.init();
  assert.equal(membership.canUse("outline"), true);
});
test("missing plan, missing membership and expired membership stay available", () => {
  for (const raw of [JSON.stringify({ plan: "missing" }), "null", JSON.stringify({ plan: "free", status: "expired", expiresAt: "2000-01-01T00:00:00Z" })]) {
    const membership = service({ storage: memoryStorage(raw) }); membership.init();
    assert.equal(membership.canUse("project_save"), true);
    assert.equal(membership.isMembershipActive(), true);
  }
});
test("redemption skeleton is disabled and never changes membership", async () => {
  const membership = service(); membership.init(); const before = membership.getMembership();
  assert.deepEqual(await membership.validateRedemptionCode("NOT-A-REAL-CODE"), { valid: false, enabled: false, reason: "disabled" });
  const result = await membership.redeemCode("NOT-A-REAL-CODE");
  assert.equal(result.redeemed, false); assert.deepEqual(membership.getMembership(), before);
});
test("redemption exceptions fail open and never change membership", async () => {
  const redemption = { get enabled() { throw new Error("offline"); } };
  const membership = service({ redemption }); membership.init(); const before = membership.getMembership();
  const result = await membership.redeemCode("ANY-CODE");
  assert.equal(result.redeemed, false);
  assert.equal(membership.canUse("manual_editing"), true);
  assert.deepEqual(membership.getMembership(), before);
});
test("membership remains isolated from project, pixler, palette and history formats", () => {
  const files = ["services/project-file-service.js", "services/pixler-importer.js", "services/palette-service.js", "services/editor-service.js"];
  for (const file of files) {
    let source = ""; try { source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8"); } catch { continue; }
    assert.doesNotMatch(source, /membership|isPro|isVip|pro_monthly/);
  }
});
