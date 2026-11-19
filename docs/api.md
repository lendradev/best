---
title: Best — Public API Reference
date: 2026-11-17
status: draft
owner: research
tags: [api, reference]
---

# Public API Reference

Everything below is exported from the `best` package. The ORM is exported
separately from `best/orm`; test helpers from `best/testing`.

---

## Application

### `createApp(modules, options?): CreateAppResult`

Creates an HTTP application. `modules` is a module class or an array of module
classes.

```ts
const { app, listen } = createApp([AppModule], { globalPrefix: '/api' });
const server = await listen({ port: 3000 });
```

`CreateAppResult`:
- `app: Application` — the application instance.
- `listen(options?): Promise<RunningServer>` — initialises the app and starts `Bun.serve`.

### `createContext(modules, options?): Promise<Application>`

Creates and initialises an application without starting a server. Use it for
queue workers, cron jobs, and headless tasks.

### `AppOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `globalPrefix` | `string` | `''` | Prefix prepended to every route path |
| `bodyLimit` | `number` | `1048576` | Maximum request body size in bytes; exceeding it returns 413 |
| `globalPipes` | `any[]` | `[]` | Pipes applied to every route |
| `globalGuards` | `any[]` | `[]` | Guards applied to every route |
| `globalInterceptors` | `any[]` | `[]` | Interceptors applied to every route |
| `globalFilters` | `any[]` | `[]` | Filters applied to every route |

### `Application`

| Member | Description |
|---|---|
| `container` | The DI `Container` |
| `router` | The `Router` with the flattened route table |
| `options` | Resolved options |
| `init(): Promise<void>` | Load modules, build routes, run startup hooks |
| `close(): Promise<void>` | Run shutdown hooks |
| `modules`, `controllers`, `providers` | Read-only snapshots |

---

## Dependency injection

### `@Module({ imports, controllers, providers, exports })`

Declares a module. `imports` are scanned recursively; `controllers` become
route providers; `providers` are registered in the container.

### `@Injectable({ scope? })`

Marks a class as injectable. Scope is `singleton` (default), `transient` or
`request`.

### `@Inject(token)`

Injects a provider into a constructor parameter. `token` is a class
constructor, a string, or a symbol.

```ts
constructor(@Inject(UserRepository) private readonly repo: UserRepository) {}
```

### `@InjectProperty(token)`

Injects a provider into a class property after construction.

### `Container`

| Method | Description |
|---|---|
| `registerClass(token, { scope? })` | Register a class as its own token |
| `registerClassAs(token, useClass, { scope? })` | Register a class under a different token |
| `registerValue(token, value)` | Register a constant |
| `registerFactory(token, fn, inject, { scope? })` | Register a factory |
| `resolve(token)` | Resolve a provider, honouring scope |
| `createChild()` | Create an isolated child container (request scope) |
| `has(token)`, `getDefinition(token)`, `tokens()` | Introspection |

Errors: `UnknownProviderError`, `CircularDependencyError`, `InjectionScopeError`.

---

## Routing

### Controllers

`@Controller(prefix?)` — the prefix is joined with the route path and the
application's `globalPrefix`.

### Route decorators

`@Get(path?)`, `@Post(path?)`, `@Put(path?)`, `@Patch(path?)`,
`@Delete(path?)`, `@Options(path?)`, `@Head(path?)`, `@All(path?)`.

`@HttpCode(status)` overrides the response status.

### Parameter decorators

| Decorator | Value passed to the handler |
|---|---|
| `@Body(name?)` | The parsed request body (or `body[name]`) |
| `@BodyPiped(pipe, name?)` | The body, transformed by the pipe |
| `@Query(name?)` | A query parameter, or all query parameters |
| `@Param(name?)` | A path parameter, or all path parameters |
| `@Headers(name?)` | A header, or all headers |
| `@Req()` | The raw `Request` |
| `@Context()` | The `ExecutionContext` |
| `@Ctx(name)` | A value from the request `state` bag |

### `Router`

| Member | Description |
|---|---|
| `routes` | The flattened route table |
| `find(method, path)` | Find a matching route and its path parameters |
| `pathExists(path)` | Whether any route matches the path (used for 405) |

### `compilePath(pattern)` / `matchPath(pattern, path)`

Compile a path pattern into a matcher. Supported: `:param`, `:param?`, `*`.

---

## Cross-cutting concerns

### `CanActivate`

```ts
interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}
```

