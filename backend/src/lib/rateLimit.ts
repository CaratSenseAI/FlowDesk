// ─────────────────────────────────────────────────────────────────────────────
// A sliding-window rate limiter for WhatsApp commands.
//
// Scope note, because it matters operationally: this is per-process. FlowDesk
// runs as a single Render web service today, so one process sees every webhook
// and the limit is real. The moment the service is scaled to two instances the
// effective limit doubles and each instance enforces its own window. If that
// day comes, move the counter to Postgres or Redis — do not assume this file
// still does what it says.
//
// What it is actually defending against is narrow and worth being clear about.
// The webhook is already authenticated (an unrecognised phone number is
// dropped before any work happens) and already deduplicated on Meta's message
// id, so this is not spam protection. It is a blast-radius limit: a manager
// whose phone is stolen, or a loop in an integration, cannot rewrite the whole
// task board before anybody notices.
// ─────────────────────────────────────────────────────────────────────────────

interface Window {
  /** Timestamps of accepted commands, oldest first. */
  hits: number[];
}

const windows = new Map<string, Window>();

function config(): { limit: number; windowMs: number } {
  const limit    = parseInt(process.env.WA_COMMAND_RATE_LIMIT ?? '20', 10);
  const seconds  = parseInt(process.env.WA_COMMAND_RATE_WINDOW_S ?? '600', 10);

  return {
    limit:    Number.isFinite(limit) && limit > 0 ? limit : 20,
    windowMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : 600) * 1000,
  };
}

export interface RateLimitResult {
  allowed: boolean;
  /** Commands still available in the current window. */
  remaining: number;
  /** When the window frees up, for the "try again" message. */
  retryAfterSeconds: number;
}

/**
 * Record an attempt and say whether it may proceed.
 *
 * Rejected attempts are NOT counted. Counting them would let a caller who is
 * already over the limit hold themselves over it indefinitely by continuing to
 * send, which turns a throttle into a lockout.
 */
export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  const { limit, windowMs } = config();
  const cutoff = now - windowMs;

  const window = windows.get(key) ?? { hits: [] };
  // Hits are appended in time order, so dropping the expired prefix is enough.
  while (window.hits.length > 0 && window.hits[0] <= cutoff) window.hits.shift();

  if (window.hits.length >= limit) {
    windows.set(key, window);
    const oldest = window.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  window.hits.push(now);
  windows.set(key, window);

  return {
    allowed: true,
    remaining: limit - window.hits.length,
    retryAfterSeconds: 0,
  };
}

/** Test hook — the map is module state and would otherwise leak between cases. */
export function __resetRateLimits(): void {
  windows.clear();
}
