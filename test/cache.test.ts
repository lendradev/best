import { describe, expect, test } from 'bun:test';
import { CACHE_MANAGER, CacheModule, MemoryCacheStore, createCacheModule } from '../src/cache/index.ts';
import { createContext } from '../src/factory.ts';
import { Module } from '../src/core/decorators.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MemoryCacheStore', () => {
  test('sets, gets and has an entry', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('a', 1);
    expect(await cache.get('a')).toBe(1);
    expect(await cache.has('a')).toBe(true);
    expect(await cache.get('missing')).toBeUndefined();
    expect(await cache.has('missing')).toBe(false);
  });

  test('deletes an entry and reports whether it existed', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('a', 1);
    expect(await cache.delete('a')).toBe(true);
    expect(await cache.delete('a')).toBe(false);
    expect(await cache.get('a')).toBeUndefined();
  });

  test('clear removes every entry', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    expect(await cache.has('a')).toBe(false);
    expect(await cache.has('b')).toBe(false);
  });

  test('an expired entry is gone', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('a', 1, { ttlMs: 20 });
    expect(await cache.get('a')).toBe(1);
    await sleep(40);
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.has('a')).toBe(false);
  });

  test('a zero ttl expires immediately', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('a', 1, { ttlMs: 0 });
    expect(await cache.get('a')).toBeUndefined();
  });

  test('evicts the oldest entry when the size limit is reached', async () => {
    const cache = new MemoryCacheStore({ maxSize: 3 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.set('d', 4);
    expect(await cache.has('a')).toBe(false);
    expect(await cache.has('b')).toBe(true);
    expect(await cache.has('c')).toBe(true);
    expect(await cache.has('d')).toBe(true);
  });

  test('overwriting a key does not grow the store', async () => {
    const cache = new MemoryCacheStore({ maxSize: 2 });
    await cache.set('a', 1);
    await cache.set('a', 2);
    await cache.set('b', 3);
    expect(await cache.has('a')).toBe(true);
    expect(await cache.has('b')).toBe(true);
  });

  test('wrap calls the loader once and caches the result', async () => {
    const cache = new MemoryCacheStore();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return 'value';
    };
    expect(await cache.wrap('a', loader)).toBe('value');
    expect(await cache.wrap('a', loader)).toBe('value');
    expect(calls).toBe(1);
  });

  test('wrap propagates a loader error and stores nothing', async () => {
    const cache = new MemoryCacheStore();
    const boom = new Error('boom');
    await expect(
      cache.wrap('a', async () => {
        throw boom;
      }),
    ).rejects.toThrow('boom');
    expect(await cache.get('a')).toBeUndefined();
  });

  test('two callers that miss at once run the loader once', async () => {
    const cache = new MemoryCacheStore();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await sleep(30);
      return 'value';
    };

    const [first, second] = await Promise.all([cache.wrap('a', loader), cache.wrap('a', loader)]);

    expect(calls).toBe(1);
    expect(first).toBe('value');
    expect(second).toBe('value');
  });

  test('a caller that mutates its object cannot change the cached value', async () => {
    const cache = new MemoryCacheStore();
    const value = { count: 1 };
    await cache.set('a', value);

    value.count = 99;

    expect((await cache.get<{ count: number }>('a'))?.count).toBe(1);
  });

  test('a cached array is copied too', async () => {
    const cache = new MemoryCacheStore();
    const value = [{ count: 1 }];
    await cache.set('a', value);

    value[0]!.count = 99;

    expect((await cache.get<{ count: number }[]>('a'))?.[0]?.count).toBe(1);
  });
});

describe('CacheModule', () => {
  test('resolves the cache manager from the container', async () => {
    @Module({ imports: [CacheModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const cache = app.container.resolve<MemoryCacheStore>(CACHE_MANAGER);
    expect(cache).toBeInstanceOf(MemoryCacheStore);
    await cache.set('a', 1);
    expect(await cache.get('a')).toBe(1);
    await app.close();
  });

  test('resolves the same singleton twice', async () => {
    @Module({ imports: [CacheModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    expect(app.container.resolve(CACHE_MANAGER)).toBe(app.container.resolve(CACHE_MANAGER));
    await app.close();
  });

  test('createCacheModule applies the store options', async () => {
    @Module({ imports: [createCacheModule({ ttlMs: 20, maxSize: 2 })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const cache = app.container.resolve<MemoryCacheStore>(CACHE_MANAGER);
    expect(cache.ttlMs).toBe(20);
    expect(cache.maxSize).toBe(2);
    await app.close();
  });
});
