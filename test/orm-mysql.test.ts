import { describe, expect, test } from 'bun:test';
import { Database, UniqueConstraintError } from '../src/orm/client.ts';
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

    test('upsert returns the inserted row when the conflict target has no row', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      const created = await user.upsert({
        where: { id: 99 },
        create: { email: 'zoe@example.com', name: 'Zoe' },
        update: { age: 2 },
      });
      expect(created.email).toBe('zoe@example.com');
      expect(created.name).toBe('Zoe');
      await db.close();
    });

    test('upsert rejects a conflict target that is not a unique key', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      await expect(
        user.upsert({
          where: { name: 'Dup' },
          create: { email: 'dup@example.com', name: 'Dup' },
          update: { age: 1 },
        }),
      ).rejects.toThrow('is not a unique key');
      // The rejected upsert must not have inserted a duplicate row.
      expect(await user.count({ where: { name: 'Dup' } })).toBe(0);
      await db.close();
    });

    test('update reads the row back when the update changes the where column', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      await user.create({ data: { email: 'ada@example.com', name: 'Ada' } });
      const updated = await user.update({
        where: { name: 'Ada' },
        data: { name: 'Ada L.' },
      });
      expect(updated.name).toBe('Ada L.');
      await db.close();
    });

    test('a duplicate insert throws a UniqueConstraintError', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      await user.create({ data: { email: 'dup@example.com', name: 'First' } });

      let thrown: unknown;
      try {
        await user.create({ data: { email: 'dup@example.com', name: 'Second' } });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UniqueConstraintError);
      // The raw driver message names the column, so it must not be the message.
      expect((thrown as Error).message).toBe('Unique constraint failed');
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

    test('a value that reads like a duplicate is not a unique violation', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });

      // MySQL reports this as error 1366 (a wrong integer value), not 1062
      // (a duplicate entry), so it must not become a UniqueConstraintError.
      let thrown: unknown;
      try {
        await user.create({ data: { email: 'a@example.com', name: 'Ada', age: 'Duplicate entry' as never } });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(UniqueConstraintError);
      await db.close();
    });

    test('update that changes the primary key returns the row under the new key', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      const created = await user.create({ data: { email: 'ada@example.com', name: 'Ada' } });

      const updated = await user.update({ where: { id: created.id }, data: { id: 999 } });
      expect(updated.id).toBe(999);
      expect(updated.email).toBe('ada@example.com');

      expect(await user.findUnique({ where: { id: 999 } })).not.toBeNull();
      expect(await user.findUnique({ where: { id: created.id } })).toBeNull();
      await db.close();
    });

    test('update on a table without a primary key returns the row', async () => {
      const db = await makeDb();
      await db.executeRun('DROP TABLE IF EXISTS `notes`');
      await db.executeRun('CREATE TABLE `notes` (`name` VARCHAR(255), `age` INT)');
      const notes = db.model({
        name: 'note',
        table: {
          name: 'notes',
          columns: [
            { name: 'name', type: 'text' },
            { name: 'age', type: 'integer' },
          ],
          indexes: [],
        },
      });
      await db.executeRun("INSERT INTO `notes` (`name`, `age`) VALUES ('Ada', 30)");

      // The write succeeds, so the update must report the row instead of an
      // error that would tell the caller the write failed.
      const updated = await notes.update({ where: { name: 'Ada' }, data: { age: 5 } });
      expect(updated.age).toBe(5);

      const stored = await notes.findFirst({ where: { name: 'Ada' } });
      expect(stored?.age).toBe(5);
      await db.close();
    });

    test('upsert on an existing unique key returns that row', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      const created = await user.create({ data: { email: 'a@x.io', name: 'Ada' } });

      const updated = await user.upsert({
        where: { email: 'a@x.io' },
        create: { email: 'a@x.io', name: 'New' },
        update: { name: 'Updated' },
      });
      expect(updated.id).toBe(created.id);
      expect(updated.email).toBe('a@x.io');
      expect(updated.name).toBe('Updated');
      expect(await user.count()).toBe(1);
      await db.close();
    });

    test('upsert that changes the conflict target is rejected before the write', async () => {
      const db = await makeDb();
      const user = db.model({ name: 'user', table: users });
      await user.create({ data: { email: 'a@x.io', name: 'Ada' } });

      await expect(
        user.upsert({
          where: { email: 'a@x.io' },
          create: { email: 'a@x.io', name: 'New' },
          update: { email: 'b@x.io' },
        }),
      ).rejects.toThrow('the update changes the conflict target');

      const rows = await user.findMany({ where: { email: 'a@x.io' } });
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Ada');
      await db.close();
    });

    test('upsert that collides with another unique key is rejected', async () => {
      const db = await makeDb();
      await db.executeRun('DROP TABLE IF EXISTS `codes`');
      await db.executeRun(
        'CREATE TABLE `codes` (`id` INT AUTO_INCREMENT PRIMARY KEY, `email` VARCHAR(255) UNIQUE, `code` VARCHAR(255) UNIQUE, `name` VARCHAR(255))',
      );
      const codes = db.model({
        name: 'code',
        table: {
          name: 'codes',
          columns: [
            { name: 'id', type: 'integer', primaryKey: true, autoIncrement: true },
            { name: 'email', type: 'text', unique: true },
            { name: 'code', type: 'text', unique: true },
            { name: 'name', type: 'text' },
          ],
          indexes: [],
        },
      });
      await db.executeRun("INSERT INTO `codes` (`email`, `code`, `name`) VALUES ('a@x.io', 'C1', 'A')");

      // MySQL resolves the conflict from any unique key, so a create payload
      // that collides on `code` would update the row of `code` and not the row
      // of the conflict target.
      await expect(
        codes.upsert({
          where: { email: 'new@x.io' },
          create: { email: 'new@x.io', code: 'C1', name: 'New' },
          update: { name: 'Updated' },
        }),
      ).rejects.toThrow('the create data collides with an existing row');

      const rows = await db.query('SELECT * FROM `codes`');
      expect(rows.length).toBe(1);
      expect((rows[0] as { name: string }).name).toBe('A');
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
