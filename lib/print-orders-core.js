export const PRINT_ORDER_PREFIX = "perler-print-orders";
export const MAX_PRINT_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_PRINT_FILES = 3;
export const ALLOWED_PRINT_EXTENSIONS = new Set(["jpg", "jpeg", "png", "pdf"]);
export const ALLOWED_PRINT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function jsonResponse(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(statusCode).json(payload);
}

export function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function pad2(value) {
  return String(value).padStart(2, "0");
}

function getShanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
  };
}

export function getDateString(date = new Date()) {
  const parts = getShanghaiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getRecentDateStrings(days = 7, now = new Date()) {
  const dates = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    dates.push(getDateString(date));
  }
  return dates;
}

export function makeOrderNo(now = new Date()) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const byte of bytes) {
    random += chars[byte % chars.length];
  }
  const parts = getShanghaiDateParts(now);
  return `PB-${parts.month}${parts.day}-${random}`;
}

export function buildOrderPrefix(dateString, orderNo) {
  return `${PRINT_ORDER_PREFIX}/${dateString}/${orderNo}`;
}

export function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function getExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function getSafeFileName(index, extension) {
  return `file-${index}.${extension === "jpeg" ? "jpg" : extension}`;
}

export function getContentType(extension) {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
}

export function isAllowedMime(mimeType, extension) {
  const normalized = String(mimeType || "").toLowerCase();
  if (!normalized) return true;
  if (!ALLOWED_PRINT_TYPES.has(normalized)) return false;
  if ((extension === "jpg" || extension === "jpeg") && normalized === "image/jpeg") return true;
  if (extension === "png" && normalized === "image/png") return true;
  if (extension === "pdf" && normalized === "application/pdf") return true;
  return false;
}

export function detectMagic(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
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
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf";
  }
  return "";
}

export function validateFileMeta({ originalName, mimeType, size, bytes }) {
  const extension = getExtension(originalName);
  if (!ALLOWED_PRINT_EXTENSIONS.has(extension)) {
    throw new Error("只支持 JPG / PNG / PDF 文件");
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("文件不能为空");
  }
  if (size > MAX_PRINT_FILE_SIZE) {
    throw new Error("单个文件不能超过 20MB");
  }
  if (!isAllowedMime(mimeType, extension)) {
    throw new Error("文件类型与扩展名不匹配");
  }
  const magic = detectMagic(bytes);
  const extensionGroup = extension === "jpeg" ? "jpg" : extension;
  if (magic !== extensionGroup) {
    throw new Error("文件内容格式不正确，请上传 JPG / PNG / PDF");
  }
  return {
    extension,
    safeExtension: extension === "jpeg" ? "jpg" : extension,
    contentType: getContentType(extension),
  };
}

export function validatePin(pin, env = process.env) {
  const expected = String(env.PRINT_ADMIN_PIN || "").trim();
  return Boolean(expected && String(pin || "").trim() === expected);
}

export function getPinFromNodeRequest(req) {
  return req.headers["x-print-admin-pin"] || req.query?.pin || "";
}

export function getPinFromWebRequest(request) {
  const url = new URL(request.url);
  return request.headers.get("x-print-admin-pin") || url.searchParams.get("pin") || "";
}

export function isRecentOrder(order, now = new Date()) {
  const submitted = new Date(order.submittedAt);
  if (Number.isNaN(submitted.getTime())) return false;
  return now.getTime() - submitted.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

export function publicOrder(order) {
  return {
    orderNo: order.orderNo,
    submittedAt: order.submittedAt,
    contact: order.contact,
    note: order.note || "",
    files: Array.isArray(order.files)
      ? order.files.map((file) => ({
          originalName: file.originalName,
          fileName: file.fileName,
          size: file.size,
          contentType: file.contentType,
        }))
      : [],
  };
}

export function formatBytes(size) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export function assertOrderNo(value) {
  const orderNo = String(value || "").trim();
  if (!/^PB-\d{4}-[A-Z0-9]{5}$/.test(orderNo)) {
    throw new Error("订单号不正确");
  }
  return orderNo;
}

export function assertSafeStoredFileName(value) {
  const fileName = String(value || "").trim();
  if (!/^file-[1-3]\.(jpg|png|pdf)$/.test(fileName)) {
    throw new Error("文件名不正确");
  }
  return fileName;
}

export function attachmentFileName(filename) {
  const fallback = String(filename || "print-file").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  return encodeURIComponent(fallback);
}
