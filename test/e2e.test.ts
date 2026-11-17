/**
 * End-to-end smoke test: starts a real HTTP server and exercises it over the
 * network, including a Postgres-style SQL round trip on SQLite.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '../src/factory.ts';
import { createFetchHandler } from '../src/http/server.ts';
import { Database } from '../src/orm/client.ts';
import { SqliteDriver } from '../src/orm/driver.ts';
import { generateMigration } from '../src/orm/migrate.ts';
import {
  Body,
  BodyPiped,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  ValidationPipe,
} from '../src/index.ts';

const DATABASE = Symbol('e2e:database');

const items = {
  name: 'items',
  columns: [
    { name: 'id', type: 'integer' as const, primaryKey: true, autoIncrement: true, notNull: true },
    { name: 'label', type: 'text' as const, notNull: true },
  ],
  indexes: [],
};

@Injectable()
class ItemService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private model() {
    return this.db.model({ name: 'item', table: items });
  }

  list() {
    return this.model().findMany({ orderBy: { column: 'id', direction: 'asc' } });
  }

  find(id: number) {
    return this.model().findUnique({ where: { id } });
  }

  create(label: string) {
    return this.model().create({ data: { label } });
  }
}

@Controller('/items')
class ItemController {
  constructor(@Inject(ItemService) private readonly service: ItemService) {}

  @Get('/')
  list() {
    return this.service.list();
  }

  @Get('/:id')
  find(@Param('id') id: string) {
    return this.service.find(Number(id));
  }

  @Post('/')
  create(
    @BodyPiped(new ValidationPipe({ label: { type: 'string', required: true } })) body: {
      label: string;
    },
  ) {
    return this.service.create(body.label);
  }
}

function buildModule(db: Database): any {
  @Module({
    controllers: [ItemController],
    providers: [ItemService, { provide: DATABASE, useValue: db }],
  })
  class E2EModule {}
  return E2EModule;
}

describe('End-to-end HTTP server', () => {
  let baseUrl: string;
  let server: { stop(): Promise<void> };

  beforeAll(async () => {
    const db = new Database(new SqliteDriver({ file: ':memory:' }));
    for (const statement of generateMigration({ tables: [items], relations: [] }).statements) {
      await db.executeRun(statement);
    }
    const { app } = createApp([buildModule(db)]);
    await app.init();
    const handler = createFetchHandler(app);

    const bunServer = Bun.serve({ port: 0, fetch: handler });
    baseUrl = `http://localhost:${bunServer.port}`;
    server = {
      async stop() {
        await bunServer.stop(true);
        await app.close();
      },
    };
  });

  afterAll(async () => {
    await server.stop();
  });

  test('creates a record over HTTP', async () => {
    const response = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'first' }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: number; label: string };
    expect(body.label).toBe('first');
    expect(body.id).toBe(1);
  });

  test('lists records over HTTP', async () => {
    const response = await fetch(`${baseUrl}/items`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { label: string }[];
    expect(body.length).toBe(1);
  });

  test('reads a record by path parameter', async () => {
    const response = await fetch(`${baseUrl}/items/1`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { label: string };
    expect(body.label).toBe('first');
  });

  test('rejects an invalid body with 400', async () => {
    const response = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  test('returns 404 for an unknown route', async () => {
    const response = await fetch(`${baseUrl}/nothing`);
    expect(response.status).toBe(404);
  });
});
