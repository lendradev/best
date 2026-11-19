/**
 * SQL dialects.
 *
 * Each dialect describes the differences that actually matter between
 * SQLite, PostgreSQL, MySQL and MariaDB:
 *
 * - parameter placeholders (`?` vs `$1`)
 * - identifier quoting
 * - whether a write can return the affected row (`RETURNING`)
 * - how an upsert is expressed
 * - how booleans are stored
 * - how case-insensitive matching is expressed
 * - column types, default values and table DDL
 */

import type { ColumnType, TableDefinition } from './schema.ts';

export type DialectName = 'sqlite' | 'postgres' | 'mysql' | 'mariadb';

export interface Dialect {
  readonly name: DialectName;
  /** Placeholder for the n-th parameter (1-based). */
  placeholder(index: number): string;
  /** Quote an identifier. */
  quote(identifier: string): string;
  /** Whether `RETURNING` is supported for inserts. */
  readonly supportsReturning: boolean;
  /** Whether `RETURNING` works on UPDATE and DELETE. */
  readonly supportsReturningOnUpdate: boolean;
  /** Whether the backend stores a real boolean type. */
  readonly nativeBoolean: boolean;
  /**
   * Whether the backend reports the rows a statement matched.
   *
   * SQLite and PostgreSQL count every row an UPDATE or DELETE touched.
   * MySQL and MariaDB count only the rows whose values changed, so an update
   * that writes the same values reports nothing.
   */
  readonly countsMatchedRows: boolean;
  /** Expression for a case-insensitive match on an already quoted column. */
  ilike(column: string): string;
  /** Build an upsert statement for a unique key. */
  upsert(options: UpsertOptions): { sql: string; params: unknown[] };
  /** DDL statements that create the table and its indexes. */
  createTable(table: TableDefinition): string[];
  /** Column type name for a logical column type. */
  columnType(type: ColumnType): string;
  /** Render a default value as a SQL literal for this dialect. */
  defaultValue(value: unknown): string | null;
  /** Convert a value for storage. */
  toStorage(value: unknown): unknown;
}

