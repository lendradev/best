import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import type { ExecutionContext } from '../src/http/contracts.ts';
import {
  SERIALIZATION_INTERCEPTOR,
  SerializationModule,
  createSerializationInterceptor,
  createSerializationModule,
} from '../src/serialization/index.ts';

function context(): ExecutionContext {
  return {
    method: 'GET',
    path: '/users',
    params: {},
    query: new URLSearchParams(),
    headers: new Headers(),
    body: undefined,
    request: undefined,
    state: {},
  };
}

describe('createSerializationInterceptor', () => {
  test('passes the result through without a transform', async () => {
    const interceptor = createSerializationInterceptor();
    const result = await interceptor.intercept(context(), async () => ({ id: 1 }));
    expect(result).toEqual({ id: 1 });
  });

  test('applies the transform to the result', async () => {
    const interceptor = createSerializationInterceptor({
      transform: (value) => ({ data: value }),
    });
    const result = await interceptor.intercept(context(), async () => ({ id: 1 }));
    expect(result).toEqual({ data: { id: 1 } });
  });

  test('the transform receives the execution context', async () => {
    let seen: ExecutionContext | undefined;
    const interceptor = createSerializationInterceptor({
      transform: (value, ctx) => {
        seen = ctx;
        return value;
      },
    });
    await interceptor.intercept(context(), async () => 'ok');
    expect(seen?.path).toBe('/users');
  });

  test('the transform may drop a field', async () => {
    const interceptor = createSerializationInterceptor({
      transform: (value) => {
        const record = value as Record<string, unknown>;
        return { id: record.id };
      },
    });
    const result = await interceptor.intercept(context(), async () => ({ id: 1, secret: 'x' }));
    expect(result).toEqual({ id: 1 });
  });

  test('the transform may return a primitive', async () => {
    const interceptor = createSerializationInterceptor({ transform: () => 'done' });
    expect(await interceptor.intercept(context(), async () => ({ id: 1 }))).toBe('done');
  });

  test('a handler error passes through', async () => {
    const interceptor = createSerializationInterceptor({ transform: (value) => value });
    expect(
      interceptor.intercept(context(), async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('SerializationModule', () => {
  test('resolves the interceptor from the container', async () => {
    @Module({ imports: [SerializationModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const interceptor = app.container.resolve<
      ReturnType<typeof createSerializationInterceptor>
    >(SERIALIZATION_INTERCEPTOR);
    expect(typeof interceptor.intercept).toBe('function');
    await app.close();
  });

  test('createSerializationModule applies the transform', async () => {
    @Module({
      imports: [createSerializationModule({ transform: (value) => ({ wrapped: value }) })],
    })
    class AppModule {}

    const app = await createContext([AppModule]);
    const interceptor = app.container.resolve<
      ReturnType<typeof createSerializationInterceptor>
    >(SERIALIZATION_INTERCEPTOR);
    const result = await interceptor.intercept(context(), async () => 'value');
    expect(result).toEqual({ wrapped: 'value' });
    await app.close();
  });
});
