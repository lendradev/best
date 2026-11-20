/**
 * Scheduler DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { createScheduler, type SchedulerOptions } from './scheduler.ts';

export const SCHEDULER = Symbol('best:scheduler');

/**
 * Registers a scheduler as a singleton.
 *
 *   @Module({ imports: [SchedulerModule] })
 */
@Module({
  providers: [
    {
      provide: SCHEDULER,
      useFactory: () => createScheduler(),
    },
  ],
  exports: [SCHEDULER],
})
export class SchedulerModule {}

/**
 * Builds a scheduler module with a custom configuration.
 *
 *   @Module({ imports: [createSchedulerModule({ onError })] })
 */
export function createSchedulerModule(options: SchedulerOptions): typeof SchedulerModule {
  class ConfiguredSchedulerModule {}
  Object.defineProperty(ConfiguredSchedulerModule, 'name', { value: 'SchedulerModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: SCHEDULER,
          useFactory: () => createScheduler(options),
        },
      ],
      exports: [SCHEDULER],
    },
    ConfiguredSchedulerModule,
  );
  return ConfiguredSchedulerModule;
}
