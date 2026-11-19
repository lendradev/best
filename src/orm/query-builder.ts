/**
 * Query builder — Drizzle-style, SQL-emitting.
 *
 * Identifiers are quoted with the dialect's quoting rules. Callers that do not
 * pass a `quote` function get the identifiers verbatim, which is what the
 * standalone builder API has always done.
 */

import { SQL, type SqlParam, normalizeParam } from './sql.ts';

export type OrderDirection = 'asc' | 'desc';

/** Quotes an identifier for the target dialect. */
export type Quote = (identifier: string) => string;

export interface OrderBy {
  column: string;
  direction: OrderDirection;
}

export interface SelectOptions {
  table: string;
  columns?: string[];
  where?: SQL;
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
  joins?: JoinSpec[];
  quote?: Quote;
}

export interface JoinSpec {
  table: string;
  alias: string;
  on: SQL;
  type: 'inner' | 'left';
  columns?: string[];
}

/** Quotes every identifier unless the caller opted out. */
function quoteAll(quote: Quote | undefined, identifiers: string[]): string[] {
  if (!quote) return identifiers;
  return identifiers.map((identifier) => (identifier === '*' ? identifier : quote(identifier)));
}

export class SelectBuilder {
  readonly #options: SelectOptions;

  constructor(options: SelectOptions) {
    this.#options = options;
  }

