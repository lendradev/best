/**
 * Relation loading.
 *
 * A relation is loaded with a second query, not with a join. A join
 * multiplies the rows, so `take` and `skip` would count the joined rows
 * instead of the parent rows. The relation keys are collected from the
 * parent rows that were returned and fetched in one statement, so the load
 * costs one query per relation and never one per row.
 *
 * A relation is declared with the foreign key side first:
 *
 * ```ts
 * relation({
 *   name: 'author',
 *   fromTable: 'posts',
 *   fromColumn: 'userId',
 *   toTable: 'users',
 *   toColumn: 'id',
 *   kind: 'many-to-one',
 * });
 * ```
 *
 * The foreign key lives in `fromTable` at `fromColumn` and points at
 * `toTable.toColumn`. The relation can be loaded from either side:
 *
 * - loaded on `posts`, the row holds one `author`;
 * - loaded on `users`, the row holds a list of `posts`.
 *
 * The direction is decided by the table the relation is loaded on, so the
 * same declaration serves both sides.
 */

import type { WhereInput } from './client.ts';
import type { Dialect } from './dialect.ts';
import type { RelationDefinition, TableDefinition } from './schema.ts';
import { SQL, and, inArray, normalizeParam, type SqlParam } from './sql.ts';

/**
 * A relation, resolved for the table it is loaded on.
 *
 * The parent is the table the rows come from; the related table holds the
 * rows that are attached to them.
 */
export interface ResolvedRelation {
  definition: RelationDefinition;
  /** The table the parent rows live in. */
  parentTable: string;
  /**
   * The column of the parent that carries the key of the relation.
   *
   * When the foreign key is on the parent, it is the foreign key itself
   * (`posts.userId`). When the foreign key is on the related row, it is the
   * column the foreign key points at (`users.id`).
   */
  parentKeyColumn: string;
  /** The table the related rows live in. */
  relatedTable: string;
  /**
   * The column of the related table the relation is matched on. It is the
   * column the foreign key points at when the key is on the parent, and the
   * foreign key itself when it is on the related row.
   */
  relatedMatchColumn: string;
  /** Whether the parent row holds one related row or many. */
  toOne: boolean;
  /**
   * Whether the foreign key is on the parent row.
   *
   * When it is, the parent column holds the key of the related row. When it
   * is not, the related row holds the key of the parent.
   */
  foreignKeyOnParent: boolean;
  /** The join table of a many-to-many relation. */
  through?: { table: string; fromColumn: string; toColumn: string };
}

/**
 * Resolves a relation for the table it is loaded on.
 *
 * Returns `null` when the relation does not touch that table, so a
 * declaration cannot be loaded on a table it does not connect.
 */
export function resolveRelation(
  definition: RelationDefinition,
  table: string,
): ResolvedRelation | null {
  if (definition.kind === 'many-to-many') {
    if (definition.fromTable !== table) return null;
    return {
      definition,
      parentTable: definition.fromTable,
      parentKeyColumn: definition.fromColumn,
      relatedTable: definition.toTable,
      relatedMatchColumn: definition.toColumn,
      toOne: false,
      foreignKeyOnParent: false,
      through: definition.through,
    };
  }

  if (definition.fromTable === table) {
    // The foreign key is local, so the row holds one related row.
    return {
      definition,
      parentTable: definition.fromTable,
      parentKeyColumn: definition.fromColumn,
      relatedTable: definition.toTable,
      relatedMatchColumn: definition.toColumn,
      toOne: true,
      foreignKeyOnParent: true,
    };
  }

  if (definition.toTable === table) {
    // The foreign key is on the other side, so the row holds many related
    // rows. A one-to-one relation holds one.
    return {
      definition,
      parentTable: definition.toTable,
      parentKeyColumn: definition.toColumn,
      relatedTable: definition.fromTable,
      relatedMatchColumn: definition.fromColumn,
      toOne: definition.kind === 'one-to-one',
      foreignKeyOnParent: false,
    };
  }

  return null;
}

