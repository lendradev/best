/**
 * Worker DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { Worker, type WorkerOptions } from './worker.ts';

export const WORKER = Symbol('best:worker');

/**
 * Registers the worker runtime as a singleton.
 *
 *   @Module({ imports: [WorkerModule] })
 */
@Module({
  providers: [
    {
      provide: WORKER,
      useClass: Worker,
    },
  ],
  exports: [WORKER],
})
export class WorkerModule {}

/**
 * Builds a worker module with a custom runtime configuration.
 *
 *   @Module({ imports: [createWorkerModule({ concurrency: 8 })] })
 */
export function createWorkerModule(options: WorkerOptions): typeof WorkerModule {
  class ConfiguredWorkerModule {}
  Object.defineProperty(ConfiguredWorkerModule, 'name', { value: 'WorkerModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: WORKER,
          useFactory: () => new Worker(options),
        },
      ],
      exports: [WORKER],
    },
    ConfiguredWorkerModule,
  );
  return ConfiguredWorkerModule;
}
