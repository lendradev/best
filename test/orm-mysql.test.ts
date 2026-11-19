import { describe, expect, test } from 'bun:test';
import { Database } from '../src/orm/client.ts';
import type { DialectName } from '../src/orm/dialect.ts';
import { MariadbDriver, MysqlDriver } from '../src/orm/driver.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import { boolean, id, integer, table, text } from '../src/orm/schema.ts';

const mysqlUrl = process.env.MYSQL_URL;
const mariadbUrl = process.env.MARIADB_URL;

const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
  boolean('active'),
]);

const describeIf = (url: string | undefined) => (url ? describe : describe.skip);

/**
 * The shared behaviour every backend has to show.
 *
 * The checks run against a real server, so a dialect that renders the wrong
 * SQL fails here instead of in production.
 */
function backendTests(dialectName: DialectName, connect: () => Database): void {
  describeIf(mysqlUrl ?? mariadbUrl)(`${dialectName} integration`, () => {
    async function makeDb(): Promise<Database> {
      const db = connect();
      await db.executeRun('DROP TABLE IF EXISTS `users`');
      const migration = generateMigration({ tables: [users], relations: [] }, 'initial', dialectName);
      for (const statement of migration.statements) {
        await db.executeRun(statement);
      }
      return db;
    }

    test('the driver reports its dialect', async () => {
      const db = await makeDb();
      expect(db.dialect.name).toBe(dialectName);
      await db.close();
    });

    test('create returns the inserted row with the generated key', async () => {
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

      // MySQL and MariaDB count the rows that changed, so this update reports
      // zero affected rows even though the row is there.
      const updated = await user.update({
        where: { email: 'a@example.com' },
        data: { age: 30 },
      });
      expect(updated.email).toBe('a@example.com');
      expect(updated.age).toBe(30);
      await db.close();
    });

    test('an update that matches no row reports the row as missing', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      await expect(
        user.update({ where: { email: 'nobody@example.com' }, data: { name: 'X' } }),
      ).rejects.toThrow('No user record found');
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

    test('contains matches case-insensitively', async () => {
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
      const rows = await db.query<{ name: string }>('SELECT `name` FROM `users` WHERE `age` > ?', [10]);
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
}

if (mysqlUrl) {
  // MySQL 8 authenticates with `caching_sha2_password`, which asks the client
  // to fetch the server's RSA key over an unencrypted connection. The driver
  // leaves that off by default; a local test server needs it turned on.
  backendTests('mysql', () =>
    new Database(new MysqlDriver({ url: mysqlUrl, allowPublicKeyRetrieval: true })),
  );
}

if (mariadbUrl) {
  backendTests('mariadb', () => new Database(new MariadbDriver({ url: mariadbUrl })));
}
