/**
 * Health check DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { createHealthCheck, type HealthCheckOptions, type HealthIndicator } from './health.ts';

export const HEALTH_CHECK = Symbol('best:health-check');

/**
 * Registers a health check as a singleton.
 *
 *   @Module({ imports: [HealthModule] })
 */
@Module({
  providers: [
    {
      provide: HEALTH_CHECK,
      useFactory: () => createHealthCheck(),
    },
  ],
  exports: [HEALTH_CHECK],
})
export class HealthModule {}

/**
 * Builds a health module with the given indicators.
 *
 *   @Module({ imports: [createHealthModule([databaseIndicator])] })
 */
export function createHealthModule(
  indicators: HealthIndicator[] = [],
  options: HealthCheckOptions = {},
): typeof HealthModule {
  class ConfiguredHealthModule {}
  Object.defineProperty(ConfiguredHealthModule, 'name', { value: 'HealthModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: HEALTH_CHECK,
          useFactory: () => createHealthCheck(indicators, options),
        },
      ],
      exports: [HEALTH_CHECK],
    },
    ConfiguredHealthModule,
  );
  return ConfiguredHealthModule;
}
