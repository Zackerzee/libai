import { mountWorkspace } from "./workspace.js?v=20260924-text";

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

export function bootstrapWorkspace({ bridge, prepareLegacyShell }) {
  document.body.dataset.workspaceState = "preparing";
  try {
    prepareLegacyShell?.();
    const result = mountWorkspace(bridge);
    document.body.dataset.workspaceState = "ready";
    document.getElementById(ERROR_ID)?.remove();
    return result;
  } catch (error) {
    showFailure(error);
    console.error("Workspace bootstrap failed", error);
    return null;
  }
}
