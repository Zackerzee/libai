export const FREE_ACCESS_MODE = true;

export const MEMBERSHIP_FEATURES = Object.freeze({
  generation_basic: "generation",
  generation_advanced: "generation",
  manual_editing: "editing",
  global_replace: "editing",
  local_replace: "editing",
  diagnostics: "diagnostics",
  structural_diagnostics: "diagnostics",
  guided_repair: "diagnostics",
  navigator: "editing",
  pixel_perfect: "editing",
  symmetry: "editing",
  outline: "editing",
  reference_layer: "editing",
  color_ramp: "editing",
  shading_ink: "editing",
  project_save: "project",
  project_export: "export",
  hd_export: "export",
  pixler_import: "project",
  pixler_export: "export",
  material_stats: "project",
});

const allFeatures = Object.freeze(Object.keys(MEMBERSHIP_FEATURES));

export const MEMBERSHIP_PLANS = Object.freeze({
  free: Object.freeze({ id: "free", entitlements: allFeatures }),
  pro_monthly: Object.freeze({ id: "pro_monthly", entitlements: allFeatures }),
  pro_yearly: Object.freeze({ id: "pro_yearly", entitlements: allFeatures }),
});

export const REDEMPTION_CONFIG = Object.freeze({ enabled: false });
export const MEMBERSHIP_STORAGE_KEY = "libms_membership_v1";
export const DEFAULT_MEMBERSHIP = Object.freeze({
  plan: "free",
  status: "active",
  activatedAt: null,
  expiresAt: null,
  source: "free-access",
});
