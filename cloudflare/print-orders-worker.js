const PRINT_ORDER_PREFIX = "perler-print-orders";
const MAX_PRINT_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PRINT_FILES = 3;
const ALLOWED_PRINT_EXTENSIONS = new Set(["jpg", "jpeg", "png", "pdf"]);
const ALLOWED_PRINT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function getShanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: map.year, month: map.month, day: map.day };
}

function getDateString(date = new Date()) {
  const parts = getShanghaiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getRecentDateStrings(days = 7, now = new Date()) {
  const dates = [];
  for (let offset = 0; offset < days; offset += 1) {
    dates.push(getDateString(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)));
  }
  return dates;
}

function makeOrderNo(now = new Date()) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const parts = getShanghaiDateParts(now);
  return `PB-${parts.month}${parts.day}-${Array.from(bytes, (byte) => chars[byte % chars.length]).join("")}`;
}

function getExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function getSafeFileName(index, extension) {
  return `file-${index}.${extension === "jpeg" ? "jpg" : extension}`;
}

function getContentType(extension) {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function detectMagic(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf";
  return "";
}

function validateFile({ originalName, mimeType, size, bytes }) {
  const extension = getExtension(originalName);
  if (!ALLOWED_PRINT_EXTENSIONS.has(extension)) throw new HttpError("只支持 JPG / PNG / PDF 文件");
  if (!size || size > MAX_PRINT_FILE_SIZE) throw new HttpError("单个文件不能超过 20MB");
  if (mimeType && !ALLOWED_PRINT_TYPES.has(String(mimeType).toLowerCase())) throw new HttpError("文件类型不支持");

  const magic = detectMagic(bytes);
  const safeExtension = extension === "jpeg" ? "jpg" : extension;
  if (magic !== safeExtension) throw new HttpError("文件内容格式不正确，请上传 JPG / PNG / PDF");
  return { safeExtension, contentType: getContentType(extension) };
}

function validatePin(request, env) {
  const url = new URL(request.url);
  const expected = String(env.PRINT_ADMIN_PIN || "").trim();
  const pin = request.headers.get("x-print-admin-pin") || url.searchParams.get("pin") || "";
  return Boolean(expected && String(pin).trim() === expected);
}

function publicOrder(order) {
  return {
    orderNo: order.orderNo,
    submittedAt: order.submittedAt,
    contact: order.contact,
    note: order.note || "",
    files: (order.files || []).map((file) => ({
      originalName: file.originalName,
      fileName: file.fileName,
      size: file.size,
      contentType: file.contentType,
    })),
  };
}

function isRecent(order, now = new Date()) {
  const submitted = new Date(order.submittedAt);
  return !Number.isNaN(submitted.getTime()) && now.getTime() - submitted.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function assertOrderNo(value) {
  const orderNo = String(value || "").trim();
  if (!/^PB-\d{4}-[A-Z0-9]{5}$/.test(orderNo)) throw new HttpError("订单号不正确");
  return orderNo;
}

function assertFileName(value) {
  const fileName = String(value || "").trim();
  if (!/^file-[1-3]\.(jpg|png|pdf)$/.test(fileName)) throw new HttpError("文件名不正确");
  return fileName;
}

function attachmentFileName(value) {
  return encodeURIComponent(String(value || "print-file").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_"));
}

async function handlePost(request, env) {
  const formData = await request.formData();
  const contact = cleanText(formData.get("contact"), 80);
  const note = cleanText(formData.get("note"), 300);
  const files = formData.getAll("files").filter((item) => item && typeof item === "object" && "arrayBuffer" in item);

  if (!contact) return json({ error: "请填写微信昵称或手机号" }, 400);
  if (files.length === 0) return json({ error: "请上传拼豆图纸图片或 PDF" }, 400);
  if (files.length > MAX_PRINT_FILES) return json({ error: "最多上传 3 个文件" }, 400);

  const now = new Date();
  const dateString = getDateString(now);
  const orderNo = makeOrderNo(now);
  const prefix = `${PRINT_ORDER_PREFIX}/${dateString}/${orderNo}`;
  const storedFiles = [];
  const validatedFiles = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateFile({
      originalName: file.name || "print-file",
      mimeType: file.type || "",
      size: file.size,
      bytes,
    });
    validatedFiles.push({ file, bytes, validation });
  }

  for (let index = 0; index < validatedFiles.length; index += 1) {
    const { file, bytes, validation } = validatedFiles[index];
    const fileName = getSafeFileName(index + 1, validation.safeExtension);
    const key = `${prefix}/${fileName}`;
    await env.PRINT_UPLOADS.put(key, bytes, {
      httpMetadata: { contentType: validation.contentType },
    });
    storedFiles.push({
      originalName: cleanText(file.name, 160) || fileName,
      fileName,
      key,
      size: file.size,
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

  await env.PRINT_UPLOADS.put(`${prefix}/order.json`, JSON.stringify(order, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return json({ orderNo });
}

async function listOrders(env) {
  const orders = [];
  for (const dateString of getRecentDateStrings(7)) {
    let cursor = undefined;
    do {
      const result = await env.PRINT_UPLOADS.list({
        prefix: `${PRINT_ORDER_PREFIX}/${dateString}/`,
        cursor,
      });
      for (const object of result.objects.filter((item) => item.key.endsWith("/order.json"))) {
        const stored = await env.PRINT_UPLOADS.get(object.key);
        if (!stored) continue;
        const order = JSON.parse(await stored.text());
        if (isRecent(order)) orders.push(publicOrder(order));
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }
  return orders.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

async function handleDownload(request, env) {
  if (!validatePin(request, env)) return json({ error: "PIN 不正确" }, 401);

  const url = new URL(request.url);
  const orderNo = assertOrderNo(url.searchParams.get("orderNo"));
  const fileName = assertFileName(url.searchParams.get("file"));

  for (const dateString of getRecentDateStrings(7)) {
    const orderObject = await env.PRINT_UPLOADS.get(`${PRINT_ORDER_PREFIX}/${dateString}/${orderNo}/order.json`);
    if (!orderObject) continue;
    const order = JSON.parse(await orderObject.text());
    if (!isRecent(order)) continue;
    const file = (order.files || []).find((item) => item.fileName === fileName);
    if (!file) return json({ error: "文件不存在" }, 404);
    const object = await env.PRINT_UPLOADS.get(file.key);
    if (!object) return json({ error: "文件不存在" }, 404);
    return new Response(object.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${attachmentFileName(file.originalName)}`,
      },
    });
  }

  return json({ error: "订单不存在或已过期" }, 404);
}

async function handleList(request, env) {
  if (!validatePin(request, env)) return json({ error: "PIN 不正确" }, 401);
  return json({ orders: await listOrders(env) });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/print-orders" && request.method === "POST") return await handlePost(request, env);
      if (url.pathname === "/api/print-orders" && request.method === "GET") return await handleList(request, env);
      if (url.pathname === "/api/print-orders/download" && request.method === "GET") return await handleDownload(request, env);
      return json({ error: "Not Found" }, 404);
    } catch (error) {
      console.error("Print Worker error", error);
      return json({ error: error.message || "服务暂时不可用" }, error.status || 500);
    }
  },
};