  where(condition: SQL): SelectBuilder {
    return new SelectBuilder({ ...this.#options, where: condition });
  }

  orderBy(column: string, direction: OrderDirection = 'asc'): SelectBuilder {
    return new SelectBuilder({
      ...this.#options,
      orderBy: [...(this.#options.orderBy ?? []), { column, direction }],
    });
  }

  limit(count: number): SelectBuilder {
    return new SelectBuilder({ ...this.#options, limit: count });
  }

  offset(count: number): SelectBuilder {
    return new SelectBuilder({ ...this.#options, offset: count });
  }

  join(spec: Omit<JoinSpec, 'alias'> & { alias?: string }): SelectBuilder {
    const alias = spec.alias ?? spec.table;
    return new SelectBuilder({ ...this.#options, joins: [...(this.#options.joins ?? []), { ...spec, alias }] });
  }

  leftJoin(spec: Omit<JoinSpec, 'alias' | 'type'> & { alias?: string }): SelectBuilder {
    const alias = spec.alias ?? spec.table;
    return new SelectBuilder({
      ...this.#options,
      joins: [...(this.#options.joins ?? []), { ...spec, alias, type: 'left' }],
    });
  }

  toSQL(): { sql: string; params: SqlParam[] } {
    const quote = this.#options.quote;
    const columns = this.#options.columns?.length ? this.#options.columns : ['*'];

    let sql = `SELECT ${quoteAll(quote, columns).join(', ')} FROM ${quote ? quote(this.#options.table) : this.#options.table}`;
    const params: SqlParam[] = [];

    for (const join of this.#options.joins ?? []) {
      const on = join.on.toFragment();
      const table = quote ? quote(join.table) : join.table;
      const alias = quote ? quote(join.alias) : join.alias;
      sql += ` ${join.type.toUpperCase()} JOIN ${table} AS ${alias} ON ${on.sql}`;
      params.push(...on.params);
    }

    if (this.#options.where) {
      const where = this.#options.where.toFragment();
      sql += ` WHERE ${where.sql}`;
      params.push(...where.params);
    }

    if (this.#options.orderBy?.length) {
      sql += ` ORDER BY ${this.#options.orderBy
        .map((o) => `${quote ? quote(o.column) : o.column} ${o.direction.toUpperCase()}`)
        .join(', ')}`;
    }

    if (this.#options.limit !== undefined) sql += ` LIMIT ${this.#options.limit}`;
    if (this.#options.offset !== undefined) sql += ` OFFSET ${this.#options.offset}`;

    return { sql, params };
  }
}

export class InsertBuilder {
  readonly #table: string;
  readonly #values: Record<string, unknown>[];
  readonly #returning: string[];
  readonly #onConflict?: { columns: string[]; update: Record<string, unknown> };
  readonly #quote?: Quote;

  constructor(
    table: string,
    values: Record<string, unknown>[],
    returning: string[] = [],
    onConflict?: { columns: string[]; update: Record<string, unknown> },
    quote?: Quote,
  ) {
    this.#table = table;
    this.#values = values;
    this.#returning = returning;
    this.#onConflict = onConflict;
    this.#quote = quote;
  }

  returning(columns: string[]): InsertBuilder {
    return new InsertBuilder(this.#table, this.#values, columns, this.#onConflict, this.#quote);
  }

  onConflictDoUpdate(columns: string[], update: Record<string, unknown>): InsertBuilder {
    return new InsertBuilder(this.#table, this.#values, this.#returning, { columns, update }, this.#quote);
  }

  onConflictDoNothing(columns: string[]): InsertBuilder {
    return new InsertBuilder(this.#table, this.#values, this.#returning, { columns, update: {} }, this.#quote);
  }

  toSQL(): { sql: string; params: SqlParam[] } {
    const quote = this.#quote;
    const table = quote ? quote(this.#table) : this.#table;
    const columns = [...new Set(this.#values.flatMap((v) => Object.keys(v)))];
    const params: SqlParam[] = [];

    const tuples = this.#values.map((value) => {
      const placeholders = columns
        .map((column) => {
          params.push(normalizeParam(value[column]));
          return '?';
        })
        .join(', ');
      return `(${placeholders})`;
    });

    let sql = `INSERT INTO ${table} (${quoteAll(quote, columns).join(', ')}) VALUES ${tuples.join(', ')}`;

    if (this.#onConflict) {
      const conflictColumns = quoteAll(quote, this.#onConflict.columns).join(', ');
      const updateEntries = Object.entries(this.#onConflict.update);
      if (updateEntries.length === 0) {
        sql += ` ON CONFLICT (${conflictColumns}) DO NOTHING`;
      } else {
        const assignments = updateEntries.map(([column, value]) => {
          params.push(normalizeParam(value));
          return `${quote ? quote(column) : column} = ?`;
        });
        sql += ` ON CONFLICT (${conflictColumns}) DO UPDATE SET ${assignments.join(', ')}`;
      }
    }

    if (this.#returning.length) {
      sql += ` RETURNING ${quoteAll(quote, this.#returning).join(', ')}`;
    }

    return { sql, params };
  }
}

export class UpdateBuilder {
  readonly #table: string;
  readonly #values: Record<string, unknown>;
  readonly #where?: SQL;
  readonly #returning: string[];
  readonly #quote?: Quote;

  constructor(
    table: string,
    values: Record<string, unknown>,
    where?: SQL,
    returning: string[] = [],
    quote?: Quote,
  ) {
    this.#table = table;
    this.#values = values;
    this.#where = where;
    this.#returning = returning;
    this.#quote = quote;
  }

  where(condition: SQL): UpdateBuilder {
    return new UpdateBuilder(this.#table, this.#values, condition, this.#returning, this.#quote);
  }

  returning(columns: string[]): UpdateBuilder {
    return new UpdateBuilder(this.#table, this.#values, this.#where, columns, this.#quote);
  }

  toSQL(): { sql: string; params: SqlParam[] } {
    const quote = this.#quote;
    const table = quote ? quote(this.#table) : this.#table;
    const params: SqlParam[] = [];
    const assignments = Object.entries(this.#values).map(([column, value]) => {
      params.push(normalizeParam(value));
      return `${quote ? quote(column) : column} = ?`;
    });

    let sql = `UPDATE ${table} SET ${assignments.join(', ')}`;
    if (this.#where) {
      const where = this.#where.toFragment();
      sql += ` WHERE ${where.sql}`;
      params.push(...where.params);
    }
    if (this.#returning.length) sql += ` RETURNING ${quoteAll(quote, this.#returning).join(', ')}`;

    return { sql, params };
  }
}

export class DeleteBuilder {
  readonly #table: string;
  readonly #where?: SQL;
  readonly #returning: string[];
  readonly #quote?: Quote;

  constructor(table: string, where?: SQL, returning: string[] = [], quote?: Quote) {
    this.#table = table;
    this.#where = where;
    this.#returning = returning;
    this.#quote = quote;
  }

  where(condition: SQL): DeleteBuilder {
    return new DeleteBuilder(this.#table, condition, this.#returning, this.#quote);
  }

  returning(columns: string[]): DeleteBuilder {
    return new DeleteBuilder(this.#table, this.#where, columns, this.#quote);
  }

  toSQL(): { sql: string; params: SqlParam[] } {
    const quote = this.#quote;
    const table = quote ? quote(this.#table) : this.#table;
    const params: SqlParam[] = [];
    let sql = `DELETE FROM ${table}`;
    if (this.#where) {
      const where = this.#where.toFragment();
      sql += ` WHERE ${where.sql}`;
      params.push(...where.params);
    }
    if (this.#returning.length) sql += ` RETURNING ${quoteAll(quote, this.#returning).join(', ')}`;

    return { sql, params };
  }
}

export { SQL };
