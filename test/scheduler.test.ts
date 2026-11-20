import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import {
  CronParseError,
  SCHEDULER,
  SchedulerModule,
  createScheduler,
  createSchedulerModule,
  nextRunAt,
  parseCronExpression,
} from '../src/scheduler/index.ts';

describe('parseCronExpression', () => {
  test('parses a wildcard expression', () => {
    const parsed = parseCronExpression('* * * * *');
    expect(parsed.minute.size).toBe(60);
    expect(parsed.hour.size).toBe(24);
    expect(parsed.dayOfMonth.size).toBe(31);
    expect(parsed.month.size).toBe(12);
    expect(parsed.dayOfWeek.size).toBe(7);
  });

  test('parses a single value', () => {
    const parsed = parseCronExpression('30 4 * * *');
    expect([...parsed.minute]).toEqual([30]);
    expect([...parsed.hour]).toEqual([4]);
  });

  test('parses a step', () => {
    const parsed = parseCronExpression('*/15 * * * *');
    expect([...parsed.minute]).toEqual([0, 15, 30, 45]);
  });

  test('parses a range', () => {
    const parsed = parseCronExpression('0 9-17 * * *');
    expect([...parsed.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  test('parses a range with a step', () => {
    const parsed = parseCronExpression('0 0-12/6 * * *');
    expect([...parsed.hour]).toEqual([0, 6, 12]);
  });

  test('parses a comma-separated list', () => {
    const parsed = parseCronExpression('0,15,45 * * * *');
    expect([...parsed.minute]).toEqual([0, 15, 45]);
  });

  test('parses the month names', () => {
    const parsed = parseCronExpression('0 0 1 jan,jul *');
    expect([...parsed.month]).toEqual([1, 7]);
  });

  test('parses the day names', () => {
    const parsed = parseCronExpression('0 0 * * mon,wed');
    expect([...parsed.dayOfWeek]).toEqual([1, 3]);
  });

  test('folds sunday 7 into 0', () => {
    const parsed = parseCronExpression('0 0 * * 7');
    expect([...parsed.dayOfWeek]).toEqual([0]);
  });

  test('rejects a wrong field count', () => {
    expect(() => parseCronExpression('* * *')).toThrow(CronParseError);
    expect(() => parseCronExpression('* * * * * *')).toThrow(CronParseError);
  });

  test('rejects an out-of-range value', () => {
    expect(() => parseCronExpression('99 * * * *')).toThrow(CronParseError);
    expect(() => parseCronExpression('* 25 * * *')).toThrow(CronParseError);
    expect(() => parseCronExpression('* * 32 * *')).toThrow(CronParseError);
    expect(() => parseCronExpression('* * * 13 *')).toThrow(CronParseError);
    expect(() => parseCronExpression('* * * * 8')).toThrow(CronParseError);
  });

  test('rejects a non-numeric value', () => {
    expect(() => parseCronExpression('abc * * * *')).toThrow(CronParseError);
  });

  test('rejects a zero step', () => {
    expect(() => parseCronExpression('*/0 * * * *')).toThrow(CronParseError);
  });

  test('rejects a reversed range', () => {
    expect(() => parseCronExpression('0 17-9 * * *')).toThrow(CronParseError);
  });
});

describe('nextRunAt', () => {
  test('returns the next matching minute', () => {
    const from = new Date('2026-01-01T10:00:30.000Z');
    const at = nextRunAt(parseCronExpression('* * * * *'), from.getTime());
    expect(at).toBeGreaterThan(from.getTime());
    expect(new Date(at!).getUTCSeconds()).toBe(0);
  });

  test('honours the minute field', () => {
    const from = new Date('2026-01-01T10:00:00.000Z');
    const at = nextRunAt(parseCronExpression('30 * * * *'), from.getTime());
    expect(new Date(at!).getUTCMinutes()).toBe(30);
  });

  test('returns undefined for a day that never comes', () => {
    const from = new Date('2026-01-01T10:00:00.000Z');
    const at = nextRunAt(parseCronExpression('0 0 30 2 *'), from.getTime());
    expect(at).toBeUndefined();
  });
});

describe('createScheduler', () => {
  test('registers a task and counts it', () => {
    const scheduler = createScheduler();
    expect(scheduler.scheduled).toBe(0);
    scheduler.schedule('* * * * *', () => {});
    expect(scheduler.scheduled).toBe(1);
  });

  test('the unsubscribe function removes the task', () => {
    const scheduler = createScheduler();
    const unsubscribe = scheduler.schedule('* * * * *', () => {});
    unsubscribe();
    expect(scheduler.scheduled).toBe(0);
  });

  test('a task registered before start runs when the scheduler starts', async () => {
    const scheduler = createScheduler({ maxDelayMs: 20 });
    const calls: number[] = [];
    scheduler.schedule('* * * * *', () => {
      calls.push(Date.now());
    });
    scheduler.start();
    await Bun.sleep(120);
    scheduler.stop();
    expect(calls.length).toBeGreaterThan(0);
  });

  test('a task registered after start also runs', async () => {
    const scheduler = createScheduler({ maxDelayMs: 20 });
    const calls: number[] = [];
    scheduler.start();
    scheduler.schedule('* * * * *', () => {
      calls.push(1);
    });
    await Bun.sleep(120);
    scheduler.stop();
    expect(calls.length).toBeGreaterThan(0);
  });

  test('stop stops the tasks', async () => {
    const scheduler = createScheduler({ maxDelayMs: 20 });
    const calls: number[] = [];
    scheduler.schedule('* * * * *', () => {
      calls.push(1);
    });
    scheduler.start();
    await Bun.sleep(80);
    scheduler.stop();
    const seen = calls.length;
    await Bun.sleep(80);
    expect(calls.length).toBe(seen);
  });

  test('a throwing task does not stop the scheduler', async () => {
    const errors: unknown[] = [];
    const scheduler = createScheduler({
      maxDelayMs: 20,
      onError: (error) => errors.push(error),
    });
    const calls: number[] = [];
    scheduler.schedule('* * * * *', () => {
      calls.push(1);
      throw new Error('boom');
    });
    scheduler.start();
    await Bun.sleep(120);
    scheduler.stop();
    expect(errors.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(1);
  });

  test('nextRunAt reports the next run of an expression', () => {
    const scheduler = createScheduler();
    const at = scheduler.nextRunAt('* * * * *');
    expect(at).toBeGreaterThan(Date.now());
  });
});

describe('SchedulerModule', () => {
  test('resolves the scheduler from the container', async () => {
    @Module({ imports: [SchedulerModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const scheduler = app.container.resolve<ReturnType<typeof createScheduler>>(SCHEDULER);
    expect(typeof scheduler.schedule).toBe('function');
    await app.close();
  });

  test('createSchedulerModule applies the options', async () => {
    @Module({ imports: [createSchedulerModule({ maxDelayMs: 25 })] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const scheduler = app.container.resolve<ReturnType<typeof createScheduler>>(SCHEDULER);
    expect(scheduler.scheduled).toBe(0);
    await app.close();
  });
});