Returning `false` produces a `403`.

### `NestInterceptor`

```ts
interface NestInterceptor {
  intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown>;
}
```

Interceptors run in declaration order on the way in and reverse order on the
way out.

### `PipeTransform`

```ts
interface PipeTransform<T = unknown> {
  transform(value: unknown, context: ExecutionContext): T | Promise<T>;
}
```

### `ExceptionFilter`

```ts
interface ExceptionFilter {
  catch(exception: unknown, context: ExecutionContext): unknown;
}
```

Return a value to handle the exception; throw or return `undefined` to pass it
up the chain.

### `ExecutionContext`

| Member | Description |
|---|---|
| `method`, `path` | Request method and path |
| `params` | Path parameters |
| `query` | `URLSearchParams` |
| `headers` | Request headers |
| `body` | Parsed body |
| `request` | The raw `Request` |
| `state` | Mutable bag shared across the request |

### Applying them

`@UseGuards(...)`, `@UseInterceptors(...)`, `@UseFilters(...)`,
`@UsePipes(...)` — usable on a class or a method.

---

## HTTP exceptions

`HttpException` is the base class. Each subclass carries a `status` and a
response body `{ statusCode, error, message }`.

`BadRequestException` (400), `UnauthorizedException` (401),
`ForbiddenException` (403), `NotFoundException` (404),
`ConflictException` (409), `GoneException` (410),
`UnprocessableEntityException` (422), `TooManyRequestsException` (429),
`InternalServerErrorException` (500), `NotImplementedException` (501),
`ServiceUnavailableException` (503).

---

## Validation

### `ValidationPipe(schema, options?)`

| Option | Default | Description |
|---|---|---|
| `whitelist` | `false` | Drop keys not present in the schema |
| `transform` | `true` | Coerce `number`, `integer` and `boolean` values |

Rule fields: `type`, `required`, `min`, `max`, `minLength`, `maxLength`,
`pattern`, `enum`, `trim`, `default`, `message`, `check`.

Types: `string`, `number`, `integer`, `boolean`, `email`, `url`, `uuid`,
`date`, `array`, `object`, `any`.

---

## Lifecycle hooks

Implemented by providers and controllers:

`onModuleInit()`, `onApplicationBootstrap()`, `beforeApplicationShutdown()`,
`onModuleDestroy()`, `onApplicationShutdown()`.

---

## Server

### `listen(app, options?): Promise<RunningServer>`

Starts `Bun.serve`. Options: `port` (default `PORT` or 3000), `hostname`
(default `HOST` or `0.0.0.0`), `onListen` callback.

`RunningServer`: `port`, `hostname`, `url`, `stop()`.

### `createFetchHandler(app): (request: Request) => Promise<Response>`

Returns a fetch handler without starting a server. Useful in tests.

---

## Common

### `Logger`

```ts
new Logger({ level: 'debug', prefix: 'api' });
logger.info('started');
logger.child('db').warn('slow query');
```

Levels: `debug`, `log`, `warn`, `error`, `fatal`. A `sink` option redirects
output, which is what the tests use.

### `ConfigService`

```ts
const config = new ConfigService({ envPrefix: 'APP_', required: ['DATABASE_URL'] });
config.get('PORT', 3000);
config.get('DEBUG', false);
```

`get` parses booleans and numbers. A missing required key throws at
construction.

### Filesystem helpers (`src/common/fs.ts`)

`writeTextFile`, `readTextFile`, `fileExists`, `directoryExists`,
`listDirectory`, `joinPath`, `resolvePath` — all built on `Bun.write`,
`Bun.file` and `Bun.Glob`, with no `node:fs` import.

---

## ORM (`best/orm`)

### `Database`

```ts
const db = new Database(new SqliteDriver({ file: 'app.db' }));
const db = new Database(new PostgresDriver({ url: 'postgres://…' }));
const db = new Database(new MysqlDriver({ url: 'mysql://…' }));
const db = new Database(new MariadbDriver({ url: 'mariadb://…' }));
```

The shorthand constructors pick the backend for you: `Database.sqlite(options?)`,
`Database.postgres(options)`, `Database.mysql(options)` and
`Database.mariadb(options)`.

