import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import { EVENT_EMITTER, EventsModule, createEventEmitter } from '../src/events/index.ts';

describe('createEventEmitter', () => {
  test('calls the handler with the payload', async () => {
    const emitter = createEventEmitter();
    const seen: unknown[] = [];

    emitter.on('ping', (payload) => {
      seen.push(payload);
    });
    await emitter.emit('ping', { id: 1 });

    expect(seen).toEqual([{ id: 1 }]);
  });

  test('awaits an async handler', async () => {
    const emitter = createEventEmitter();
    const seen: string[] = [];

    emitter.on('ping', async (payload: string) => {
      await Bun.sleep(1);
      seen.push(payload);
    });
    await emitter.emit('ping', 'value');

    expect(seen).toEqual(['value']);
  });

  test('calls every handler of an event', async () => {
    const emitter = createEventEmitter();
    const calls: string[] = [];

    emitter.on('ping', () => {
      calls.push('first');
    });
    emitter.on('ping', () => {
      calls.push('second');
    });
    await emitter.emit('ping');

    expect(calls).toEqual(['first', 'second']);
  });

  test('the unsubscribe function returned by on removes the handler', async () => {
    const emitter = createEventEmitter();
    const calls: string[] = [];

    const unsubscribe = emitter.on('ping', () => {
      calls.push('hit');
    });
    unsubscribe();
    await emitter.emit('ping');

    expect(calls).toEqual([]);
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  test('off removes a handler', async () => {
    const emitter = createEventEmitter();
    const calls: string[] = [];
    const handler = () => {
      calls.push('hit');
    };

    emitter.on('ping', handler);
    emitter.off('ping', handler);
    await emitter.emit('ping');

    expect(calls).toEqual([]);
  });

  test('once runs the handler a single time', async () => {
    const emitter = createEventEmitter();
    const calls: string[] = [];

    emitter.once('ping', () => {
      calls.push('hit');
    });
    await emitter.emit('ping');
    await emitter.emit('ping');

    expect(calls).toEqual(['hit']);
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  test('a failing handler does not stop the other handlers', async () => {
    const emitter = createEventEmitter();
    const calls: string[] = [];

    emitter.on('ping', () => {
      calls.push('first');
      throw new Error('boom');
    });
    emitter.on('ping', () => {
      calls.push('second');
    });

    await expect(emitter.emit('ping')).rejects.toThrow(AggregateError);
    expect(calls).toEqual(['first', 'second']);
  });

  test('the aggregate error carries every failure', async () => {
    const emitter = createEventEmitter();

    emitter.on('ping', () => {
      throw new Error('first failure');
    });
    emitter.on('ping', () => {
      throw new Error('second failure');
    });

    const error = await emitter.emit('ping').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
  });

  test('emitting an event without handlers does nothing', async () => {
    const emitter = createEventEmitter();
    await emitter.emit('nobody-listens');
    expect(emitter.listenerCount('nobody-listens')).toBe(0);
  });

  test('a handler registered during an emit does not join that round', async () => {
    const emitter = createEventEmitter();
    const calls: string[] = [];

    emitter.on('ping', () => {
      calls.push('first');
      emitter.on('ping', () => {
        calls.push('late');
      });
    });
    await emitter.emit('ping');

    expect(calls).toEqual(['first']);
  });
});

describe('EventsModule', () => {
  test('resolves the emitter from the container', async () => {
    @Module({ imports: [EventsModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const emitter = app.container.resolve<ReturnType<typeof createEventEmitter>>(EVENT_EMITTER);
    expect(typeof emitter.emit).toBe('function');
    await app.close();
  });
});
