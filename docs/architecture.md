---
title: Best — Architecture
date: 2026-11-17
status: draft
owner: research
tags: [architecture, bun, framework, orm]
---

# Best — Architecture

Best is two libraries in one repository:

| Library | Purpose |
|---|---|
| `best` (core) | HTTP application framework: modules, DI, routing, cross-cutting concerns |
| `best/orm` | Data access layer: schema, query builder, migrations |

Both run **natively on Bun** with **zero runtime dependencies**. No `node:` builtins, no Deno APIs, no third-party packages at runtime.

---

## 1. Runtime constraints

| Constraint | Rule | Enforcement |
|---|---|---|
| Runtime | Bun >= 1.4.0 | `engines.bun` in `package.json` |
| Runtime dependencies | none | `dependencies` is absent from `package.json` |
| Node.js builtins | not used | all filesystem access goes through `Bun.write`, `Bun.file`, `Bun.Glob` |
| Deno APIs | not used | no `jsr:` or `deno.land` specifiers |
| Dev dependencies | `@types/bun`, `typescript` (both pinned) | type-checking only |

The only Bun builtins the framework imports are `bun:sqlite` (SQLite driver) and `node:async_hooks` is avoided entirely — request context does not need it yet.

---

## 2. Core framework

### 2.1 Layers

```
src/
├── core/          DI container, tokens, metadata store, decorators
├── http/          routing, request pipeline, params, validation, server
├── common/        logger, config, Bun-native filesystem helpers
├── orm/           schema, SQL builder, query builder, client, migrations
├── testing/       createTestingModule
├── cli/           `best new|generate|migrate|dev|start`
├── application.ts module loading, route building, pipeline execution
├── factory.ts     createApp / createContext
└── index.ts       public exports
```

### 2.2 Dependency injection

Bun's transpiler does **not** implement `emitDecoratorMetadata`, so a
constructor parameter cannot be resolved by its type alone. Best therefore
uses **explicit tokens**:

```ts
@Injectable()
export class UserService {
  constructor(@Inject(UserRepository) private readonly repo: UserRepository) {}
}
```

`@Inject(token)` accepts a class constructor, a string, or a symbol.

Scopes: `singleton` (default), `transient`, `request`. A request-scoped
provider resolved from a singleton throws `InjectionScopeError` instead of
silently leaking a shared instance.

Child containers: `container.createChild()` creates an isolated scope. Parent
singletons stay shared; request-scoped instances are created per child.

Circular dependencies raise `CircularDependencyError` with the resolution chain.

### 2.3 Metadata store

`src/core/metadata.ts` implements a `WeakMap`-backed metadata registry. The
`reflect-metadata` polyfill is not needed and not used.

Two scoping rules exist because of how TypeScript applies decorators:

- **Class decorators** receive the constructor.
- **Method decorators** receive the prototype.

Route metadata is therefore read from `controllerType.prototype`; parameter
metadata is keyed by method name on the prototype (`Map<string, ParamMeta[]>`)
so two handlers in one controller never collide.

Cross-cutting members (`@UseGuards`, `@UseInterceptors`, `@UseFilters`,
`@UsePipes`) are stored under a per-kind symbol on the constructor for class
scope, and in a `Map` keyed by `kind + methodName` on the prototype for method
scope. A single flat array per prototype would leak one method's guards into
every other method of the same controller.

### 2.4 Request pipeline

The pipeline runs in this order:

```
middleware -> guards -> pipes -> handler -> interceptors (reverse) -> filters
```

Middleware runs first, because it is request-level work: reading a header,
rejecting a token. A middleware calls `next()` to let the request continue,
or returns a `Response` to answer it itself.

A middleware or a guard that declares no dependency does not have to be
listed in the module: the framework instantiates it directly. A member with
dependencies has to be a provider of the module, so the container can resolve
those dependencies.

### 2.5 Request scope

Every request gets its own child container. The child delegates the unknown
tokens to its parent, so the application-scoped providers stay shared while
the request-scoped ones are created per child.

The framework decides whether a controller has to be resolved per request by
asking the container whether the controller depends on a request-scoped
provider, directly or through another provider. Such a controller is scoped to
the request, so it is not built at route-build time.

