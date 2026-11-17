import { describe, expect, test } from 'bun:test';
import { Database } from '../src/orm/client.ts';
import { SqliteDriver } from '../src/orm/driver.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import { id, integer, table, text } from '../src/orm/schema.ts';
import { and, eq, like } from '../src/orm/sql.ts';

const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
]);

const posts = table('posts', [
  id(),
  text('title', { notNull: true }),
  integer('userId', { notNull: true }),
]);

async function makeDb(): Promise<Database> {
  const db = new Database(new SqliteDriver({ file: ':memory:' }));
  const migration = generateMigration({ tables: [users, posts], relations: [] });
  for (const statement of migration.statements) {
    await db.executeRun(statement);
  }
  const user = db.model({ name: 'user', table: users });
  const post = db.model({ name: 'post', table: posts });
  await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
  await user.create({ data: { email: 'linus@example.com', name: 'Linus', age: 54 } });
  await post.create({ data: { title: 'First', userId: 1 } });
  return db;
}

describe('ORM', () => {
  test('create returns the inserted row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const created = await user.create({ data: { email: 'grace@example.com', name: 'Grace', age: 45 } });
    expect(created.email).toBe('grace@example.com');
    expect(created.id).toBeGreaterThan(0);
  });

  test('findMany returns all rows', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const rows = await user.findMany();
    expect(rows.length).toBe(2);
  });

  test('findMany filters with a scalar where', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const rows = await user.findMany({ where: { email: 'ada@example.com' } });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Ada');
  });

  test('findMany filters with operator where', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const rows = await user.findMany({ where: { age: { gte: 40 } } });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Linus');
  });

  test('findMany supports contains', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const rows = await user.findMany({ where: { email: { contains: 'example' } } });
    expect(rows.length).toBe(2);
  });

  test('findUnique returns null when no row matches', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    expect(await user.findUnique({ where: { email: 'nobody@example.com' } })).toBeNull();
  });

  test('update changes a row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const updated = await user.update({ where: { email: 'ada@example.com' }, data: { name: 'Ada L.' } });
    expect(updated.name).toBe('Ada L.');
  });

  test('updateMany reports the affected count', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const result = await user.updateMany({ data: { age: 30 } });
    expect(result.count).toBe(2);
  });

  test('delete removes a row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.delete({ where: { email: 'ada@example.com' } });
    expect(await user.count()).toBe(1);
  });

  test('count returns the row count', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    expect(await user.count()).toBe(2);
    expect(await user.count({ where: { name: 'Ada' } })).toBe(1);
  });

  test('aggregate computes sum and average', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const result = await user.aggregate({ _count: true, _sum: { age: true }, _avg: { age: true } });
    expect(result._count).toBe(2);
    expect(result._sum.age).toBe(90);
    expect(result._avg.age).toBe(45);
  });

  test('upsert creates then updates', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const created = await user.upsert({
      where: { email: 'new@example.com' },
      create: { email: 'new@example.com', name: 'New' },
      update: { name: 'Updated' },
    });
    expect(created.name).toBe('New');
    const updated = await user.upsert({
      where: { email: 'new@example.com' },
      create: { email: 'new@example.com', name: 'New' },
      update: { name: 'Updated' },
    });
    expect(updated.name).toBe('Updated');
  });

  test('orderBy sorts rows', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const rows = await user.findMany({ orderBy: { column: 'age', direction: 'desc' } });
    expect(rows[0].name).toBe('Linus');
  });

  test('take and skip paginate', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const rows = await user.findMany({ orderBy: { column: 'id', direction: 'asc' }, take: 1, skip: 1 });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Linus');
  });

  test('raw SQL runs through the same driver', async () => {
    const db = await makeDb();
    const rows = await db.query<{ name: string }>('SELECT name FROM users WHERE age > ?', [40]);
    expect(rows.length).toBe(1);
  });

  test('transactions roll back on error', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await expect(
      db.transaction(async (tx) => {
        const txUser = tx.model({ name: 'user', table: users });
        await txUser.create({ data: { email: 'tx@example.com', name: 'Tx' } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await user.count()).toBe(2);
  });

  test('transactions commit successful work', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await db.transaction(async (tx) => {
      const txUser = tx.model({ name: 'user', table: users });
      await txUser.create({ data: { email: 'tx@example.com', name: 'Tx' } });
    });
    expect(await user.count()).toBe(3);
  });

  test('SQL helpers compose into a where clause', () => {
    const clause = and(eq('name', 'Ada'), like('email', '%example%'));
    expect(clause.toFragment().sql).toBe('((name = ?) AND (email LIKE ?))');
    expect(clause.toFragment().params).toEqual(['Ada', '%example%']);
  });
});
