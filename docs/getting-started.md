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

## 10. Caching

The cache manager keeps values in memory with a lifetime and a size limit.

```ts
import { CACHE_MANAGER, CacheModule } from 'best';
import { Inject, Injectable, Module } from 'best';

@Injectable()
class UserService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: CacheManager) {}

  async find(id: string) {
    return this.cache.wrap(`user:${id}`, async () => this.load(id));
  }
}

@Module({ imports: [CacheModule], providers: [UserService] })
class AppModule {}
```

`wrap` returns the cached value when there is one. When there is not, it
calls the loader and stores the result. Two callers that miss at the same time
share one loader call, so a slow query does not run twice.

The store is in memory. An entry lives for `ttlMs` milliseconds and the store
keeps at most `maxSize` entries, dropping the oldest one when it is full.
`createCacheModule({ ttlMs, maxSize })` sets the defaults.

---

## 11. Background jobs

The worker runs jobs outside the request. It is in process, so a job that has
not finished is lost when the process exits, and a retried job may run more
than once. A job has to be safe to run twice.

```ts
import { WORKER, Worker, WorkerModule } from 'best';

const worker = new Worker({ concurrency: 4, maxAttempts: 3 });

worker.register('send-welcome', async (payload: { email: string }) => {
  await sendMail(payload.email);
});

await worker.enqueue({ name: 'send-welcome', payload: { email: 'a@example.com' } });
```

`enqueue` resolves once the job is queued. `run` resolves with the handler's
result:

```ts
const result = await worker.run('send-welcome', { email: 'a@example.com' });
```

A job that throws is retried up to `maxAttempts` times, with the delay
growing by `backoffFactor` each time. A job that runs out of attempts is
counted in `worker.failed` and reported to the logger. The worker is
registered in the container the same way the cache manager is:

```ts
@Module({ imports: [WorkerModule] })
class AppModule {}
```

Call `worker.start()` to begin processing and `await worker.stop()` to drain
the queue. Stopping aborts the signal of the running jobs, so a handler that
watches `context.signal` can stop early.

---

## 12. Static files

The static handler serves a directory over HTTP. It answers with `null` when
the request does not match a file, so it can sit in front of the router.

```ts
import { createStaticHandler } from 'best';

const serveStatic = createStaticHandler({ root: 'public', prefix: '/public' });
```

A path that tries to escape the served directory — through `..`, an encoded
`..`, a backslash or a null byte — is answered with `403`.

The handler is also available through the container:

```ts
import { STATIC_FILES, StaticFilesModule, Module } from 'best';

@Module({ imports: [StaticFilesModule] })
class AppModule {}
```

`createStaticFilesModule({ root, prefix, index, cacheControl })` builds the
same module with a custom configuration.

---

## 13. WebSockets

The gateway routes messages between clients and the application. It never
starts a server, so `Bun.serve` stays with you.

```ts
import { createWebSocketGateway, websocketHandlers } from 'best';

const gateway = createWebSocketGateway({ path: '/ws' });

gateway.on('news', (data) => console.log(data));

Bun.serve({
  fetch: handleHttp,
  websocket: websocketHandlers(gateway),
});
```

A client subscribes to a topic by sending a JSON message:

```json
{ "topic": "news", "data": "hello" }
```

`gateway.publish('news', 'hello')` sends a message to the subscribers of that
topic. A message that is not JSON goes to every connected client.

---

## 14. Events

The event emitter connects parts of an application without them knowing about
each other.

```ts
import { createEventEmitter } from 'best';

const emitter = createEventEmitter();

emitter.on('user.created', async (payload: { id: number }) => {
  await sendWelcomeMail(payload.id);
});

await emitter.emit('user.created', { id: 1 });
```

`emit` awaits every handler. A handler that throws does not stop the others:
the failures are collected into an `AggregateError`.

The emitter is also available through the container:

```ts
import { EVENT_EMITTER, EventsModule, Module } from 'best';

@Module({ imports: [EventsModule] })
class AppModule {}
```

---

## 15. Rate limiting

The limiter counts the requests of a client in a fixed window. The guard
throws `TooManyRequestsException` once the window is full.

```ts
import { UseGuards, createRateLimitGuard } from 'best';

@Controller('/reports')
export class ReportController {
  @Get('/')
  @UseGuards(createRateLimitGuard({ limit: 10, windowMs: 60_000 }))
  list() {
    return [];
  }
}
```

