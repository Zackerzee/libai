import {
  DEFAULT_MEMBERSHIP,
  FREE_ACCESS_MODE,
  MEMBERSHIP_FEATURES,
  MEMBERSHIP_PLANS,
  MEMBERSHIP_STORAGE_KEY,
  REDEMPTION_CONFIG,
} from "../config/membership-config.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const browserStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export function createMembershipService({
  storage = browserStorage(),
  logger = globalThis.console,
  now = () => Date.now(),
  freeAccessMode = FREE_ACCESS_MODE,
  features = MEMBERSHIP_FEATURES,
  plans = MEMBERSHIP_PLANS,
  redemption = REDEMPTION_CONFIG,
} = {}) {
  let membership = clone(DEFAULT_MEMBERSHIP);

  const warn = (message, error) => logger?.warn?.(`[membership] ${message}`, error || "");
  const safePlan = () => plans[membership?.plan] || plans.free || null;

  function init() {
    try {
      const raw = storage?.getItem?.(MEMBERSHIP_STORAGE_KEY);
      if (!raw) return getMembership();
      const parsed = JSON.parse(raw);
      membership = { ...clone(DEFAULT_MEMBERSHIP), ...(parsed && typeof parsed === "object" ? parsed : {}) };
      if (!plans[membership.plan]) warn(`Unknown membership plan: ${membership.plan}`);
      if (membership.expiresAt && !Number.isFinite(Date.parse(membership.expiresAt))) warn("Invalid membership expiration");
    } catch (error) {
      membership = clone(DEFAULT_MEMBERSHIP);
      warn("Unable to restore membership; free access remains available", error);
    }
    return getMembership();
  }

  function isMembershipActive() {
    if (freeAccessMode) return true;
    if (!membership || membership.status !== "active") return false;
    if (!membership.expiresAt) return true;
    const expiresAt = Date.parse(membership.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now();
  }

  function canUse(feature) {
    try {
      if (!Object.hasOwn(features, feature)) {
        warn(`Unknown membership feature: ${String(feature)}`);
        return Boolean(freeAccessMode);
      }
      if (freeAccessMode) return true;
      const plan = safePlan();
      return Boolean(isMembershipActive() && plan?.entitlements?.includes(feature));
    } catch (error) {
      warn("Permission check failed; applying safe fallback", error);
      return Boolean(freeAccessMode);
    }
  }

  const getMembership = () => clone(membership || DEFAULT_MEMBERSHIP);
  const getPlan = () => safePlan();
  const getEntitlements = () => [...(safePlan()?.entitlements || [])];

  async function validateRedemptionCode(code) {
    if (!redemption?.enabled) return { valid: false, enabled: false, reason: "disabled" };
    return { valid: false, enabled: true, reason: code ? "not-implemented" : "empty" };
  }

  async function redeemCode(code) {
    const before = getMembership();
    try {
      const validation = await validateRedemptionCode(code);
      return { redeemed: false, validation, membership: before };
    } catch (error) {
      warn("Redemption failed; membership was not changed", error);
      return { redeemed: false, error: "unavailable", membership: before };
    }
  }

  return { init, canUse, getMembership, getPlan, getEntitlements, isMembershipActive, validateRedemptionCode, redeemCode };
}

export const membershipService = createMembershipService();
