# Best

An HTTP application framework and a SQL ORM, built natively on Bun with **zero
runtime dependencies**.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D%201.4.0-black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **Status: v0.2.0 — early. The API is not frozen.**

## Changes in v0.2.0

The ORM now speaks four backends from one query layer: SQLite, PostgreSQL,
MySQL and MariaDB. A dialect object owns the placeholder syntax, the
identifier quoting, the upsert syntax, the boolean storage and the DDL, and
the driver renders a statement for the backend it talks to.

Breaking changes, all in the ORM:

- `PostgresDriverOptions` is now `SqlDriverOptions`. It is the option type for
  every `Bun.SQL` driver, so it carries `allowPublicKeyRetrieval` as well.
- `SchemaBuilder.table()` and `SchemaBuilder.relation()` return the builder
  instead of the definition, so the calls chain.
- `orderBy.direction` is validated at runtime and must be `asc` or `desc`.
- A `where` key must be a plain column name.
- `upsert()` requires its `where` clause to name a unique key.
- A unique constraint violation raises `UniqueConstraintError`; in an HTTP
  handler it becomes a `409`.

## What you get

| Area | What is included |
|---|---|
| HTTP | Modules, dependency injection, controllers, routing, guards, interceptors, exception filters, lifecycle hooks, request validation |
| ORM | Schema helpers, a model delegate with `find` / `create` / `update` / `upsert` / `delete` / `aggregate`, SQL builders, migrations |
| Backends | SQLite, PostgreSQL, MySQL, MariaDB behind one API and one dialect layer |
| Testing | `createTestingModule` for controller and provider tests |
| CLI | `best new`, `best generate`, `best migrate`, `best dev`, `best start` |
| Dependencies | None at runtime. `dependencies` is empty in `package.json` |

## Install

The npm name `best` is taken by an unrelated package, so the package is
installed from GitHub for now:

```bash
bun add github:lendradev/best
```

Requires Bun >= 1.4.0. There is no Node.js or Deno support and no native build
step.

Scaffold a project instead of installing by hand:

```bash
bunx best new my-api
cd my-api
bun install
bun run dev
```

The scaffold writes `best` into `dependencies` as `github:lendradev/best`, so
`bun install` inside the new project resolves it the same way.

The CLI is registered as the `best` binary, so `bunx best`, `best new` and
`best migrate` work once the package is installed.

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

Every dependency names its token with `@Inject`, because Bun's transpiler does
not emit decorator metadata.

Also included: guards, interceptors, exception filters, lifecycle hooks, a
`Logger`, a `ConfigService`, and `createTestingModule`.

## ORM

```ts
import { Database, SqliteDriver, id, integer, table, text } from 'best/orm';

export const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
]);

const db = new Database(new SqliteDriver({ file: 'app.db' }));
const user = db.model({ name: 'user', table: users });

await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
await user.findMany({ where: { age: { gte: 18 } }, orderBy: { column: 'name', direction: 'asc' } });
await user.aggregate({ _count: true, _avg: { age: true } });
```

Raw SQL is available through `db.query(...)` and `db.raw\`...\``.

## Backends

The same model and the same calls run on every backend. A dialect owns the
differences.

| Backend | Driver | Connection | Placeholders | Notes |
|---|---|---|---|---|
| SQLite | `SqliteDriver` | `--db app.db` | `?` | Synchronous, through `bun:sqlite` |
| PostgreSQL | `PostgresDriver` | `--url postgres://…` | `$1` | Uses `RETURNING` for writes |
| MySQL | `MysqlDriver` | `--url mysql://…` | `?` | No `RETURNING`; rows are read back by primary key |
| MariaDB | `MariadbDriver` | `--url mariadb://…` | `?` | No `RETURNING`; rows are read back by primary key |

```ts
import { Database, MysqlDriver, PostgresDriver } from 'best/orm';

const pg = new Database(new PostgresDriver({ url: process.env.DATABASE_URL! }));
const my = new Database(new MysqlDriver({ url: process.env.DATABASE_URL! }));
```

## Migrations

The schema file exports a `schema` object, and the CLI applies the DDL:

```bash
best migrate src/schema.ts --db app.db
best migrate src/schema.ts --url postgres://localhost/app
```

A scaffolded project has a `migrate` script that applies `src/schema.ts` to
`app.db`:

```bash
bun run migrate
```

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
