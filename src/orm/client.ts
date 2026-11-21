/**
 * ORM client — a model API over inspectable SQL builders.
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
  ORDER_DIRECTIONS,
  SelectBuilder,
  UpdateBuilder,
  type OrderBy,
  type OrderDirection,
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
import {
  buildRelationQuery,
  resolveRelation,
  whereCondition,
  type ResolvedRelation,
} from './relations.ts';
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
  select?: string[] | SelectShape;
  take?: number;
  skip?: number;
  include?: IncludeShape;
}

/**
 * The columns of a model and of its relations.
 *
 * A plain column name picks that column of the model. A relation name picks
 * the columns of that relation.
 */
export type SelectShape = Record<string, boolean | { select?: SelectShape }>;

export interface RelationInclude {
  /** The columns of the relation. Every column when absent. */
  select?: SelectShape;
  /** A filter on the relation. */
  where?: WhereInput;
}

export type IncludeShape = Record<string, boolean | RelationInclude>;

export interface FindUniqueArgs {
  where: WhereInput;
  select?: string[] | SelectShape;
  include?: IncludeShape;
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

export interface GroupByArgs {
  /** The columns the rows are grouped by. */
  by: string | string[];
  where?: WhereInput;
  orderBy?: OrderBy | OrderBy[];
  _count?: boolean;
  _sum?: Record<string, true>;
  _avg?: Record<string, true>;
  _min?: Record<string, true>;
  _max?: Record<string, true>;
}

export interface GroupByResult {
  /** The value of every group column, keyed by the column name. */
  group: Record<string, unknown>;
  _count: number;
  _sum: Record<string, number | null>;
  _avg: Record<string, number | null>;
  _min: Record<string, number | null>;
  _max: Record<string, number | null>;
}

/**
 * A nested write of a relation.
 *
 * `create` inserts the related rows, `connect` links the rows that already
 * exist and `disconnect` unlinks them without deleting them.
 */
export interface NestedWrite {
  create?: Record<string, unknown>[];
  connect?: Record<string, unknown>[];
  disconnect?: Record<string, unknown>[];
}

export type NestedData = Record<string, unknown> & {
  [relation: string]: NestedWrite | undefined;
};

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
 * lower case. A key that is already qualified (`user.name`) or already quoted
 * is rejected: quoting it again would build a column name that does not
 * exist, and the query would silently match no row.
 */
function compileWhere(where: WhereInput | undefined, dialect: Dialect): SQL | undefined {
  if (!where) return undefined;
  const conditions: SQL[] = [];
  for (const [column, value] of Object.entries(where)) {
    assertColumnKey(column);
    const compiled = compileCondition(dialect.quote(column), value, dialect);
    if (compiled) conditions.push(compiled);
  }
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/**
 * Rejects a where key that is not a plain column name.
 *
 * Only a bare column name is supported, so a qualified or pre-quoted key is
 * reported instead of being turned into an identifier that matches nothing.
 */
function assertColumnKey(column: string): void {
  if (column.includes('.') || column.includes('"') || column.includes('`')) {
    throw new OrmError(
      `Invalid where key ${JSON.stringify(column)}; use a plain column name`,
    );
  }
}

function normalizeOrderBy(orderBy: FindManyArgs['orderBy']): OrderBy[] {
  if (!orderBy) return [];
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  return entries.map((entry) => {
    const direction = String(entry.direction).toLowerCase();
    if (!ORDER_DIRECTIONS.includes(direction as OrderDirection)) {
      throw new OrmError(
        `Invalid order direction ${JSON.stringify(entry.direction)}; expected "asc" or "desc"`,
      );
    }
    return { column: entry.column, direction: direction as OrderDirection };
  });
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

  /** The name of the primary key of the table, when it has one. */
  get primaryKeyColumn(): string | undefined {
    return this.#model.table.columns.find((column) => column.primaryKey)?.name;
  }

  /* ---------------------------------- read --------------------------------- */

  /**
   * The columns of the parent table.
   *
   * A plain column list is used as it is. A select shape is split: the
   * names that are columns of this table become the column list, and the
   * names that are relations are left to the relation loader.
   */
  #parentColumns(select: string[] | SelectShape | undefined): string[] | undefined {
    if (!select) return undefined;
    if (Array.isArray(select)) return select;

    const columns: string[] = [];
    for (const [name, value] of Object.entries(select)) {
      if (value === false) continue;
      if (this.#isRelationName(name)) continue;
      columns.push(name);
    }
    return columns.length > 0 ? columns : undefined;
  }

  /** Whether the name is a relation of this model. */
  #isRelationName(name: string): boolean {
    const relations = this.#db.relationsOf(this.#model);
    return relations.some((relation) => relation.definition.name === name);
  }

  /**
   * Loads the relations of the parent rows.
   *
   * One query per relation, never one per row: the keys of the parent rows
   * are collected first and fetched in a single statement.
   */
  async #loadRelations(
    rows: Record<string, unknown>[],
    args: { include?: IncludeShape; select?: string[] | SelectShape },
  ): Promise<Record<string, unknown>[]> {
    if (!args.include || rows.length === 0) return rows;

    const relations = this.#db.relationsOf(this.#model);

    for (const [name, option] of Object.entries(args.include)) {
      if (option === false) continue;
      const relation = relations.find((candidate) => candidate.definition.name === name);
      if (!relation) {
        throw new OrmError(
          `The model ${this.#model.name} has no relation named "${name}"`,
        );
      }

      const settings: RelationInclude = option === true ? {} : option;
      const columns = this.#relationColumns(relation, settings.select, args.select);

      // The key of the parent has to be present, or the relation cannot be
      // attached to the rows.
      const keyColumn = relation.parentKeyColumn;
      const hasKey = rows.some((row) => row[keyColumn] !== undefined);
      if (!hasKey) {
        throw new OrmError(
          `The relation "${name}" needs the column "${keyColumn}" of ${this.#model.name}, but it was not selected`,
        );
      }

      const keys = rows.map((row) => row[keyColumn]);
      const plan = buildRelationQuery(
        relation,
        keys,
        settings.where,
        columns,
        this.#db.dialect,
      );
      const related = plan.sql
        ? await this.#db.executeAll<Record<string, unknown>>(plan.sql, plan.params)
        : [];

      this.#attachRelation(rows, relation, related, plan);
    }

    return rows;
  }

