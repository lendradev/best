import { describe, expect, test } from 'bun:test';
import { Database } from '../src/orm/client.ts';
import { PostgresDriver } from '../src/orm/driver.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import { boolean, id, integer, table, text } from '../src/orm/schema.ts';

const url = process.env.DATABASE_URL;

const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
  boolean('active'),
]);

const describeIfDatabase = url ? describe : describe.skip;

describeIfDatabase('postgres integration', () => {
  async function makeDb(): Promise<Database> {
    const db = new Database(new PostgresDriver({ url: url as string }));
    const migration = generateMigration({ tables: [users], relations: [] }, 'initial', 'postgres');
    await db.executeRun('DROP TABLE IF EXISTS "users"');
    for (const statement of migration.statements) {
      await db.executeRun(statement);
    }
    return db;
  }

  test('the driver reports the postgres dialect', async () => {
    const db = await makeDb();
    expect(db.dialect.name).toBe('postgres');
    await db.close();
  });

  test('create returns the inserted row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    const created = await user.create({
      data: { email: 'ada@example.com', name: 'Ada', age: 36, active: true },
    });
    expect(created.email).toBe('ada@example.com');
    expect(created.id).toBeGreaterThan(0);
    expect(created.active).toBe(true);
    await db.close();
  });

  test('findMany filters with a scalar where', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
    await user.create({ data: { email: 'linus@example.com', name: 'Linus', age: 54 } });
    const rows = await user.findMany({ where: { email: 'ada@example.com' } });
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Ada');
    await db.close();
  });

  test('a camel case column keeps its case', async () => {
    const db = await makeDb();
    const camel = table('camel', [id(), integer('userId')]);
    await db.executeRun('DROP TABLE IF EXISTS "camel"');
    const migration = generateMigration({ tables: [camel], relations: [] }, 'initial', 'postgres');
    for (const statement of migration.statements) {
      await db.executeRun(statement);
    }
    const model = db.model({ name: 'camel', table: camel });
    await model.create({ data: { userId: 7 } });
    const rows = await model.findMany({ where: { userId: 7 } });
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(7);
    await db.close();
  });

  test('a boolean column is stored and read back as a boolean', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'a@example.com', name: 'A', active: true } });
    await user.create({ data: { email: 'b@example.com', name: 'B', active: false } });

    const active = await user.findMany({ where: { active: true } });
    expect(active.length).toBe(1);
    expect(active[0].email).toBe('a@example.com');
    expect(active[0].active).toBe(true);

    const all = await user.findMany();
    expect(all.map((row) => row.active).sort()).toEqual([false, true]);
    await db.close();
  });

  test('update changes a row and returns it', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
    const updated = await user.update({
      where: { email: 'ada@example.com' },
      data: { name: 'Ada L.' },
    });
    expect(updated.name).toBe('Ada L.');
    await db.close();
  });

  test('updateMany reports the affected count', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'a@example.com', name: 'A' } });
    await user.create({ data: { email: 'b@example.com', name: 'B' } });
    const result = await user.updateMany({ data: { age: 30 } });
    expect(result.count).toBe(2);
    await db.close();
  });

  test('an update that writes the same values still finds the row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'a@example.com', name: 'A', age: 30 } });
    const updated = await user.update({
      where: { email: 'a@example.com' },
      data: { age: 30 },
    });
    expect(updated.email).toBe('a@example.com');
    expect(updated.age).toBe(30);
    await db.close();
  });

  test('delete removes a row', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'ada@example.com', name: 'Ada' } });
    await user.delete({ where: { email: 'ada@example.com' } });
    expect(await user.count()).toBe(0);
    await db.close();
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
    await db.close();
  });

  test('contains uses ILIKE', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'ada@example.com', name: 'Ada' } });
    const rows = await user.findMany({ where: { email: { contains: 'EXAMPLE' } } });
    expect(rows.length).toBe(1);
    await db.close();
  });

  test('aggregate computes the sum and the average', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'a@example.com', name: 'A', age: 36 } });
    await user.create({ data: { email: 'b@example.com', name: 'B', age: 54 } });
    const result = await user.aggregate({ _count: true, _sum: { age: true }, _avg: { age: true } });
    expect(result._count).toBe(2);
    expect(result._sum.age).toBe(90);
    expect(result._avg.age).toBe(45);
    await db.close();
  });

  test('raw SQL with a bound parameter runs', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });
    await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
    const rows = await db.query<{ name: string }>('SELECT name FROM "users" WHERE age > ?', [10]);
    expect(rows.length).toBe(1);
    await db.close();
  });

  test('a transaction commits and rolls back', async () => {
    const db = await makeDb();
    const user = db.model({ name: 'user', table: users });

    await db.transaction(async (tx) => {
      const txUser = tx.model({ name: 'user', table: users });
      await txUser.create({ data: { email: 'tx@example.com', name: 'Tx' } });
    });
    expect(await user.count()).toBe(1);

    await expect(
      db.transaction(async (tx) => {
        const txUser = tx.model({ name: 'user', table: users });
        await txUser.create({ data: { email: 'rollback@example.com', name: 'Rb' } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await user.count()).toBe(1);
    await db.close();
  });
});