export interface UpsertOptions {
  table: string;
  values: Record<string, unknown>;
  conflictColumns: string[];
  update: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Renders a default value as a SQL literal.
 *
 * `booleanLiteral` is how the dialect spells true — `TRUE` on PostgreSQL, `1`
 * on the backends that store a boolean as an integer.
 */
function formatDefault(value: unknown, booleanLiteral: string): string | null {
  if (value === undefined) return null;
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? booleanLiteral : booleanLiteral === 'TRUE' ? 'FALSE' : '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

/**
 * Builds an `INSERT ... ON CONFLICT ... DO UPDATE` statement.
 *
 * The insert values come first and the update values second, which is the
 * order the placeholders appear in.
 */
function conflictUpsert(
  quote: (identifier: string) => string,
  table: string,
  values: Record<string, unknown>,
  conflictColumns: string[],
  update: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  const columns = Object.keys(values);
  const params: unknown[] = columns.map((column) => values[column]);

  const sql =
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')})` +
    ` VALUES (${columns.map(() => '?').join(', ')})`;

  if (Object.keys(update).length === 0) {
    return { sql: `${sql} ON CONFLICT (${conflictColumns.map(quote).join(', ')}) DO NOTHING`, params };
  }

  const assignments = Object.entries(update).map(([column, value]) => {
    params.push(value);
    return `${quote(column)} = ?`;
  });
  return {
    sql: `${sql} ON CONFLICT (${conflictColumns.map(quote).join(', ')}) DO UPDATE SET ${assignments.join(', ')}`,
    params,
  };
}

/* -------------------------------------------------------------------------- */
/* SQLite                                                                     */
/* -------------------------------------------------------------------------- */

const sqliteTypeMap: Record<ColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'BOOLEAN',
  blob: 'BLOB',
  json: 'TEXT',
  timestamp: 'TEXT',
  uuid: 'TEXT',
  bigint: 'INTEGER',
};

const sqliteQuote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function createSqliteTable(table: TableDefinition): string {
  const parts: string[] = [];
  for (const column of table.columns) {
    let definition = `${sqliteQuote(column.name)} ${sqliteTypeMap[column.type]}`;
    if (column.primaryKey) {
      definition += column.autoIncrement ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY';
    }
    if (column.notNull && !column.primaryKey) definition += ' NOT NULL';
    if (column.unique && !column.primaryKey) definition += ' UNIQUE';
    const defaultValue = formatDefault(column.default, '1');
    if (defaultValue !== null) definition += ` DEFAULT ${defaultValue}`;
    parts.push(definition);
  }
  for (const column of table.columns) {
    if (!column.references) continue;
    const action = column.references.onDelete ? ` ON DELETE ${column.references.onDelete}` : '';
    parts.push(
      `FOREIGN KEY (${sqliteQuote(column.name)}) REFERENCES ${sqliteQuote(column.references.table)}(${sqliteQuote(column.references.column)})${action}`,
    );
  }
  return `CREATE TABLE IF NOT EXISTS ${sqliteQuote(table.name)} (\n  ${parts.join(',\n  ')}\n)`;
}

function createSqliteIndexes(table: TableDefinition): string[] {
  return table.indexes.map(
    (index) =>
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${sqliteQuote(index.name)} ON ${sqliteQuote(table.name)} (${index.columns.map(sqliteQuote).join(', ')})`,
  );
}

export const sqliteDialect: Dialect = {
  name: 'sqlite',
  placeholder: () => '?',
  quote: sqliteQuote,
  supportsReturning: true,
  supportsReturningOnUpdate: true,
  nativeBoolean: false,
  countsMatchedRows: true,
  ilike: (column) => `LOWER(${column}) LIKE LOWER(?)`,
  upsert: ({ table, values, conflictColumns, update }) =>
    conflictUpsert(sqliteQuote, table, values, conflictColumns, update),
  createTable: (table) => [createSqliteTable(table), ...createSqliteIndexes(table)],
  columnType: (type) => sqliteTypeMap[type],
  defaultValue: (value) => formatDefault(value, '1'),
  toStorage: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
};

/* -------------------------------------------------------------------------- */
/* PostgreSQL                                                                 */
/* -------------------------------------------------------------------------- */

const postgresTypeMap: Record<ColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'DOUBLE PRECISION',
  boolean: 'BOOLEAN',
  blob: 'BYTEA',
  json: 'JSONB',
  timestamp: 'TIMESTAMPTZ',
  uuid: 'UUID',
  bigint: 'BIGINT',
};

const postgresQuote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function createPostgresTable(table: TableDefinition): string {
  const parts: string[] = [];
  for (const column of table.columns) {
    let definition = `${postgresQuote(column.name)} ${postgresTypeMap[column.type]}`;
    if (column.primaryKey) {
      definition += column.autoIncrement
        ? ' GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY'
        : ' PRIMARY KEY';
    }
    if (column.notNull && !column.primaryKey) definition += ' NOT NULL';
    if (column.unique && !column.primaryKey) definition += ' UNIQUE';
    const defaultValue = formatDefault(column.default, 'TRUE');
    if (defaultValue !== null) definition += ` DEFAULT ${defaultValue}`;
    parts.push(definition);
  }
  for (const column of table.columns) {
    if (!column.references) continue;
    const action = column.references.onDelete ? ` ON DELETE ${column.references.onDelete}` : '';
    parts.push(
      `FOREIGN KEY (${postgresQuote(column.name)}) REFERENCES ${postgresQuote(column.references.table)}(${postgresQuote(column.references.column)})${action}`,
    );
  }
  return `CREATE TABLE IF NOT EXISTS ${postgresQuote(table.name)} (\n  ${parts.join(',\n  ')}\n)`;
}

function createPostgresIndexes(table: TableDefinition): string[] {
  return table.indexes.map(
    (index) =>
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${postgresQuote(index.name)} ON ${postgresQuote(table.name)} (${index.columns.map(postgresQuote).join(', ')})`,
  );
}

export const postgresDialect: Dialect = {
  name: 'postgres',
  placeholder: (index) => `$${index}`,
  quote: postgresQuote,
  supportsReturning: true,
  supportsReturningOnUpdate: true,
  nativeBoolean: true,
  countsMatchedRows: true,
  ilike: (column) => `${column} ILIKE ?`,
  upsert: ({ table, values, conflictColumns, update }) =>
    conflictUpsert(postgresQuote, table, values, conflictColumns, update),
  createTable: (table) => [createPostgresTable(table), ...createPostgresIndexes(table)],
  columnType: (type) => postgresTypeMap[type],
  defaultValue: (value) => formatDefault(value, 'TRUE'),
  toStorage: (value) => value,
};

/* -------------------------------------------------------------------------- */
/* MySQL / MariaDB                                                            */
/* -------------------------------------------------------------------------- */

const mysqlTypeMap: Record<ColumnType, string> = {
  text: 'VARCHAR(255)',
  integer: 'INT',
  real: 'DOUBLE',
  boolean: 'TINYINT(1)',
  blob: 'BLOB',
  json: 'JSON',
  timestamp: 'DATETIME',
  uuid: 'CHAR(36)',
  bigint: 'BIGINT',
};

const mysqlQuote = (identifier: string) => `\`${identifier.replace(/`/g, '``')}\``;

