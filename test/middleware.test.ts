import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import { Controller, Get } from '../src/http/route-decorators.ts';
import { UseMiddleware, type ExecutionContext, type NestMiddleware } from '../src/http/contracts.ts';
import { Body } from '../src/http/param-decorators.ts';
import { createFetchHandler } from '../src/http/server.ts';

class TraceMiddleware implements NestMiddleware {
  readonly calls: string[] = [];

  use(context: ExecutionContext, next: () => Promise<void>): Promise<void> {
    this.calls.push(context.path);
    return next();
  }
}

class BlockerMiddleware implements NestMiddleware {
  use(): Response {
    return Response.json({ blocked: true }, { status: 403 });
  }
}

class MutatingMiddleware implements NestMiddleware {
  use(context: ExecutionContext, next: () => Promise<void>): Promise<void> {
    context.body = { replaced: true };
    return next();
  }
}

class ThrowingMiddleware implements NestMiddleware {
  use(): void {
    throw new Error('middleware failed');
  }
}

@Controller('/items')
class ItemController {
  @Get('/')
  list() {
    return { items: [1, 2] };
  }
}

@Controller('/other')
class OtherController {
  @Get('/')
  list() {
    return { other: true };
  }
}

async function call(
  app: Awaited<ReturnType<typeof createContext>>,
  path: string,
): Promise<Response> {
  const handler = createFetchHandler(app as never);
  return handler(new Request(`http://localhost${path}`));
}

describe('middleware', () => {
  test('a middleware on a handler runs before the route', async () => {
    const trace = new TraceMiddleware();

    @Controller('/traced')
    class TracedController {
      @Get('/')
      @UseMiddleware(trace)
      list() {
        return { ok: true };
      }
    }

    @Module({ controllers: [TracedController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const response = await call(app, '/traced');
    expect(response.status).toBe(200);
    expect(trace.calls).toEqual(['/traced']);
    await app.close();
  });

  test('a middleware on a controller applies to every route of it', async () => {
    const trace = new TraceMiddleware();

    @Controller('/grouped')
    @UseMiddleware(trace)
    class GroupedController {
      @Get('/one')
      one() {
        return 1;
      }

      @Get('/two')
      two() {
        return 2;
      }
    }

    @Module({ controllers: [GroupedController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    await call(app, '/grouped/one');
    await call(app, '/grouped/two');
    expect(trace.calls).toEqual(['/grouped/one', '/grouped/two']);
    await app.close();
  });

  test('a middleware does not apply to another controller', async () => {
    const trace = new TraceMiddleware();

    @Controller('/scoped')
    @UseMiddleware(trace)
    class ScopedController {
      @Get('/')
      list() {
        return 1;
      }
    }

    @Module({ controllers: [ScopedController, OtherController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    await call(app, '/other');
    expect(trace.calls).toEqual([]);
    await app.close();
  });

  test('a middleware can answer the request itself', async () => {
    @Controller('/blocked')
    @UseMiddleware(BlockerMiddleware)
    class BlockedController {
      @Get('/')
      list() {
        return { reached: true };
      }
    }

    @Module({ controllers: [BlockedController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const response = await call(app, '/blocked');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ blocked: true });
    await app.close();
  });

  test('the handler does not run when a middleware answers the request', async () => {
    let reached = false;

    @Controller('/short')
    @UseMiddleware(BlockerMiddleware)
    class ShortController {
      @Get('/')
      list() {
        reached = true;
        return {};
      }
    }

    @Module({ controllers: [ShortController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    await call(app, '/short');
    expect(reached).toBe(false);
    await app.close();
  });

  test('a middleware can replace the body before the handler reads it', async () => {
    @Controller('/mutated')
    @UseMiddleware(MutatingMiddleware)
    class MutatedController {
      @Get('/')
      list(@Body() body: unknown) {
        return body;
      }
    }

    @Module({ controllers: [MutatedController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const response = await call(app, '/mutated');
    expect(await response.json()).toEqual({ replaced: true });
    await app.close();
  });

  test('a throwing middleware is handled as an error', async () => {
    @Controller('/broken')
    @UseMiddleware(ThrowingMiddleware)
    class BrokenController {
      @Get('/')
      list() {
        return {};
      }
    }

    @Module({ controllers: [BrokenController] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const response = await call(app, '/broken');
    expect(response.status).toBe(500);
    await app.close();
  });

  test('a global middleware applies to every route', async () => {
    const trace = new TraceMiddleware();

    @Module({ controllers: [ItemController, OtherController] })
    class AppModule {}

    const app = await createContext([AppModule], { globalMiddleware: [trace] });
    await call(app, '/items');
    await call(app, '/other');
    expect(trace.calls).toEqual(['/items', '/other']);
    await app.close();
  });

  test('the global middleware runs before the route middleware', async () => {
    const order: string[] = [];

    class OrderMiddleware implements NestMiddleware {
      constructor(private readonly label: string) {}

      use(_context: ExecutionContext, next: () => Promise<void>): Promise<void> {
        order.push(this.label);
        return next();
      }
    }

    @Controller('/ordered')
    @UseMiddleware(new OrderMiddleware('route'))
    class OrderedController {
      @Get('/')
      list() {
        return {};
      }
    }

    @Module({ controllers: [OrderedController] })
    class AppModule {}

    const app = await createContext([AppModule], {
      globalMiddleware: [new OrderMiddleware('global')],
    });
    await call(app, '/ordered');
    expect(order).toEqual(['global', 'route']);
    await app.close();
  });
});
