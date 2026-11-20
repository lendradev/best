/**
 * Rate limiter with a fixed window per key.
 *
 * The counter lives in the process heap, so the limit applies to one process.
 * A deployment with several instances has one limiter per instance.
 */

import { TooManyRequestsException, type CanActivate, type ExecutionContext } from '../http/contracts.ts';

export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Requests allowed per window. */
  limit: number;
  /** Unix milliseconds at which the window resets. */
  resetAt: number;
}

export interface RateLimiter {
  /** Counts one request against the key and reports whether it is allowed. */
  check(key: string): Promise<RateLimitResult>;
  /** Forgets the counter of a key. */
  reset(key: string): Promise<void>;
  /** Forgets every counter. */
  clear(): Promise<void>;
}

export interface RateLimiterOptions {
  /** Requests allowed per window. Default 100. */
  limit?: number;
  /** Length of the window in milliseconds. Default 60000. */
  windowMs?: number;
  /** Reads the key of a request. Default reads `x-forwarded-for`, then `x-real-ip`, then `'unknown'`. */
  keyResolver?: (context: ExecutionContext) => string;
  /** Called when a request is blocked. Default throws `TooManyRequestsException`. */
  onBlocked?: (context: ExecutionContext, result: RateLimitResult) => void;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW_MS = 60_000;

interface Window {
  count: number;
  resetAt: number;
}

/** Reads the client address from the proxy headers, falling back to a shared key. */
export function defaultKeyResolver(context: ExecutionContext): string {
  const forwarded = context.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return context.headers.get('x-real-ip') ?? 'unknown';
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const windowMs = Math.max(1, options.windowMs ?? DEFAULT_WINDOW_MS);
  const windows = new Map<string, Window>();

  const windowOf = (key: string): Window => {
    const now = Date.now();
    const existing = windows.get(key);
    if (existing && existing.resetAt > now) return existing;
    const window: Window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
    return window;
  };

  return {
    async check(key: string): Promise<RateLimitResult> {
      const window = windowOf(key);
      window.count += 1;
      const allowed = window.count <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - window.count),
        limit,
        resetAt: window.resetAt,
      };
    },

    async reset(key: string): Promise<void> {
      windows.delete(key);
    },

    async clear(): Promise<void> {
      windows.clear();
    },
  };
}

/**
 * Guard that lets a request through while it stays under the limit and
 * throws `TooManyRequestsException` once it does not.
 */
export class RateLimitGuard implements CanActivate {
  private readonly keyResolver: (context: ExecutionContext) => string;
  private readonly onBlocked: (context: ExecutionContext, result: RateLimitResult) => void;

  constructor(
    private readonly limiter: RateLimiter,
    options: Pick<RateLimiterOptions, 'keyResolver' | 'onBlocked'> = {},
  ) {
    this.keyResolver = options.keyResolver ?? defaultKeyResolver;
    this.onBlocked =
      options.onBlocked ??
      ((_context, result) => {
        throw new TooManyRequestsException(
          `Rate limit exceeded, retry in ${Math.max(0, result.resetAt - Date.now())}ms`,
        );
      });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = await this.limiter.check(this.keyResolver(context));
    if (result.allowed) return true;
    this.onBlocked(context, result);
    return false;
  }
}

/** Builds a guard with its own limiter. */
export function createRateLimitGuard(options: RateLimiterOptions = {}): RateLimitGuard {
  return new RateLimitGuard(createRateLimiter(options), options);
}
