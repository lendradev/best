/**
 * SQL rendering.
 *
 * Statements are built with portable `?` placeholders and rendered to the
 * target dialect at execution time: PostgreSQL numbers its placeholders
 * (`$1`, `$2`), while SQLite, MySQL and MariaDB use `?`.
 *
 * The rewrite skips string literals, quoted identifiers and comments so a `?`
 * inside user data is never mistaken for a placeholder.
 */

import type { Dialect } from './dialect.ts';
import type { SqlParam } from './sql.ts';

export interface RenderedSql {
  sql: string;
  params: SqlParam[];
}

/**
 * Rewrites portable placeholders into the dialect's syntax.
 *
 * A statement that already uses numbered placeholders (`$1`, `$2`) is left
 * alone, so hand-written PostgreSQL keeps working. Mixing the two styles in
 * one statement is an error.
 *
 * @throws when the number of placeholders does not match the parameter count.
 */
export function renderSql(sql: string, params: SqlParam[], dialect: Dialect): RenderedSql {
  const portable = countPlaceholders(sql);
  const native = countNumberedPlaceholders(sql);

  if (portable > 0 && native > 0) {
    throw new Error('SQL mixes `?` and `$n` placeholders; use one style per statement');
  }

  if (native > 0) {
    if (native !== params.length) {
      throw new Error(
        `SQL has ${native} placeholder(s) but ${params.length} parameter(s) were bound`,
      );
    }
    return { sql, params };
  }

  if (portable !== params.length) {
    throw new Error(
      `SQL has ${portable} placeholder(s) but ${params.length} parameter(s) were bound`,
    );
  }

  return { sql: replacePlaceholders(sql, dialect.placeholder), params };
}

/**
 * Replaces each `?` placeholder with the dialect's placeholder for that
 * position. SQLite, MySQL and MariaDB keep `?`.
 */
export function replacePlaceholders(sql: string, placeholder: (index: number) => string): string {
  let out = '';
  let index = 0;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i] as string;

    if (char === "'" || char === '"' || char === '`') {
      const end = skipQuoted(sql, i, char);
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (char === '?') {
      index += 1;
      out += placeholder(index);
      i += 1;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * Replaces each `?` placeholder with a numbered `$n` placeholder.
 */
export function numberPlaceholders(sql: string): string {
  return replacePlaceholders(sql, (index) => `$${index}`);
}

/**
 * Returns the index just past the closing quote of a quoted section.
 * A doubled quote inside the section is an escaped quote.
 */
function skipQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

/**
 * Counts the placeholders in a statement, ignoring quoted sections.
 */
export function countPlaceholders(sql: string): number {
  let count = 0;
  for (const char of scanSql(sql)) {
    if (char === '?') count += 1;
  }
  return count;
}

/**
 * Counts the numbered placeholders (`$1`, `$2`) in a statement.
 */
export function countNumberedPlaceholders(sql: string): number {
  let count = 0;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] as string;
    if (char === "'" || char === '"' || char === '`') {
      i = skipQuoted(sql, i, char);
      continue;
    }
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (char === '$' && /[1-9]/.test(sql[i + 1] ?? '')) {
      count += 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  return count;
}

/**
 * Yields the significant characters of a statement, skipping the quoted
 * sections and the comments.
 */
function* scanSql(sql: string): Generator<string> {
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] as string;
    if (char === "'" || char === '"' || char === '`') {
      i = skipQuoted(sql, i, char);
      continue;
    }
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    yield char;
    i += 1;
  }
}
