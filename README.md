# Best

A NestJS-style application framework and a Prisma-style ORM, built natively on
Bun with **zero runtime dependencies**.

> **Status: v0.1.0 — early. The API is not frozen.**

## Why

NestJS needs `reflect-metadata`, RxJS and an Express or Fastify adapter.
Prisma ships a query engine. Best removes both: the framework compiles to
plain Bun APIs, and the ORM emits SQL you can read.

| | Nest + Prisma | Best |
|---|---|---|
| Runtime dependencies | 10+ (reflect-metadata, rxjs, express, …) | 0 |
| DI metadata | `emitDecoratorMetadata` + `reflect-metadata` | explicit `@Inject` tokens |
| Interceptors | RxJS observables | plain async functions |
| ORM | query engine | SQL builders, inspectable output |
| Runtime | Node.js | Bun |

## Install

```bash
bun add best
```

Requires Bun >= 1.4.0.

## Quick start

```ts
import { Controller, Get, Module, createApp } from 'best';

@Controller('/')
class AppController {
  @Get('/')
  root() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const { listen } = createApp([AppModule]);
const server = await listen({ port: 3000 });
console.log(`Listening on ${server.url}`);
```

Scaffold a whole project:

```bash
bunx best new my-api
```

## Framework

```ts
import { Body, BodyPiped, Controller, Get, Inject, Injectable, Module, Param, Post, ValidationPipe } from 'best';

@Injectable()
export class UserService {
  constructor(@Inject(UserRepository) private readonly repo: UserRepository) {}
}

@Controller('/users')
export class UserController {
  constructor(@Inject(UserService) private readonly service: UserService) {}

  @Get('/:id')
  find(@Param('id') id: string) {
    return this.service.find(id);
  }

  @Post('/')
  create(
    @BodyPiped(new ValidationPipe({ email: { type: 'email', required: true } }))
    body: { email: string },
  ) {
    return this.service.create(body);
  }
}
```

Also included: guards, interceptors, exception filters, lifecycle hooks, a
`Logger`, a `ConfigService`, and `createTestingModule`.

## ORM

```ts
import { Database, SqliteDriver } from 'best/orm';
import { id, integer, table, text } from 'best/orm';

export const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
]);

const db = new Database(new SqliteDriver({ file: 'app.db' }));
const user = db.model({ name: 'user', table: users });

await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
await user.findMany({ where: { age: { gte: 18 } }, orderBy: { column: 'name' } });
await user.aggregate({ _count: true, _avg: { age: true } });
```

Postgres uses the same API with `new PostgresDriver({ url })`. Raw SQL is
available through `db.query(...)` and `db.raw\`...\``.

## Development

```bash
bun install
bun test
bunx tsc --noEmit
bun run src/cli/main.ts dev
```

## Documentation

The full API reference, architecture notes and setup guide are maintained
alongside the source in this repository's `docs/` folder.

- [Getting started](docs/getting-started.md) — install, scaffold, DI, routing, validation, ORM, migrations
- [Architecture](docs/architecture.md) — layer map, design decisions, known limitations
- [API reference](docs/api.md) — every export of `best`, `best/orm` and `best/testing`

## License

[MIT](LICENSE)