/**
 * The statement that fetches the related rows, and the columns of the result
 * that carry the keys.
 */
export interface RelationQueryPlan {
  sql: string;
  params: SqlParam[];
  /**
   * The column of the result that holds the key of the parent, or `null`
   * when the parent holds the key itself.
   */
  parentKeyInRow: string | null;
  /** The column of the result that holds the key of the related row. */
  relatedKeyInRow: string;
}

/** The alias of the join column that carries the key of the parent. */
export const PARENT_KEY_ALIAS = '__best_parent_key__';

/**
 * Builds the statement that fetches the related rows.
 *
 * The related rows are found by the key they carry, so the same shape works
 * for a relation loaded from either side.
 */
export function buildRelationQuery(
  relation: ResolvedRelation,
  keys: unknown[],
  where: WhereInput | undefined,
  columns: string[] | undefined,
  dialect: Dialect,
): RelationQueryPlan {
  const quote = dialect.quote;
  const uniqueKeys = [...new Set(keys.map((key) => normalizeParam(key)))];

  if (uniqueKeys.length === 0) {
    return { sql: '', params: [], parentKeyInRow: null, relatedKeyInRow: relation.relatedMatchColumn };
  }

  if (relation.through) {
    const joinTable = quote(relation.through.table);
    const related = quote(relation.definition.name);
    const selected = columns?.length ? columns : ['*'];
    const selectColumns = selected.map((column) =>
      column === '*' ? `${related}.*` : `${related}.${quote(column)}`,
    );
    selectColumns.push(`${joinTable}.${quote(relation.through.fromColumn)} AS ${PARENT_KEY_ALIAS}`);

    const conditions = and(
      inArray(`${joinTable}.${quote(relation.through.fromColumn)}`, uniqueKeys),
      whereCondition(where, relation.relatedTable, dialect),
    );
    const fragment = conditions.toFragment();
    const sql =
      `SELECT ${selectColumns.join(', ')} FROM ${quote(relation.relatedTable)} AS ${related}` +
      ` INNER JOIN ${joinTable} ON ${joinTable}.${quote(relation.through.toColumn)} = ${related}.${quote(relation.relatedMatchColumn)}` +
      ` WHERE ${fragment.sql}`;
    return {
      sql,
      params: fragment.params,
      parentKeyInRow: PARENT_KEY_ALIAS,
      relatedKeyInRow: relation.relatedMatchColumn,
    };
  }

  const keyColumn = quote(relation.relatedMatchColumn);
  const selected = columns?.length ? columns : ['*'];
  const selectColumns = selected.map((column) => (column === '*' ? '*' : quote(column)));

  // The match column is always selected: the result is grouped by it, so a
  // column list that leaves it out would make the rows unattachable.
  if (!selectColumns.includes(keyColumn)) selectColumns.push(keyColumn);

  const conditions = and(
    inArray(keyColumn, uniqueKeys),
    whereCondition(where, relation.relatedTable, dialect),
  );
  const fragment = conditions.toFragment();
  const sql = `SELECT ${selectColumns.join(', ')} FROM ${quote(relation.relatedTable)} WHERE ${fragment.sql}`;
  return {
    sql,
    params: fragment.params,
    // The related row carries the key of the parent only when the foreign
    // key is on the related row.
    parentKeyInRow: relation.toOne ? null : relation.relatedMatchColumn,
    relatedKeyInRow: relation.relatedMatchColumn,
  };
}

/**
 * The condition of a relation filter.
 *
 * The column is qualified with the table of the relation, so a filter on a
 * column that exists in both tables cannot read the wrong one.
 */
