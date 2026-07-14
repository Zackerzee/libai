import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LabelType,
  NiimbotNodeSerialClient,
} from "@mmote/niimbluelib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.LIBMS_PRINT_HOST || "127.0.0.1";
const PORT = Number(process.env.LIBMS_PRINT_PORT || 17888);
const SERIAL_PORT = process.env.LIBMS_NIIMBOT_PORT || "/dev/cu.usbmodem1301";
const PRINT_DENSITY = Number(process.env.LIBMS_NIIMBOT_DENSITY || 2);
const ALLOWED_ORIGINS = new Set([
  "https://www.libms.net",
  "https://libms.net",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

let printQueue = Promise.resolve();

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://www.libms.net";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin",
  };
}

function jsonResponse(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizePayload(payload) {
  const deskId = String(payload?.deskId || "01").replace(/[^\d]/g, "").padStart(2, "0").slice(-2);
  return {
    deskId,
    session: String(payload?.session || "拼豆计时").slice(0, 40),
    mode: payload?.mode === "countup" ? "countup" : "countdown",
    startLabel: String(payload?.startLabel || "--:--").slice(0, 20),
    endLabel: String(payload?.endLabel || "").slice(0, 20),
    note: String(payload?.note || "").slice(0, 80),
  };
}

function renderLabel(payload) {
  const result = spawnSync("python3", [join(__dirname, "render-label.py")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `render-label.py exited with ${result.status}`);
  }

  const image = JSON.parse(result.stdout);
  image.rowsData = image.rowsData.map((row) => ({
    dataType: row.dataType,
    rowNumber: row.rowNumber,
    repeat: row.repeat,
    blackPixelsCount: row.blackPixelsCount,
    rowData: row.rowDataBase64 ? Uint8Array.from(Buffer.from(row.rowDataBase64, "base64")) : undefined,
  }));
  return image;
}

async function printLabel(payload) {
  const client = new NiimbotNodeSerialClient();
  client.setPort(SERIAL_PORT);
  client.setPacketInterval(10);

  const image = renderLabel(payload);

  try {
    await client.connect();
    const printTask = client.abstraction.newPrintTask("B1", {
      labelType: LabelType.WithGaps,
      density: PRINT_DENSITY,
      totalPages: 1,
      pageTimeoutMs: 15000,
      statusTimeoutMs: 15000,
      statusPollIntervalMs: 500,
    });
    await printTask.printInit();
    await printTask.printPage(image, 1);
    await printTask.waitForPageFinished();
    await printTask.waitForFinished();
    await printTask.printEnd();
  } finally {
    try {
      if (client.isConnected()) await client.disconnect();
    } catch (_) {
      // Ignore disconnect errors. The next request will reconnect.
    }
  }
}

function enqueuePrint(payload) {
  const job = printQueue.then(() => printLabel(payload));
  printQueue = job.catch(() => {});
  return job;
}

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse(request, 200, {
      ok: true,
      printer: "NIIMBOT B3S-P",
      serialPort: SERIAL_PORT,
      port: PORT,
    });
  }

  if (request.method === "POST" && url.pathname === "/print-label") {
    let payload;
    try {
      payload = normalizePayload(await request.json());
    } catch (_) {
      return jsonResponse(request, 400, { ok: false, error: "invalid_json" });
    }

    try {
      await enqueuePrint(payload);
      return jsonResponse(request, 200, { ok: true });
    } catch (error) {
      console.error("[print-label] failed:", error);
      return jsonResponse(request, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "print_failed",
      });
    }
  }

  return jsonResponse(request, 404, { ok: false, error: "not_found" });
}

if (process.argv.includes("--test")) {
  const payload = normalizePayload({
    deskId: "01",
    session: "拼豆计时测试",
    mode: "countdown",
    startLabel: "20:30",
    endLabel: "21:30",
    note: "本机打印桥测试",
  });
  await printLabel(payload);
  console.log("test print complete");
} else {
  const { createServer } = await import("node:http");
  const httpServer = createServer(async (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const request = new Request(`http://${HOST}:${PORT}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const response = await handleRequest(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  });
  httpServer.listen(PORT, HOST, () => {
    console.log(`LIBMS NIIMBOT print bridge listening on http://${HOST}:${PORT}`);
    console.log(`Serial port: ${SERIAL_PORT}`);
  });
}
