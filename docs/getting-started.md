---
title: Best — Getting Started
date: 2026-11-17
status: draft
owner: research
tags: [setup, bun, quickstart]
---

# Getting Started

Requirements: **Bun >= 1.4.0**. Nothing else — no Node.js, no Deno, no native build step.

```bash
bun --version
```

---

## 1. Install

The npm name `best` is taken by an unrelated package, so the package is
installed from GitHub for now:

```bash
bun add github:lendradev/best
```

To work on Best itself:

```bash
git clone https://github.com/lendradev/best.git
cd best/workspace
bun install
bun test
```

---

## 2. Scaffold a project

```bash
bunx best new my-api
cd my-api
bun install
bun run dev
```

The scaffold produces:

```
my-api/
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    ├── main.ts
    ├── schema.ts
    └── models/user.ts
```

`src/main.ts` starts a server on port 3000 (override with `PORT`).

`src/schema.ts` exports the `schema` object that `best migrate` reads. The
scaffold writes `best` into `dependencies` as `github:lendradev/best`, so
`bun install` inside the new project resolves it the same way.

---

## 3. A minimal application

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

---

## 4. Dependency injection

Bun does not implement `emitDecoratorMetadata`, so every dependency names its
token with `@Inject`:

```ts
import { Inject, Injectable } from 'best';

@Injectable()
export class UserService {
  constructor(@Inject(UserRepository) private readonly repo: UserRepository) {}
}
```

Providers are registered per module:

```ts
@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository, { provide: 'CONFIG', useValue: { ttl: 60 } }],
})
export class UserModule {}
```

Provider forms: a class, `{ provide, useValue }`, `{ provide, useClass }`,
`{ provide, useFactory, inject }`.

Scopes: `singleton` (default), `transient`, `request`.

```ts
@Injectable({ scope: 'request' })
export class RequestContext {}
```

---

## 5. Routing and parameters

```ts
@Controller('/users')
export class UserController {
  @Get('/')                       list() { /* ... */ }
  @Get('/:id')                    find(@Param('id') id: string) { /* ... */ }
  @Get('/search')                 search(@Query('q') q: string) { /* ... */ }
  @Post('/')                      create(@Body() body: unknown) { /* ... */ }
  @Delete('/:id')                 remove(@Param('id') id: string) { /* ... */ }
}
```

Path patterns: `:param`, `:param?` for optional segments, `*` for a wildcard
tail. `@HttpCode(202)` overrides the default status (200, or 201 for `POST`).

---

## 6. Validation

```ts
import { BodyPiped, ValidationPipe } from 'best';

@Post('/')
create(
  @BodyPiped(new ValidationPipe({
    email: { type: 'email', required: true },
    age: { type: 'integer', min: 0 },
  }))
  body: { email: string; age?: number },
) {
  /* ... */
}
```

A failed rule throws `BadRequestException` (HTTP 400) with a message naming
the field.

---

## 7. Guards, interceptors and filters

```ts
import { CanActivate, ExecutionContext, NestInterceptor, UseGuards } from 'best';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return context.headers.get('authorization') === 'Bearer secret';
  }
}

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  async intercept(_context: ExecutionContext, next: () => Promise<unknown>) {
    const started = performance.now();
    const result = await next();
    console.log(`took ${performance.now() - started}ms`);
    return result;
  }
}
```

Apply them at class or method level:

```ts
@Controller('/admin')
@UseGuards(AuthGuard)
export class AdminController {
  @Get('/stats')
  @UseInterceptors(TimingInterceptor)
  stats() { /* ... */ }
}
```

Guards returning `false` produce a `403`. Throwing `HttpException` subclasses
(`BadRequestException`, `NotFoundException`, `ConflictException`, …) maps
directly to the response status.

---

## 8. The ORM

```ts
import {
  Database,
  MariadbDriver,
  MysqlDriver,
  PostgresDriver,
  SqliteDriver,
  generateMigration,
  id,
  integer,
  table,
  text,
} from 'best/orm';

export const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
]);

const db = new Database(new SqliteDriver({ file: 'app.db' }));

for (const statement of generateMigration({ tables: [users], relations: [] }).statements) {
  await db.executeRun(statement);
}

const user = db.model({ name: 'user', table: users });

await user.create({ data: { email: 'ada@example.com', name: 'Ada', age: 36 } });
await user.findMany({ where: { age: { gte: 18 } }, orderBy: { column: 'name', direction: 'asc' } });
await user.aggregate({ _count: true, _avg: { age: true } });
await db.transaction(async (tx) => {
  await tx.model({ name: 'user', table: users }).delete({ where: { id: 1 } });
});
```

Postgres uses the same client with a different driver:

```ts
const db = new Database(new PostgresDriver({ url: process.env.DATABASE_URL! }));
```

MySQL and MariaDB work the same way:

```ts
const db = new Database(new MysqlDriver({ url: process.env.DATABASE_URL! }));
const db = new Database(new MariadbDriver({ url: process.env.DATABASE_URL! }));
```

The same model and the same calls work on every backend. The dialect takes
care of the differences: the placeholder syntax, the quoting, the upsert
syntax and how a boolean is stored. A `boolean` column reads back as a
boolean on every backend.

MySQL 8 accounts that use `caching_sha2_password` need the server's RSA key
over an unencrypted connection. Turn `allowPublicKeyRetrieval` on for a server
you trust:

```ts
const db = new Database(
  new MysqlDriver({ url: process.env.DATABASE_URL!, allowPublicKeyRetrieval: true }),
);
```

---

## 9. Migrations from the CLI

The scaffolded project has a `migrate` script that applies `src/schema.ts` to
`app.db`:

```bash
bun run migrate
```

The CLI itself takes the schema file and a target:

```bash
best migrate src/schema.ts --db app.db
best migrate src/schema.ts --url postgres://localhost/app
```

`--db` takes a SQLite file path. `--url` takes a connection string and picks
the backend from its scheme: `postgres://`, `mysql://` or `mariadb://`.

The schema file must export a `schema` object. `SchemaBuilder.table()`
registers a table and returns the builder, so the calls chain and the schema
is read off `build()`:

```ts
import { SchemaBuilder, id, text } from 'best/orm';

export const schema = new SchemaBuilder()
  .table('users', [id(), text('email', { notNull: true })])
  .build();
```

The CLI prints the number of statements it applied and the backend it used:

```
Applied 1 statement to app.db (sqlite)
```

---

## 10. Testing

```ts
import { describe, expect, test } from 'bun:test';
import { createTestingModule } from 'best/testing';

const module = await createTestingModule({ providers: [UserService] });
const service = module.get(UserService);
await module.close();
```

The framework's own suite runs with `bun test`.

---

## 11. Commands

| Command | Description |
|---|---|
| `best new <name>` | Scaffold a project |
| `best generate <model>` | Create a model file from the template |
| `best migrate <schema.ts> --db <file>` | Apply schema DDL to a SQLite file |
| `best migrate <schema.ts> --url <connection>` | Apply schema DDL to PostgreSQL, MySQL or MariaDB |
| `best dev` | Run `src/main.ts` with hot reload |
| `best start` | Run `src/main.ts` |

The package has no `bin` entry yet, so the CLI is reached through the source
path in a scaffolded project:

```bash
bun run node_modules/best/src/cli/index.ts migrate src/schema.ts --db app.db
```
