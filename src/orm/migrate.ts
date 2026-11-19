/**
 * Schema-to-SQL migration generator.
 *
 * Reads a `SchemaDefinition` and produces DDL statements per table, plus
 * index creation. Introspects an existing database to compute a diff.
 */

import { getDialect, type Dialect, type DialectName } from './dialect.ts';
import type { Driver } from './driver.ts';
import type { ColumnDefinition, SchemaDefinition, TableDefinition } from './schema.ts';

export interface Migration {
  name: string;
  statements: string[];
}

/**
 * Renders a default value as a SQL literal.
 *
 * The dialect decides how a boolean default is spelled, so this uses the
 * SQLite spelling unless another dialect is given.
 */
export function formatDefault(value: unknown, dialect: Dialect = getDialect('sqlite')): string | null {
  return dialect.defaultValue(value);
}

/**
 * DDL for one table, rendered with the dialect's quoting and types.
 *
 * The dialect owns table and index creation; this is the public entry point.
 */
export function createTableSql(table: TableDefinition, dialect: Dialect = getDialect('sqlite')): string {
  return dialect.createTable(table)[0] ?? '';
}

/** Index DDL for one table. */
export function createIndexSql(
  table: TableDefinition,
  dialect: Dialect = getDialect('sqlite'),
): string[] {
  return dialect.createTable(table).slice(1);
}

/** Full DDL for a schema — used to create a fresh database. */
export function generateMigration(
  schema: SchemaDefinition,
  name = 'initial',
  dialectName: DialectName = 'sqlite',
): Migration {
  const dialect = getDialect(dialectName);
  const statements: string[] = [];
  for (const table of schema.tables) {
    statements.push(...dialect.createTable(table));
  }
  return { name, statements };
}

/* -------------------------------------------------------------------------- */
/* Diffing against a live database                                            */
/* -------------------------------------------------------------------------- */

export interface ExistingColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface SchemaDiff {
  createTables: string[];
  addColumns: { table: string; sql: string }[];
  /** Statements that cannot be applied automatically. */
  manual: string[];
}

export async function diffSchema(
  schema: SchemaDefinition,
  driver: Driver,
): Promise<SchemaDiff> {
  const diff: SchemaDiff = { createTables: [], addColumns: [], manual: [] };
  const dialect = getDialect(driver.kind);

  if (dialect.name === 'sqlite') {
    await diffSqlite(schema, driver, diff, dialect);
    return diff;
  }

  if (dialect.name === 'postgres') {
    await diffPostgres(schema, driver, diff, dialect);
    return diff;
  }

  // MySQL and MariaDB share the INFORMATION_SCHEMA layout.
  await diffMySqlFamily(schema, driver, diff, dialect);
  return diff;
}

async function diffSqlite(
  schema: SchemaDefinition,
  driver: Driver,
  diff: SchemaDiff,
  dialect: Dialect,
): Promise<void> {
  const existingTables = new Set(
    (await driver.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)).map(
      (row) => row.name,
    ),
  );

  for (const table of schema.tables) {
    if (!existingTables.has(table.name)) {
      diff.createTables.push(...dialect.createTable(table));
      continue;
    }

    const existingColumns = new Map(
      (await driver.all<ExistingColumn>(`PRAGMA table_info(${dialect.quote(table.name)})`)).map(
        (column) => [column.name, column],
      ),
    );

    for (const column of table.columns) {
      if (existingColumns.has(column.name)) continue;
      diff.addColumns.push({
        table: table.name,
        sql: `ALTER TABLE ${dialect.quote(table.name)} ADD COLUMN ${addColumnSql(column, dialect)}`,
      });
    }
  }
}

async function diffPostgres(
  schema: SchemaDefinition,
  driver: Driver,
  diff: SchemaDiff,
  dialect: Dialect,
): Promise<void> {
  const existingTables = new Set(
    (
      await driver.all<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`,
      )
    ).map((row) => row.table_name),
  );

  for (const table of schema.tables) {
    if (!existingTables.has(table.name)) {
      diff.createTables.push(...dialect.createTable(table));
      continue;
    }

    const existingColumns = new Set(
      (
        await driver.all<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND table_schema = current_schema()`,
          [table.name],
        )
      ).map((row) => row.column_name),
    );

    for (const column of table.columns) {
      if (existingColumns.has(column.name)) continue;
      diff.addColumns.push({
        table: table.name,
        sql: `ALTER TABLE ${dialect.quote(table.name)} ADD COLUMN ${addColumnSql(column, dialect)}`,
      });
    }
  }
}

async function diffMySqlFamily(
  schema: SchemaDefinition,
  driver: Driver,
  diff: SchemaDiff,
  dialect: Dialect,
): Promise<void> {
  const existingTables = new Set(
    (
      await driver.all<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
      )
    ).map((row) => row.TABLE_NAME),
  );

  for (const table of schema.tables) {
    if (!existingTables.has(table.name)) {
      diff.createTables.push(...dialect.createTable(table));
      continue;
    }

    const existingColumns = new Set(
      (
        await driver.all<{ COLUMN_NAME: string }>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
          [table.name],
        )
      ).map((row) => row.COLUMN_NAME),
    );

    for (const column of table.columns) {
      if (existingColumns.has(column.name)) continue;
      diff.addColumns.push({
        table: table.name,
        sql: `ALTER TABLE ${dialect.quote(table.name)} ADD COLUMN ${addColumnSql(column, dialect)}`,
      });
    }
  }
}

/** Column definition used in an `ALTER TABLE ... ADD COLUMN` statement. */
function addColumnSql(column: ColumnDefinition, dialect: Dialect): string {
  let definition = `${dialect.quote(column.name)} ${dialect.columnType(column.type)}`;
  if (column.notNull) definition += ' NOT NULL';
  const defaultValue = dialect.defaultValue(column.default);
  if (defaultValue !== null) definition += ` DEFAULT ${defaultValue}`;
  return definition;
}
