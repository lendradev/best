/**
 * Rate limiter DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { createRateLimiter, type RateLimiterOptions } from './ratelimit.ts';

export const RATE_LIMITER = Symbol('best:rate-limiter');

/**
 * Registers a rate limiter as a singleton.
 *
 *   @Module({ imports: [RateLimiterModule] })
 */
@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      useFactory: () => createRateLimiter(),
    },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimiterModule {}

/**
 * Builds a rate limiter module with a custom configuration.
 *
 *   @Module({ imports: [createRateLimiterModule({ limit: 60, windowMs: 60_000 })] })
 */
export function createRateLimiterModule(options: RateLimiterOptions): typeof RateLimiterModule {
  class ConfiguredRateLimiterModule {}
  Object.defineProperty(ConfiguredRateLimiterModule, 'name', { value: 'RateLimiterModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: RATE_LIMITER,
          useFactory: () => createRateLimiter(options),
        },
      ],
      exports: [RATE_LIMITER],
    },
    ConfiguredRateLimiterModule,
  );
  return ConfiguredRateLimiterModule;
}
