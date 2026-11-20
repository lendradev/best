/**
 * Cache contract.
 *
 * The framework ships an in-memory implementation only, but everything here
 * speaks to the interface so a different store can replace it without
 * touching call sites.
 */

export interface CacheSetOptions {
  /** Lifetime of the entry in milliseconds. Falls back to the store default. */
  ttlMs?: number;
}

export interface CacheManager {
  /** Returns the stored value, or `undefined` when the key is absent or expired. */
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  /** Returns `true` when an entry was removed. */
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  /**
   * Returns the cached value or loads it. A loader that throws propagates the
   * error and stores nothing.
   */
  wrap<T>(key: string, loader: () => Promise<T>, options?: CacheSetOptions): Promise<T>;
}
