import { describe, expect, test } from 'bun:test';
import { Container, UnknownProviderError } from '../src/core/container.ts';
import { Inject, Injectable } from '../src/core/decorators.ts';

@Injectable()
class Engine {
  readonly kind: string = 'v8';
}

@Injectable()
class Car {
  constructor(@Inject(Engine) readonly engine: Engine) {}
}

describe('Container', () => {
  test('resolves a class provider', () => {
    const container = new Container();
    container.registerClass(Engine);
    expect(container.resolve(Engine)).toBeInstanceOf(Engine);
  });

  test('returns the same singleton instance', () => {
    const container = new Container();
    container.registerClass(Engine);
    expect(container.resolve(Engine)).toBe(container.resolve(Engine));
  });

  test('creates a new instance for transient scope', () => {
    const container = new Container();
    container.registerClass(Engine, { scope: 'transient' });
    expect(container.resolve(Engine)).not.toBe(container.resolve(Engine));
  });

  test('injects dependencies through constructor parameters', () => {
    const container = new Container();
    container.registerClass(Engine);
    container.registerClass(Car);
    const car = container.resolve(Car);
    expect(car.engine).toBeInstanceOf(Engine);
  });

  test('injects a registered value', () => {
    const container = new Container();
    container.registerValue<string>('TOKEN', '42');
    expect(container.resolve<string>('TOKEN')).toBe('42');
  });

  test('throws for an unknown provider', () => {
    const container = new Container();
    expect(() => container.resolve(Engine)).toThrow(UnknownProviderError);
  });

  test('resolves a factory provider', () => {
    const container = new Container();
    container.registerClass(Engine);
    container.registerFactory<{ engine: Engine }>(
      'CAR',
      (engine: Engine) => ({ engine }),
      [Engine],
    );
    const car = container.resolve<{ engine: Engine }>('CAR');
    expect(car.engine).toBeInstanceOf(Engine);
  });

  test('child container shares parent singletons but isolates request scope', () => {
    const parent = new Container();
    parent.registerClass(Engine, { scope: 'request' });
    const child = parent.createChild();
    expect(child.resolve(Engine)).toBe(child.resolve(Engine));
    expect(child.resolve(Engine)).not.toBe(parent.resolve(Engine));
  });

  test('injects a value token by constructor parameter', () => {
    @Injectable()
    class Consumer {
      constructor(@Inject('B') readonly b: string) {}
    }
    const container = new Container();
    container.registerValue<string>('B', 'value');
    container.registerClass(Consumer);
    expect(container.resolve(Consumer).b).toBe('value');
  });
});
