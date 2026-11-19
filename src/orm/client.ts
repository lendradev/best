/**
 * ORM client — Prisma-style API over Drizzle-style SQL builders.
 *
 * `db.user.findMany({ where: { email: { contains: 'x' } } })` compiles to a
 * parameterized SQL statement and executes it on the configured driver.
 *
 * Statements are written with portable `?` placeholders and portable
 * identifiers; the driver renders both to the dialect of the backend.
 */

import {
  MariadbDriver,
  MysqlDriver,
  PostgresDriver,
  SqliteDriver,
  type Driver,
} from './driver.ts';
import { getDialect, type Dialect, type DialectName } from './dialect.ts';
import {
  DeleteBuilder,
  InsertBuilder,
  SelectBuilder,
  UpdateBuilder,
  type OrderBy,
  type Quote,
} from './query-builder.ts';
import {
  SQL,
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  normalizeParam,
  type SqlParam,
} from './sql.ts';
import type { RelationDefinition, TableDefinition } from './schema.ts';

/* -------------------------------------------------------------------------- */
/* Where-clause input                                                         */
/* -------------------------------------------------------------------------- */

export interface WhereOperators {
  equals?: unknown;
  not?: unknown;
  in?: readonly unknown[];
  notIn?: readonly unknown[];
  gt?: number | bigint;
  gte?: number | bigint;
  lt?: number | bigint;
  lte?: number | bigint;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  isNull?: boolean;
  notNull?: boolean;
}

export type WhereValue =
  | string
  | number
  | boolean
  | null
  | bigint
  | Date
  | Uint8Array
  | WhereOperators;

export type WhereInput = Record<string, WhereValue>;

export interface FindManyArgs {
  where?: WhereInput;
  orderBy?: OrderBy | OrderBy[];
  select?: string[];
  take?: number;
  skip?: number;
}

export interface FindUniqueArgs {
  where: WhereInput;
  select?: string[];
}

export interface FindFirstArgs extends FindManyArgs {}

export interface CreateArgs {
  data: Record<string, unknown>;
  select?: string[];
}

export interface CreateManyArgs {
  data: Record<string, unknown>[];
}

export interface UpdateArgs {
  where: WhereInput;
  data: Record<string, unknown>;
  select?: string[];
}

export interface UpdateManyArgs {
  where?: WhereInput;
  data: Record<string, unknown>;
}

export interface UpsertArgs {
  where: WhereInput;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  select?: string[];
}

export interface DeleteArgs {
  where: WhereInput;
  select?: string[];
}

export interface DeleteManyArgs {
  where?: WhereInput;
}

export interface CountArgs {
  where?: WhereInput;
}

export interface AggregateArgs {
  where?: WhereInput;
  _count?: boolean;
  _sum?: Record<string, true>;
  _avg?: Record<string, true>;
  _min?: Record<string, true>;
  _max?: Record<string, true>;
}

export interface AggregateResult {
  _count: number;
  _sum: Record<string, number | null>;
  _avg: Record<string, number | null>;
  _min: Record<string, number | null>;
  _max: Record<string, number | null>;
}

export interface ModelDefinition {
  name: string;
  table: TableDefinition;
  relations?: RelationDefinition[];
}

/* -------------------------------------------------------------------------- */
/* Where compiler                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Compiles a value for comparison.
 *
 * A boolean is stored the way the backend stores it: `TRUE` on PostgreSQL,
 * `1` on the backends that keep a boolean in an integer column.
 */
function compileValue(column: string, value: unknown, dialect: Dialect): SQL {
  if (value === null) return isNull(column);
  if (value instanceof Date) return eq(column, value.toISOString());
  if (typeof value === 'boolean') return eq(column, dialect.toStorage(value));
  return eq(column, value);
}

