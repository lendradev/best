/**
 * Worker runtime: an in-process queue with retries, backoff and a concurrency
 * limit.
 *
 * The queue is not durable. A job that has not finished is lost when the
 * process exits, and a retried job may run more than once, so jobs are
 * expected to be idempotent.
 */

import type { Job, JobContext } from './job.ts';

export interface WorkerOptions {
  /** Maximum number of jobs running at the same time. */
  concurrency?: number;
  /** Maximum number of attempts per job. */
  maxAttempts?: number;
  /** First backoff delay in milliseconds. */
  backoffMs?: number;
  /** Multiplier applied to the backoff delay after each attempt. */
  backoffFactor?: number;
  logger?: { error(msg: string, ...meta: unknown[]): void };
}

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: JobContext,
) => Promise<TResult>;

interface QueueEntry {
  job: Job;
  handler: JobHandler<any, any>;
  /** Resolves with the handler result, or `undefined` when the job did not run. */
  resolve: (result?: unknown) => void;
}

export class Worker {
  readonly #handlers = new Map<string, JobHandler<any, any>>();
  readonly #queue: QueueEntry[] = [];
  readonly #concurrency: number;
  readonly #maxAttempts: number;
  readonly #backoffMs: number;
  readonly #backoffFactor: number;
  readonly #logger?: WorkerOptions['logger'];

  #running = 0;
  #failed = 0;
  #stopped = false;
  #started = false;

  readonly #jobControllers = new Set<AbortController>();
  readonly #sleepCancels = new Set<() => void>();
  readonly #idleWaiters: (() => void)[] = [];

  constructor(options: WorkerOptions = {}) {
    this.#concurrency = Math.max(1, options.concurrency ?? 4);
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.#backoffMs = Math.max(0, options.backoffMs ?? 1_000);
    this.#backoffFactor = Math.max(1, options.backoffFactor ?? 2);
    this.#logger = options.logger;
  }

  /** Registers the handler a job name routes to. */
  register<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: (payload: TPayload, context: JobContext) => Promise<TResult>,
  ): void {
    this.#handlers.set(name, handler as JobHandler<any, any>);
  }

  /**
   * Adds a job to the queue and resolves once the job is queued, not once it
   * has finished. Use `run()` when the caller wants the result.
   *
   * The job only runs after `start()`.
   */
  async enqueue<T>(job: Job<T>): Promise<void> {
    const handler = this.#handlers.get(job.name) ?? job.handle;
    if (!handler) {
      throw new Error(`No handler registered for job "${job.name}"`);
    }
    if (this.#stopped) {
      throw new Error('Worker is stopped and does not accept new jobs');
    }

    this.#queue.push({ job: job as Job, handler, resolve: () => {} });
    this.#drain();
  }

  /**
   * Adds a job to the queue and resolves with the handler's result once the
   * job has finished, whether it succeeded or ran out of attempts.
   */
  async run<TPayload, TResult>(
    name: string,
    payload: TPayload,
  ): Promise<TResult | undefined> {
    const handler = this.#handlers.get(name);
    if (!handler) {
      throw new Error(`No handler registered for job "${name}"`);
    }
    if (this.#stopped) {
      throw new Error('Worker is stopped and does not accept new jobs');
    }

    return new Promise<TResult | undefined>((resolve) => {
      this.#queue.push({
        job: { name, payload } as Job,
        handler,
        resolve: (result) => resolve(result as TResult | undefined),
      });
      this.#drain();
    });
  }

  start(): void {
    this.#started = true;
    this.#drain();
  }

  /**
   * Stops accepting new jobs and discards whatever is still queued. A
   * discarded job never runs.
   *
   * The running jobs get an aborted signal, so a handler that watches the
   * signal can stop early. A handler that ignores the signal runs to
   * completion, and `stop()` waits for it.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const entry of this.#queue.splice(0)) entry.resolve();
    for (const controller of this.#jobControllers) controller.abort();
    for (const cancel of [...this.#sleepCancels]) cancel();
    this.#drain();
    await this.#whenIdle();
  }

  /** Jobs waiting to run. */
  get pending(): number {
    return this.#queue.length;
  }

  /** Jobs that failed after the last attempt. */
  get failed(): number {
    return this.#failed;
  }

  /** Jobs currently running. */
  get running(): number {
    return this.#running;
  }

  get started(): boolean {
    return this.#started;
  }

  #drain(): void {
    if (!this.#started || this.#stopped) return;
    while (this.#running < this.#concurrency && this.#queue.length > 0) {
      const entry = this.#queue.shift()!;
      this.#run(entry);
    }
  }

  async #run(entry: QueueEntry): Promise<void> {
    this.#running += 1;
    const controller = new AbortController();
    this.#jobControllers.add(controller);
    try {
      await this.#attemptLoop(entry, controller);
    } catch (error) {
      this.#failed += 1;
      this.#logger?.error(`Job "${entry.job.name}" failed`, error);
      entry.resolve();
    } finally {
      this.#jobControllers.delete(controller);
      this.#running -= 1;
      this.#drain();
      if (this.#running === 0) this.#notifyIdle();
    }
  }

  async #attemptLoop(entry: QueueEntry, controller: AbortController): Promise<void> {
    let attempt = 1;
    for (;;) {
      const context: JobContext = { attempt, signal: controller.signal };
      try {
        const result = await entry.handler(entry.job.payload, context);
        entry.resolve(result);
        return;
      } catch (error) {
        if (this.#stopped) {
          this.#logger?.error(`Job "${entry.job.name}" cancelled`, error);
          entry.resolve();
          return;
        }
        if (attempt >= this.#maxAttempts) {
          this.#failed += 1;
          this.#logger?.error(`Job "${entry.job.name}" failed`, error);
          entry.resolve();
          return;
        }
        const delay = this.#backoffMs * this.#backoffFactor ** (attempt - 1);
        attempt += 1;
        if (await this.#sleep(delay)) {
          this.#logger?.error(`Job "${entry.job.name}" cancelled during backoff`, error);
          entry.resolve();
          return;
        }
      }
    }
  }

  /**
   * Sleeps for `ms`. Resolves `true` when the wait was cut short by a stop,
   * `false` when the full delay elapsed.
   */
  #sleep(ms: number): Promise<boolean> {
    if (ms <= 0) return Promise.resolve(this.#stopped);
    return new Promise<boolean>((resolve) => {
      const cancel = () => {
        clearTimeout(timer);
        this.#sleepCancels.delete(cancel);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#sleepCancels.delete(cancel);
        resolve(this.#stopped);
      }, ms);
      this.#sleepCancels.add(cancel);
    });
  }

  #whenIdle(): Promise<void> {
    if (this.#running === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  #notifyIdle(): void {
    for (const waiter of this.#idleWaiters.splice(0)) waiter();
  }
}
