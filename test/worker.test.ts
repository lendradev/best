import { describe, expect, test } from 'bun:test';
import { Module } from '../src/core/decorators.ts';
import { createContext } from '../src/factory.ts';
import { WORKER, Worker, WorkerModule } from '../src/worker/index.ts';
import type { Job } from '../src/worker/index.ts';

function job(name: string, payload: unknown, handle?: () => Promise<void>): Job {
  return { name, payload, handle } as Job;
}

/** Resolves once `check` is true, or rejects after `timeout` milliseconds. */
async function waitFor(check: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await Bun.sleep(5);
  }
}

describe('worker', () => {
  test('a registered handler runs the job with its payload', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    const seen: unknown[] = [];
    worker.register('send', async (payload: string) => {
      seen.push(payload);
    });
    worker.start();

    await worker.enqueue(job('send', 'hello'));
    await waitFor(() => seen.length === 1);

    expect(seen).toEqual(['hello']);
    await worker.stop();
  });

  test('the first attempt is numbered one', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    const attempts: number[] = [];
    worker.register('work', async (_payload: unknown, context) => {
      attempts.push(context.attempt);
    });
    worker.start();

    await worker.enqueue(job('work', null));
    await waitFor(() => attempts.length === 1);

    expect(attempts).toEqual([1]);
    await worker.stop();
  });

  test('a failing job is retried and the attempt counter grows', async () => {
    const worker = new Worker({ maxAttempts: 3, backoffMs: 5, backoffFactor: 1 });
    const attempts: number[] = [];
    worker.register('flaky', async (_payload: unknown, context) => {
      attempts.push(context.attempt);
      if (context.attempt < 3) throw new Error('not yet');
    });
    worker.start();

    await worker.enqueue(job('flaky', null));
    await waitFor(() => attempts.length === 3);

    expect(attempts).toEqual([1, 2, 3]);
    expect(worker.failed).toBe(0);
    await worker.stop();
  });

  test('a job that keeps failing is counted as failed', async () => {
    const errors: unknown[] = [];
    const worker = new Worker({
      maxAttempts: 2,
      backoffMs: 5,
      backoffFactor: 1,
      logger: { error: (_message, ...meta) => errors.push(meta[0]) },
    });
    worker.register('broken', async () => {
      throw new Error('always fails');
    });
    worker.start();

    await worker.enqueue(job('broken', null));
    await waitFor(() => worker.failed === 1);

    expect(worker.failed).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
    await worker.stop();
  });

  test('no more jobs run than the concurrency limit allows', async () => {
    const worker = new Worker({ concurrency: 2, maxAttempts: 1 });
    let active = 0;
    let peak = 0;
    worker.register('slow', async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(30);
      active -= 1;
    });
    worker.start();

    for (let i = 0; i < 6; i += 1) {
      await worker.enqueue(job('slow', i));
    }
    await waitFor(() => worker.pending === 0 && worker.running === 0, 3_000);

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
    await worker.stop();
  });

  test('a job with no registered handler is rejected', async () => {
    const worker = new Worker();
    worker.start();

    await expect(worker.enqueue(job('missing', null))).rejects.toThrow('No handler registered');
    await worker.stop();
  });

  test('an inline handler runs a job that has no registered name', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    let ran = false;
    worker.start();

    await worker.enqueue(
      job('inline', null, async () => {
        ran = true;
      }),
    );
    await waitFor(() => ran);

    expect(ran).toBe(true);
    await worker.stop();
  });

  test('a stopped worker refuses new jobs', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    worker.register('work', async () => {});
    worker.start();
    await worker.stop();

    await expect(worker.enqueue(job('work', null))).rejects.toThrow('stopped');
  });

  test('stopping the worker during a backoff finishes quickly', async () => {
    const worker = new Worker({ maxAttempts: 5, backoffMs: 30_000, backoffFactor: 1 });
    worker.register('slow-fail', async () => {
      throw new Error('fails');
    });
    worker.start();

    await worker.enqueue(job('slow-fail', null));
    await waitFor(() => worker.running === 1);

    const started = Date.now();
    await Promise.race([
      worker.stop(),
      Bun.sleep(2_000).then(() => {
        throw new Error('stop did not finish within two seconds');
      }),
    ]);

    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test('stopping the worker waits for the running job', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    let finished = false;
    worker.register('work', async () => {
      await Bun.sleep(50);
      finished = true;
    });
    worker.start();

    await worker.enqueue(job('work', null));
    await waitFor(() => worker.running === 1);
    await worker.stop();

    expect(finished).toBe(true);
  });

  test('a queued job is discarded when the worker stops', async () => {
    const worker = new Worker({ concurrency: 1, maxAttempts: 1 });
    let ran = 0;
    worker.register('work', async () => {
      ran += 1;
      await Bun.sleep(60);
    });
    worker.start();

    await worker.enqueue(job('work', 1));
    await waitFor(() => worker.running === 1);
    await worker.enqueue(job('work', 2));
    expect(worker.pending).toBe(1);

    await worker.stop();
    expect(ran).toBe(1);
  });

  test('run resolves with the handler result', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    worker.register('double', async (payload: number) => payload * 2);
    worker.start();

    const result = await worker.run('double', 21);

    expect(result).toBe(42);
    await worker.stop();
  });

  test('stopping the worker signals the running job', async () => {
    const worker = new Worker({ maxAttempts: 1 });
    let aborted = false;
    worker.register('work', async (_payload: unknown, context) => {
      await Bun.sleep(30);
      aborted = context.signal.aborted;
    });
    worker.start();

    await worker.enqueue(job('work', null));
    await waitFor(() => worker.running === 1);
    await worker.stop();

    expect(aborted).toBe(true);
  });

  test('a job that keeps failing counts as one failed job', async () => {
    const worker = new Worker({ maxAttempts: 3, backoffMs: 1, backoffFactor: 1 });
    worker.register('broken', async () => {
      throw new Error('always fails');
    });
    worker.start();

    await worker.enqueue(job('broken', null));
    await waitFor(() => worker.failed === 1);

    expect(worker.failed).toBe(1);
    expect(worker.pending).toBe(0);
    await worker.stop();
  });

  test('the backoff grows between attempts', async () => {
    const stamps: number[] = [];
    const worker = new Worker({ maxAttempts: 3, backoffMs: 30, backoffFactor: 2 });
    worker.register('work', async () => {
      stamps.push(Date.now());
      throw new Error('fails');
    });
    worker.start();

    await worker.enqueue(job('work', null));
    await waitFor(() => stamps.length === 3, 3_000);

    const firstGap = stamps[1]! - stamps[0]!;
    const secondGap = stamps[2]! - stamps[1]!;
    expect(firstGap).toBeGreaterThanOrEqual(25);
    expect(firstGap).toBeLessThan(55);
    expect(secondGap).toBeGreaterThanOrEqual(55);
    await worker.stop();
  });

  test('the worker is resolvable from the container', async () => {
    @Module({ imports: [WorkerModule] })
    class AppModule {}

    const app = await createContext([AppModule]);
    const worker = app.container.resolve<Worker>(WORKER);

    expect(worker).toBeInstanceOf(Worker);
    expect(app.container.resolve(WORKER)).toBe(worker);
  });
});