The child container is released when the response is built. A request-scoped
provider with an `onModuleDestroy` hook has it called at that point.

The lifecycle hooks of a request-scoped provider run at the end of the
request, not at the start of the application: a request-scoped provider has
no application-level lifecycle.

### 2.6 Routing

Path patterns support `:param`, `:param?` (optional) and `*` (wildcard tail).
Matching is anchored, so `/users` does not match `/users/1`.

Controllers are decorated with `@Controller('/prefix')`; the application
prefix is prepended to the controller prefix and the route path.

### 2.7 Validation

`ValidationPipe` takes a plain rule object. There are no DTO classes and no
validation library:

```ts
@BodyPiped(new ValidationPipe({
  email: { type: 'email', required: true },
  age: { type: 'integer', min: 0 },
})) body: CreateUserDto
```

Rules support `type`, `required`, `min`, `max`, `minLength`, `maxLength`,
`pattern`, `enum`, `trim`, `default`, `message`, and a custom `check` function.

Strings are **not** coerced: a number sent for a string field is a type error,
not something to silently stringify.

### 2.8 Lifecycle hooks

`onModuleInit` → `onApplicationBootstrap` → (shutdown)
`beforeApplicationShutdown` → `onModuleDestroy` → `onApplicationShutdown`.

### 2.9 Server

`Bun.serve` with a `fetch` handler. The handler parses JSON, form-urlencoded
and text bodies, enforces a body limit (default 1 MiB), and returns `404` for
unknown paths and `405` for a known path with the wrong method.

---

## 3. ORM

### 3.1 Schema

```ts
export const users = table('users', [
  id(),
  text('email', { notNull: true, unique: true }),
  text('name', { notNull: true }),
  integer('age'),
]);
```

`table()`, `column()` and the typed helpers (`id`, `text`, `integer`, `real`,
`boolean`, `blob`, `json`, `timestamp`, `uuid`, `primaryKey`, `references`)
produce plain objects. Nothing is codegen'd; the schema is the single source of
truth at runtime.

### 3.2 Model API

```ts
const user = db.model({ name: 'user', table: users });

await user.findMany({ where: { age: { gte: 18 } }, orderBy: { column: 'name', direction: 'asc' } });
await user.findUnique({ where: { email: 'ada@example.com' } });
await user.create({ data: { email, name } });
await user.update({ where: { id }, data: { name } });
await user.upsert({ where: { email }, create: { ... }, update: { ... } });
await user.delete({ where: { id } });
await user.count({ where: { name: { contains: 'a' } } });
await user.aggregate({ _count: true, _sum: { age: true }, _avg: { age: true } });
```

