/**
 * In-memory cache store: bounded size, per-entry TTL, oldest-entry eviction.
 */

import type { CacheManager, CacheSetOptions } from './cache-manager.ts';

export const DEFAULT_TTL_MS = 300_000;
export const DEFAULT_MAX_SIZE = 1_000;

export interface MemoryCacheOptions {
  /** Default entry lifetime in milliseconds. */
  ttlMs?: number;
  /** Maximum number of entries kept at once. */
  maxSize?: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class MemoryCacheStore implements CacheManager {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #inflight = new Map<string, Promise<unknown>>();
  readonly #ttlMs: number;
  readonly #maxSize: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }

  get maxSize(): number {
    return this.#maxSize;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#live(key);
    return entry ? (entry.value as T) : undefined;
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    const ttl = options?.ttlMs ?? this.#ttlMs;
    this.#entries.delete(key);
    this.#entries.set(key, { value: this.#copy(value), expiresAt: Date.now() + ttl });
    this.#evict();
  }

  async delete(key: string): Promise<boolean> {
    return this.#entries.delete(key);
  }

  async clear(): Promise<void> {
    this.#entries.clear();
  }

  async has(key: string): Promise<boolean> {
    return this.#live(key) !== undefined;
  }

  async wrap<T>(key: string, loader: () => Promise<T>, options?: CacheSetOptions): Promise<T> {
    const cached = this.#live(key);
    if (cached) return cached.value as T;

    // Two callers that miss at the same time must not both run the loader.
    const running = this.#inflight.get(key);
    if (running) return running as Promise<T>;

    const promise = (async () => {
      const value = await loader();
      await this.set(key, value, options);
      return value;
    })();
    this.#inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.#inflight.delete(key);
    }
  }

  /**
   * Stores a copy of the value, so a caller that mutates the object it passed
   * in cannot change what the cache holds.
   */
  #copy(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (Array.isArray(value)) return value.map((item) => this.#copy(item));
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = this.#copy(item);
    }
    return copy;
  }

  /** Returns the entry only while it is alive, dropping it when expired. */
  #live(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  #evict(): void {
    while (this.#entries.size > this.#maxSize) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }
}
