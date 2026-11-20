/**
 * Serialization entry point.
 */
export { createSerializationInterceptor } from './serialization.ts';
export type { SerializationInterceptor, SerializationOptions } from './serialization.ts';
export {
  SERIALIZATION_INTERCEPTOR,
  SerializationModule,
  createSerializationModule,
} from './serialization.module.ts';