| Member | Description |
|---|---|
| `model({ name, table })` | Register a model and return its delegate |
| `query(sql, params?)` | Run raw SQL, return rows |
| `raw\`…\`` | Tagged-template raw SQL |
| `executeAll`, `executeOne`, `executeRun` | Low-level execution |
| `transaction(fn)` | Run `fn` inside a transaction with a transactional database handle |
| `close()` | Close the driver |
| `driver` | The underlying driver |
| `dialect` | The dialect the database speaks |
| `dialectName` | The name of that dialect: `sqlite`, `postgres`, `mysql` or `mariadb` |

### Drivers

| Driver | Backend | Options |
|---|---|---|
| `SqliteDriver` | SQLite, through `bun:sqlite` | `file`, `readonly`, `create`, `strict`, `safeIntegers` |
| `PostgresDriver` | PostgreSQL, through `Bun.SQL` | `url`, `max`, `tls` |
| `MysqlDriver` | MySQL, through `Bun.SQL` | `url`, `max`, `tls`, `allowPublicKeyRetrieval` |
| `MariadbDriver` | MariaDB, through `Bun.SQL` | `url`, `max`, `tls` |

`createDriver(options)` picks a driver from the connection URL scheme.
`inferAdapter(url)` returns the adapter name for a URL.

`allowPublicKeyRetrieval` is off by default. MySQL 8 accounts that use
`caching_sha2_password` need it over an unencrypted connection; enable it only
for a server you trust.

### Dialects

A dialect describes what differs between the backends: placeholders,
identifier quoting, `RETURNING` support, upsert syntax, boolean storage,
case-insensitive matching, column types, default values and table DDL.

| Export | Description |
|---|---|
| `getDialect(name)` | The dialect for a name |
| `sqliteDialect`, `postgresDialect`, `mysqlDialect`, `mariadbDialect` | The four dialects |

### Rendering

| Export | Description |
|---|---|
| `renderSql(sql, params, dialect)` | Rewrite portable `?` placeholders to the dialect syntax |
| `numberPlaceholders(sql)` | Number the `?` placeholders as `$1`, `$2` |
| `replacePlaceholders(sql, placeholder)` | Replace the `?` placeholders with a function |
| `countPlaceholders(sql)` | Count the `?` placeholders |
| `countNumberedPlaceholders(sql)` | Count the `$n` placeholders |

A statement that already uses `$n` is left alone, so hand-written PostgreSQL
keeps working. Mixing `?` and `$n` in one statement is an error, and so is a
placeholder count that does not match the number of bound parameters.

### Model delegate

`findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`,
`findMany`, `create`, `createMany`, `update`, `updateMany`, `upsert`,
`delete`, `deleteMany`, `count`, `aggregate`.

Arguments:

```ts
findMany({ where, orderBy, select, take, skip })
create({ data, select })
update({ where, data, select })
upsert({ where, create, update })
delete({ where })
count({ where })
aggregate({ where, _count, _sum, _avg, _min, _max })
```

Where operators: `equals`, `not`, `in`, `notIn`, `gt`, `gte`, `lt`, `lte`,
`contains`, `startsWith`, `endsWith`, `isNull`, `notNull`.

A `boolean` column round-trips as a boolean on every backend, whatever the
backend stores it as.

### Schema

`table(name, columns, options?)`, `column(name, type, options?)`, `id()`,
`text()`, `integer()`, `real()`, `boolean()`, `blob()`, `json()`, `timestamp()`,
`uuid()`, `primaryKey()`, `references()`, `index()`, `relation()`,
`SchemaBuilder`.

### SQL helpers

`SQL.raw`, `SQL.tagged`, `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`,
`ilike`, `inArray`, `notInArray`, `between`, `isNull`, `isNotNull`, `and`,
`or`, `not`, `count`, `sum`, `avg`, `min`, `max`, `raw`.

### Migrations

`generateMigration(schema, name?, dialect?)` returns `{ name, statements }`.
The dialect defaults to `sqlite`; pass `postgres`, `mysql` or `mariadb` to
render the DDL for another backend.

`diffSchema(schema, driver)` returns `{ createTables, addColumns, manual }`.

`createTableSql(table, dialect?)` renders a single `CREATE TABLE` statement.
`createIndexSql(table, dialect?)` renders the index statements.
`formatDefault(value, dialect?)` renders a default value as a SQL literal.

### Errors

`OrmError`, `NotFoundError`, `UniqueConstraintError`.

---

## Testing (`best/testing`)

### `createTestingModule(options?)`

```ts
const module = await createTestingModule({
  providers: [UserService],
  controllers: [UserController],
});
module.get(UserService);
await module.close();
```
