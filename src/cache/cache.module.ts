/**
 * Cache DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { MemoryCacheStore, type MemoryCacheOptions } from './memory-store.ts';

export const CACHE_MANAGER = Symbol('best:cache-manager');

/**
 * Registers the in-memory cache manager as a singleton.
 *
 *   @Module({ imports: [CacheModule] })
 */
@Module({
  providers: [
    {
      provide: CACHE_MANAGER,
      useClass: MemoryCacheStore,
    },
  ],
  exports: [CACHE_MANAGER],
})
export class CacheModule {}

/**
 * Builds a cache module with a custom store configuration.
 *
 *   @Module({ imports: [createCacheModule({ ttlMs: 1000, maxSize: 10 })] })
 */
export function createCacheModule(options: MemoryCacheOptions): typeof CacheModule {
  class ConfiguredCacheModule {}
  Object.defineProperty(ConfiguredCacheModule, 'name', { value: 'CacheModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: CACHE_MANAGER,
          useFactory: () => new MemoryCacheStore(options),
        },
      ],
      exports: [CACHE_MANAGER],
    },
    ConfiguredCacheModule,
  );
  return ConfiguredCacheModule;
}
