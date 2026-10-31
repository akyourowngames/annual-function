import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rateLimitKey } from "@/lib/security/family";
import { HttpError } from "./http";

// ---------------------------------------------------------------------------
// Shared, database-backed rate limiting.
//
// The original implementation used an in-process `Map`, which resets on every
// serverless cold start and is not shared between instances, so an attacker
// could bypass it simply by hitting a different instance. These counters live in
// PostgreSQL and are updated atomically.
// ---------------------------------------------------------------------------

export type RateBucket = { key: string; limit: number; windowSeconds: number };

// How often stale limiter rows are swept. The table only needs tidying
// occasionally; doing it inline on every request was a write on the hot path.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

export function limiterSecret(): string {
  const secret =
    process.env.FAMILY_SESSION_SECRET ||
    process.env.FAMILY_OTP_SECRET ||
    process.env.ADMIN_ACCESS_KEY;
  if (!secret)
    throw new HttpError(
      "Family verification is not configured. Contact the event team.",
      503,
    );
  return secret;
}

/** Hash raw identifiers (IPs, codes) before they touch the database. */
export function hashedKey(value: string): string {
  return rateLimitKey(limiterSecret(), value);
}

/** Best-effort client identity. Vercel sets x-forwarded-for; fall back to a bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  return ip || "unknown";
}

export type RateResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  bucket?: RateBucket;
};

/**
 * Consume one unit from every bucket atomically. All buckets must pass; if any
 * is exhausted the request is rejected. Counters are still incremented so
 * repeated attempts stay throttled.
 */
export async function consumeRateLimits(buckets: RateBucket[]): Promise<RateResult> {
  if (!buckets.length) return { allowed: true, retryAfterSeconds: 0 };
  const db = getDb();
  // No transaction here on purpose. Each bucket update is a single atomic
  // INSERT … ON CONFLICT statement, so it is already safe under concurrency;
  // wrapping them in BEGIN/COMMIT added two extra network round trips to every
  // request, which measured ~450ms against a remote pooler versus ~150ms for a
  // bare query. The limiter guards the hot path, so that cost mattered.
  const outcome = await (async () => {
    let allowed = true;
    let retryAfterSeconds = 0;
    let blocking: RateBucket | undefined;
    for (const bucket of buckets) {
      const hash = hashedKey(bucket.key);
      const rows = await db.execute<{
        attempts: number;
        window_start: string | Date;
      }>(sql`
        insert into family_rate_limits (key_hash, window_start, attempts)
        values (${hash}, now(), 1)
        on conflict (key_hash) do update set
          attempts = case
            when family_rate_limits.window_start <= now() - make_interval(secs => ${bucket.windowSeconds})
              then 1
            else least(family_rate_limits.attempts + 1, 1000000)
          end,
          window_start = case
            when family_rate_limits.window_start <= now() - make_interval(secs => ${bucket.windowSeconds})
              then now()
            else family_rate_limits.window_start
          end
        returning attempts, window_start
      `);
      const row = rows[0];
      if (row && Number(row.attempts) > bucket.limit) {
        allowed = false;
        const start =
          row.window_start instanceof Date
            ? row.window_start.getTime()
            : Date.parse(String(row.window_start));
        const elapsed = Number.isFinite(start)
          ? Math.floor((Date.now() - start) / 1000)
          : 0;
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.max(1, bucket.windowSeconds - elapsed),
        );
        if (!blocking) blocking = bucket;
      }
    }
    // Opportunistic cleanup, but NOT on every request: this was a DELETE inside
    // every limiter transaction, i.e. a write on the hot path for a table that
    // only needs tidying hourly. Run it at most once per interval.
    if (Date.now() - lastCleanupAt > CLEANUP_INTERVAL_MS) {
      lastCleanupAt = Date.now();
      await db.execute(
        sql`delete from family_rate_limits where window_start < now() - interval '1 day'`,
      );
    }
    return { allowed, retryAfterSeconds, bucket: blocking };
  })();
  return outcome;
}

/** Throwing variant used by route handlers. */
export async function enforceRateLimits(buckets: RateBucket[]): Promise<void> {
  const result = await consumeRateLimits(buckets);
  if (!result.allowed)
    throw new HttpError(
      "Too many attempts. Please wait a few minutes and try again.",
      429,
    );
}
