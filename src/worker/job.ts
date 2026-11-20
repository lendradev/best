/**
 * Job model.
 *
 * A job is a plain object. `name` routes it to a registered handler,
 * `payload` carries the data, `handle` is the inline fallback for a job whose
 * name has no registered handler.
 */

export interface JobContext {
  /** How many times this job has been attempted, starting at 1. */
  attempt: number;
  /**
   * Aborted when the worker stops.
   *
   * The signal may already be aborted when the handler starts, so a handler
   * that wants to stop early has to check `signal.aborted` as well as listen
   * for the `abort` event.
   */
  signal: AbortSignal;
}

export interface Job<TPayload = unknown, TResult = unknown> {
  name: string;
  payload: TPayload;
  /** Inline handler, used when no handler is registered under `name`. */
  handle?(context: JobContext): Promise<TResult>;
}
