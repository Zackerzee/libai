import {
  MAX_PRINT_FILES,
  assertOrderNo,
  buildOrderPrefix,
  cleanText,
  getDateString,
  getPinFromWebRequest,
  getRecentDateStrings,
  getSafeFileName,
  isRecentOrder,
  makeJsonResponse,
  makeOrderNo,
  publicOrder,
  validateFileMeta,
  validatePin,
} from "../../../lib/print-orders-core.js";

async function fileToUpload(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    originalName: file.name || "print-file",
    mimeType: file.type || "",
    size: file.size,
    bytes,
  };
}

async function listRecentOrders(env) {
  const orders = [];
  for (const dateString of getRecentDateStrings(7)) {
    let cursor = undefined;
    do {
      const result = await env.PRINT_UPLOADS.list({
        prefix: `perler-print-orders/${dateString}/`,
        cursor,
      });
      const orderObjects = result.objects.filter((object) => object.key.endsWith("/order.json"));
      for (const object of orderObjects) {
        try {
          const stored = await env.PRINT_UPLOADS.get(object.key);
          if (!stored) continue;
          const order = JSON.parse(await stored.text());
          if (isRecentOrder(order)) orders.push(publicOrder(order));
        } catch (error) {
          console.error("Failed to read print order", object.key, error);
        }
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }
  return orders.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

async function handleGet({ request, env }) {
  if (!validatePin(getPinFromWebRequest(request), env)) {
    return makeJsonResponse({ error: "PIN 不正确" }, 401);
  }
  const orders = await listRecentOrders(env);
  return makeJsonResponse({ orders });
}

async function handlePost({ request, env }) {
  const formData = await request.formData();
  const contact = cleanText(formData.get("contact"), 80);
  const note = cleanText(formData.get("note"), 300);
  const files = formData.getAll("files").filter((item) => item && typeof item === "object" && "arrayBuffer" in item);

  if (!contact) {
    return makeJsonResponse({ error: "请填写微信昵称或手机号" }, 400);
  }
  if (files.length === 0) {
    return makeJsonResponse({ error: "请上传拼豆图纸图片或 PDF" }, 400);
  }
  if (files.length > MAX_PRINT_FILES) {
    return makeJsonResponse({ error: "最多上传 3 个文件" }, 400);
  }

  const now = new Date();
  const dateString = getDateString(now);
  const orderNo = assertOrderNo(makeOrderNo(now));
  const orderPrefix = buildOrderPrefix(dateString, orderNo);
  const storedFiles = [];

  for (let index = 0; index < files.length; index += 1) {
    const upload = await fileToUpload(files[index]);
    const validation = validateFileMeta(upload);
    const fileName = getSafeFileName(index + 1, validation.safeExtension);
    const key = `${orderPrefix}/${fileName}`;

    await env.PRINT_UPLOADS.put(key, upload.bytes, {
      httpMetadata: { contentType: validation.contentType },
    });
    storedFiles.push({
      originalName: cleanText(upload.originalName, 160) || fileName,
      fileName,
      key,
      size: upload.size,
      contentType: validation.contentType,
    });
  }

  const order = {
    orderNo,
    submittedAt: now.toISOString(),
    contact,
    note,
    files: storedFiles,
  };

  await env.PRINT_UPLOADS.put(`${orderPrefix}/order.json`, JSON.stringify(order, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  return makeJsonResponse({ orderNo });
}

export async function onRequest(context) {
  try {
    if (!context.env.PRINT_UPLOADS) {
      return makeJsonResponse({ error: "缺少 PRINT_UPLOADS R2 bucket binding" }, 500);
    }
    if (context.request.method === "GET") return await handleGet(context);
    if (context.request.method === "POST") return await handlePost(context);
    return makeJsonResponse({ error: "Method Not Allowed" }, 405);
  } catch (error) {
    console.error("Print orders function error", error);
    return makeJsonResponse({ error: error.message || "图纸提交失败，请联系店员" }, 500);
  }
}
