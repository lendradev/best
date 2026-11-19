/**
 * Database drivers.
 *
 * `SqliteDriver` uses `bun:sqlite` (synchronous). The `PostgresDriver`,
 * `MysqlDriver` and `MariadbDriver` all use `Bun.SQL` (asynchronous, pooled)
 * with a different adapter.
 *
 * Every driver exposes the same interface so the query layer never branches on
 * the backend. Statements are written with portable `?` placeholders and
 * rendered to the backend's syntax by the driver.
 */

import { Database } from 'bun:sqlite';
import { getDialect, type Dialect, type DialectName } from './dialect.ts';
import { renderSql } from './render.ts';
import type { SqlParam } from './sql.ts';

export interface Driver {
  /** The dialect this driver speaks. */
  readonly kind: DialectName;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number; lastInsertRowid: number }>;
  transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* SQLite                                                                     */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Bun.SQL based drivers                                                      */
/* -------------------------------------------------------------------------- */

export interface SqlDriverOptions {
  url: string;
  /** Maximum pooled connections. */
  max?: number;
  /**
   * Allow the server's RSA public key to be retrieved during authentication.
   * Needed by MySQL 8 accounts using `caching_sha2_password` over an
   * unencrypted connection. MySQL and MariaDB only.
   */
  allowPublicKeyRetrieval?: boolean;
  /** TLS mode forwarded to Bun.SQL. */
  tls?: boolean;
}

/**
 * Shared implementation for the Bun.SQL backed drivers.
 *
 * Bun.SQL speaks the placeholder syntax of the target server: `?` for MySQL
 * and MariaDB, `$1` for PostgreSQL. The driver rewrites the portable `?`
 * placeholders before the statement reaches the server.
 */
class SqlDriver implements Driver {
  readonly kind: DialectName;
  readonly dialect: Dialect;
  readonly #client: Bun.SQL;

  constructor(kind: DialectName, options: SqlDriverOptions) {
    this.kind = kind;
    this.dialect = getDialect(kind);
    const isMySqlFamily = kind === 'mysql' || kind === 'mariadb';
    this.#client = new Bun.SQL(options.url, {
      max: options.max ?? 10,
      bigint: false,
      ...(isMySqlFamily && options.allowPublicKeyRetrieval !== undefined
        ? { allowPublicKeyRetrieval: options.allowPublicKeyRetrieval }
        : {}),
      ...(options.tls !== undefined ? { tls: options.tls } : {}),
    });
  }

  /** Escape hatch for the underlying Bun.SQL client. */
  get raw(): Bun.SQL {
    return this.#client;
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const rendered = renderSql(sql, params, this.dialect);
    const rows = await this.#client.unsafe(rendered.sql, rendered.params as never[]);
    return (Array.isArray(rows) ? rows : []) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const rows = await this.all<T>(sql, params);
    return rows[0] ?? null;
  }

  async run(sql: string, params: SqlParam[] = []) {
    const rendered = renderSql(sql, params, this.dialect);
    const result = await this.#client.unsafe(rendered.sql, rendered.params as never[]);
    return {
      changes: Number(result?.affectedRows ?? 0) || Number(result?.count ?? 0),
      lastInsertRowid: Number(result?.lastInsertRowid ?? 0),
    };
  }

  async transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T> {
    return this.#client.transaction(async (tx) => {
      const wrapped = this.#wrap(tx);
      return fn(wrapped);
    });
  }

  #wrap(tx: Bun.TransactionSQL): Driver {
    const self = this;
    const run = async (sql: string, params: SqlParam[]) => {
      const rendered = renderSql(sql, params, self.dialect);
      return tx.unsafe(rendered.sql, rendered.params as never[]);
    };
    return {
      kind: self.kind,
      async all<T>(sql: string, params: SqlParam[] = []) {
        const rows = await run(sql, params);
        return (Array.isArray(rows) ? rows : []) as T[];
      },
      async get<T>(sql: string, params: SqlParam[] = []) {
        const rows = await run(sql, params);
        return ((Array.isArray(rows) ? rows[0] : null) ?? null) as T | null;
      },
      async run(sql: string, params: SqlParam[]) {
        const result = await run(sql, params);
        return {
          changes: Number(result?.affectedRows ?? 0) || Number(result?.count ?? 0),
          lastInsertRowid: Number(result?.lastInsertRowid ?? 0),
        };
      },
      async transaction() {
        throw new Error('Nested transactions are not supported');
      },
      async close() {},
    };
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export class PostgresDriver extends SqlDriver {
  constructor(options: SqlDriverOptions) {
    super('postgres', options);
  }
}

export class MysqlDriver extends SqlDriver {
  constructor(options: SqlDriverOptions) {
    super('mysql', options);
  }
}

export class MariadbDriver extends SqlDriver {
  constructor(options: SqlDriverOptions) {
    super('mariadb', options);
  }
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

export type DriverOptions =
  | SqliteDriverOptions
  | (SqlDriverOptions & { adapter?: 'postgres' | 'mysql' | 'mariadb' });

export function createDriver(options: DriverOptions): Driver {
  if ('url' in options) {
    const adapter = options.adapter ?? inferAdapter(options.url);
    switch (adapter) {
      case 'mysql':
        return new MysqlDriver(options);
      case 'mariadb':
        return new MariadbDriver(options);
      default:
        return new PostgresDriver(options);
    }
  }
  return new SqliteDriver(options);
}

/** Infers the adapter from a connection URL scheme. */
export function inferAdapter(url: string): 'postgres' | 'mysql' | 'mariadb' {
  if (url.startsWith('mysql2://')) return 'mysql';
  if (url.startsWith('mysql://')) return 'mysql';
  if (url.startsWith('mariadb://')) return 'mariadb';
  return 'postgres';
}