Where operators: `equals`, `not`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`,
`contains`, `startsWith`, `endsWith`, `isNull`, `notNull`.

### 3.3 Query building

The ORM compiles to SQL through an explicit builder chain (`SelectBuilder`,
`InsertBuilder`, `UpdateBuilder`, `DeleteBuilder`) and a `SQL` fragment type.
Every builder exposes `toSQL()` returning `{ sql, params }`, so the generated
statement is inspectable before it reaches the database.

### 3.4 Drivers and dialects

`SqliteDriver` wraps `bun:sqlite` (synchronous). `PostgresDriver`,
`MysqlDriver` and `MariadbDriver` wrap `Bun.SQL` (asynchronous, pooled). All
implement the same `Driver` interface: `all`, `get`, `run`, `transaction`,
`close`.

The differences between the backends live in a `Dialect` object rather than
in the query layer. A dialect owns:

- the parameter placeholder (`?` or `$1`),
- identifier quoting,
- whether `RETURNING` is available,
- the upsert syntax (`ON CONFLICT` or `ON DUPLICATE KEY UPDATE`),
- how a boolean is stored and how a case-insensitive match is spelled,
- the column types, the default values and the table DDL.

The query layer writes portable SQL with `?` placeholders, and the driver
renders it to the dialect of the backend. Identifiers are quoted on the way
out, because PostgreSQL folds an unquoted `userId` to `userid` and the column
does not exist under that name.

`RETURNING` is used for `create`, `update` and `delete` where the backend
supports it, so the affected row comes back in a single round trip. MySQL has
no `RETURNING`; the row is read back by its primary key instead.

Two backends behave differently enough to need their own handling:

- **Booleans.** PostgreSQL stores a real boolean, SQLite and MySQL store an
  integer. The model delegate encodes a boolean on write and decodes it on
  read, using the column type from the schema, so a `boolean` column
  round-trips as a boolean everywhere.
- **Row counts.** MySQL and MariaDB count the rows that *changed*, not the
  rows that *matched*, so an update that writes the same values reports zero.
  The ORM counts the matching rows itself, and an update decides whether a
  row exists by reading it back rather than by trusting the count.

### 3.5 Migrations

`generateMigration(schema, name, dialect)` produces DDL statements for the
given backend. `diffSchema(schema, driver)` introspects a live database and
reports tables to create and columns to add. It reads `sqlite_master` for
SQLite, `information_schema` for PostgreSQL and `INFORMATION_SCHEMA` for
MySQL and MariaDB. Statements that cannot be applied automatically are
returned under `manual` rather than attempted.

### 3.6 Relations

A relation is declared with the foreign key side first:

```ts
relation({
  name: 'author',
  fromTable: 'posts',
  fromColumn: 'userId',
  toTable: 'users',
  toColumn: 'id',
  kind: 'many-to-one',
});
```

`fromTable.fromColumn` holds the foreign key and points at `toTable.toColumn`.
The same declaration serves both sides: resolved for `posts` the row holds one
`author`, resolved for `users` the row holds a list of `posts`.

A relation is loaded with a **second query**, not with a join. A join
multiplies the rows, so `take` and `skip` would count the joined rows instead
of the parent rows. The keys of the parent rows are collected first and the
related rows are fetched in one statement, so the load costs one query per
relation and never one per row.

The related rows are attached to the parent rows by the key they carry. A
relation whose key column was not selected is reported, rather than loaded as
an empty relation.

A nested write runs in one transaction. The parent is written first, because
the relation needs its key. The relation supports `create`, `connect` and
`disconnect`; it does not update the related rows.

### 3.7 Grouping

`groupBy` groups the rows by one or more columns and aggregates over each
group. The group columns are selected next to the aggregates, so a group is
one row. The aggregate is aliased with its name, which is portable across the
four backends, so no dialect-specific handling is needed.

### 3.8 Not yet implemented

These features are **not** in the current scope and are tracked as follow-up
work:

- A graphical schema browser.

---

## 4. Cache and worker

### 4.1 Cache manager

`CacheManager` is a key-value interface: `get`, `set`, `delete`, `clear`,
`has` and `wrap`. `MemoryCacheStore` is the implementation that ships.

Three properties matter for the store:

- **A lifetime per entry.** An entry carries the time it expires and is
  dropped when it is read after that time. There is no sweeper timer, so an
  entry that is never read costs nothing.
- **A size limit.** The store keeps a bounded number of entries and drops the
  oldest one when it is full, so the cache cannot grow without limit.
- **A copy on write.** The store copies the value it is given. A caller that
  mutates the object it passed in cannot change what the cache holds.

`wrap` runs the loader once. Two callers that miss at the same time share
that call, so a slow query does not run twice.

The cache is a plain store. It does not read through the ORM; a caller
composes the read-through itself. That keeps the ORM unaware of the cache.

### 4.2 Worker runtime

`Worker` runs jobs from an in-process queue. A job is a plain object with a
`name`, a `payload` and an optional inline `handle`. A registered handler
routes the job by name.

The runtime holds three limits:

- **Concurrency.** At most `concurrency` jobs run at the same time.
- **Attempts.** A job that throws is retried up to `maxAttempts` times.
- **Backoff.** The delay before the next attempt grows by `backoffFactor`,
  so a failing dependency is not hammered.

The queue is **not durable**. A job that has not finished is lost when the
process exits, and a retried job may run more than once. A job therefore has
to be idempotent. The runtime does not promise exactly-once delivery.

`stop()` stops accepting new jobs and discards the queue. The running jobs
get an aborted signal, so a handler that watches `context.signal` can stop
early; a handler that ignores it runs to completion and `stop()` waits for
it.

---

## 5. HTTP capabilities

### 5.1 Static files

`createStaticHandler` serves a directory with `Bun.file`. It returns a plain
fetch-style function, so it can sit in front of the router: it answers with a
`Response` when the request maps to a file, and with `null` when it does not.

The path is read from the raw request URL rather than from `URL.pathname`,
because the `URL` parser collapses `..` segments and would hide a traversal
attempt. Every segment is checked before the path is joined, and the resolved
path has to stay inside the root, so a request cannot read a file outside the
served directory.

### 5.2 WebSocket gateway

`createWebSocketGateway` routes messages between clients and the application.
It never starts a server: `Bun.serve` stays with the caller, and the gateway
only exposes `handleOpen`, `handleMessage` and `handleClose`. The
`websocketHandlers` helper bundles them into the object `Bun.serve` expects.

A client subscribes to a topic by sending a JSON message with a `topic` field.
The gateway keeps a topic-to-socket map, so `publish` reaches the subscribers
of a topic only. A socket is unsubscribed when it closes.

### 5.3 Event emitter

`createEventEmitter` is a small typed emitter. `emit` awaits every handler and
collects the failures into an `AggregateError`, so one broken handler does not
stop the others and does not hide the failure.

---

## 6. Operational capabilities

### 6.1 Rate limiter

`RateLimiter` counts the requests of a key in a fixed window. The counter is a
map in the process heap, so the limit applies to one process. The state sits
behind the `RateLimiter` interface, so a shared store can be added later.

`RateLimitGuard` reads the client address from the proxy headers and throws
`TooManyRequestsException` once the window is full.

### 6.2 Scheduler

`Scheduler` parses a five-field cron expression and computes the next run time
from the expression on every tick, so a slow tick does not accumulate drift.
A task that throws does not stop the scheduler: the failure goes to the
`onError` callback and the task runs again on the next tick.

The cron parser supports a wildcard, a step, a value, a range and a
comma-separated list in every field, plus the short month and day names.

### 6.3 Health check

Each indicator reports on one dependency. The check runs them all, and a
check that throws counts as down. `createHealthHandler` turns the report into
a fetch handler that answers `200` or `503`.

### 6.4 Serialization interceptor

`createSerializationInterceptor` maps the value a handler returned. Without a
transform it changes nothing.

### 6.5 Password hashing and token signing

`Bun.password` hashes with argon2 and runs the work in a worker thread. The
token signer uses HMAC-SHA-256 from `crypto.subtle`, so the signing path holds
no third-party code. The secret is required — there is no default — and the
signature comparison runs over the whole string, so the timing does not depend
on where the first difference is.

### 6.6 OpenAPI generator

The document is built from the route table the router already holds, so it
describes the routes the application serves. A path parameter becomes a
required path parameter, the handler name becomes the operation id, and the
controller name becomes the tag.

---

## 7. Design decisions and their reasons

| Decision | Reason | Cost |
|---|---|---|
| Explicit `@Inject` tokens | Bun has no `emitDecoratorMetadata` | Every dependency must name its token |
| Interceptors as plain async functions | No observable type is needed to wrap a handler | No observable composition in interceptors |
| No metadata polyfill | Bun has no metadata reflection | Hand-written metadata store (~60 lines) |
| `Bun.write` / `Bun.file` instead of `node:fs` | Keeps the runtime surface Bun-only | No `mkdir` primitive; `Bun.write` creates parents |
| SQL builders over a query compiler | Inspectable SQL, no engine process | Less automatic relation handling |
| A dialect object per backend | One query layer for four backends, no `if (postgres)` in the code | A new backend means a new dialect |
| Portable `?` placeholders, rendered by the driver | The query layer never branches on the backend | A hand-written statement has to use `?`, not `$1` |
| `RETURNING` for writes where the backend has it | One round trip per write | MySQL needs a read-back; PostgreSQL needs >= 8.2 |
| The cache is in memory | It works with no external service, matching the zero-dependency rule | The entries are lost when the process exits |
| The cache copies the value it stores | A caller cannot change the cache by mutating its own object | A deep copy costs time on every write |
| The queue is in process | It works with no broker and no protocol client | A job in flight is lost when the process exits |
| Jobs are retried rather than dropped | A transient failure does not lose the work | A job may run more than once, so it has to be idempotent |
| The static handler reads the raw URL path | The `URL` parser collapses `..` and would hide a traversal | The query string and the fragment are cut by hand |
| The gateway never starts a server | `Bun.serve` stays with the caller, who owns the port and the lifecycle | The caller has to wire the handlers into `Bun.serve` |
| A failing event handler is collected, not swallowed | One broken listener must not hide its own failure | The caller has to handle the `AggregateError` |
| The rate limiter counts in process | It works with no shared store, matching the zero-dependency rule | The limit applies per process, so several instances multiply it |
| The cron expression is parsed in the framework | A five-field expression is small, and a dependency would break the rule | The parser covers the common syntax, not every cron extension |
| The scheduler recomputes the next run on every tick | A slow tick does not accumulate drift | The expression is parsed once per task, not per tick |
| The token secret is required | A default secret would be a silent security hole | Every application has to supply one |
| The token signature is HMAC-SHA-256 from `crypto.subtle` | It is the Web Crypto API and needs no dependency | Only HMAC is offered, not RSA or ECDSA |
| The OpenAPI document is generated from the route table | The document cannot drift from the routes | The document describes the paths, not the payload shapes |
| Middleware runs before the guards | Middleware is request-level work, so it has to happen before the route logic | A middleware cannot read a value the guards produced |
| A member without dependencies is instantiated directly | A middleware or a guard does not have to be listed in the module | A member with dependencies has to be a provider |
| Every request gets its own child container | Two requests never share a request-scoped instance | The container is allocated per request |
| The container decides whether a controller is request-scoped | The controller holds the instance, so the decision has to follow the dependencies | The check walks the dependency graph once per controller |
| A relation is loaded with a second query | A join multiplies the rows, so `take` and `skip` would count the joined rows | The load costs one query per relation |
| The relation keys are fetched in one statement | A query per row is an N+1 | The keys are collected from the parent rows first |
| A relation is declared with the foreign key side first | The declaration then serves both sides of the relation | The direction is decided by the table the relation is loaded on |
| A nested write runs in one transaction | The parent and its relation have to succeed or fail together | A failing relation write rolls the parent write back |
| `disconnect` clears the foreign key | The related row stays, only the link is gone | The foreign key column has to be nullable |

---

## 8. Known limitations

1. **Type-based DI is unavailable.** Without `emitDecoratorMetadata`, a
   constructor parameter cannot be resolved by its type alone. Every dependency
   must name its token.
2. **Relations are not loaded automatically.** `include` is not implemented;
   joins must be written explicitly.
3. **Request-scoped providers are per request, not per worker.** The container
   creates one child container per request and releases it when the response
   is built.
4. **Middleware has no path configuration.** A middleware applies to the route
   it is declared on, or to every route when it is a global one. There is no
   `forRoutes('*')` builder.
5. **No GraphQL, microservice or message-broker support.** A protocol client
   for either is its own piece of work and would break the zero-dependency
   rule.
6. **MySQL and MariaDB count the rows that changed.** The ORM compensates by
   counting the matching rows itself, which costs one extra query on
   `updateMany` and `deleteMany` for those two backends. Bun 1.4.0 has no
   support for the `foundRows` option that would avoid it.
7. **A raw statement uses `?` for its parameters.** A hand-written PostgreSQL
   statement may use `$1`, but the two styles cannot be mixed.
8. **The cache and the queue are per process.** A deployment with several
   processes has one cache and one queue per process. The state sits behind an
   interface, so a shared store can be added later.
9. **The WebSocket gateway is per process.** A message published by one
   instance does not reach the clients of another.
10. **The rate limiter counts per process.** A deployment with several
    instances allows the limit per instance, so the effective limit is the
    configured limit times the instance count.
11. **The OpenAPI document describes the paths, not the payload shapes.** The
    route table carries no body or response schema, so the generated document
    has a generic `200` response. The extra schemas can be passed in by hand.
12. **A request-scoped provider has no application lifecycle.** Its
    `onModuleInit` and `onApplicationBootstrap` hooks do not run at startup;
    `onModuleDestroy` runs when the request ends.

---

## 9. Sources

- Bun documentation: <https://bun.com/docs>
- Bun SQL documentation: <https://bun.com/docs/sql>
