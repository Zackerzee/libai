import crypto from "node:crypto";

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback || "").trim();
}

function getR2Config() {
  const accountId = getEnv("R2_ACCOUNT_ID") || getEnv("CLOUDFLARE_ACCOUNT_ID") || getEnv("PRINT_UPLOADS_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID") || getEnv("PRINT_UPLOADS_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY") || getEnv("PRINT_UPLOADS_SECRET_ACCESS_KEY");
  const bucket = getEnv("PRINT_UPLOADS_BUCKET") || getEnv("R2_BUCKET_NAME") || getEnv("R2_BUCKET") || getEnv("PRINT_UPLOADS");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing R2 environment variables");
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    host: `${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    service: "s3",
  };
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value || "").digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function amzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    dateTime: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function encodePath(value) {
  return String(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function encodeQuery(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(query = {}) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeQuery(key)}=${encodeQuery(value)}`)
    .join("&");
}

async function r2Request({ method, key = "", query = {}, body, contentType }) {
  const config = getR2Config();
  const payload = body ? Buffer.from(body) : Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const { dateTime, dateStamp } = amzDate();
  const canonicalUri = key ? `/${config.bucket}/${encodePath(key)}` : `/${config.bucket}`;
  const queryString = canonicalQuery(query);
  const headers = {
    host: config.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateTime,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [method, canonicalUri, queryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/${config.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(getSigningKey(config.secretAccessKey, dateStamp, config.region, config.service), stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `https://${config.host}${canonicalUri}${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body: method === "GET" ? undefined : payload,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`R2 ${method} failed: ${response.status} ${text.slice(0, 300)}`);
  }

  return response;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function putR2Object(key, body, contentType = "application/octet-stream") {
  await r2Request({ method: "PUT", key, body, contentType });
}

export async function getR2Object(key) {
  const response = await r2Request({ method: "GET", key });
  const arrayBuffer = await response.arrayBuffer();
  return {
    body: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function listR2Keys(prefix) {
  const keys = [];
  let continuationToken = "";

  for (let page = 0; page < 20; page += 1) {
    const query = {
      "list-type": "2",
      prefix,
    };
    if (continuationToken) query["continuation-token"] = continuationToken;

    const response = await r2Request({ method: "GET", query });
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
      keys.push(decodeXml(match[1]));
    }
    const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
    if (!next) break;
    continuationToken = decodeXml(next[1]);
  }

  return keys;
}
