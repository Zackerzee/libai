export const LEGACY_DIALOG_IDS = Object.freeze([
  "preview-modal", "register-modal", "link-import-modal", "direct-pattern-modal",
  "assembly-modal", "exit-modal", "donate-modal", "editor-modal",
  "blank-board-modal", "pattern-adjust-modal", "grid-align-modal",
  "export-settings-modal",
]);

export function markLegacyUi(root = document) {
  for (const id of LEGACY_DIALOG_IDS) {
    const node = root.getElementById(id);
    if (!node) continue;
    node.dataset.legacyUi = "compat";
    node.dataset.legacyOwner = "app";
  }
  const shell = root.querySelector(".workspace-grid");
  if (shell) shell.dataset.legacyAdapter = "active";
}

export function openLegacyDialog(id, root = document) {
  if (!LEGACY_DIALOG_IDS.includes(id)) throw new Error("未登记的旧界面入口：" + id);
  const dialog = root.getElementById(id);
  if (!dialog) throw new Error("旧界面不存在：" + id);
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  return dialog;
}
