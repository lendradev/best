/**
 * Logger — level-filtered console logger with no external dependency.
 */

export type LogLevel = 'debug' | 'log' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  log: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  /** Sink override, useful for tests. */
  sink?: (level: LogLevel, message: string, meta?: unknown[]) => void;
}

export class Logger {
  readonly #level: LogLevel;
  readonly #prefix: string;
  readonly #sink: (level: LogLevel, message: string, meta?: unknown[]) => void;

  constructor(options: LoggerOptions = {}) {
    this.#level = options.level ?? 'log';
    this.#prefix = options.prefix ?? '';
    this.#sink =
      options.sink ??
      ((level, message, meta) => {
        const label = this.#prefix ? `[${this.#prefix}] ` : '';
        const args = meta && meta.length > 0 ? meta : [];
        const method =
          level === 'debug' ? 'log' : level === 'fatal' ? 'error' : level;
        (console[method] as (...a: unknown[]) => void)(`${label}${message}`, ...args);
      });
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.#level];
  }

  debug(message: string, ...meta: unknown[]): void {
    if (this.isLevelEnabled('debug')) this.#sink('debug', message, meta);
  }

  log(message: string, ...meta: unknown[]): void {
    if (this.isLevelEnabled('log')) this.#sink('log', message, meta);
  }

  /** Alias of `log`, for callers that use the conventional logger naming. */
  info(message: string, ...meta: unknown[]): void {
    this.log(message, ...meta);
  }

  warn(message: string, ...meta: unknown[]): void {
    if (this.isLevelEnabled('warn')) this.#sink('warn', message, meta);
  }

  error(message: string, ...meta: unknown[]): void {
    if (this.isLevelEnabled('error')) this.#sink('error', message, meta);
  }

  fatal(message: string, ...meta: unknown[]): void {
    if (this.isLevelEnabled('fatal')) this.#sink('fatal', message, meta);
  }

  /** Creates a child logger with an additional prefix. */
  child(prefix: string): Logger {
    return new Logger({
      level: this.#level,
      prefix: this.#prefix ? `${this.#prefix}:${prefix}` : prefix,
      sink: this.#sink,
    });
  }
}