  /**
   * The columns of a relation.
   *
   * The select of the relation wins. The select of the parent may also name
   * the relation, so both are read.
   */
  #relationColumns(
    relation: ResolvedRelation,
    includeSelect: SelectShape | undefined,
    parentSelect: string[] | SelectShape | undefined,
  ): string[] | undefined {
    const fromInclude = this.#shapeColumns(includeSelect);
    if (fromInclude) return fromInclude;

    if (!parentSelect || Array.isArray(parentSelect)) return undefined;
    const entry = parentSelect[relation.definition.name];
    if (!entry || entry === true) return undefined;
    return this.#shapeColumns((entry as { select?: SelectShape }).select);
  }

  /** The columns of a select shape. */
  #shapeColumns(shape: SelectShape | undefined): string[] | undefined {
    if (!shape) return undefined;
    const columns: string[] = [];
    for (const [name, value] of Object.entries(shape)) {
      if (value === false) continue;
      if (typeof value === 'object' && value.select) continue;
      columns.push(name);
    }
    return columns.length > 0 ? columns : undefined;
  }

  /**
   * Attaches the related rows to the parent rows.
   *
   * A to-one relation puts the row on the parent. A to-many relation puts
   * the rows in an array.
   */
  #attachRelation(
    rows: Record<string, unknown>[],
    relation: ResolvedRelation,
    related: Record<string, unknown>[],
    plan: { parentKeyInRow: string | null; relatedKeyInRow: string },
  ): void {
    // The related rows are indexed by the key they carry. For a to-one
    // relation that is the key of the related row, which the parent row
    // points at. For a many-to-many it is the key the join table carries.
    const index = new Map<string, Record<string, unknown>[]>();
    for (const row of related) {
      const key = String(plan.parentKeyInRow ? row[plan.parentKeyInRow] : row[plan.relatedKeyInRow]);
      const list = index.get(key) ?? [];
      list.push(row);
      index.set(key, list);
    }

    for (const row of rows) {
      const matched = index.get(String(row[relation.parentKeyColumn])) ?? [];
      row[relation.definition.name] = relation.toOne ? (matched[0] ?? null) : matched;
    }
  }

  async findMany(args: FindManyArgs = {}): Promise<T[]> {
    const builder = new SelectBuilder({
      table: this.#model.table.name,
      columns: this.#parentColumns(args.select),
      where: compileWhere(args.where, this.#db.dialect),
      orderBy: normalizeOrderBy(args.orderBy),
      limit: args.take,
      offset: args.skip,
      quote: this.#db.dialect.quote,
    });
    const { sql, params } = builder.toSQL();
    const rows = await this.#db.executeAll<Record<string, unknown>>(sql, params);
    const decoded = rows.map((row) => this.#decode(row));
    const loaded = await this.#loadRelations(decoded, args);
    return loaded as T[];
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
      columns: this.#parentColumns(args.select),
      where: compileWhere(args.where, this.#db.dialect),
      limit: 1,
      quote: this.#db.dialect.quote,
    });
    const { sql, params } = builder.toSQL();
    const row = await this.#db.executeOne<Record<string, unknown>>(sql, params);
    if (!row) return null;
    const loaded = await this.#loadRelations([this.#decode(row)], args);
    return (loaded[0] ?? null) as T | null;
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

  /**
   * Groups the rows and aggregates over each group.
   *
   * The group columns are selected next to the aggregates, so the result of
   * a group is one row.
   */
  async groupBy(args: GroupByArgs): Promise<GroupByResult[]> {
    const dialect = this.#db.dialect;
    const quote = dialect.quote;
    const table = quote(this.#model.table.name);

    const by = Array.isArray(args.by) ? args.by : [args.by];
    if (by.length === 0) {
      throw new OrmError(`Cannot group ${this.#model.name} by an empty list of columns`);
    }
    for (const column of by) {
      if (!this.#model.table.columns.some((candidate) => candidate.name === column)) {
        throw new OrmError(
          `Cannot group ${this.#model.name} by "${column}", which the table does not have`,
        );
      }
    }

    const selectColumns = by.map((column) => quote(column));
    selectColumns.push(`COUNT(*) as ${quote('_count')}`);

    const aggregates: { fn: 'SUM' | 'AVG' | 'MIN' | 'MAX'; columns: Record<string, true> }[] = [];
    if (args._sum) aggregates.push({ fn: 'SUM', columns: args._sum });
    if (args._avg) aggregates.push({ fn: 'AVG', columns: args._avg });
    if (args._min) aggregates.push({ fn: 'MIN', columns: args._min });
    if (args._max) aggregates.push({ fn: 'MAX', columns: args._max });

    for (const aggregate of aggregates) {
      for (const column of Object.keys(aggregate.columns)) {
        selectColumns.push(
          `${aggregate.fn}(${quote(column)}) as ${quote(`_${aggregate.fn.toLowerCase()}_${column}`)}`,
        );
      }
    }

    const where = compileWhere(args.where, dialect);
    const whereSql = where ? ` WHERE ${where.toFragment().sql}` : '';
    const whereParams = where ? where.toFragment().params : [];

    const groupSql = ` GROUP BY ${by.map((column) => quote(column)).join(', ')}`;
    const orderBy = normalizeOrderBy(args.orderBy);
    const orderSql = orderBy.length
      ? ` ORDER BY ${orderBy
          .map((entry) => `${quote(entry.column)} ${entry.direction.toUpperCase()}`)
          .join(', ')}`
      : '';

    const sql =
      `SELECT ${selectColumns.join(', ')} FROM ${table}${whereSql}${groupSql}${orderSql}`;
    const rows = await this.#db.executeAll<Record<string, unknown>>(sql, whereParams);

    return rows.map((row) => {
      const group: Record<string, unknown> = {};
      for (const column of by) group[column] = row[column];

      const result: GroupByResult = {
        group,
        _count: Number(row._count ?? 0),
        _sum: {},
        _avg: {},
        _min: {},
        _max: {},
      };

      for (const aggregate of aggregates) {
        const bucket = result[`_${aggregate.fn.toLowerCase()}` as '_sum' | '_avg' | '_min' | '_max'];
        for (const column of Object.keys(aggregate.columns)) {
          const value = row[`_${aggregate.fn.toLowerCase()}_${column}`];
          bucket[column] = value === null || value === undefined ? null : Number(value);
        }
      }

      return result;
    });
  }

  /* --------------------------------- write --------------------------------- */

  async create(args: CreateArgs): Promise<T> {
    const nested = this.#splitNested(args.data);
    if (nested.relations.length > 0) {
      return (await this.#createWithRelations(nested.relations, nested.data)) as T;
    }
    return this.#createRow(args.data, args.select);
  }

  /**
   * Splits the data of a write into the columns of the table and the
   * relations that have to be written with them.
   */
  #splitNested(data: Record<string, unknown>): {
    data: Record<string, unknown>;
    relations: { name: string; write: NestedWrite }[];
  } {
    const columns: Record<string, unknown> = {};
    const relations: { name: string; write: NestedWrite }[] = [];

    for (const [key, value] of Object.entries(data)) {
      const relation = this.#relationFor(key);
      if (!relation) {
        columns[key] = value;
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      relations.push({ name: key, write: value as NestedWrite });
    }

    return { data: columns, relations };
  }

  /** The relation of the model with that name. */
  #relationFor(name: string): ResolvedRelation | undefined {
    return this.#db.relationsOf(this.#model).find(
      (relation) => relation.definition.name === name,
    );
  }

  /**
   * Creates the parent row and writes its relations in the same transaction.
   *
   * The parent is written first, because the relation needs its key.
   */
  async #createWithRelations(
    relations: { name: string; write: NestedWrite }[],
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.#db.transaction(async (tx) => {
      const delegate = tx.delegateOf(this.#model.name) as ModelDelegate<any>;
      const parent = (await delegate.create({ data })) as Record<string, unknown>;

      for (const { name, write } of relations) {
        await this.#writeRelation(tx, delegate, parent, name, write);
      }

      // The parent row is read back with its relations, so the caller gets
      // the same shape a read with `include` returns.
      const identity = delegate.primaryKeyColumn;
      if (!identity) return parent;
      const reloaded = (await delegate.findUnique({
        where: { [identity]: parent[identity] } as WhereInput,
        include: Object.fromEntries(relations.map(({ name }) => [name, true])),
      })) as Record<string, unknown> | null;
      return reloaded ?? parent;
    });
  }

  /**
   * Writes one relation of a parent row.
   *
   * `create` inserts the related rows and links them, `connect` links the
   * rows that already exist and `disconnect` unlinks them.
   */
  async #writeRelation(
    tx: Database,
    parentDelegate: ModelDelegate<any>,
    parent: Record<string, unknown>,
    name: string,
    write: NestedWrite,
  ): Promise<void> {
    const relation = this.#relationFor(name);
    if (!relation) {
      throw new OrmError(`The model ${this.#model.name} has no relation named "${name}"`);
    }

    const related = tx.modelByTable(relation.relatedTable);
    if (!related) {
      throw new OrmError(
        `The relation "${name}" points at the table "${relation.relatedTable}", which has no model`,
      );
    }
    const relatedDelegate = tx.delegateOf(related.name) as ModelDelegate<any>;

    // The key of the parent row.
    //
    // When the foreign key is on the parent, the key is the primary key of
    // the parent: the foreign key is what the write sets, and it is still
    // empty at this point. When the foreign key is on the related row, the
    // key is the column the foreign key points at.
    const parentIdentity = parentDelegate.primaryKeyColumn;
    const parentKey = relation.foreignKeyOnParent
      ? parentIdentity
        ? parent[parentIdentity]
        : undefined
      : parent[relation.parentKeyColumn];
    if (parentKey === undefined || parentKey === null) {
      throw new OrmError(
        `The relation "${name}" needs the key of ${this.#model.name}, but the written row does not have it`,
      );
    }

    // The key of a related row, taken from the data of a connect or a
    // disconnect.
    const relatedKeyOf = (data: Record<string, unknown>): unknown => {
      const primary = related.table.columns.find((column) => column.primaryKey);
      if (primary && data[primary.name] !== undefined) return data[primary.name];
      if (data[relation.relatedMatchColumn] !== undefined) {
        return data[relation.relatedMatchColumn];
      }
      return undefined;
    };

    for (const data of write.create ?? []) {
      const payload = { ...data };
      if (relation.foreignKeyOnParent) {
        // The foreign key is on the parent, so the related row is written
        // first and the parent is linked to it afterwards.
        const created = (await relatedDelegate.create({ data: payload })) as Record<string, unknown>;
        await this.#linkRows(tx, relation, parentKey, created[relation.relatedMatchColumn]);
        continue;
      }

      // The foreign key is on the related row, so it points at the parent.
      payload[relation.relatedMatchColumn] = parentKey;
      const created = (await relatedDelegate.create({ data: payload })) as Record<string, unknown>;
      if (relation.through) {
        await this.#linkRows(tx, relation, parentKey, created[relation.relatedMatchColumn]);
      }
    }

    for (const data of write.connect ?? []) {
      const key = relatedKeyOf(data);
      if (key === undefined) {
        throw new OrmError(
          `Cannot connect the relation "${name}": the data does not name the key of "${relation.relatedTable}"`,
        );
      }
      // The related row is looked up by its own key, not by the foreign
      // key, because the foreign key is what the write sets.
      const relatedPrimary = related.table.columns.find((column) => column.primaryKey);
      const lookupColumn = relatedPrimary?.name ?? relation.relatedMatchColumn;
      const found = (await relatedDelegate.findUnique({
        where: { [lookupColumn]: key } as WhereInput,
      })) as Record<string, unknown> | null;
      if (!found) {
        throw new OrmError(
          `Cannot connect the relation "${name}": no row of "${relation.relatedTable}" has the key ${JSON.stringify(key)}`,
        );
      }
      await this.#linkRows(tx, relation, parentKey, key);
    }

    for (const data of write.disconnect ?? []) {
      const key = relatedKeyOf(data);
      if (key === undefined) {
        throw new OrmError(
          `Cannot disconnect the relation "${name}": the data does not name the key of "${relation.relatedTable}"`,
        );
      }
      await this.#unlinkRows(tx, relation, parentKey, key);
    }

    void parentDelegate;
  }

  /**
   * Links a parent row and a related row.
   *
   * The foreign key decides where the link lives:
   *
   * - the foreign key is on the parent: the parent column is written with
   *   the key of the related row;
   * - the foreign key is on the related row: the related row is written with
   *   the key of the parent;
   * - a many-to-many relation: a row is written to the join table.
   */
  async #linkRows(
    tx: Database,
    relation: ResolvedRelation,
    parentKey: unknown,
    relatedKey: unknown,
  ): Promise<void> {
    if (relation.through) {
      const columns = [relation.through.fromColumn, relation.through.toColumn];
      await tx.executeRun(
        `INSERT INTO ${this.#db.dialect.quote(relation.through.table)} (${columns
          .map((column) => this.#db.dialect.quote(column))
          .join(', ')}) VALUES (?, ?)`,
        [parentKey as never, relatedKey as never],
      );
      return;
    }

    if (relation.foreignKeyOnParent) {
      // The parent column is written with the key of the related row.
      const parent = tx.delegateOf(this.#model.name) as ModelDelegate<any> | undefined;
      if (!parent) return;
      await parent.update({
        where: this.#primaryKeyWhere(parent, parentKey),
        data: { [relation.parentKeyColumn]: relatedKey },
      });
      return;
    }

    // The related row is written with the key of the parent.
    const related = tx.modelByTable(relation.relatedTable);
    const delegate = tx.delegateOf(related?.name ?? '') as ModelDelegate<any> | undefined;
    if (!delegate) return;
    const primary = related?.table.columns.find((column) => column.primaryKey);
    if (!primary) {
      throw new OrmError(
        `The table "${relation.relatedTable}" has no primary key, so the relation cannot be written`,
      );
    }
    await delegate.update({
      where: { [primary.name]: relatedKey } as WhereInput,
      data: { [relation.relatedMatchColumn]: parentKey },
    });
  }

  /** The where clause that finds a row by its primary key. */
  #primaryKeyWhere(delegate: ModelDelegate<any>, key: unknown): WhereInput {
    const primary = delegate.primaryKeyColumn;
    if (!primary) {
      throw new OrmError(
        `The table "${delegate.tableName}" has no primary key, so the relation cannot be written`,
      );
    }
    return { [primary]: key } as WhereInput;
  }

  /** Unlinks a parent row and a related row. */
  async #unlinkRows(
    tx: Database,
    relation: ResolvedRelation,
    parentKey: unknown,
    relatedKey: unknown,
  ): Promise<void> {
    if (relation.through) {
      await tx.executeRun(
        `DELETE FROM ${this.#db.dialect.quote(relation.through.table)}` +
          ` WHERE ${this.#db.dialect.quote(relation.through.fromColumn)} = ?` +
          ` AND ${this.#db.dialect.quote(relation.through.toColumn)} = ?`,
        [parentKey as never, relatedKey as never],
      );
      return;
    }

    if (relation.foreignKeyOnParent) {
      const parent = tx.delegateOf(this.#model.name) as ModelDelegate<any> | undefined;
      if (!parent) return;
      await parent.update({
        where: this.#primaryKeyWhere(parent, parentKey),
        data: { [relation.parentKeyColumn]: null },
      });
      return;
    }

    // The foreign key is on the related row, so it is cleared. The row
    // itself stays.
    const related = tx.modelByTable(relation.relatedTable);
    const delegate = tx.delegateOf(related?.name ?? '') as ModelDelegate<any> | undefined;
    if (!delegate) return;
    const primary = related?.table.columns.find((column) => column.primaryKey);
    if (!primary) {
      throw new OrmError(
        `The table "${relation.relatedTable}" has no primary key, so the relation cannot be written`,
      );
    }
    const foreignKey = related?.table.columns.find(
      (column) => column.name === relation.relatedMatchColumn,
    );
    if (foreignKey?.notNull) {
      throw new OrmError(
        `Cannot disconnect the relation "${relation.definition.name}": the column "${relation.relatedMatchColumn}" of "${relation.relatedTable}" is not nullable, so the link cannot be cleared. Make the column nullable or delete the row instead`,
      );
    }
    await delegate.update({
      where: { [primary.name]: relatedKey } as WhereInput,
      data: { [relation.relatedMatchColumn]: null },
    });
  }

  /**
   * Creates one row and reads it back.
   */
  async #createRow(
    rawData: Record<string, unknown>,
    select?: string[] | SelectShape,
  ): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;
    const data = this.#encode(rawData);
    const columns = Array.isArray(select) ? select : undefined;

    if (dialect.supportsReturning) {
      const builder = new InsertBuilder(
        table,
        [data],
        columns ?? ['*'],
        undefined,
        dialect.quote,
      );
      const { sql, params } = builder.toSQL();
      const rows = await this.#all<Record<string, unknown>>(sql, params);
      if (rows[0]) return this.#decode(rows[0]) as T;
    } else {
      // No RETURNING: insert, then read the row back by primary key.
      const builder = new InsertBuilder(table, [data], [], undefined, dialect.quote);
      const { sql, params } = builder.toSQL();
      const result = await this.#run(sql, params);

      const primaryKey = this.#primaryKeyOf(data) ?? this.#generatedPrimaryKey(result);
      if (primaryKey) {
        const found = await this.findUnique({
          where: { [primaryKey.name]: primaryKey.value } as WhereInput,
          select: columns,
        });
        if (found) return found;
      }

      // A table without a primary key can still be read back by a unique
      // column; without one the defaults the database applied are unknown.
      const unique = this.#uniqueColumnOf(data);
      if (unique) {
        const found = await this.findUnique({
          where: { [unique.name]: unique.value } as WhereInput,
          select: columns,
        });
        if (found) return found;
      }

      throw new OrmError(
        `Cannot read back the inserted ${this.#model.name} row: the table has no primary key or unique column to look it up by`,
      );
    }

    // The row was not returned by the statement, so it is read back by the
    // primary key the caller supplied.
    const primaryKey = this.#primaryKeyOf(data);
    if (primaryKey) {
      const found = await this.findUnique({
        where: { [primaryKey.name]: primaryKey.value } as WhereInput,
        select: columns,
      });
      if (found) return found;
    }

    throw new OrmError(`Insert into ${table} returned no row`);
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
    const result = await this.#run(sql, params);
    return { count: result.changes };
  }

  async update(args: UpdateArgs): Promise<T> {
    const nested = this.#splitNested(args.data);
    if (nested.relations.length > 0) {
      return (await this.#updateWithRelations(args, nested)) as T;
    }
    return this.#updateRow(args, args.data, args.select);
  }

  /**
   * Updates the parent row and writes its relations in the same
   * transaction.
   */
  async #updateWithRelations(
    args: UpdateArgs,
    nested: { data: Record<string, unknown>; relations: { name: string; write: NestedWrite }[] },
  ): Promise<Record<string, unknown>> {
    return this.#db.transaction(async (tx) => {
      const delegate = tx.delegateOf(this.#model.name) as ModelDelegate<any>;

      // A write that only touches a relation has no column to write on the
      // parent, so the parent row is only read.
      const parent = (
        Object.keys(nested.data).length > 0
          ? await delegate.update({
              where: args.where,
              data: nested.data,
              select: args.select,
            })
          : await delegate.findFirstOrThrow({ where: args.where })
      ) as Record<string, unknown>;

      for (const { name, write } of nested.relations) {
        await this.#writeRelation(tx, delegate, parent, name, write);
      }

      return parent;
    });
  }

  /**
   * Updates one row and reads it back.
   */
  async #updateRow(
    args: UpdateArgs,
    rawData: Record<string, unknown>,
    select?: string[] | SelectShape,
  ): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;
    const data = this.#encode(rawData);
    const columns = Array.isArray(select) ? select : undefined;

    if (dialect.supportsReturningOnUpdate) {
      const builder = new UpdateBuilder(
        table,
        data,
        compileWhere(args.where, dialect),
        args.select ?? ['*'],
        dialect.quote,
      );
      const { sql, params } = builder.toSQL();
      const rows = await this.#all<Record<string, unknown>>(sql, params);
      if (rows[0]) return this.#decode(rows[0]) as T;
      throw new NotFoundError(this.#model.name);
    }

    // No RETURNING on UPDATE: the row the update matches is read before the
    // update, because the update may change the columns the where clause
    // matches on.
    const primary = this.#model.table.columns.find((c) => c.primaryKey);
    const before = (await this.findFirst({ where: args.where })) as Record<string, unknown> | null;
    if (!before) throw new NotFoundError(this.#model.name);

    const builder = new UpdateBuilder(
      table,
      data,
      compileWhere(args.where, dialect),
      [],
      dialect.quote,
    );
    const { sql, params } = builder.toSQL();
    await this.#run(sql, params);

    if (primary) {
      // The update may have changed the primary key, so the row is read back
      // by the value it carries now, not by the value it had before.
      const value = data[primary.name] !== undefined ? data[primary.name] : before[primary.name];
      const found = await this.findUnique({
        where: { [primary.name]: value } as WhereInput,
        select: args.select,
      });
      if (found) return found;
    } else {
      // The row is read back by the where clause with the updated values,
      // because the update may have changed the columns the where clause
      // matches on.
      const updatedWhere = this.#updatedWhere(args.where, data);
      if (updatedWhere) {
        const found = await this.findUnique({ where: updatedWhere, select: args.select });
        if (found) return found;
      }
    }

    // The write already happened, so the row is reported from the values the
    // database had and the values the update wrote. Reporting an error here
    // would tell the caller the write failed when it succeeded.
    return this.#updatedRow(before, data, args.select) as T;
  }

  /**
   * Rebuilds the updated row from the row the update matched.
   *
   * Used by the tables without a primary key, where the row cannot be looked
   * up after the update.
   */
  #updatedRow(
    before: Record<string, unknown>,
    data: Record<string, unknown>,
    select?: string[],
  ): Record<string, unknown> {
    const merged = this.#decode({ ...before, ...data });
    if (!select || select.includes('*')) return merged;
    const picked: Record<string, unknown> = {};
    for (const column of select) picked[column] = merged[column];
    return picked;
  }

  /**
   * Builds the where clause that matches the row after the update.
   *
   * Every column the where clause matches on that the update also writes gets
   * the new value. Returns null when the update writes none of them, because
   * the updated row could then not be identified.
   */
  #updatedWhere(where: WhereInput, data: Record<string, unknown>): WhereInput | null {
    const updated: WhereInput = {};
    for (const [column, value] of Object.entries(where)) {
      if (typeof value === 'object' && value !== null && !(value instanceof Date)) return null;
      if (!(column in data)) return null;
      updated[column] = data[column] as WhereValue;
    }
    return Object.keys(updated).length > 0 ? updated : null;
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
      await this.#run(sql, params);
      return { count: matched };
    }

    const result = await this.#run(sql, params);
    return { count: result.changes };
  }

  async upsert(args: UpsertArgs): Promise<T> {
    const dialect = this.#db.dialect;
    const table = this.#model.table.name;
    const conflictColumns = this.#conflictColumns(args.where);
    this.#assertUniqueConflictTarget(args.where);
    this.#assertConflictTargetStable(args.where, args.update);

    // The conflict target is a unique key, so it identifies at most one row.
    // Whether that row exists decides which row the statement touches. Only
    // the backends without RETURNING need to know, because only they have to
    // look the row up afterwards.
    const before = dialect.supportsReturningOnUpdate
      ? null
      : await this.findFirst({ where: args.where });

    // MySQL and MariaDB resolve the conflict from any unique key of the
    // table, so a create payload that collides with a different unique key
    // makes the statement update that other row.
    if (dialect.name === 'mysql' || dialect.name === 'mariadb') {
      await this.#assertNoOtherUniqueConflict(
        args.create,
        args.where,
        before as Record<string, unknown> | null,
      );
    }

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
      const rows = await this.#all<Record<string, unknown>>(
        `${sql} RETURNING ${returning}`,
        params,
      );
      if (rows[0]) return this.#decode(rows[0]) as T;
    } else {
      const result = await this.#run(sql, params);

      // The conflict target keeps its value, so it names the row the statement
      // inserted or updated. The last insert id is not used for that: it is
      // unrelated to the row the statement touched when the statement updated
      // an existing row.
      const found = await this.findUnique({ where: args.where, select: args.select });
      if (found) return found;

      if (!before) {
        // The statement inserted a new row: the database generated its
        // primary key, so the where clause does not match it.
        const generated = this.#generatedPrimaryKey(result);
        if (generated) {
          const inserted = await this.findUnique({
            where: { [generated.name]: generated.value } as WhereInput,
            select: args.select,
          });
          if (inserted) return inserted;
        }
      } else {
        // The write already happened, so the row is reported from the values
        // the database had and the values the upsert wrote.
        return this.#updatedRow(before, this.#encode(args.update), args.select) as T;
      }
    }

    const found = await this.findUnique({ where: args.where, select: args.select });
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
      const rows = await this.#all<Record<string, unknown>>(sql, params);
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
    await this.#run(sql, params);
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
    const result = await this.#run(sql, params);
    return { count: result.changes };
  }

  /** Column names used as the conflict target of an upsert. */
  #conflictColumns(where: WhereInput): string[] {
    return Object.keys(where);
  }

  /**
   * Rejects an upsert whose conflict target is not a unique key.
   *
   * MySQL and MariaDB resolve the conflict from any unique key of the table
   * and ignore the named columns, so a where clause on a non-unique column
   * inserts a duplicate row instead of updating the existing one. SQLite and
   * PostgreSQL reject the statement outright. Both outcomes are wrong, so the
   * target is checked against the schema before the statement is built.
   */
  #assertUniqueConflictTarget(where: WhereInput): void {
    const keys = Object.keys(where);
    if (keys.length === 0) {
      throw new OrmError(`Cannot upsert ${this.#model.name}: the conflict target is empty`);
    }

    // A column that is only part of a composite key is not unique on its own.
    const compositeColumns = new Set<string>();
    const primaryKeys = this.#model.table.columns.filter((c) => c.primaryKey);
    if (primaryKeys.length > 1) {
      for (const column of primaryKeys) compositeColumns.add(column.name);
    }
    for (const index of this.#model.table.indexes) {
      if (!index.unique || index.columns.length < 2) continue;
      for (const column of index.columns) compositeColumns.add(column);
    }

    const unique = new Set<string>();
    for (const column of this.#model.table.columns) {
      if (compositeColumns.has(column.name)) continue;
      if (column.primaryKey || column.unique) unique.add(column.name);
    }
    for (const index of this.#model.table.indexes) {
      if (index.unique && index.columns.length === 1) unique.add(index.columns[0] as string);
    }

    // A unique index over several columns is a conflict target of its own, so
    // the whole set of columns has to match it.
    const composite = this.#model.table.indexes.some(
      (index) =>
        index.unique &&
        index.columns.length > 1 &&
        index.columns.every((column) => keys.includes(column)),
    );
    if (composite) return;

    const notUnique = keys.filter((column) => !unique.has(column));
    if (notUnique.length > 0) {
      throw new OrmError(
        `Cannot upsert ${this.#model.name}: ${notUnique.join(', ')} ${
          notUnique.length === 1 ? 'is not a unique key' : 'are not unique keys'
        } of the table`,
      );
    }
  }

  /**
   * Rejects an upsert whose update writes the conflict target.
   *
   * The conflict target names the row the statement works on. When the update
   * changes its value, the row the upsert touched can no longer be found
   * under the target, so the statement is rejected before it runs.
   */
  #assertConflictTargetStable(where: WhereInput, update: Record<string, unknown>): void {
    const changed = Object.keys(where).filter((column) => column in update);
    if (changed.length === 0) return;
    throw new OrmError(
      `Cannot upsert ${this.#model.name}: the update changes the conflict target (${changed.join(', ')}), so the upserted row could not be found`,
    );
  }

  /**
   * Rejects an upsert whose create payload collides with a different unique
   * key than the conflict target.
   *
   * MySQL and MariaDB resolve the conflict from any unique key of the table.
   * When the create payload collides with another unique key, the statement
   * updates that other row, and the upsert no longer touches the row the
   * conflict target named.
   */
  async #assertNoOtherUniqueConflict(
    create: Record<string, unknown>,
    where: WhereInput,
    target: Record<string, unknown> | null,
  ): Promise<void> {
    const primary = this.#model.table.columns.find((c) => c.primaryKey);
    for (const column of this.#uniqueColumns()) {
      if (column in where) continue;
      const value = create[column];
      if (value === undefined) continue;
      const clash = (await this.findFirst({
        where: { [column]: value } as WhereInput,
      })) as Record<string, unknown> | null;
      if (!clash) continue;
      // The clash is the row the conflict target named, so the statement
      // updates the row the upsert was asked to update.
      if (primary && target && clash[primary.name] === target[primary.name]) continue;
      throw new OrmError(
        `Cannot upsert ${this.#model.name}: the create data collides with an existing row on the unique column ${column}, which is not the conflict target`,
      );
    }
  }

  /** The columns of the table that hold a unique value on their own. */
  #uniqueColumns(): string[] {
    const compositeColumns = new Set<string>();
    const primaryKeys = this.#model.table.columns.filter((c) => c.primaryKey);
    if (primaryKeys.length > 1) {
      for (const column of primaryKeys) compositeColumns.add(column.name);
    }
    for (const index of this.#model.table.indexes) {
      if (!index.unique || index.columns.length < 2) continue;
      for (const column of index.columns) compositeColumns.add(column);
    }
    return this.#model.table.columns
      .filter((column) => !compositeColumns.has(column.name) && (column.primaryKey || column.unique))
      .map((column) => column.name);
  }

  #primaryKeyOf(data: Record<string, unknown>): { name: string; value: unknown } | null {
    const primary = this.#model.table.columns.find((c) => c.primaryKey);
    if (!primary) return null;
    const value = data[primary.name];
    if (value === undefined) return null;
    return { name: primary.name, value };
  }

  /** A unique column of the table whose value is known in the written data. */
  #uniqueColumnOf(data: Record<string, unknown>): { name: string; value: unknown } | null {
    const column = this.#model.table.columns.find(
      (c) => c.unique && !c.primaryKey && data[c.name] !== undefined,
    );
    if (!column) return null;
    return { name: column.name, value: data[column.name] };
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

  /** Runs a statement and maps a driver error to an ORM error. */
  async #all<T = Record<string, unknown>>(sql: string, params: SqlParam[]): Promise<T[]> {
    try {
      return await this.#db.executeAll<T>(sql, params);
    } catch (error) {
      throw mapDriverError(error);
    }
  }

  /** Runs a statement and maps a driver error to an ORM error. */
  async #run(sql: string, params: SqlParam[]): Promise<{ changes: number; lastInsertRowid: number }> {
    try {
      return await this.#db.executeRun(sql, params);
    } catch (error) {
      throw mapDriverError(error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Driver error mapping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Maps a driver error to an ORM error.
 *
 * A unique violation becomes a `UniqueConstraintError` whose message stays
 * generic, because the raw driver message names the column and the schema.
 * The original error is kept as the cause for the internal log.
 */
export function mapDriverError(error: unknown): Error {
  if (error instanceof OrmError) return error;
  if (!isUniqueViolation(error)) return error instanceof Error ? error : new Error(String(error));

  const mapped = new UniqueConstraintError('Unique constraint failed');
  (mapped as { cause?: unknown }).cause = error;
  return mapped;
}

/**
 * Detects a unique violation across the four backends.
 *
 * The backend codes decide, never the free text of the message: a value that
 * merely reads like a duplicate must not become a unique violation.
 *
 * - SQLite reports `SQLITE_CONSTRAINT_UNIQUE` or `SQLITE_CONSTRAINT_PRIMARYKEY`,
 *   and its message for a unique violation always starts with
 *   `UNIQUE constraint failed`.
 * - PostgreSQL reports SQLSTATE `23505`.
 * - MySQL and MariaDB report error number `1062`.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    sqlState?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  const code = String(candidate.code ?? '');
  if (code === '23505') return true;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  if (code === '1062') return true;

  if (String(candidate.sqlState ?? '') === '23505') return true;

  const errno = Number(candidate.errno);
  if (errno === 1062) return true;

  // SQLite reports a unique violation with a message that always starts with
  // this text; a CHECK violation says `CHECK constraint failed` and is not one.
  if (String(candidate.message ?? '').startsWith('UNIQUE constraint failed')) return true;

  const cause = candidate.cause;
  if (cause && cause !== error) return isUniqueViolation(cause);
  return false;
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
 * `db.<model>` delegate with the find, create, update, upsert and delete
 * methods.
 */
export class Database {
  readonly #driver: Driver;
  readonly #dialect: Dialect;
  readonly #delegates = new Map<string, ModelDelegate<any>>();
  readonly #models: ModelDefinition[] = [];
  readonly #relations: RelationDefinition[] = [];

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
    for (const relation of definition.relations ?? []) {
      this.#relations.push(relation);
    }
    const delegate = new ModelDelegate(this, definition);
    this.#delegates.set(definition.name, delegate);
    return delegate;
  }

  /**
   * The relations of a model, resolved for its table.
   *
   * A relation declared on the model is used as it is. A relation declared on
   * the other side of the same pair is used for the reverse direction, so a
   * relation declared on the child table can be loaded on the parent table
   * as well.
   */
  relationsOf(model: ModelDefinition): ResolvedRelation[] {
    const table = model.table.name;
    const resolved: ResolvedRelation[] = [];

    for (const definition of model.relations ?? []) {
      const relation = resolveRelation(definition, table);
      if (relation) resolved.push(relation);
    }

    for (const definition of this.#relations) {
      if (resolved.some((candidate) => candidate.definition.name === definition.name)) continue;
      const relation = resolveRelation(definition, table);
      if (relation) resolved.push(relation);
    }

    return resolved;
  }

  /** The models of the database, keyed by their table name. */
  modelByTable(table: string): ModelDefinition | undefined {
    return this.#models.find((model) => model.table.name === table);
  }

  /** The delegate of a model, by its name. */
  delegateOf(name: string): ModelDelegate<any> | undefined {
    return this.#delegates.get(name);
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