function createMySqlTable(table: TableDefinition): string {
  const parts: string[] = [];
  for (const column of table.columns) {
    let definition = `${mysqlQuote(column.name)} ${mysqlTypeMap[column.type]}`;
    if (column.primaryKey) {
      definition += column.autoIncrement ? ' AUTO_INCREMENT PRIMARY KEY' : ' PRIMARY KEY';
    }
    if (column.notNull && !column.primaryKey) definition += ' NOT NULL';
    if (column.unique && !column.primaryKey) definition += ' UNIQUE';
    const defaultValue = formatDefault(column.default, '1');
    if (defaultValue !== null) definition += ` DEFAULT ${defaultValue}`;
    parts.push(definition);
  }
  for (const column of table.columns) {
    if (!column.references) continue;
    const action = column.references.onDelete ? ` ON DELETE ${column.references.onDelete}` : '';
    parts.push(
      `FOREIGN KEY (${mysqlQuote(column.name)}) REFERENCES ${mysqlQuote(column.references.table)}(${mysqlQuote(column.references.column)})${action}`,
    );
  }
  return `CREATE TABLE IF NOT EXISTS ${mysqlQuote(table.name)} (\n  ${parts.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

function createMySqlIndexes(table: TableDefinition): string[] {
  return table.indexes.map(
    (index) =>
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${mysqlQuote(index.name)} ON ${mysqlQuote(table.name)} (${index.columns.map(mysqlQuote).join(', ')})`,
  );
}

function createMySqlDialect(name: 'mysql' | 'mariadb'): Dialect {
  return {
    name,
    placeholder: () => '?',
    quote: mysqlQuote,
    // MySQL has no RETURNING. MariaDB supports it on INSERT from 10.5 and on
    // UPDATE and DELETE from 11.5, so only the insert is assumed to work.
    supportsReturning: name === 'mariadb',
    supportsReturningOnUpdate: false,
    nativeBoolean: false,
    countsMatchedRows: false,
    ilike: (column) => `LOWER(${column}) LIKE LOWER(?)`,
    upsert({ table, values, conflictColumns, update }) {
      const columns = Object.keys(values);
      const params: unknown[] = columns.map((column) => values[column]);
      // The unique key of the table decides which row is updated, so the
      // conflict columns are not named in the statement.
      void conflictColumns;
      const sql =
        `INSERT INTO ${mysqlQuote(table)} (${columns.map(mysqlQuote).join(', ')})` +
        ` VALUES (${columns.map(() => '?').join(', ')})`;
      if (Object.keys(update).length === 0) {
        return { sql, params };
      }
      const assignments = Object.entries(update).map(([column, value]) => {
        params.push(value);
        return `${mysqlQuote(column)} = ?`;
      });
      return { sql: `${sql} ON DUPLICATE KEY UPDATE ${assignments.join(', ')}`, params };
    },
    createTable: (table) => [createMySqlTable(table), ...createMySqlIndexes(table)],
    columnType: (type) => mysqlTypeMap[type],
    defaultValue: (value) => formatDefault(value, '1'),
    toStorage: (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value),
  };
}

export const mysqlDialect = createMySqlDialect('mysql');
export const mariadbDialect = createMySqlDialect('mariadb');

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

const dialects: Record<DialectName, Dialect> = {
  sqlite: sqliteDialect,
  postgres: postgresDialect,
  mysql: mysqlDialect,
  mariadb: mariadbDialect,
};

export function getDialect(name: DialectName): Dialect {
  const dialect = dialects[name];
  if (!dialect) throw new Error(`Unknown dialect: ${name}`);
  return dialect;
}