function compileCondition(column: string, value: WhereValue, dialect: Dialect): SQL | undefined {
  if (value === null) return isNull(column);
  if (typeof value !== 'object' || value instanceof Date || value instanceof Uint8Array) {
    return compileValue(column, value, dialect);
  }

  const conditions: SQL[] = [];
  const spec = value as WhereOperators;

  if ('equals' in spec) conditions.push(compileValue(column, spec.equals, dialect));
  if ('not' in spec) {
    const notValue = spec.not;
    conditions.push(notValue === null ? isNotNull(column) : ne(column, notValue));
  }
  if ('in' in spec && spec.in) conditions.push(inArray(column, spec.in));
  if ('notIn' in spec && spec.notIn) conditions.push(notInArray(column, spec.notIn));
  if ('gt' in spec) conditions.push(gt(column, spec.gt));
  if ('gte' in spec) conditions.push(gte(column, spec.gte));
  if ('lt' in spec) conditions.push(lt(column, spec.lt));
  if ('lte' in spec) conditions.push(lte(column, spec.lte));
  if ('contains' in spec) conditions.push(ilike(column, `%${spec.contains}%`, dialect));
  if ('startsWith' in spec) conditions.push(ilike(column, `${spec.startsWith}%`, dialect));
  if ('endsWith' in spec) conditions.push(ilike(column, `%${spec.endsWith}`, dialect));
  if (spec.isNull === true) conditions.push(isNull(column));
  if (spec.notNull === true) conditions.push(isNotNull(column));

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/**
 * Case-insensitive match. PostgreSQL has `ILIKE`; MySQL, MariaDB and SQLite
 * need `LOWER(column) LIKE LOWER(?)`.
 */
function ilike(column: string, pattern: string, dialect: Dialect): SQL {
  return SQL.raw(dialect.ilike(column), [pattern]);
}

/**
 * Compiles a where clause.
 *
 * The column names are quoted with the dialect's rules, so a column such as
 * `userId` keeps its case on PostgreSQL, which folds unquoted identifiers to
 * lower case.
 */
export function compileWhere(where: WhereInput | undefined, dialect?: Dialect): SQL | undefined {
  if (!where) return undefined;
  const effective = dialect ?? getDialect('sqlite');
  const conditions: SQL[] = [];
  for (const [column, value] of Object.entries(where)) {
    const compiled = compileCondition(effective.quote(column), value, effective);
    if (compiled) conditions.push(compiled);
  }
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

function normalizeOrderBy(orderBy: FindManyArgs['orderBy']): OrderBy[] {
  if (!orderBy) return [];
  return Array.isArray(orderBy) ? orderBy : [orderBy];
}

/* -------------------------------------------------------------------------- */
/* Model delegate                                                             */
/* -------------------------------------------------------------------------- */

export class ModelDelegate<T = Record<string, unknown>> {
  readonly #db: Database;
  readonly #model: ModelDefinition;

  constructor(db: Database, model: ModelDefinition) {
    this.#db = db;
    this.#model = model;
  }

  get modelName(): string {
    return this.#model.name;
  }

  get tableName(): string {
    return this.#model.table.name;
  }

  /* ---------------------------------- read --------------------------------- */

  async findMany(args: FindManyArgs = {}): Promise<T[]> {
    const builder = new SelectBuilder({
      table: this.#model.table.name,
      columns: args.select,
      where: compileWhere(args.where, this.#db.dialect),
      orderBy: normalizeOrderBy(args.orderBy),
      limit: args.take,
      offset: args.skip,
      quote: this.#db.dialect.quote,
    });
    const { sql, params } = builder.toSQL();
    const rows = await this.#db.executeAll<Record<string, unknown>>(sql, params);
    return rows.map((row) => this.#decode(row)) as T[];
  }

  async findFirst(args: FindFirstArgs = {}): Promise<T | null> {
    const rows = await this.findMany({ ...args, take: 1 });
    return rows[0] ?? null;
  }

  async findFirstOrThrow(args: FindFirstArgs = {}): Promise<T> {
    const row = await this.findFirst(args);
    if (!row) throw new NotFoundError(this.#model.name);
    return row;
  }

  async findUnique(args: FindUniqueArgs): Promise<T | null> {
    const builder = new SelectBuilder({
      table: this.#model.table.name,
      columns: args.select,
      where: compileWhere(args.where, this.#db.dialect),
      limit: 1,
      quote: this.#db.dialect.quote,
    });
    const { sql, params } = builder.toSQL();
    const row = await this.#db.executeOne<Record<string, unknown>>(sql, params);
    return row ? (this.#decode(row) as T) : null;
  }

  async findUniqueOrThrow(args: FindUniqueArgs): Promise<T> {
    const row = await this.findUnique(args);
    if (!row) throw new NotFoundError(this.#model.name);
    return row;
  }

  async count(args: CountArgs = {}): Promise<number> {
    const where = compileWhere(args.where, this.#db.dialect);
    const table = this.#db.dialect.quote(this.#model.table.name);
    const alias = this.#db.dialect.quote('count');
    const sql = where
      ? `SELECT COUNT(*) as ${alias} FROM ${table} WHERE ${where.toFragment().sql}`
      : `SELECT COUNT(*) as ${alias} FROM ${table}`;
    const params = where ? where.toFragment().params : [];
    const row = await this.#db.executeOne<{ count: number }>(sql, params);
    return Number(row?.count ?? 0);
  }

  async aggregate(args: AggregateArgs = {}): Promise<AggregateResult> {
    const where = compileWhere(args.where, this.#db.dialect);
    const whereSql = where ? ` WHERE ${where.toFragment().sql}` : '';
    const whereParams = where ? where.toFragment().params : [];
    const table = this.#db.dialect.quote(this.#model.table.name);
    const quote = this.#db.dialect.quote;

    const result: AggregateResult = {
      _count: 0,
      _sum: {},
      _avg: {},
      _min: {},
      _max: {},
    };

    const countRow = await this.#db.executeOne<{ count: number }>(
      `SELECT COUNT(*) as ${quote('count')} FROM ${table}${whereSql}`,
      whereParams,
    );
    result._count = Number(countRow?.count ?? 0);

    const aggregate = async (
      fn: 'SUM' | 'AVG' | 'MIN' | 'MAX',
      columns: Record<string, true> | undefined,
    ) => {
      if (!columns) return;
      const selected = Object.keys(columns)
        .map((c) => `${fn}(${quote(c)}) as ${quote(c)}`)
        .join(', ');
      const row = await this.#db.executeOne<Record<string, number | null>>(
        `SELECT ${selected} FROM ${table}${whereSql}`,
        whereParams,
      );
      const bucket = result[`_${fn.toLowerCase()}` as '_sum' | '_avg' | '_min' | '_max'];
      for (const key of Object.keys(columns)) {
        const value = row?.[key];
        bucket[key] = value === null || value === undefined ? null : Number(value);
      }
    };

    await aggregate('SUM', args._sum);
    await aggregate('AVG', args._avg);
    await aggregate('MIN', args._min);
    await aggregate('MAX', args._max);

    return result;
  }

  /* --------------------------------- write --------------------------------- */

  async create(args: CreateArgs): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;
    const data = this.#encode(args.data);

    if (dialect.supportsReturning) {
      const builder = new InsertBuilder(
        table,
        [data],
        args.select ?? ['*'],
        undefined,
        dialect.quote,
      );
      const { sql, params } = builder.toSQL();
      const rows = await this.#db.executeAll<Record<string, unknown>>(sql, params);
      if (rows[0]) return this.#decode(rows[0]) as T;
    } else {
      // No RETURNING: insert, then read the row back by primary key.
      const builder = new InsertBuilder(table, [data], [], undefined, dialect.quote);
      const { sql, params } = builder.toSQL();
      const result = await this.#db.executeRun(sql, params);

      const primaryKey = this.#primaryKeyOf(data) ?? this.#generatedPrimaryKey(result);
      if (primaryKey) {
        const found = await this.findUnique({
          where: { [primaryKey.name]: primaryKey.value } as WhereInput,
          select: args.select,
        });
        if (found) return found;
      }
      return this.#decode(data) as T;
    }

    const primaryKey = this.#primaryKeyOf(data);
    if (primaryKey) {
      const found = await this.findUnique({
        where: { [primaryKey.name]: primaryKey.value } as WhereInput,
      });
      if (found) return found;
    }
    return this.#decode(data) as T;
  }

  async createMany(args: CreateManyArgs): Promise<{ count: number }> {
    if (args.data.length === 0) return { count: 0 };
    const builder = new InsertBuilder(
      this.#model.table.name,
      args.data.map((data) => this.#encode(data)),
      [],
      undefined,
      this.#db.dialect.quote,
    );
    const { sql, params } = builder.toSQL();
    const result = await this.#db.executeRun(sql, params);
    return { count: result.changes };
  }

  async update(args: UpdateArgs): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;
    const data = this.#encode(args.data);

    if (dialect.supportsReturningOnUpdate) {
      const builder = new UpdateBuilder(
        table,
        data,
        compileWhere(args.where, dialect),
        args.select ?? ['*'],
        dialect.quote,
      );
      const { sql, params } = builder.toSQL();
      const rows = await this.#db.executeAll<Record<string, unknown>>(sql, params);
      if (rows[0]) return this.#decode(rows[0]) as T;
      throw new NotFoundError(this.#model.name);
    }

    // No RETURNING on UPDATE: update first, then read the row back.
    const builder = new UpdateBuilder(
      table,
      data,
      compileWhere(args.where, dialect),
      [],
      dialect.quote,
    );
    const { sql, params } = builder.toSQL();
    await this.#db.executeRun(sql, params);

    // The row count cannot decide whether the row exists: MySQL and MariaDB
    // count the rows that changed, so an update that writes the same values
    // reports zero for a row that is there.
    const found = await this.findFirst({ where: args.where, select: args.select });
    if (found) return found;
    throw new NotFoundError(this.#model.name);
  }

  async updateMany(args: UpdateManyArgs): Promise<{ count: number }> {
    const dialect = this.#db.dialect;
    const builder = new UpdateBuilder(
      this.#model.table.name,
      this.#encode(args.data),
      compileWhere(args.where, dialect),
      [],
      dialect.quote,
    );
    const { sql, params } = builder.toSQL();

    if (!dialect.countsMatchedRows) {
      // MySQL and MariaDB report the rows that changed, not the rows that
      // matched. Count the matching rows first so the reported count is the
      // number of rows the statement applied to.
      const matched = await this.count({ where: args.where });
      await this.#db.executeRun(sql, params);
      return { count: matched };
    }

    const result = await this.#db.executeRun(sql, params);
    return { count: result.changes };
  }

  async upsert(args: UpsertArgs): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;
    const conflictColumns = this.#conflictColumns(args.where);

    const { sql, params: rawParams } = dialect.upsert({
      table,
      values: this.#encode(args.create),
      conflictColumns,
      update: this.#encode(args.update),
    });
    const params = rawParams.map(normalizeParam);

    if (dialect.supportsReturningOnUpdate) {
      const returning = (args.select ?? ['*'])
        .map((column) => (column === '*' ? column : dialect.quote(column)))
        .join(', ');
      const rows = await this.#db.executeAll<Record<string, unknown>>(
        `${sql} RETURNING ${returning}`,
        params,
      );
      if (rows[0]) return this.#decode(rows[0]) as T;
    } else {
      await this.#db.executeRun(sql, params);
    }

    const found = await this.findFirst({ where: args.where, select: args.select });
    if (found) return found;
    throw new NotFoundError(this.#model.name);
  }

  async delete(args: DeleteArgs): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;

    if (dialect.supportsReturningOnUpdate) {
      const builder = new DeleteBuilder(
        table,
        compileWhere(args.where, dialect),
        args.select ?? ['*'],
        dialect.quote,
      );
      const { sql, params } = builder.toSQL();
      const rows = await this.#db.executeAll<Record<string, unknown>>(sql, params);
      if (rows[0]) return this.#decode(rows[0]) as T;
      throw new NotFoundError(this.#model.name);
    }

    // No RETURNING on DELETE: delete first, then read the row back.
    const found = await this.findFirst({ where: args.where, select: args.select });
    if (!found) throw new NotFoundError(this.#model.name);

    const builder = new DeleteBuilder(
      table,
      compileWhere(args.where, dialect),
      [],
      dialect.quote,
    );
    const { sql, params } = builder.toSQL();
    await this.#db.executeRun(sql, params);
    return found;
  }

  async deleteMany(args: DeleteManyArgs = {}): Promise<{ count: number }> {
    const builder = new DeleteBuilder(
      this.#model.table.name,
      compileWhere(args.where, this.#db.dialect),
      [],
      this.#db.dialect.quote,
    );
    const { sql, params } = builder.toSQL();
    const result = await this.#db.executeRun(sql, params);
    return { count: result.changes };
  }

  /** Column names used as the conflict target of an upsert. */
  #conflictColumns(where: WhereInput): string[] {
    return Object.keys(where);
  }

  #primaryKeyOf(data: Record<string, unknown>): { name: string; value: unknown } | null {
    const primary = this.#model.table.columns.find((c) => c.primaryKey);
    if (!primary) return null;
    const value = data[primary.name];
    if (value === undefined) return null;
    return { name: primary.name, value };
  }

  /**
   * The primary key the database generated for an inserted row.
   *
   * MySQL reports the generated auto-increment value as the last insert id;
   * PostgreSQL reports none because it uses `RETURNING`.
   */
  #generatedPrimaryKey(result: { lastInsertRowid: number }): { name: string; value: unknown } | null {
    const primary = this.#model.table.columns.find((c) => c.primaryKey && c.autoIncrement);
    if (!primary) return null;
    if (!result.lastInsertRowid) return null;
    return { name: primary.name, value: result.lastInsertRowid };
  }

  /**
   * Converts the values of a row into the types the schema declares.
   *
   * A `boolean` column is an integer on SQLite, MySQL and MariaDB, so the
   * stored `1` becomes `true` again. PostgreSQL already returns a boolean.
   */
  #decode(row: Record<string, unknown>): Record<string, unknown> {
    const booleans = this.#model.table.columns.filter((c) => c.type === 'boolean');
    if (booleans.length === 0) return row;
    for (const column of booleans) {
      const value = row[column.name];
      if (typeof value === 'number') row[column.name] = value !== 0;
    }
    return row;
  }

  /** Converts the values of a write into the way the backend stores them. */
  #encode(data: Record<string, unknown>): Record<string, unknown> {
    const encoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      encoded[key] = typeof value === 'boolean' ? this.#db.dialect.toStorage(value) : value;
    }
    return encoded;
  }
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class OrmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrmError';
  }
}

export class NotFoundError extends OrmError {
  constructor(model: string) {
    super(`No ${model} record found`);
    this.name = 'NotFoundError';
  }
}

export class UniqueConstraintError extends OrmError {
  constructor(message = 'Unique constraint failed') {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}

/* -------------------------------------------------------------------------- */
/* Database                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Database facade. Models are registered up-front; each one becomes an
 * `db.<model>` delegate with the Prisma-style method set.
 */
export class Database {
  readonly #driver: Driver;
  readonly #dialect: Dialect;
  readonly #delegates = new Map<string, ModelDelegate<any>>();
  readonly #models: ModelDefinition[] = [];

  constructor(driver: Driver) {
    this.#driver = driver;
    this.#dialect = getDialect(driver.kind);
  }

  static sqlite(options: { file?: string; readonly?: boolean; create?: boolean } = {}): Database {
    return new Database(new SqliteDriver(options));
  }

  static postgres(options: {
    url: string;
    max?: number;
    tls?: boolean;
  }): Database {
    return new Database(new PostgresDriver(options));
  }

  static mysql(options: {
    url: string;
    max?: number;
    tls?: boolean;
    allowPublicKeyRetrieval?: boolean;
  }): Database {
    return new Database(new MysqlDriver(options));
  }

  static mariadb(options: {
    url: string;
    max?: number;
    tls?: boolean;
    allowPublicKeyRetrieval?: boolean;
  }): Database {
    return new Database(new MariadbDriver(options));
  }

  model(definition: ModelDefinition): ModelDelegate<any> {
    this.#models.push(definition);
    const delegate = new ModelDelegate(this, definition);
    this.#delegates.set(definition.name, delegate);
    return delegate;
  }

  get models(): ModelDefinition[] {
    return [...this.#models];
  }

  get driver(): Driver {
    return this.#driver;
  }

  /** The SQL dialect this database speaks. */
  get dialect(): Dialect {
    return this.#dialect;
  }

  /** The name of the dialect this database speaks. */
  get dialectName(): DialectName {
    return this.#dialect.name;
  }

  /* ------------------------------ raw execution ---------------------------- */

  /**
   * Executes a statement with portable `?` placeholders. The driver renders
   * the statement and its identifiers to the dialect of the backend, so the
   * same code works on SQLite, PostgreSQL, MySQL and MariaDB.
   */
  async executeAll<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.#driver.all<T>(sql, params);
  }

  async executeOne<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = [],
  ): Promise<T | null> {
    return this.#driver.get<T>(sql, params);
  }

  async executeRun(sql: string, params: SqlParam[] = []) {
    return this.#driver.run(sql, params);
  }

  /** Raw SQL with bound parameters. */
  async query<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.executeAll<T>(sql, params);
  }

  /** Tagged-template raw SQL. */
  async raw<T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const fragment = SQL.tagged(strings, ...values).toFragment();
    return this.executeAll<T>(fragment.sql, fragment.params);
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    return this.#driver.transaction(async (txDriver) => {
      const tx = new Database(txDriver);
      for (const model of this.#models) {
        tx.model(model);
      }
      return fn(tx);
    });
  }

  async close(): Promise<void> {
    await this.#driver.close();
  }
}

export { normalizeParam };
export type { Quote };
