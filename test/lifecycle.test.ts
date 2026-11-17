import { describe, expect, test } from 'bun:test';
import { Injectable, Module } from '../src/index.ts';
import { createContext } from '../src/factory.ts';
import { createTestingModule } from '../src/testing/index.ts';

const calls: string[] = [];

@Injectable()
class Lifecycle {
  onModuleInit() {
    calls.push('onModuleInit');
  }
  onApplicationBootstrap() {
    calls.push('onApplicationBootstrap');
  }
  onModuleDestroy() {
    calls.push('onModuleDestroy');
  }
  beforeApplicationShutdown() {
    calls.push('beforeApplicationShutdown');
  }
  onApplicationShutdown() {
    calls.push('onApplicationShutdown');
  }
}

@Module({ providers: [Lifecycle] })
class TestModule {}

describe('Lifecycle hooks', () => {
  test('hooks run in order and shutdown hooks run in reverse', async () => {
    calls.length = 0;
    const app = await createContext([TestModule]);
    expect(calls).toEqual(['onModuleInit', 'onApplicationBootstrap']);
    await app.close();
    expect(calls).toEqual([
      'onModuleInit',
      'onApplicationBootstrap',
      'beforeApplicationShutdown',
      'onModuleDestroy',
      'onApplicationShutdown',
    ]);
  });
});

describe('Testing module', () => {
  test('createTestingModule resolves providers', async () => {
    const module = await createTestingModule({ providers: [Lifecycle] });
    const instance = module.get(Lifecycle);
    expect(instance).toBeInstanceOf(Lifecycle);
    await module.close();
  });

  test('createTestingModule exposes the container', async () => {
    const module = await createTestingModule({ providers: [Lifecycle] });
    expect(module.container.has(Lifecycle)).toBe(true);
    await module.close();
  });
});
