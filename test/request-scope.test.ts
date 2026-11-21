import { describe, expect, test } from 'bun:test';
import type { Container } from '../src/core/container.ts';
import { Inject, Injectable, Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import type { ExecutionContext } from '../src/http/contracts.ts';
import { Controller, Get } from '../src/http/route-decorators.ts';
import { Context } from '../src/http/param-decorators.ts';
import { createFetchHandler } from '../src/http/server.ts';

@Injectable({ scope: 'request' })
class RequestId {
  readonly id = Math.random().toString(36).slice(2);
}

@Injectable({ scope: 'request' })
class RequestUser {
  constructor(@Inject(RequestId) readonly requestId: RequestId) {}
}

@Controller('/scoped')
class ScopedController {
  constructor(@Inject(RequestUser) private readonly user: RequestUser) {}

  @Get('/')
  read() {
    return { id: this.user.requestId.id };
  }
}

@Controller('/plain')
class PlainController {
  @Get('/')
  read() {
    return { ok: true };
  }
}

async function call(app: Awaited<ReturnType<typeof createContext>>, path: string): Promise<Response> {
  const handler = createFetchHandler(app as never);
  return handler(new Request(`http://localhost${path}`));
}

describe('request scope', () => {
  test('a request-scoped provider is not shared between two requests', async () => {
    @Module({ controllers: [ScopedController], providers: [RequestId, RequestUser] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const first = await (await call(app, '/scoped')).json() as { id: string };
    const second = await (await call(app, '/scoped')).json() as { id: string };
    expect(first.id).not.toBe(second.id);
    await app.close();
  });

  test('two providers of the same request share the instance', async () => {
    let first: string | undefined;
    let second: string | undefined;

    @Injectable({ scope: 'request' })
    class Shared {
      readonly id = 'shared-id';
    }

    @Controller('/shared')
    class SharedController {
      constructor(@Inject(Shared) private readonly shared: Shared) {}

      @Get('/')
      read(@Context() context: ExecutionContext) {
        const container = context.container as Container;
        first = container.resolve<Shared>(Shared).id;
        second = this.shared.id;
        return { id: first };
      }
    }

    @Module({ controllers: [SharedController], providers: [Shared] })
    class AppModule {}

    const app = await createContext([AppModule]);
    await call(app, '/shared');
    expect(first).toBe('shared-id');
    expect(second).toBe('shared-id');
    await app.close();
  });

  test('a request-scoped provider is released when the request ends', async () => {
    let destroyed = false;

    @Injectable({ scope: 'request' })
    class Disposable {
      async onModuleDestroy(): Promise<void> {
        destroyed = true;
      }
    }

    @Controller('/disposable')
    class DisposableController {
      constructor(@Inject(Disposable) private readonly disposable: Disposable) {}

      @Get('/')
      read() {
        return { ok: true };
      }
    }

    @Module({ controllers: [DisposableController], providers: [Disposable] })
    class AppModule {}

    const app = await createContext([AppModule]);
    await call(app, '/disposable');
    expect(destroyed).toBe(true);
    await app.close();
  });

  test('a request-scoped provider cannot be injected into a singleton', async () => {
    @Injectable()
    class SingletonConsumer {
      constructor(@Inject(RequestId) readonly requestId: RequestId) {}
    }

    @Module({ providers: [SingletonConsumer, RequestId] })
    class AppModule {}

    const app = await createContext([AppModule]);
    expect(() => app.container.resolve(SingletonConsumer)).toThrow();
    await app.close();
  });

  test('a controller without a request-scoped dependency is not resolved per request', async () => {
    let constructions = 0;

    @Injectable()
    class Counting {
      constructor() {
        constructions += 1;
      }
    }

    @Controller('/counting')
    class CountingController {
      constructor(@Inject(Counting) private readonly counting: Counting) {}

      @Get('/')
      read() {
        return { ok: true };
      }
    }

    @Module({ controllers: [CountingController], providers: [Counting] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const before = constructions;
    await call(app, '/counting');
    await call(app, '/counting');
    expect(constructions).toBe(before);
    await app.close();
  });

  test('a route without a request-scoped dependency still works', async () => {
    @Module({ controllers: [PlainController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const response = await call(app, '/plain');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await app.close();
  });
});
