import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import { TooManyRequestsException, type ExecutionContext } from '../src/http/contracts.ts';
import {
  RATE_LIMITER,
  RateLimitGuard,
  RateLimiterModule,
  createRateLimitGuard,
  createRateLimiter,
  createRateLimiterModule,
  defaultKeyResolver,
} from '../src/ratelimit/index.ts';

function context(ip = '10.0.0.1'): ExecutionContext {
  return {
    method: 'GET',
    path: '/',
    params: {},
    query: new URLSearchParams(),
    headers: new Headers({ 'x-forwarded-for': ip }),
    body: undefined,
    request: undefined,
    state: {},
  };
}

describe('createRateLimiter', () => {
  test('allows a request under the limit', async () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000 });
    const result = await limiter.check('a');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.limit).toBe(3);
  });

  test('blocks a request over the limit', async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    await limiter.check('a');
    await limiter.check('a');
    const third = await limiter.check('a');
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  test('counts each key separately', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect((await limiter.check('a')).allowed).toBe(true);
    expect((await limiter.check('b')).allowed).toBe(true);
    expect((await limiter.check('a')).allowed).toBe(false);
  });

  test('the window resets after it passes', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 30 });
    expect((await limiter.check('a')).allowed).toBe(true);
    expect((await limiter.check('a')).allowed).toBe(false);
    await Bun.sleep(50);
    expect((await limiter.check('a')).allowed).toBe(true);
  });

  test('reset forgets the counter of a key', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    await limiter.check('a');
    await limiter.reset('a');
    expect((await limiter.check('a')).allowed).toBe(true);
  });

  test('clear forgets every counter', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    await limiter.check('a');
    await limiter.check('b');
    await limiter.clear();
    expect((await limiter.check('a')).allowed).toBe(true);
    expect((await limiter.check('b')).allowed).toBe(true);
  });

  test('resetAt is in the future', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 5_000 });
    const result = await limiter.check('a');
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});

describe('defaultKeyResolver', () => {
  test('reads the first forwarded address', () => {
    expect(defaultKeyResolver(context('1.2.3.4'))).toBe('1.2.3.4');
  });

  test('reads the real ip header', () => {
    const ctx = context();
    ctx.headers = new Headers({ 'x-real-ip': '5.6.7.8' });
    expect(defaultKeyResolver(ctx)).toBe('5.6.7.8');
  });

  test('falls back to a shared key', () => {
    const ctx = context();
    ctx.headers = new Headers();
    expect(defaultKeyResolver(ctx)).toBe('unknown');
  });
});

describe('RateLimitGuard', () => {
  test('lets a request under the limit through', async () => {
    const guard = new RateLimitGuard(createRateLimiter({ limit: 2, windowMs: 1_000 }));
    expect(await guard.canActivate(context())).toBe(true);
  });

  test('throws TooManyRequestsException over the limit', async () => {
    const guard = new RateLimitGuard(createRateLimiter({ limit: 1, windowMs: 1_000 }));
    await guard.canActivate(context());
    expect(guard.canActivate(context())).rejects.toBeInstanceOf(TooManyRequestsException);
  });

  test('counts each address separately', async () => {
    const guard = new RateLimitGuard(createRateLimiter({ limit: 1, windowMs: 1_000 }));
    expect(await guard.canActivate(context('1.1.1.1'))).toBe(true);
    expect(await guard.canActivate(context('2.2.2.2'))).toBe(true);
  });

  test('a custom blocked handler replaces the exception', async () => {
    let blocked = 0;
    const guard = createRateLimitGuard({
      limit: 1,
      windowMs: 1_000,
      onBlocked: () => {
        blocked += 1;
      },
    });
    await guard.canActivate(context());
    await guard.canActivate(context());
    expect(blocked).toBe(1);
  });
});

describe('RateLimiterModule', () => {
  test('resolves the limiter from the container', async () => {
    @Module({ imports: [RateLimiterModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const limiter = app.container.resolve<ReturnType<typeof createRateLimiter>>(RATE_LIMITER);
    expect(typeof limiter.check).toBe('function');
    await app.close();
  });

  test('createRateLimiterModule applies the options', async () => {
    @Module({ imports: [createRateLimiterModule({ limit: 7, windowMs: 1_000 })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const limiter = app.container.resolve<ReturnType<typeof createRateLimiter>>(RATE_LIMITER);
    const result = await limiter.check('a');
    expect(result.limit).toBe(7);
    await app.close();
  });
});
