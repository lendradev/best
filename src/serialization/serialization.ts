/**
 * Serialization interceptor.
 *
 * The interceptor maps the value a handler returned into the value the client
 * receives. Without a transform it changes nothing.
 */

import type { ExecutionContext, NestInterceptor } from '../http/contracts.ts';

export interface SerializationOptions {
  /** Maps the handler result into the response body. */
  transform?: (value: unknown, context: ExecutionContext) => unknown;
}

export interface SerializationInterceptor extends NestInterceptor {
  intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown>;
}

export function createSerializationInterceptor(
  options: SerializationOptions = {},
): SerializationInterceptor {
  const transform = options.transform;

  return {
    async intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
      const result = await next();
      if (!transform) return result;
      return transform(result, context);
    },
  };
}
