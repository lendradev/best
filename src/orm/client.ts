/**
 * ORM client — Prisma-style API over Drizzle-style SQL builders.
 *
 * `db.user.findMany({ where: { email: { contains: 'x' } } })` compiles to a
 * parameterized SQL statement and executes it on the configured driver.
 */

import { SqliteDriver, type Driver } from './driver.ts';
import {
  DeleteBuilder,
  InsertBuilder,
  SelectBuilder,
  UpdateBuilder,
  type OrderBy,
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
  like,
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

function compileValue(column: string, value: unknown): SQL {
  if (value === null) return isNull(column);
  if (value instanceof Date) return eq(column, value.toISOString());
  if (typeof value === 'boolean') return eq(column, value ? 1 : 0);
  return eq(column, value);
}

function compileCondition(column: string, value: WhereValue): SQL | undefined {
  if (value === null) return isNull(column);
  if (typeof value !== 'object' || value instanceof Date || value instanceof Uint8Array) {
    return compileValue(column, value);
  }

  const conditions: SQL[] = [];
  const spec = value as WhereOperators;

  if ('equals' in spec) conditions.push(compileValue(column, spec.equals));
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
  if ('contains' in spec) conditions.push(like(column, `%${spec.contains}%`));
  if ('startsWith' in spec) conditions.push(like(column, `${spec.startsWith}%`));
  if ('endsWith' in spec) conditions.push(like(column, `%${spec.endsWith}`));
  if (spec.isNull === true) conditions.push(isNull(column));
  if (spec.notNull === true) conditions.push(isNotNull(column));

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

export function compileWhere(where: WhereInput | undefined): SQL | undefined {
  if (!where) return undefined;
  const conditions: SQL[] = [];
  for (const [column, value] of Object.entries(where)) {
    const compiled = compileCondition(column, value);
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
      where: compileWhere(args.where),
      orderBy: normalizeOrderBy(args.orderBy),
      limit: args.take,
      offset: args.skip,
    });
    const { sql, params } = builder.toSQL();
    return this.#db.executeAll<T>(sql, params);
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
      where: compileWhere(args.where),
      limit: 1,
    });
    const { sql, params } = builder.toSQL();
    return this.#db.executeOne<T>(sql, params);
  }

  async findUniqueOrThrow(args: FindUniqueArgs): Promise<T> {
    const row = await this.findUnique(args);
    if (!row) throw new NotFoundError(this.#model.name);
    return row;
  }

  async count(args: CountArgs = {}): Promise<number> {
    const where = compileWhere(args.where);
    const sql = where
      ? `SELECT COUNT(*) as count FROM ${this.#model.table.name} WHERE ${where.toFragment().sql}`
      : `SELECT COUNT(*) as count FROM ${this.#model.table.name}`;
    const params = where ? where.toFragment().params : [];
    const row = await this.#db.executeOne<{ count: number }>(sql, params);
    return Number(row?.count ?? 0);
  }

  async aggregate(args: AggregateArgs = {}): Promise<AggregateResult> {
    const where = compileWhere(args.where);
    const whereSql = where ? ` WHERE ${where.toFragment().sql}` : '';
    const whereParams = where ? where.toFragment().params : [];

    const result: AggregateResult = {
      _count: 0,
      _sum: {},
      _avg: {},
      _min: {},
      _max: {},
    };

    const countRow = await this.#db.executeOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.#model.table.name}${whereSql}`,
      whereParams,
    );
    result._count = Number(countRow?.count ?? 0);

    const aggregate = async (
      fn: 'SUM' | 'AVG' | 'MIN' | 'MAX',
      columns: Record<string, true> | undefined,
    ) => {
      if (!columns) return;
      const selected = Object.keys(columns)
        .map((c) => `${fn}(${c}) as ${c}`)
        .join(', ');
      const row = await this.#db.executeOne<Record<string, number | null>>(
        `SELECT ${selected} FROM ${this.#model.table.name}${whereSql}`,
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
    const builder = new InsertBuilder(this.#model.table.name, [args.data], args.select ?? ['*']);
    const { sql, params } = builder.toSQL();
    const rows = await this.#db.executeAll<T>(sql, params);
    const row = rows[0];
    if (row) return row;
    // Drivers without RETURNING support need a follow-up read.
    const primaryKey = this.#primaryKeyOf(args.data);
    if (primaryKey) {
      const found = await this.findUnique({ where: { [primaryKey.name]: primaryKey.value } as WhereInput });
      if (found) return found;
    }
    return args.data as T;
  }

  async createMany(args: CreateManyArgs): Promise<{ count: number }> {
    if (args.data.length === 0) return { count: 0 };
    const builder = new InsertBuilder(this.#model.table.name, args.data);
    const { sql, params } = builder.toSQL();
    const result = await this.#db.executeRun(sql, params);
    return { count: result.changes };
  }

  async update(args: UpdateArgs): Promise<T> {
    const builder = new UpdateBuilder(
      this.#model.table.name,
      args.data,
      compileWhere(args.where),
      args.select ?? ['*'],
    );
    const { sql, params } = builder.toSQL();
    const rows = await this.#db.executeAll<T>(sql, params);
    if (rows[0]) return rows[0];
    throw new NotFoundError(this.#model.name);
  }

  async updateMany(args: UpdateManyArgs): Promise<{ count: number }> {
    const builder = new UpdateBuilder(
      this.#model.table.name,
      args.data,
      compileWhere(args.where),
    );
    const { sql, params } = builder.toSQL();
    const result = await this.#db.executeRun(sql, params);
    return { count: result.changes };
  }

  async upsert(args: UpsertArgs): Promise<T> {
    const where = compileWhere(args.where);
    const existing = where ? await this.findFirst({ where: args.where }) : null;
    if (existing) {
      return this.update({ where: args.where, data: args.update, select: args.select });
    }
    return this.create({ data: args.create, select: args.select });
  }

  async delete(args: DeleteArgs): Promise<T> {
    const builder = new DeleteBuilder(
      this.#model.table.name,
      compileWhere(args.where),
      args.select ?? ['*'],
    );
    const { sql, params } = builder.toSQL();
    const rows = await this.#db.executeAll<T>(sql, params);
    if (rows[0]) return rows[0];
    throw new NotFoundError(this.#model.name);
  }

  async deleteMany(args: DeleteManyArgs = {}): Promise<{ count: number }> {
    const builder = new DeleteBuilder(this.#model.table.name, compileWhere(args.where));
    const { sql, params } = builder.toSQL();
    const result = await this.#db.executeRun(sql, params);
    return { count: result.changes };
  }

  #primaryKeyOf(data: Record<string, unknown>): { name: string; value: unknown } | null {
    const primary = this.#model.table.columns.find((c) => c.primaryKey);
    if (!primary) return null;
    const value = data[primary.name];
    if (value === undefined) return null;
    return { name: primary.name, value };
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
  readonly #delegates = new Map<string, ModelDelegate<any>>();
  readonly #models: ModelDefinition[] = [];

  constructor(driver: Driver) {
    this.#driver = driver;
  }

  static sqlite(options: { file?: string; readonly?: boolean; create?: boolean } = {}): Database {
    return new Database(new SqliteDriver(options));
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

  /* ------------------------------ raw execution ---------------------------- */

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
