import {
  assertOrderNo,
  assertSafeStoredFileName,
  attachmentFileName,
  getPinFromNodeRequest,
  getRecentDateStrings,
  isRecentOrder,
  validatePin,
} from "../../lib/print-orders-core.js";
import { getR2Object, listR2Keys } from "../../lib/r2-s3.js";

async function findOrder(orderNo) {
  for (const dateString of getRecentDateStrings(7)) {
    const keys = await listR2Keys(`perler-print-orders/${dateString}/${orderNo}/`);
    if (!keys.includes(`perler-print-orders/${dateString}/${orderNo}/order.json`)) continue;
    const object = await getR2Object(`perler-print-orders/${dateString}/${orderNo}/order.json`);
    const order = JSON.parse(object.body.toString("utf8"));
    if (isRecentOrder(order)) return order;
  }
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    if (!validatePin(getPinFromNodeRequest(req))) {
      return res.status(401).json({ error: "PIN 不正确" });
    }

    const orderNo = assertOrderNo(req.query.orderNo);
    const fileName = assertSafeStoredFileName(req.query.file);
    const order = await findOrder(orderNo);
    if (!order) {
      return res.status(404).json({ error: "订单不存在或已过期" });
    }

    const file = order.files.find((item) => item.fileName === fileName);
    if (!file) {
      return res.status(404).json({ error: "文件不存在" });
    }

    const object = await getR2Object(file.key);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", file.contentType || object.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${attachmentFileName(file.originalName)}`);
    return res.status(200).send(object.body);
  } catch (error) {
    console.error("Print order download error", error);
    return res.status(500).json({ error: error.message || "下载失败" });
  }
}
