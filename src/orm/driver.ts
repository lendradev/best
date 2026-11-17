/**
 * Database drivers.
 *
 * `SqliteDriver` uses `bun:sqlite` (synchronous). `PostgresDriver` uses
 * `Bun.SQL` (asynchronous, pooled). Both expose the same `Driver` interface so
 * the query layer does not branch on the backend.
 */

import { Database } from 'bun:sqlite';
import type { SqlParam } from './sql.ts';

export interface Driver {
  readonly kind: 'sqlite' | 'postgres';
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number; lastInsertRowid: number }>;
  transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface SqliteDriverOptions {
  file?: string;
  readonly?: boolean;
  create?: boolean;
  strict?: boolean;
  safeIntegers?: boolean;
}

export class SqliteDriver implements Driver {
  readonly kind = 'sqlite' as const;
  readonly #db: Database;

  constructor(options: SqliteDriverOptions = {}) {
    this.#db = new Database(options.file ?? ':memory:', {
      readonly: options.readonly ?? false,
      create: options.create ?? true,
      strict: options.strict ?? false,
      safeIntegers: options.safeIntegers ?? false,
    });
  }

  /** Escape hatch for the underlying handle. */
  get raw(): Database {
    return this.#db;
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const statement = this.#db.prepare(sql);
    return statement.all(...(params as never[])) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const statement = this.#db.prepare(sql);
    return (statement.get(...(params as never[])) as T | undefined) ?? null;
  }

  async run(sql: string, params: SqlParam[] = []) {
    const statement = this.#db.prepare(sql);
    const result = statement.run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  async transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T> {
    this.#db.transaction(() => {})();
    this.#db.run('BEGIN');
    try {
      const result = await fn(this);
      this.#db.run('COMMIT');
      return result;
    } catch (error) {
      this.#db.run('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

export interface PostgresDriverOptions {
  url: string;
  max?: number;
}

export class PostgresDriver implements Driver {
  readonly kind = 'postgres' as const;
  readonly #client: any;

  constructor(options: PostgresDriverOptions) {
    this.#client = new Bun.SQL(options.url, {
      max: options.max ?? 10,
      bigint: false,
    });
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return (await this.#client.unsafe(sql, params as never[])) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const rows = await this.all<T>(sql, params);
    return rows[0] ?? null;
  }

  async run(sql: string, params: SqlParam[] = []) {
    const result = await this.#client.unsafe(sql, params as never[]);
    const count = Number(result?.count ?? 0);
    return { changes: count, lastInsertRowid: 0 };
  }

  async transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T> {
    return this.#client.transaction(async (tx: any) => {
      const wrapped: Driver = {
        kind: 'postgres',
        all: (sql, params) => tx.unsafe(sql, params as never[]),
        get: async (sql, params) => {
          const rows = await tx.unsafe(sql, params as never[]);
          return (rows[0] ?? null) as any;
        },
        run: async (sql, params) => {
          const result = await tx.unsafe(sql, params as never[]);
          return { changes: Number(result?.count ?? 0), lastInsertRowid: 0 };
        },
        transaction: async () => {
          throw new Error('Nested transactions are not supported');
        },
        close: async () => {},
      };
      return fn(wrapped);
    });
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export function createDriver(options: SqliteDriverOptions | PostgresDriverOptions): Driver {
  if ('url' in options) return new PostgresDriver(options);
  return new SqliteDriver(options);
}
