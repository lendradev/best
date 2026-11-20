/**
 * Serialization DI wiring.
 */

import { Module } from '../core/decorators.ts';
import { METADATA_KEY, defineMetadata } from '../core/metadata.ts';
import { createSerializationInterceptor, type SerializationOptions } from './serialization.ts';

export const SERIALIZATION_INTERCEPTOR = Symbol('best:serialization-interceptor');

/**
 * Registers a pass-through serialization interceptor as a singleton.
 *
 *   @Module({ imports: [SerializationModule] })
 */
@Module({
  providers: [
    {
      provide: SERIALIZATION_INTERCEPTOR,
      useFactory: () => createSerializationInterceptor(),
    },
  ],
  exports: [SERIALIZATION_INTERCEPTOR],
})
export class SerializationModule {}

/**
 * Builds a serialization module with a custom transform.
 *
 *   @Module({ imports: [createSerializationModule({ transform })] })
 */
export function createSerializationModule(
  options: SerializationOptions,
): typeof SerializationModule {
  class ConfiguredSerializationModule {}
  Object.defineProperty(ConfiguredSerializationModule, 'name', { value: 'SerializationModule' });
  defineMetadata(
    METADATA_KEY.MODULE,
    {
      imports: [],
      controllers: [],
      providers: [
        {
          provide: SERIALIZATION_INTERCEPTOR,
          useFactory: () => createSerializationInterceptor(options),
        },
      ],
      exports: [SERIALIZATION_INTERCEPTOR],
    },
    ConfiguredSerializationModule,
  );
  return ConfiguredSerializationModule;
}
