/**
 * Schema definition primitives.
 *
 * Tables are declared with `table()` and columns with type helpers such as
 * `text()`, `integer()` and `boolean()`. The result is a plain object tree that
 * both the query builder and the migration generator read.
 */

export type ColumnType =
  | 'text'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'blob'
  | 'json'
  | 'timestamp'
  | 'uuid'
  | 'bigint';

export type OnDelete = 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: unknown;
  references?: { table: string; column: string; onDelete?: OnDelete };
  /** Enum-like constraint; the value must be one of the listed options. */
  enum?: readonly string[];
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  indexes: IndexDefinition[];
}

export interface RelationDefinition {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  kind: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  onDelete?: OnDelete;
}

export interface SchemaDefinition {
  tables: TableDefinition[];
  relations: RelationDefinition[];
}

export function column(
  name: string,
  type: ColumnType,
  options: Partial<Omit<ColumnDefinition, 'name' | 'type'>> = {},
): ColumnDefinition {
  return { name, type, ...options };
}

export const text = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'text', options);
export const integer = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'integer', options);
export const real = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'real', options);
export const boolean = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'boolean', options);
export const blob = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'blob', options);
export const json = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'json', options);
export const timestamp = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'timestamp', options);
export const uuid = (name: string, options: Partial<ColumnDefinition> = {}) =>
  column(name, 'uuid', options);

/** Auto-incrementing integer primary key. */
export const id = (name = 'id') =>
  column(name, 'integer', { primaryKey: true, autoIncrement: true, notNull: true });

export function primaryKey(name: string, options: Partial<ColumnDefinition> = {}) {
  return column(name, 'integer', { primaryKey: true, notNull: true, ...options });
}

export function references(
  name: string,
  tableName: string,
  columnName: string,
  onDelete?: OnDelete,
): ColumnDefinition {
  return column(name, 'integer', {
    references: { table: tableName, column: columnName, onDelete },
  });
}

export interface TableOptions {
  primaryKey?: string | string[];
  indexes?: IndexDefinition[];
}

export function table(
  name: string,
  columns: ColumnDefinition[],
  options: TableOptions = {},
): TableDefinition {
  const primaryKeys = options.primaryKey
    ? Array.isArray(options.primaryKey)
      ? options.primaryKey
      : [options.primaryKey]
    : [];
  const merged = columns.map((c) => (primaryKeys.includes(c.name) ? { ...c, primaryKey: true } : c));
  return { name, columns: merged, indexes: options.indexes ?? [] };
}

export function index(name: string, columns: string[], unique = false): IndexDefinition {
  return { name, columns, unique };
}

export function relation(definition: RelationDefinition): RelationDefinition {
  return definition;
}

/** Collects table and relation definitions into a schema. */
export class SchemaBuilder {
  readonly #tables: TableDefinition[] = [];
  readonly #relations: RelationDefinition[] = [];

  table(...args: [string, ColumnDefinition[], TableOptions?]): TableDefinition {
    const def = table(...args);
    this.#tables.push(def);
    return def;
  }

  relation(...args: [RelationDefinition]): RelationDefinition {
    const def = relation(...args);
    this.#relations.push(def);
    return def;
  }

  build(): SchemaDefinition {
    return { tables: [...this.#tables], relations: [...this.#relations] };
  }
}
