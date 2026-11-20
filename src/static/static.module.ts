/**
 * Static file DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { createStaticHandler, type StaticFilesOptions } from './static.ts';

export const STATIC_FILES = Symbol('best:static-files');

/**
 * Registers the static file handler as a singleton.
 *
 *   @Module({ imports: [StaticFilesModule] })
 */
@Module({
  providers: [
    {
      provide: STATIC_FILES,
      useFactory: () => createStaticHandler({ root: 'public' }),
    },
  ],
  exports: [STATIC_FILES],
})
export class StaticFilesModule {}

/**
 * Builds a static file module with a custom configuration.
 *
 *   @Module({ imports: [createStaticFilesModule({ root: 'assets' })] })
 */
export function createStaticFilesModule(options: StaticFilesOptions): typeof StaticFilesModule {
  class ConfiguredStaticFilesModule {}
  Object.defineProperty(ConfiguredStaticFilesModule, 'name', { value: 'StaticFilesModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: STATIC_FILES,
          useFactory: () => createStaticHandler(options),
        },
      ],
      exports: [STATIC_FILES],
    },
    ConfiguredStaticFilesModule,
  );
  return ConfiguredStaticFilesModule;
}
