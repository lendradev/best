import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/factory.ts';
import { createFetchHandler } from '../src/http/server.ts';
import { Database } from '../src/orm/client.ts';
import { SqliteDriver } from '../src/orm/driver.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import { createAppModule, users } from './fixtures/app.ts';

async function makeApp() {
  const db = new Database(new SqliteDriver({ file: ':memory:' }));
  const migration = generateMigration({ tables: [users], relations: [] });
  for (const statement of migration.statements) {
    await db.executeRun(statement);
  }
  const { app } = createApp([createAppModule(db)]);
  await app.init();
  const handler = createFetchHandler(app);
  return { app, db, handler };
}

describe('HTTP application', () => {
  test('GET route returns JSON', async () => {
    const { handler, db } = await makeApp();
    const model = db.model({ name: 'user', table: users });
    await model.create({ data: { email: 'ada@example.com', name: 'Ada' } });

    const response = await handler(new Request('http://localhost/users'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string }[];
    expect(body.length).toBe(1);
    expect(body[0]?.name).toBe('Ada');
  });
  test('POST route validates the body', async () => {
    const { handler } = await makeApp();
    const response = await handler(
      new Request('http://localhost/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test('POST route creates a record and returns 201', async () => {
    const { handler, db } = await makeApp();
    const response = await handler(
      new Request('http://localhost/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'grace@example.com', name: 'Grace' }),
      }),
    );
    expect(response.status).toBe(201);
    const model = db.model({ name: 'user', table: users });
    expect(await model.count()).toBe(1);
  });

  test('unknown route returns 404', async () => {
    const { handler } = await makeApp();
    const response = await handler(new Request('http://localhost/nope'));
    expect(response.status).toBe(404);
  });

  test('wrong method returns 405', async () => {
    const { handler } = await makeApp();
    const response = await handler(new Request('http://localhost/users', { method: 'DELETE' }));
    expect(response.status).toBe(405);
  });

  test('invalid JSON returns 400', async () => {
    const { handler } = await makeApp();
    const response = await handler(
      new Request('http://localhost/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(response.status).toBe(400);
  });
});
