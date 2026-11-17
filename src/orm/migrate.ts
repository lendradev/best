/**
 * Schema-to-SQL migration generator.
 *
 * Reads a `SchemaDefinition` and produces DDL statements per table, plus
 * index creation. Introspects an existing SQLite database to compute a diff.
 */

import type { Driver } from './driver.ts';
import type { ColumnDefinition, SchemaDefinition, TableDefinition } from './schema.ts';

export interface Migration {
  name: string;
  statements: string[];
}

export type SqlType =
  | 'TEXT'
  | 'INTEGER'
  | 'REAL'
  | 'BLOB'
  | 'BOOLEAN'
  | 'JSON'
  | 'TIMESTAMP'
  | 'BIGINT';

const TYPE_MAP: Record<ColumnDefinition['type'], SqlType> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'BOOLEAN',
  blob: 'BLOB',
  json: 'JSON',
  timestamp: 'TIMESTAMP',
  uuid: 'TEXT',
  bigint: 'BIGINT',
};

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function formatDefault(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

export function createTableSql(table: TableDefinition): string {
  const parts: string[] = [];

  for (const column of table.columns) {
    let definition = `${quote(column.name)} ${TYPE_MAP[column.type]}`;
    if (column.primaryKey) {
      definition += column.autoIncrement ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY';
    }
    if (column.notNull && !column.primaryKey) definition += ' NOT NULL';
    if (column.unique && !column.primaryKey) definition += ' UNIQUE';
    const defaultValue = formatDefault(column.default);
    if (defaultValue !== null) definition += ` DEFAULT ${defaultValue}`;
    parts.push(definition);
  }

  for (const column of table.columns) {
    if (!column.references) continue;
    const action = column.references.onDelete ? ` ON DELETE ${column.references.onDelete}` : '';
    parts.push(
      `FOREIGN KEY (${quote(column.name)}) REFERENCES ${quote(column.references.table)}(${quote(column.references.column)})${action}`,
    );
  }

  return `CREATE TABLE IF NOT EXISTS ${quote(table.name)} (\n  ${parts.join(',\n  ')}\n)`;
}

export function createIndexSql(table: TableDefinition): string[] {
  return table.indexes.map(
    (index) =>
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(index.name)} ON ${quote(table.name)} (${index.columns.map(quote).join(', ')})`,
  );
}

/** Full DDL for a schema — used to create a fresh database. */
export function generateMigration(schema: SchemaDefinition, name = 'initial'): Migration {
  const statements: string[] = [];
  for (const table of schema.tables) {
    statements.push(createTableSql(table));
    statements.push(...createIndexSql(table));
  }
  return { name, statements };
}

/* -------------------------------------------------------------------------- */
/* Diffing against a live SQLite database                                     */
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

  if (driver.kind !== 'sqlite') {
    diff.manual.push('Schema diffing is only implemented for SQLite drivers.');
    return diff;
  }

  const existingTables = new Set(
    (await driver.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)).map(
      (row) => row.name,
    ),
  );

  for (const table of schema.tables) {
    if (!existingTables.has(table.name)) {
      diff.createTables.push(createTableSql(table));
      diff.createTables.push(...createIndexSql(table));
      continue;
    }

    const existingColumns = new Map(
      (await driver.all<ExistingColumn>(`PRAGMA table_info(${quote(table.name)})`)).map((column) => [
        column.name,
        column,
      ]),
    );

    for (const column of table.columns) {
      if (existingColumns.has(column.name)) continue;
      let definition = `${quote(column.name)} ${TYPE_MAP[column.type]}`;
      if (column.notNull) definition += ' NOT NULL';
      const defaultValue = formatDefault(column.default);
      if (defaultValue !== null) definition += ` DEFAULT ${defaultValue}`;
      diff.addColumns.push({
        table: table.name,
        sql: `ALTER TABLE ${quote(table.name)} ADD COLUMN ${definition}`,
      });
    }
  }

  return diff;
}
