import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const FILE_NAME = "libms-niimbot-windows-bridge.zip";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const filePath = path.join(process.cwd(), "downloads", FILE_NAME);

  try {
    const fileStat = await stat(filePath);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(fileStat.size));
    res.setHeader("Content-Disposition", `attachment; filename="${FILE_NAME}"`);
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    res.status(200);
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("Windows bridge download failed", error);
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "download_not_found" });
  }
}
