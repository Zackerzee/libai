import {
  assertOrderNo,
  assertSafeStoredFileName,
  attachmentFileName,
  getPinFromWebRequest,
  getRecentDateStrings,
  isRecentOrder,
  makeJsonResponse,
  validatePin,
} from "../../../lib/print-orders-core.js";

async function findOrder(env, orderNo) {
  for (const dateString of getRecentDateStrings(7)) {
    const key = `perler-print-orders/${dateString}/${orderNo}/order.json`;
    const stored = await env.PRINT_UPLOADS.get(key);
    if (!stored) continue;
    const order = JSON.parse(await stored.text());
    if (isRecentOrder(order)) return order;
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.PRINT_UPLOADS) {
      return makeJsonResponse({ error: "缺少 PRINT_UPLOADS R2 bucket binding" }, 500);
    }
    if (!validatePin(getPinFromWebRequest(request), env)) {
      return makeJsonResponse({ error: "PIN 不正确" }, 401);
    }

    const url = new URL(request.url);
    const orderNo = assertOrderNo(url.searchParams.get("orderNo"));
    const fileName = assertSafeStoredFileName(url.searchParams.get("file"));
    const order = await findOrder(env, orderNo);
    if (!order) {
      return makeJsonResponse({ error: "订单不存在或已过期" }, 404);
    }

    const file = order.files.find((item) => item.fileName === fileName);
    if (!file) {
      return makeJsonResponse({ error: "文件不存在" }, 404);
    }

    const object = await env.PRINT_UPLOADS.get(file.key);
    if (!object) {
      return makeJsonResponse({ error: "文件不存在" }, 404);
    }

    return new Response(object.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${attachmentFileName(file.originalName)}`,
      },
    });
  } catch (error) {
    console.error("Print order download function error", error);
    return makeJsonResponse({ error: error.message || "下载失败" }, 500);
  }
}
