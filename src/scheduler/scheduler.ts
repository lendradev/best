/**
 * Cron-style scheduler.
 *
 * The expression is a five-field string: minute, hour, day of month, month,
 * day of week. Each field accepts a wildcard, a step, a value, a range or a
 * comma-separated list of those. The month and day-of-week fields also
 * accept the short names `jan` to `dec` and `sun` to `sat`.
 *
 * The next run time is computed from the expression on every tick, so a slow
 * tick does not accumulate drift.
 */

export type SchedulerTask = () => void | Promise<void>;

export interface Scheduler {
  /** Registers a task and returns the function that removes it. */
  schedule(expression: string, task: SchedulerTask): () => void;
  /** Starts the timers. */
  start(): void;
  /** Stops the timers. The registered tasks stay. */
  stop(): void;
  /** Number of registered tasks. */
  readonly scheduled: number;
  /** Unix milliseconds of the next run of a task, or `undefined` when it has none. */
  nextRunAt(expression: string): number | undefined;
}

export interface SchedulerOptions {
  /** Called when a task throws. The task failure never stops the scheduler. */
  onError?: (error: unknown, expression: string) => void;
  /** Upper bound of a timer delay in milliseconds. Default 60000. */
  maxDelayMs?: number;
}

export interface CronExpression {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_MAX_DELAY_MS = 60_000;

/** Raised when an expression cannot be parsed. */
export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronParseError';
  }
}

function namedValue(value: string, names: string[], offset: number): number | undefined {
  const index = names.indexOf(value.toLowerCase());
  return index === -1 ? undefined : index + offset;
}

function parseField(
  field: string,
  min: number,
  max: number,
  names: string[] = [],
  nameOffset = 0,
): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const token = part.trim();
    if (token === '') throw new CronParseError(`empty field in "${field}"`);

    const slash = token.indexOf('/');
    const rangePart = slash === -1 ? token : token.slice(0, slash);
    const stepPart = slash === -1 ? undefined : token.slice(slash + 1);
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) {
        throw new CronParseError(`invalid step "${stepPart}" in "${field}"`);
      }
    }

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else {
      const bounds = rangePart.split('-');
      const parseBound = (bound: string): number => {
        const named = namedValue(bound, names, nameOffset);
        if (named !== undefined) return named;
        const parsed = Number(bound);
        if (!Number.isInteger(parsed)) throw new CronParseError(`invalid value "${bound}" in "${field}"`);
        return parsed;
      };

      const first = bounds[0];
      const second = bounds[1];
      if (first === undefined) throw new CronParseError(`invalid range "${rangePart}" in "${field}"`);

      if (bounds.length === 1) {
        start = parseBound(first.trim());
        end = stepPart === undefined ? start : max;
      } else if (bounds.length === 2 && second !== undefined) {
        start = parseBound(first.trim());
        end = parseBound(second.trim());
      } else {
        throw new CronParseError(`invalid range "${rangePart}" in "${field}"`);
      }
    }

    if (start < min || end > max || start > end) {
      throw new CronParseError(`value out of range in "${field}"`);
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  if (values.size === 0) throw new CronParseError(`field "${field}" matches nothing`);
  return values;
}

/**
 * Parses a five-field cron expression.
 *
 * @throws {CronParseError} when a field is malformed or out of range.
 */
export function parseCronExpression(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/).filter((field) => field.length > 0);
  if (fields.length !== 5) {
    throw new CronParseError(
      `expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeekField] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  const dayOfWeek = parseField(dayOfWeekField, 0, 7, DAY_NAMES);
  // Sunday is both 0 and 7 in cron, so 7 is folded into 0.
  if (dayOfWeek.has(7)) {
    dayOfWeek.delete(7);
    dayOfWeek.add(0);
  }

  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12, MONTH_NAMES, 1),
    dayOfWeek,
  };
}

/** Whether a date matches every field of the expression. */
function matches(expression: CronExpression, date: Date): boolean {
  if (!expression.minute.has(date.getMinutes())) return false;
  if (!expression.hour.has(date.getHours())) return false;
  if (!expression.month.has(date.getMonth() + 1)) return false;

  const dayRestricted = expression.dayOfMonth.size !== 31;
  const weekRestricted = expression.dayOfWeek.size !== 7;
  const dayMatches = expression.dayOfMonth.has(date.getDate());
  const weekMatches = expression.dayOfWeek.has(date.getDay());

  // When both day fields are restricted, either one may match.
  if (dayRestricted && weekRestricted) return dayMatches || weekMatches;
  if (dayRestricted) return dayMatches;
  if (weekRestricted) return weekMatches;
  return true;
}

/**
 * Returns the next minute after `from` that matches the expression, as unix
 * milliseconds. Returns `undefined` when no match falls in the next year.
 */
export function nextRunAt(expression: CronExpression, from: number = Date.now()): number | undefined {
  const date = new Date(from);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 1);

  while (date.getTime() <= limit.getTime()) {
    if (matches(expression, date)) return date.getTime();
    date.setMinutes(date.getMinutes() + 1);
  }
  return undefined;
}

interface Entry {
  expression: string;
  parsed: CronExpression;
  task: SchedulerTask;
  timer: ReturnType<typeof setTimeout> | undefined;
  nextAt: number | undefined;
}

export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const maxDelayMs = Math.max(1, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const entries = new Map<() => void, Entry>();
  let running = false;

  const clearTimer = (entry: Entry): void => {
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  };

  const schedule = (entry: Entry): void => {
    clearTimer(entry);
    const at = nextRunAt(entry.parsed);
    entry.nextAt = at;
    if (at === undefined) return;

    const delay = Math.min(maxDelayMs, Math.max(0, at - Date.now()));
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (!running) return;
      void Promise.resolve()
        .then(() => entry.task())
        .catch((error: unknown) => {
          options.onError?.(error, entry.expression);
        })
        .finally(() => {
          if (running) schedule(entry);
        });
    }, delay);
  };

  const scheduler: Scheduler = {
    schedule(expression: string, task: SchedulerTask): () => void {
      const entry: Entry = {
        expression,
        parsed: parseCronExpression(expression),
        task,
        timer: undefined,
        nextAt: undefined,
      };
      const unsubscribe = (): void => {
        clearTimer(entry);
        entries.delete(unsubscribe);
      };
      entries.set(unsubscribe, entry);
      if (running) schedule(entry);
      return unsubscribe;
    },

    start(): void {
      if (running) return;
      running = true;
      for (const entry of entries.values()) schedule(entry);
    },

    stop(): void {
      running = false;
      for (const entry of entries.values()) clearTimer(entry);
    },

    get scheduled(): number {
      return entries.size;
    },

    nextRunAt(expression: string): number | undefined {
      return nextRunAt(parseCronExpression(expression));
    },
  };

  return scheduler;
}
