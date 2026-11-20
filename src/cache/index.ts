/**
 * Cache entry point.
 */
export type { CacheManager, CacheSetOptions } from './cache-manager.ts';
export {
  DEFAULT_MAX_SIZE,
  DEFAULT_TTL_MS,
  MemoryCacheStore,
} from './memory-store.ts';
export type { MemoryCacheOptions } from './memory-store.ts';
export { CACHE_MANAGER, CacheModule, createCacheModule } from './cache.module.ts';