The counter lives in the process heap, so the limit applies per process. The
limiter is also available through the container:

```ts
import { RATE_LIMITER, RateLimiterModule, Module } from 'best';

@Module({ imports: [RateLimiterModule] })
class AppModule {}
```

---

## 16. Scheduled jobs

The scheduler runs a task on a cron expression. The expression has five
fields: minute, hour, day of month, month, day of week.

```ts
import { createScheduler } from 'best';

const scheduler = createScheduler({
  onError: (error, expression) => console.error(expression, error),
});

scheduler.schedule('*/15 * * * *', async () => {
  await refreshReports();
});
scheduler.start();
```

A task that throws does not stop the scheduler. The scheduler is also
available through the container:

```ts
import { SCHEDULER, SchedulerModule, Module } from 'best';

@Module({ imports: [SchedulerModule] })
class AppModule {}
```

---

## 17. Health check

Each indicator reports on one dependency. The handler answers `200` when
everything is up and `503` when one is down.

```ts
import { createHealthCheck, createHealthHandler, createHealthIndicator } from 'best';

const health = createHealthCheck([
  createHealthIndicator('database', async () => {
    await db.query('SELECT 1');
    return { status: 'up' };
  }),
]);

const handler = createHealthHandler(health);
```

---

## 18. Serialization

The serialization interceptor maps the value a handler returned into the
response body. Without a transform it changes nothing.

```ts
import { UseInterceptors, createSerializationInterceptor } from 'best';

@Controller('/users')
export class UserController {
  @Get('/:id')
  @UseInterceptors(
    createSerializationInterceptor({
      transform: (value) => {
        const { password, ...rest } = value as Record<string, unknown>;
        return rest;
      },
    }),
  )
  findOne() {
    return this.service.find();
  }
}
```

---

## 19. Passwords and tokens

`hashPassword` uses argon2 through `Bun.password`. `signToken` signs a
payload with HMAC-SHA-256; the secret is required.

```ts
import { hashPassword, signToken, verifyPassword, verifyToken } from 'best';

const hash = await hashPassword('correct horse');
const ok = await verifyPassword('correct horse', hash);

const { token, expiresAt } = await signToken(
  { sub: user.id },
  { secret: process.env.SECRET!, expiresInMs: 3_600_000 },
);
const payload = await verifyToken(token, { secret: process.env.SECRET! });
```

Both are also available through the container. The token signer needs a
secret, so it is registered through `createSecurityModule`:

```ts
import { PASSWORD_HASHER, TOKEN_SIGNER, createSecurityModule, Module } from 'best';

@Module({ imports: [createSecurityModule({ secret: process.env.SECRET! })] })
class AppModule {}
```

---

## 20. OpenAPI

The document is generated from the route table, so it describes the routes the
application actually serves.

```ts
import { createOpenApiDocument } from 'best';

const app = await createContext([AppModule]);
const document = createOpenApiDocument({
  title: 'My API',
  version: '1.0.0',
  routes: app.router.routes,
});
```

The document carries the paths, the path parameters and the operation ids.
The payload shapes are not in the route table, so the shared schemas are
passed in by hand:

```ts
createOpenApiDocument({
  title: 'My API',
  version: '1.0.0',
  routes: app.router.routes,
  schemas: {
    User: { type: 'object', properties: { id: { type: 'string' } } },
  },
});
```

---

## 21. Testing

```ts
import { describe, expect, test } from 'bun:test';
import { createTestingModule } from 'best/testing';

const module = await createTestingModule({ providers: [UserService] });
const service = module.get(UserService);
await module.close();
```

The framework's own suite runs with `bun test`.

---

## 22. Commands

| Command | Description |
|---|---|
| `best new <name>` | Scaffold a project |
| `best generate <model>` | Create a model file from the template |
| `best migrate <schema.ts> --db <file>` | Apply schema DDL to a SQLite file |
| `best migrate <schema.ts> --url <connection>` | Apply schema DDL to PostgreSQL, MySQL or MariaDB |
| `best dev` | Run `src/main.ts` with hot reload |
| `best start` | Run `src/main.ts` |

The CLI is registered as the `best` binary, so `bunx best <command>` works
once the package is installed.