export function whereCondition(
  where: WhereInput | undefined,
  table: string,
  dialect: Dialect,
): SQL | undefined {
  if (!where) return undefined;
  const conditions: SQL[] = [];
  for (const [column, value] of Object.entries(where)) {
    if (column.includes('.') || column.includes('"') || column.includes('`')) {
      throw new Error(`Invalid relation filter key ${JSON.stringify(column)}; use a plain column name`);
    }
    const qualified = `${dialect.quote(table)}.${dialect.quote(column)}`;
    const compiled = compileRelationCondition(qualified, value, dialect);
    if (compiled) conditions.push(compiled);
  }
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

function compileRelationCondition(column: string, value: unknown, dialect: Dialect): SQL | undefined {
  if (value === null) return SQL.raw(`${column} IS NULL`);
  if (typeof value !== 'object' || value instanceof Date || value instanceof Uint8Array) {
    return SQL.raw(`${column} = ?`, [normalizeParam(value)]);
  }

  const spec = value as Record<string, unknown>;
  const conditions: SQL[] = [];

  if ('equals' in spec) conditions.push(SQL.raw(`${column} = ?`, [normalizeParam(spec.equals)]));
  if ('not' in spec) conditions.push(SQL.raw(`${column} != ?`, [normalizeParam(spec.not)]));
  if ('in' in spec && Array.isArray(spec.in)) {
    conditions.push(SQL.raw(`${column} IN (${spec.in.map(() => '?').join(', ')})`, spec.in.map(normalizeParam)));
  }
  if ('notIn' in spec && Array.isArray(spec.notIn)) {
    conditions.push(
      SQL.raw(`${column} NOT IN (${spec.notIn.map(() => '?').join(', ')})`, spec.notIn.map(normalizeParam)),
    );
  }
  if ('gt' in spec) conditions.push(SQL.raw(`${column} > ?`, [normalizeParam(spec.gt)]));
  if ('gte' in spec) conditions.push(SQL.raw(`${column} >= ?`, [normalizeParam(spec.gte)]));
  if ('lt' in spec) conditions.push(SQL.raw(`${column} < ?`, [normalizeParam(spec.lt)]));
  if ('lte' in spec) conditions.push(SQL.raw(`${column} <= ?`, [normalizeParam(spec.lte)]));
  if ('contains' in spec) {
    conditions.push(SQL.raw(dialect.ilike(column), [`%${String(spec.contains)}%`]));
  }
  if ('startsWith' in spec) {
    conditions.push(SQL.raw(dialect.ilike(column), [`${String(spec.startsWith)}%`]));
  }
  if ('endsWith' in spec) {
    conditions.push(SQL.raw(dialect.ilike(column), [`%${String(spec.endsWith)}`]));
  }
  if (spec.isNull === true) conditions.push(SQL.raw(`${column} IS NULL`));
  if (spec.notNull === true) conditions.push(SQL.raw(`${column} IS NOT NULL`));

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}

/**
 * Checks that the relation matches the schema.
 *
 * The columns the relation names have to exist, so a relation that names a
 * column that does not exist is reported before the query runs.
 */
export function assertRelationMatchesSchema(
  relation: ResolvedRelation,
  tables: Map<string, TableDefinition>,
): void {
  const definition = relation.definition;

  if (relation.through) {
    const joinTable = tables.get(relation.through.table);
    if (!joinTable) {
      throw new Error(
        `The join table "${relation.through.table}" of the relation "${definition.name}" is not in the schema`,
      );
    }
    assertColumn(joinTable, relation.through.fromColumn, definition.name);
    assertColumn(joinTable, relation.through.toColumn, definition.name);
    assertColumn(tables.get(relation.relatedTable), relation.relatedMatchColumn, definition.name);
    return;
  }

  assertColumn(tables.get(relation.parentTable), relation.parentKeyColumn, definition.name);
  assertColumn(tables.get(relation.relatedTable), relation.relatedMatchColumn, definition.name);
}

function assertColumn(table: TableDefinition | undefined, column: string, relationName: string): void {
  if (!table) return;
  if (table.columns.some((candidate) => candidate.name === column)) return;
  throw new Error(
    `The relation "${relationName}" names the column "${column}", which the table "${table.name}" does not have`,
  );
}
