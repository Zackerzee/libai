import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LabelType,
  NiimbotNodeSerialClient,
} from "@mmote/niimbluelib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.LIBMS_PRINT_HOST || "127.0.0.1";
const PORT = Number(process.env.LIBMS_PRINT_PORT || 17888);
const PRINT_DENSITY = Number(process.env.LIBMS_NIIMBOT_DENSITY || 2);
const PYTHON_BIN = process.env.LIBMS_PYTHON_BIN || "python3";
const PYTHON_ARGS = String(process.env.LIBMS_PYTHON_ARGS || "")
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const RAW_SERIAL_PORT = process.env.LIBMS_NIIMBOT_PORT || "auto";
const PRINT_METHOD = String(process.env.LIBMS_PRINT_METHOD || "auto").trim().toLowerCase();
const WINDOWS_PRINTER_NAME = String(process.env.LIBMS_WINDOWS_PRINTER_NAME || "").trim();
const ALLOWED_ORIGINS = new Set([
  "https://www.libms.net",
  "https://libms.net",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

let printQueue = Promise.resolve();

function normalizeSerialPort(value) {
  const port = String(value || "").trim();
  const match = /^COM(\d+)$/i.exec(port);
  if (process.platform === "win32" && match) {
    const normalized = `COM${Number(match[1])}`;
    return Number(match[1]) >= 10 ? `\\\\.\\${normalized}` : normalized;
  }
  return port;
}

function findMacSerialPort() {
  if (process.platform !== "darwin") return "";

  const names = readdirSync("/dev").filter((name) => name.startsWith("cu."));
  const candidates = [
    ...names.filter((name) => /^cu\.usbmodem/i.test(name)),
    ...names.filter((name) => /^cu\.usbserial/i.test(name)),
    ...names.filter((name) => /^cu\.B3S/i.test(name)),
  ];

  return candidates.length ? `/dev/${candidates[0]}` : "";
}

function comName(value) {
  return String(value || "").replace(/^\\\\\.\\/, "").trim().toUpperCase();
}

function scoreWindowsPort(item, preferred) {
  const name = String(item?.Name || "");
  let score = 0;
  if (/NIIMBOT|B3S|B3S_P|B3S-P/i.test(name)) score += 120;
  if (/USB|Serial|串行|CH340|CP210|Prolific/i.test(name)) score += 80;
  if (/Bluetooth|蓝牙/i.test(name)) score -= 140;
  if (comName(item?.Port) === comName(preferred) && score >= 0) score += 20;
  return score;
}

function findWindowsSerialPort(preferred) {
  if (process.platform !== "win32") return "";

  const script = [
    "$ports = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue | Select-Object DeviceID,Name;",
    "if ($ports) { $ports | ConvertTo-Json -Compress }",
  ].join(" ");

  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000,
  });

  if (result.error || result.status !== 0 || !String(result.stdout || "").trim()) return "";

  try {
    const parsed = JSON.parse(String(result.stdout).trim());
    const ports = (Array.isArray(parsed) ? parsed : [parsed])
      .map((item) => ({
        Port: String(item.DeviceID || item.Port || "").trim(),
        Name: String(item.Name || "").trim(),
      }))
      .filter((item) => item.Port);

    if (!ports.length) return "";

    const ranked = ports
      .map((item) => ({ ...item, Score: scoreWindowsPort(item, preferred) }))
      .sort((a, b) => b.Score - a.Score);

    const requested = comName(preferred);
    const requestedItem = ranked.find((item) => comName(item.Port) === requested);
    const best = ranked[0];

    if (!requested || requested === "AUTO") return normalizeSerialPort(best.Port);
    if (!requestedItem) return normalizeSerialPort(best.Port);
    if (best.Score >= 50 && best.Score > requestedItem.Score) return normalizeSerialPort(best.Port);

    return normalizeSerialPort(requestedItem.Port);
  } catch (_) {
    return "";
  }
}

function resolveSerialPort(value) {
  const requested = normalizeSerialPort(value);

  if (process.platform === "win32") {
    return findWindowsSerialPort(requested) || (requested && requested.toLowerCase() !== "auto" ? requested : "COM3");
  }

  if (!requested || requested.toLowerCase() === "auto") {
    return findMacSerialPort() || requested;
  }

  if (process.platform === "darwin" && requested.startsWith("/dev/") && !existsSync(requested)) {
    return findMacSerialPort() || requested;
  }

  return requested;
}

function currentSerialPort() {
  return resolveSerialPort(RAW_SERIAL_PORT);
}

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

function runRenderScript(payload, args = []) {
  const result = spawnSync(PYTHON_BIN, [...PYTHON_ARGS, join(__dirname, "render-label.py"), ...args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      LIBMS_WINDOWS_PRINTER_NAME: WINDOWS_PRINTER_NAME,
    },
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `render-label.py exited with ${result.status}`);
  }

  return JSON.parse(result.stdout);
}

function renderLabel(payload) {
  const image = runRenderScript(payload);
  image.rowsData = image.rowsData.map((row) => ({
    dataType: row.dataType,
    rowNumber: row.rowNumber,
    repeat: row.repeat,
    blackPixelsCount: row.blackPixelsCount,
    rowData: row.rowDataBase64 ? Uint8Array.from(Buffer.from(row.rowDataBase64, "base64")) : undefined,
  }));
  return image;
}

function printWindowsQueueLabel(payload) {
  return runRenderScript(payload, ["--windows-print"]);
}

async function printSerialLabel(payload) {
  const client = new NiimbotNodeSerialClient();
  client.setPort(currentSerialPort());
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

async function printLabel(payload) {
  const errors = [];
  const preferWindowsQueue =
    PRINT_METHOD === "windows-printer" ||
    (PRINT_METHOD === "auto" && process.platform === "win32" && WINDOWS_PRINTER_NAME);

  if (preferWindowsQueue) {
    try {
      return printWindowsQueueLabel(payload);
    } catch (error) {
      if (PRINT_METHOD === "windows-printer") throw error;
      errors.push(`windows-printer: ${error instanceof Error ? error.message : String(error)}`);
      console.warn("[print-label] Windows printer queue failed, trying serial:", error);
    }
  }

  try {
    await printSerialLabel(payload);
    return { ok: true, printer: "serial" };
  } catch (error) {
    errors.push(`serial: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(errors.join(" | "));
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
      platform: process.platform,
      printMethod: PRINT_METHOD,
      windowsPrinterName: WINDOWS_PRINTER_NAME,
      pythonArgs: PYTHON_ARGS,
      rawSerialPort: RAW_SERIAL_PORT,
      serialPort: currentSerialPort(),
      pythonBin: PYTHON_BIN,
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
    console.log(`Print method: ${PRINT_METHOD}`);
    if (WINDOWS_PRINTER_NAME) console.log(`Windows printer: ${WINDOWS_PRINTER_NAME}`);
    if (PYTHON_ARGS.length) console.log(`Python args: ${PYTHON_ARGS.join(" ")}`);
    console.log(`Serial port: ${currentSerialPort()}`);
  });
}
