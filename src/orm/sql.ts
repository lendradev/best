/**
 * SQL expression builder.
 *
 * Every builder produces a `{ sql, params }` pair so the same code path works
 * for SQLite (`bun:sqlite`) and Postgres (`Bun.SQL`).
 */

export type SqlParam = string | number | boolean | null | bigint | Uint8Array | Date;

export interface SqlFragment {
  sql: string;
  params: SqlParam[];
}

export class SQL {
  readonly #fragments: SqlFragment[] = [];

  constructor(...fragments: SqlFragment[]) {
    this.#fragments = fragments;
  }

  static raw(sql: string, params: SqlParam[] = []): SQL {
    return new SQL({ sql, params });
  }

  /** Tagged template that escapes interpolated values as bound parameters. */
  static tagged(strings: TemplateStringsArray, ...values: unknown[]): SQL {
    let sql = '';
    const params: SqlParam[] = [];
    strings.forEach((part, index) => {
      sql += part;
      if (index < values.length) {
        const value = values[index];
        if (value instanceof SQL) {
          sql += value.toFragment().sql;
          params.push(...value.toFragment().params);
        } else {
          sql += '?';
          params.push(normalizeParam(value));
        }
      }
    });
    return new SQL({ sql, params });
  }

  and(other: SQL): SQL {
    return new SQL(...this.#fragments, other.toFragment());
  }

  or(other: SQL): SQL {
    return new SQL(...this.#fragments, { sql: ' OR ', params: [] }, other.toFragment());
  }

  toFragment(): SqlFragment {
    let sql = '';
    const params: SqlParam[] = [];
    for (const fragment of this.#fragments) {
      sql += fragment.sql;
      params.push(...fragment.params);
    }
    return { sql, params };
  }

  toString(): string {
    return this.toFragment().sql;
  }
}

export function normalizeParam(value: unknown): SqlParam {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

export function eq(column: string, value: unknown): SQL {
  return SQL.raw(`${column} = ?`, [normalizeParam(value)]);
}

export function ne(column: string, value: unknown): SQL {
  return SQL.raw(`${column} != ?`, [normalizeParam(value)]);
}

export function gt(column: string, value: unknown): SQL {
  return SQL.raw(`${column} > ?`, [normalizeParam(value)]);
}

export function gte(column: string, value: unknown): SQL {
  return SQL.raw(`${column} >= ?`, [normalizeParam(value)]);
}

export function lt(column: string, value: unknown): SQL {
  return SQL.raw(`${column} < ?`, [normalizeParam(value)]);
}

export function lte(column: string, value: unknown): SQL {
  return SQL.raw(`${column} <= ?`, [normalizeParam(value)]);
}

export function like(column: string, pattern: string): SQL {
  return SQL.raw(`${column} LIKE ?`, [pattern]);
}

export function ilike(column: string, pattern: string): SQL {
  return SQL.raw(`LOWER(${column}) LIKE LOWER(?)`, [pattern]);
}

export function isNull(column: string): SQL {
  return SQL.raw(`${column} IS NULL`);
}

export function isNotNull(column: string): SQL {
  return SQL.raw(`${column} IS NOT NULL`);
}

export function inArray(column: string, values: readonly unknown[]): SQL {
  if (values.length === 0) return SQL.raw('1 = 0');
  const placeholders = values.map(() => '?').join(', ');
  return SQL.raw(`${column} IN (${placeholders})`, values.map(normalizeParam));
}

export function notInArray(column: string, values: readonly unknown[]): SQL {
  if (values.length === 0) return SQL.raw('1 = 1');
  const placeholders = values.map(() => '?').join(', ');
  return SQL.raw(`${column} NOT IN (${placeholders})`, values.map(normalizeParam));
}

export function between(column: string, min: unknown, max: unknown): SQL {
  return SQL.raw(`${column} BETWEEN ? AND ?`, [normalizeParam(min), normalizeParam(max)]);
}

export function and(...conditions: (SQL | undefined)[]): SQL {
  const parts = conditions.filter((c): c is SQL => Boolean(c));
  if (parts.length === 0) return SQL.raw('');
  if (parts.length === 1) return parts[0] as SQL;
  return SQL.raw(
    `(${parts.map((p) => `(${p.toFragment().sql})`).join(' AND ')})`,
    parts.flatMap((p) => p.toFragment().params),
  );
}

export function or(...conditions: (SQL | undefined)[]): SQL {
  const parts = conditions.filter((c): c is SQL => Boolean(c));
  if (parts.length === 0) return SQL.raw('');
  if (parts.length === 1) return parts[0] as SQL;
  return SQL.raw(
    `(${parts.map((p) => `(${p.toFragment().sql})`).join(' OR ')})`,
    parts.flatMap((p) => p.toFragment().params),
  );
}

export function not(condition: SQL): SQL {
  return SQL.raw(`NOT (${condition.toFragment().sql})`, condition.toFragment().params);
}

export function raw(sql: string, params: SqlParam[] = []): SQL {
  return SQL.raw(sql, params);
}

/** Aggregates. */
export const count = (column = '*') => SQL.raw(`COUNT(${column})`);
export const sum = (column: string) => SQL.raw(`SUM(${column})`);
export const avg = (column: string) => SQL.raw(`AVG(${column})`);
export const min = (column: string) => SQL.raw(`MIN(${column})`);
export const max = (column: string) => SQL.raw(`MAX(${column})`);
