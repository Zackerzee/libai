const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_ENTRY_MS = DAY_MS * 2;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const REVIEW_REFILL_WINDOW_MS = 64 * 1000;

const rateLimits = new Map();
let lastCleanup = Date.now();

function createBucket(capacity, windowMs, now) {
  return {
    capacity,
    refillPerMs: capacity / windowMs,
    tokens: capacity,
    updatedAt: now,
  };
}

function refillBucket(bucket, now) {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
  bucket.updatedAt = now;
}

function secondsUntilToken(bucket) {
  if (bucket.tokens >= 1) return 0;
  return Math.max(1, Math.ceil((1 - bucket.tokens) / bucket.refillPerMs / 1000));
}

function getClientIp(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "unknown";
}

function cleanupStaleEntries(now) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [ip, entry] of rateLimits) {
    if (now - entry.lastSeen > STALE_ENTRY_MS) rateLimits.delete(ip);
  }
}

function consumeRateLimit(ip, now, pathname) {
  cleanupStaleEntries(now);
  const isReviewApi = pathname === "/api/review";
  const minuteCapacity = isReviewApi ? 8 : 5;
  const minuteWindowMs = isReviewApi ? REVIEW_REFILL_WINDOW_MS : MINUTE_MS;

  let entry = rateLimits.get(ip);
  if (!entry) {
    entry = {
      minute: createBucket(minuteCapacity, minuteWindowMs, now),
      day: createBucket(50, DAY_MS, now),
      lastSeen: now,
    };
    rateLimits.set(ip, entry);
  } else if (entry.minute.capacity !== minuteCapacity) {
    entry.minute = createBucket(minuteCapacity, minuteWindowMs, now);
  }

  entry.lastSeen = now;
  refillBucket(entry.minute, now);
  refillBucket(entry.day, now);

  if (entry.minute.tokens < 1 || entry.day.tokens < 1) {
    return {
      allowed: false,
      retryAfter: Math.max(secondsUntilToken(entry.minute), secondsUntilToken(entry.day)),
    };
  }

  entry.minute.tokens -= 1;
  entry.day.tokens -= 1;
  return { allowed: true, retryAfter: 0 };
}

function tooManyRequests(retryAfter) {
  return new Response(JSON.stringify({ error: "Too Many Requests", retryAfter }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(retryAfter),
      "Cache-Control": "no-store",
    },
  });
}

export function middleware(request) {
  const result = consumeRateLimit(getClientIp(request), Date.now(), request.nextUrl?.pathname || "");
  if (!result.allowed) return tooManyRequests(result.retryAfter);
}

export const config = {
  matcher: ["/api/convert", "/api/review"],
};
