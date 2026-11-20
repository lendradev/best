import { describe, expect, test } from 'bun:test';
import { Logger } from '../src/common/logger.ts';
import { createApp } from '../src/factory.ts';
import { createFetchHandler } from '../src/http/server.ts';
import { Database, NotFoundError, UniqueConstraintError } from '../src/orm/client.ts';
import { SqliteDriver } from '../src/orm/driver.ts';
import { HttpException } from '../src/http/contracts.ts';
import { errorBody } from '../src/http/server.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import { id, integer, table, text } from '../src/orm/schema.ts';
import { and, eq, like } from '../src/orm/sql.ts';
import { createAppModule } from './fixtures/app.ts';

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

  test('upsert rejects a conflict target that is not a unique key', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await expect(
      user.upsert({
        where: { name: 'Ada' },
        create: { email: 'dup@example.com', name: 'Ada' },
        update: { age: 1 },
      }),
    ).rejects.toThrow('is not a unique key');
    expect(await user.count({ where: { name: 'Ada' } })).toBe(1);
  });

  test('update that changes the primary key returns the row under the new key', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const created = await user.create({ data: { email: 'grace@example.com', name: 'Grace' } });

    const updated = await user.update({ where: { id: created.id }, data: { id: 999 } });
    expect(updated.id).toBe(999);
    expect(updated.email).toBe('grace@example.com');

    expect(await user.findUnique({ where: { id: 999 } })).not.toBeNull();
    expect(await user.findUnique({ where: { id: created.id } })).toBeNull();
  });

  test('upsert on an existing unique key returns that row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const created = await user.create({ data: { email: 'grace@example.com', name: 'Grace' } });

    const updated = await user.upsert({
      where: { email: 'grace@example.com' },
      create: { email: 'grace@example.com', name: 'New' },
      update: { name: 'Updated' },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('Updated');
    expect(await user.count()).toBe(3);
  });

  test('upsert that changes the conflict target is rejected before the write', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'grace@example.com', name: 'Grace' } });

    await expect(
      user.upsert({
        where: { email: 'grace@example.com' },
        create: { email: 'grace@example.com', name: 'New' },
        update: { email: 'other@example.com' },
      }),
    ).rejects.toThrow('the update changes the conflict target');

    const rows = await user.findMany({ where: { email: 'grace@example.com' } });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Grace');
  });
});

describe('Logger', () => {
  test('info writes at the log level', () => {
    const lines: Array<{ level: string; message: string }> = [];
    const logger = new Logger({
      level: 'log',
      sink: (level, message) => lines.push({ level, message }),
    });
    logger.info('started');
    expect(lines).toEqual([{ level: 'log', message: 'started' }]);
  });

  test('info is filtered out below the log level', () => {
    const lines: string[] = [];
    const logger = new Logger({
      level: 'warn',
      sink: (_level, message) => lines.push(message),
    });
    logger.info('started');
    expect(lines).toEqual([]);
    expect(logger.isLevelEnabled('log')).toBe(false);
    expect(logger.isLevelEnabled('warn')).toBe(true);
  });
});

describe('HTTP error mapping', () => {  test('a NotFoundError maps to 404', () => {
    expect(errorBody(new NotFoundError('user'))).toEqual({
      status: 404,
      body: { statusCode: 404, message: 'No user record found' },
    });
  });

  test('a UniqueConstraintError maps to 409', () => {
    expect(errorBody(new UniqueConstraintError())).toEqual({
      status: 409,
      body: { statusCode: 409, message: 'Unique constraint failed' },
    });
  });

  test('an HttpException keeps its own status and body', () => {
    const exception = new HttpException(418, { statusCode: 418, message: 'Teapot' });
    expect(errorBody(exception)).toEqual({
      status: 418,
      body: { statusCode: 418, message: 'Teapot' },
    });
  });

  test('an unknown error maps to 500 without leaking the message', () => {
    expect(errorBody(new Error('secret detail'))).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Internal Server Error' },
    });
  });

  test('a duplicate insert reaches the client as a 409', async () => {
    const db = new Database(new SqliteDriver({ file: ':memory:' }));
    for (const statement of generateMigration({ tables: [users], relations: [] }).statements) {
      await db.executeRun(statement);
    }
    const { app } = createApp([createAppModule(db)]);
    await app.init();
    const handler = createFetchHandler(app);

    const post = (email: string) =>
      handler(
        new Request('http://localhost/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, name: 'Ada' }),
        }),
      );

    expect((await post('dup@example.com')).status).toBe(201);
    const conflict = await post('dup@example.com');
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { statusCode: number; message: string };
    expect(body.statusCode).toBe(409);
    expect(body.message).toBe('Unique constraint failed');
    await app.close();
  });
});
