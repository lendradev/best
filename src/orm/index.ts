/**
 * ORM entry point.
 */

export { Database, ModelDelegate, NotFoundError, OrmError, UniqueConstraintError } from './client.ts';
export type {
  AggregateArgs,
  AggregateResult,
  CountArgs,
  CreateArgs,
  CreateManyArgs,
  DeleteArgs,
  DeleteManyArgs,
  FindFirstArgs,
  FindManyArgs,
  FindUniqueArgs,
  ModelDefinition,
  UpdateArgs,
  UpdateManyArgs,
  UpsertArgs,
  WhereInput,
  WhereValue,
} from './client.ts';

export {
  createDriver,
  inferAdapter,
  MariadbDriver,
  MysqlDriver,
  PostgresDriver,
  SqliteDriver,
} from './driver.ts';
export type {
  Driver,
  DriverOptions,
  SqlDriverOptions,
  SqliteDriverOptions,
} from './driver.ts';

export {
  getDialect,
  mariadbDialect,
  mysqlDialect,
  postgresDialect,
  sqliteDialect,
} from './dialect.ts';
export type { Dialect, DialectName, UpsertOptions } from './dialect.ts';

export {
  countNumberedPlaceholders,
  countPlaceholders,
  numberPlaceholders,
  renderSql,
  replacePlaceholders,
} from './render.ts';
export type { RenderedSql } from './render.ts';

export {
  DeleteBuilder,
  InsertBuilder,
  SelectBuilder,
  UpdateBuilder,
} from './query-builder.ts';
export type { JoinSpec, OrderBy, OrderDirection, Quote, SelectOptions } from './query-builder.ts';

export {
  SQL,
  and,
  avg,
  between,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notInArray,
  or,
  raw,
  sum,
} from './sql.ts';
export type { SqlParam } from './sql.ts';

export {
  SchemaBuilder,
  blob,
  boolean,
  column,
  id,
  index,
  integer,
  json,
  primaryKey,
  real,
  references,
  relation,
  table,
  text,
  timestamp,
  uuid,
} from './schema.ts';
export type {
  ColumnDefinition,
  ColumnType,
  IndexDefinition,
  OnDelete,
  RelationDefinition,
  SchemaDefinition,
  TableDefinition,
} from './schema.ts';

export {
  createTableSql,
  diffSchema,
  formatDefault,
  generateMigration,
} from './migrate.ts';
export type { Migration, SchemaDiff } from './migrate.ts';
