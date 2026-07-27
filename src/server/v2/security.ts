import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { AppError } from "./errors";
import { getDatabasePool } from "./repository-factory";

type LocalBucket = {
  timestamps: number[];
  expiresAt: number;
};

const LOCAL_BUCKET_LIMIT = 10_000;
const LOCAL_CLEANUP_BATCH = 128;
const DURABLE_CLEANUP_BATCH = 100;
const buckets = new Map<string, LocalBucket>();
let requestsSinceCleanup = 0;

function opaqueBucketKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function cleanupLocalBuckets(now: number): void {
  let inspected = 0;
  for (const [key, bucket] of buckets) {
    if (inspected >= LOCAL_CLEANUP_BATCH) break;
    inspected += 1;
    if (bucket.expiresAt <= now) {
      buckets.delete(key);
      continue;
    }

    // Rotate live entries so later bounded sweeps eventually inspect the
    // entire map without doing an unbounded scan on any request.
    buckets.delete(key);
    buckets.set(key, bucket);
  }
}

function enforceLocalRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): void {
  const now = options.now ?? Date.now();
  const cutoff = now - options.windowMs;
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup >= LOCAL_CLEANUP_BATCH) {
    requestsSinceCleanup = 0;
    cleanupLocalBuckets(now);
  }

  const existing = buckets.get(key);
  const recent = (existing?.timestamps ?? []).filter((value) => value > cutoff);
  if (recent.length >= options.limit) {
    throw new AppError(429, "RATE_LIMITED", "Too many requests; please retry later");
  }

  if (!existing && buckets.size >= LOCAL_BUCKET_LIMIT) {
    cleanupLocalBuckets(now);
    if (buckets.size >= LOCAL_BUCKET_LIMIT) {
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Too many requests; please retry later",
      );
    }
  }

  recent.push(now);
  buckets.set(key, {
    timestamps: recent,
    expiresAt: now + options.windowMs,
  });
}

export async function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): Promise<void> {
  const bucketKey = opaqueBucketKey(key);
  enforceLocalRateLimit(bucketKey, options);
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Shared abuse protection is not configured",
      );
    }
    return;
  }

  const now = options.now ?? Date.now();
  const windowStartMs = Math.floor(now / options.windowMs) * options.windowMs;
  try {
    const result = await getDatabasePool().query(
      `WITH expired_candidates AS MATERIALIZED (
         SELECT bucket_key, window_started_at
         FROM v2_rate_limit_buckets
         WHERE expires_at <= $2
         ORDER BY expires_at
         LIMIT ${DURABLE_CLEANUP_BATCH}
         FOR UPDATE SKIP LOCKED
       ), expired AS (
         DELETE FROM v2_rate_limit_buckets AS buckets
         USING expired_candidates
         WHERE buckets.bucket_key = expired_candidates.bucket_key
           AND buckets.window_started_at = expired_candidates.window_started_at
         RETURNING 1
       )
       INSERT INTO v2_rate_limit_buckets (
         bucket_key, window_started_at, request_count, expires_at
       )
       SELECT $1, $3, 1, $4
       FROM (SELECT count(*) FROM expired) AS cleanup
       ON CONFLICT (bucket_key, window_started_at)
       DO UPDATE SET request_count = v2_rate_limit_buckets.request_count + 1
       WHERE v2_rate_limit_buckets.request_count < $5
       RETURNING request_count`,
      [
        bucketKey,
        new Date(now).toISOString(),
        new Date(windowStartMs).toISOString(),
        new Date(windowStartMs + options.windowMs * 2).toISOString(),
        options.limit,
      ],
    );
    if (!result.rowCount) {
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Too many requests; please retry later",
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Shared abuse protection is temporarily unavailable",
    );
  }
}

export async function enforceMagicLinkRateLimits(
  email: string,
  address: string,
  options: { now?: number } = {},
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const emailBucket = opaqueBucketKey(normalizedEmail);
  const now = options.now;
  const hourMs = 60 * 60 * 1000;

  // Keep a service-wide ceiling in addition to the recipient and source
  // controls. This bounds mail spend even if an attacker rotates both.
  await enforceRateLimit("magic-link:global", {
    limit: 1_000,
    windowMs: hourMs,
    now,
  });
  await enforceRateLimit(`magic-link:ip:${address}`, {
    limit: 10,
    windowMs: hourMs,
    now,
  });
  await enforceRateLimit(`magic-link:email:${emailBucket}`, {
    limit: 5,
    windowMs: hourMs,
    now,
  });
}

export function clientAddress(
  request: Pick<Request, "headers">,
): string {
  const configuredHeader =
    process.env.V2_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  const supportedHeaders = new Set([
    "cf-connecting-ip",
    "fly-client-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ]);
  if (!configuredHeader || !supportedHeaders.has(configuredHeader)) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        503,
        "TRUSTED_CLIENT_IP_NOT_CONFIGURED",
        "Trusted ingress client addressing is not configured",
      );
    }
    return "unknown";
  }
  const raw = request.headers.get(configuredHeader);
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        503,
        "TRUSTED_CLIENT_IP_MISSING",
        "Trusted ingress did not provide a valid client address",
      );
    }
    return "unknown";
  }
  // x-forwarded-for is accepted only when the deployment explicitly names it
  // as the header its trusted ingress overwrites. Never trust it by default.
  const candidate = raw.split(",")[0]?.trim() ?? "";
  if (isIP(candidate)) return candidate;
  if (process.env.NODE_ENV === "production") {
    throw new AppError(
      503,
      "TRUSTED_CLIENT_IP_INVALID",
      "Trusted ingress provided an invalid client address",
    );
  }
  return "unknown";
}

export async function assertSafeExternalUrl(
  raw: string,
  options: {
    allowedHosts?: string[];
    allowHttpInDevelopment?: boolean;
  } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "INVALID_URL", "URL is invalid");
  }
  const allowHttp =
    options.allowHttpInDevelopment === true && process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new AppError(400, "UNSAFE_URL", "Only HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new AppError(400, "UNSAFE_URL", "URLs with embedded credentials are forbidden");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    options.allowedHosts &&
    !options.allowedHosts.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    )
  ) {
    throw new AppError(400, "UNSAFE_URL", "URL host is not allowlisted");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateHost(hostname)) {
    throw new AppError(400, "UNSAFE_URL", "Private network URLs are forbidden");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((item) => isPrivateHost(item.address))) {
    throw new AppError(400, "UNSAFE_URL", "URL does not resolve to a public address");
  }
  return url;
}

export function isPrivateHost(host: string): boolean {
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return true;
  }
  if (isIP(host) === 6) {
    const normalized = host.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPrivateHost(normalized.slice(7));
    return false;
  }
  if (isIP(host) !== 4) return false;
  const parts = host.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
  requestsSinceCleanup = 0;
}

export function localRateLimitBucketCountForTests(): number {
  return buckets.size;
}
