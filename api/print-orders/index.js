import {
  MAX_PRINT_FILES,
  assertOrderNo,
  buildOrderPrefix,
  cleanText,
  getDateString,
  getPinFromNodeRequest,
  getRecentDateStrings,
  getSafeFileName,
  isRecentOrder,
  jsonResponse,
  makeOrderNo,
  publicOrder,
  validateFileMeta,
  validatePin,
} from "../../lib/print-orders-core.js";
import { getR2Object, listR2Keys, putR2Object } from "../../lib/r2-s3.js";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "70mb",
  },
};

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of String(value || "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawValue.length) continue;
    const key = rawKey.toLowerCase();
    result[key] = rawValue.join("=").replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("上传数据格式不正确");

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const raw = buffer.toString("latin1");
  const parts = raw.split(`--${boundary}`);
  const fields = {};
  const files = [];

  for (const part of parts) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;

    const headerText = part.slice(0, headerEnd);
    let bodyText = part.slice(headerEnd + 4);
    if (bodyText.endsWith("\r\n")) bodyText = bodyText.slice(0, -2);
    if (bodyText.endsWith("--")) bodyText = bodyText.slice(0, -2);

    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const index = line.indexOf(":");
      if (index > -1) {
        headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }
    }

    const disposition = parseContentDisposition(headers["content-disposition"]);
    const name = disposition.name;
    const filename = disposition.filename;
    if (!name) continue;

    if (filename) {
      const data = Buffer.from(bodyText, "latin1");
      files.push({
        fieldName: name,
        originalName: filename,
        mimeType: headers["content-type"] || "",
        size: data.length,
        data,
      });
    } else {
      fields[name] = Buffer.from(bodyText, "latin1").toString("utf8");
    }
  }

  return { fields, files };
}

async function listRecentOrders() {
  const orders = [];
  const dates = getRecentDateStrings(7);

  for (const dateString of dates) {
    const keys = await listR2Keys(`perler-print-orders/${dateString}/`);
    const orderJsonKeys = keys.filter((key) => key.endsWith("/order.json"));
    for (const key of orderJsonKeys) {
      try {
        const object = await getR2Object(key);
        const order = JSON.parse(object.body.toString("utf8"));
        if (isRecentOrder(order)) orders.push(publicOrder(order));
      } catch (error) {
        console.error("Failed to read print order", key, error);
      }
    }
  }

  return orders.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

async function handleGet(req, res) {
  if (!validatePin(getPinFromNodeRequest(req))) {
    return jsonResponse(res, 401, { error: "PIN 不正确" });
  }

  const orders = await listRecentOrders();
  return jsonResponse(res, 200, { orders });
}

async function handlePost(req, res) {
  const body = await readRequestBody(req);
  const { fields, files } = parseMultipart(body, req.headers["content-type"]);
  const contact = cleanText(fields.contact, 80);
  const note = cleanText(fields.note, 300);
  const uploadFiles = files.filter((file) => file.fieldName === "files" || file.fieldName === "files[]");

  if (!contact) {
    return jsonResponse(res, 400, { error: "请填写微信昵称或手机号" });
  }
  if (uploadFiles.length === 0) {
    return jsonResponse(res, 400, { error: "请上传拼豆图纸图片或 PDF" });
  }
  if (uploadFiles.length > MAX_PRINT_FILES) {
    return jsonResponse(res, 400, { error: "最多上传 3 个文件" });
  }

  const now = new Date();
  const dateString = getDateString(now);
  const orderNo = assertOrderNo(makeOrderNo(now));
  const orderPrefix = buildOrderPrefix(dateString, orderNo);
  const storedFiles = [];

  for (let index = 0; index < uploadFiles.length; index += 1) {
    const file = uploadFiles[index];
    const validation = validateFileMeta({
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      bytes: file.data,
    });
    const fileName = getSafeFileName(index + 1, validation.safeExtension);
    const key = `${orderPrefix}/${fileName}`;

    await putR2Object(key, file.data, validation.contentType);
    storedFiles.push({
      originalName: cleanText(file.originalName, 160) || fileName,
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

  await putR2Object(`${orderPrefix}/order.json`, Buffer.from(JSON.stringify(order, null, 2)), "application/json; charset=utf-8");
  return jsonResponse(res, 200, { orderNo });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    res.setHeader("Allow", "GET, POST");
    return jsonResponse(res, 405, { error: "Method Not Allowed" });
  } catch (error) {
    console.error("Print orders API error", error);
    return jsonResponse(res, 500, { error: error.message || "图纸提交失败，请联系店员" });
  }
}
