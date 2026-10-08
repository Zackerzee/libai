import { mountWorkspace } from "./workspace.js?v=20261008-selection-popover-r24";
import { markLegacyUi } from "./legacy-ui-policy.js?v=20260928-v3";

const ERROR_ID = "workspace-bootstrap-error";

function showFailure(error) {
  document.body.dataset.workspaceState = "failed";
  let banner = document.getElementById(ERROR_ID);
  if (!banner) {
    banner = document.createElement("div");
    banner.id = ERROR_ID;
    banner.className = "workspace-bootstrap-error";
    banner.setAttribute("role", "alert");
    document.body.prepend(banner);
  }
  banner.textContent = "工作台启动失败：" + (error?.message || "未知错误") + "。旧版界面仍可使用，请刷新后重试。";
}

let mountedResult = null;

export function bootstrapWorkspace({ bridge, prepareLegacyShell }) {
  if (mountedResult) return mountedResult;
  document.body.dataset.workspaceState = "preparing";
  try {
    prepareLegacyShell?.();
    markLegacyUi(document);
    const result = mountWorkspace(bridge);
    document.body.dataset.workspaceState = "ready";
    document.getElementById(ERROR_ID)?.remove();
    mountedResult = result;
    return mountedResult;
  } catch (error) {
    const shell = document.querySelector(".workspace-grid");
    if (shell) {
      delete shell.dataset.workspaceMounting;
      delete shell.dataset.workspaceReady;
    }
    showFailure(error);
    console.error("Workspace bootstrap failed", error);
    return null;
  }
}
