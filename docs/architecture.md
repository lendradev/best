---
title: Best — Architecture
date: 2026-11-17
status: draft
owner: research
tags: [architecture, bun, framework, orm]
---

# Best — Architecture

Best is two libraries in one repository:

| Library | Purpose | Nest/Prisma analogue |
|---|---|---|
| `best` (core) | HTTP application framework: modules, DI, routing, cross-cutting concerns | NestJS |
| `best/orm` | Data access layer: schema, query builder, migrations | Prisma ergonomics + Drizzle SQL transparency |

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

Bun's transpiler does **not** implement `emitDecoratorMetadata`, so Nest's
type-based constructor injection is impossible without `reflect-metadata`.
Best therefore uses **explicit tokens**:

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

Order, matching Nest semantics:

```
middleware → guards → interceptors (pre) → pipes → handler
           → interceptors (post) → response
errors   → filters (route → controller → global)
```

Guards that return `false` short-circuit with `403`.

Interceptors are plain async functions (`intercept(context, next)`), not RxJS
observables — Bun has no need for the RxJS dependency.

### 2.5 Routing

Path patterns support `:param`, `:param?` (optional) and `*` (wildcard tail).
Matching is anchored, so `/users` does not match `/users/1`.

Controllers are decorated with `@Controller('/prefix')`; the application
prefix is prepended to the controller prefix and the route path.

### 2.6 Validation

`ValidationPipe` takes a plain rule object — no `class-validator`, no DTO
classes:

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

### 2.7 Lifecycle hooks

`onModuleInit` → `onApplicationBootstrap` → (shutdown)
`beforeApplicationShutdown` → `onModuleDestroy` → `onApplicationShutdown`.

### 2.8 Server

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
statement is inspectable — the Drizzle property — while the call sites keep the
Prisma shape.

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

### 3.6 Not yet implemented

The following Prisma features are **not** in the current scope and are tracked
as follow-up work:

- Relation loading (`include` / `select` on relation fields) and nested writes.
- `groupBy`.
- `Prisma Studio` equivalent GUI.

---

## 4. Design decisions and their reasons

| Decision | Reason | Cost |
|---|---|---|
| Explicit `@Inject` tokens | Bun has no `emitDecoratorMetadata` | More verbose than Nest's type-based injection |
| No RxJS | Interceptors as plain async functions | No observable composition in interceptors |
| No `reflect-metadata` | Bun has no metadata reflection | Hand-written metadata store (~60 lines) |
| `Bun.write` / `Bun.file` instead of `node:fs` | Keeps the runtime surface Bun-only | No `mkdir` primitive; `Bun.write` creates parents |
| SQL builders over a query compiler | Inspectable SQL, no engine, Drizzle-level speed | Less automatic relation handling |
| A dialect object per backend | One query layer for four backends, no `if (postgres)` in the code | A new backend means a new dialect |
| Portable `?` placeholders, rendered by the driver | The query layer never branches on the backend | A hand-written statement has to use `?`, not `$1` |
| `RETURNING` for writes where the backend has it | One round trip per write | MySQL needs a read-back; PostgreSQL needs >= 8.2 |

---

## 5. Known limitations

1. **Type-based DI is unavailable.** Without `emitDecoratorMetadata`, a
   constructor parameter cannot be resolved by its type alone. Every dependency
   must name its token.
2. **Relations are not loaded automatically.** `include` is not implemented;
   joins must be written explicitly.
3. **Request-scoped providers need an explicit child container.** The HTTP
   layer currently uses the application container for every request.
4. **Middleware is declared but not executed.** The `UseMiddleware` decorator
   and the `MiddlewareConsumer` concept from Nest are not wired into the
   request pipeline yet.
5. **No WebSocket, GraphQL, microservice or OpenAPI support.**
6. **MySQL and MariaDB count the rows that changed.** The ORM compensates by
   counting the matching rows itself, which costs one extra query on
   `updateMany` and `deleteMany` for those two backends. Bun 1.4.0 has no
   support for the `foundRows` option that would avoid it.
7. **A raw statement uses `?` for its parameters.** A hand-written PostgreSQL
   statement may use `$1`, but the two styles cannot be mixed.

---

## 6. Sources

- Bun documentation: <https://bun.com/docs>
- NestJS reference: <https://docs.nestjs.com>
- Prisma reference: <https://www.prisma.io/docs>
- Drizzle reference: <https://orm.drizzle.team/docs>
