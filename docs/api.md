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
| `globalMiddleware` | `any[]` | `[]` | Middleware applied to every route, before the guards |

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
| `requiresRequestScope(token)` | Whether the token depends on a request-scoped provider |
| `dispose()` | Release the request-scoped instances of the container |
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

### `NestMiddleware`

```ts
interface NestMiddleware {
  use(
    context: ExecutionContext,
    next: () => Promise<void>,
  ): void | Response | Promise<void | Response>;
}
```

Middleware runs before the guards. A middleware calls `next()` to let the
request continue, or returns a `Response` to answer the request itself — the
handler and the middleware after it do not run. A middleware that neither
calls `next()` nor returns a `Response` stops the request, which the
framework reports as a `500`.

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
| `body` | Parsed body; a middleware may replace it |
| `request` | The raw `Request` |
| `state` | Mutable bag shared across the request |
| `container` | The container of the request; request-scoped providers are resolved from it |

### Applying them

`@UseGuards(...)`, `@UseInterceptors(...)`, `@UseFilters(...)`,
`@UsePipes(...)`, `@UseMiddleware(...)` — usable on a class or a method.

A member declared on a class applies to every route of that class; a member
declared on a method applies to that route only. `AppOptions.globalGuards`,
`globalInterceptors`, `globalFilters`, `globalPipes` and `globalMiddleware`
apply to every route.

A member that declares no dependency does not have to be listed in the
module: it is instantiated directly. A member with dependencies has to be a
provider of the module.

### Middleware

```ts
import { Controller, Get, UseMiddleware, type NestMiddleware } from 'best';

class AuthMiddleware implements NestMiddleware {
  async use(context: ExecutionContext, next: () => Promise<void>): Promise<void> {
    if (!context.headers.get('authorization')) {
      return new Response('Unauthorized', { status: 401 });
    }
    await next();
  }
}

@Controller('/reports')
class ReportController {
  @Get('/')
  @UseMiddleware(AuthMiddleware)
  list() {
    return [];
  }
}
```

### Request scope

A provider declared with `@Injectable({ scope: 'request' })` gets one instance
per request. Two requests never share an instance, and two providers of the
same request do.

```ts
import { Inject, Injectable } from 'best';

@Injectable({ scope: 'request' })
class RequestContext {
  readonly startedAt = Date.now();
}

@Injectable({ scope: 'request' })
class UserService {
  constructor(@Inject(RequestContext) readonly context: RequestContext) {}
}
```

A controller that depends on a request-scoped provider is resolved per
request as well. A request-scoped provider cannot be injected into a
singleton — that raises an `InjectionScopeError`.

A request-scoped provider with an `onModuleDestroy` hook has it called when
the request ends.

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

Levels: `debug`, `log`, `warn`, `error`, `fatal`. `info` is an alias of `log`.
A `sink` option redirects output, which is what the tests use.

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

## Cache

A cache maps string keys to values with a per-entry lifetime. The package
ships one store, `MemoryCacheStore`, which keeps every entry in the process
heap. Nothing is written to disk, nothing is shared between processes, and
there is no cache server to run.

### `CacheManager`

| Member | Signature | Description |
|---|---|---|
| `get` | `get<T>(key: string): Promise<T \| undefined>` | The stored value, or `undefined` when the key is absent or expired |
| `set` | `set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>` | Stores a copy of the value |
| `delete` | `delete(key: string): Promise<boolean>` | Removes the entry; `true` when one was there |
| `clear` | `clear(): Promise<void>` | Removes every entry |
| `has` | `has(key: string): Promise<boolean>` | Whether a live entry exists |
| `wrap` | `wrap<T>(key: string, loader: () => Promise<T>, options?: CacheSetOptions): Promise<T>` | Returns the cached value, or loads and stores it |

`wrap` is single-flight: two callers that miss the same key at the same time
share one loader call. A loader that throws propagates the error and stores
nothing.

### `CacheSetOptions`

| Field | Type | Description |
|---|---|---|
| `ttlMs` | `number \| undefined` | Lifetime of the entry in milliseconds; falls back to the store default |

### `MemoryCacheStore`

| Export | Description |
|---|---|
| `MemoryCacheStore` | The in-memory implementation of `CacheManager` |
| `MemoryCacheOptions` | `{ ttlMs?: number; maxSize?: number }` |
| `DEFAULT_TTL_MS` | `300_000` — the default entry lifetime |
| `DEFAULT_MAX_SIZE` | `1_000` — the default number of entries |

`new MemoryCacheStore(options?: MemoryCacheOptions)`.

- `ttlMs` is the default lifetime of an entry. A `ttlMs` of `0` expires the
  entry on the next read.
- `maxSize` is the number of entries kept at once. When the limit is passed,
  the oldest entry is evicted.
- Writing a key that already exists replaces the entry, so it does not count
  twice towards `maxSize`.
- Values are copied on the way in, so a caller that mutates the object it
  passed cannot change what the cache holds.
- An expired entry is dropped when it is next read.

### `CACHE_MANAGER`

The injection token for the cache manager: `Symbol('best:cache-manager')`.

### `CacheModule`

Registers `MemoryCacheStore` as a singleton under `CACHE_MANAGER`.

```ts
import { CACHE_MANAGER, CacheModule, Module, createContext } from 'best';
import type { CacheManager } from 'best';

@Module({ imports: [CacheModule] })
class AppModule {}

const app = await createContext([AppModule]);
const cache = app.container.resolve<CacheManager>(CACHE_MANAGER);

await cache.set('user:1', { id: 1 }, { ttlMs: 30_000 });
const user = await cache.get<{ id: number }>('user:1');
```

### `createCacheModule(options: MemoryCacheOptions)`

The same module, with a store built from `options`.

```ts
import { CACHE_MANAGER, Module, createCacheModule, createContext } from 'best';
import type { MemoryCacheStore } from 'best';

@Module({ imports: [createCacheModule({ ttlMs: 5_000, maxSize: 100 })] })
class AppModule {}

const app = await createContext([AppModule]);
const cache = app.container.resolve<MemoryCacheStore>(CACHE_MANAGER);
```

---

## Worker

The worker runs background jobs in the same process. It owns an in-process
queue, a concurrency limit, retries with backoff, and an abort signal for the
jobs that are running.

The queue lives in memory. A job that has not finished is lost when the
process exits, nothing is written to disk, and nothing is sent to a broker.
A job that is retried can run more than once, so a handler has to be
idempotent.

### `Job`

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Routes the job to a registered handler |
| `payload` | `TPayload` | The data the handler receives |
| `handle` | `((context: JobContext) => Promise<TResult>) \| undefined` | Inline handler, used when no handler is registered under `name` |

The declared type of `handle` takes a `JobContext`. At runtime the inline
handler is called with the same argument list as a registered handler, so the
first argument is the payload and the second is the `JobContext`. Register
the job by name with `register()` when the handler needs the attempt counter
or the abort signal.

### `JobContext`

| Field | Type | Description |
|---|---|---|
| `attempt` | `number` | Which attempt this is, starting at 1 |
| `signal` | `AbortSignal` | Aborted when the worker stops |

The signal may already be aborted when the handler starts, so a handler that
wants to stop early checks `signal.aborted` as well as listening for the
`abort` event.

### `JobHandler`

```ts
type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: JobContext,
) => Promise<TResult>;
```

### `WorkerOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `4` | Jobs running at the same time; the minimum is 1 |
| `maxAttempts` | `number` | `3` | Attempts per job; the minimum is 1 |
| `backoffMs` | `number` | `1000` | First backoff delay in milliseconds |
| `backoffFactor` | `number` | `2` | Multiplier applied to the delay after each attempt |
| `logger` | `{ error(msg: string, ...meta: unknown[]): void }` | none | Receives the failure and cancellation messages |

### `Worker`

`new Worker(options?: WorkerOptions)`.

| Member | Signature | Description |
|---|---|---|
| `register` | `register<TPayload, TResult>(name: string, handler: (payload: TPayload, context: JobContext) => Promise<TResult>): void` | Registers the handler a job name routes to |
| `enqueue` | `enqueue<T>(job: Job<T>): Promise<void>` | Queues a job; resolves once the job is queued, not when it has finished |
| `run` | `run<TPayload, TResult>(name: string, payload: TPayload): Promise<TResult \| undefined>` | Queues a job and resolves with the handler result |
| `start` | `start(): void` | Starts draining the queue; jobs queued before this wait |
| `stop` | `stop(): Promise<void>` | Stops accepting jobs, discards the queued ones and waits for the running ones |
| `pending` | `number` | Jobs waiting to run |
| `failed` | `number` | Jobs that failed after the last attempt |
| `running` | `number` | Jobs currently running |
| `started` | `boolean` | Whether `start()` has been called |

- `enqueue` and `run` throw when the worker is stopped.
- `enqueue` throws when no handler is registered under the name and the job
  carries no inline `handle`. `run` throws when no handler is registered
  under the name.
- `run` resolves with `undefined` when the job failed after its last attempt
  or was discarded before it ran.
- `stop()` aborts the signal of the running jobs. A handler that ignores the
  signal runs to completion, and `stop()` waits for it.
- A job discarded by `stop()` never runs.

```ts
import { WORKER, Worker, WorkerModule, Module, createContext } from 'best';
import type { JobContext } from 'best';

@Module({ imports: [WorkerModule] })
class AppModule {}

const app = await createContext([AppModule]);
const worker = app.container.resolve<Worker>(WORKER);

worker.register('send-email', async (payload: { to: string }, context: JobContext) => {
  if (context.signal.aborted) return;
  console.log(`sending to ${payload.to}, attempt ${context.attempt}`);
});

worker.start();
await worker.enqueue({ name: 'send-email', payload: { to: 'ada@example.com' } });
```

### `WORKER`

The injection token for the worker runtime: `Symbol('best:worker')`.

### `WorkerModule`

Registers `Worker` as a singleton under `WORKER`.

### `createWorkerModule(options: WorkerOptions)`

The same module, with a runtime built from `options`.

```ts
import { WORKER, Module, createContext, createWorkerModule } from 'best';
import type { Worker } from 'best';

@Module({ imports: [createWorkerModule({ concurrency: 8, maxAttempts: 5 })] })
class AppModule {}

const app = await createContext([AppModule]);
const worker = app.container.resolve<Worker>(WORKER);
```

---

## Static files

The static file handler serves a directory over HTTP. It is a plain
fetch-style function, so it can sit in front of the router: it answers with a
`Response` when the request maps to a file, and with `null` when it does not,
which lets the next route handle the request.

### `StaticFilesOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `root` | `string` | required | Directory served. A relative path is resolved against the working directory |
| `prefix` | `string` | `'/public'` | URL prefix the files are served under |
| `index` | `string` | `'index.html'` | File served for a directory request |
| `cacheControl` | `string` | `'public, max-age=0'` | Value of the `Cache-Control` header |

### `createStaticHandler(options: StaticFilesOptions)`

Returns `(request: Request) => Promise<Response | null>`.

- A request outside the prefix returns `null`.
- A path that tries to escape the root — through `..`, an encoded `..`, a
  backslash or a null byte — is answered with `403`.
- A path inside the prefix whose file does not exist returns `null`.
- A directory request is answered with the index file when it exists.
- A `HEAD` request is answered with the headers and no body.
- The content type is derived from the file extension. An unknown extension is
  served as `application/octet-stream`.

```ts
import { createStaticHandler } from 'best';

const serveStatic = createStaticHandler({ root: 'public', prefix: '/public' });

const response = await serveStatic(request);
if (response) return response;
// otherwise fall through to the router
```

### `STATIC_FILES`

The injection token for the static file handler:
`Symbol('best:static-files')`.

### `StaticFilesModule`

Registers a handler serving the `public` directory under `/public` as a
singleton under `STATIC_FILES`.

### `createStaticFilesModule(options: StaticFilesOptions)`

The same module, with a handler built from `options`.

```ts
import { STATIC_FILES, Module, createContext, createStaticFilesModule } from 'best';

@Module({ imports: [createStaticFilesModule({ root: 'assets', prefix: '/assets' })] })
class AppModule {}

const app = await createContext([AppModule]);
const handler = app.container.resolve<(request: Request) => Promise<Response | null>>(
  STATIC_FILES,
);
```

---

## WebSocket

The gateway routes messages between WebSocket clients and the application. It
never starts a server: `Bun.serve` stays with the caller, so the gateway only
exposes the handlers that `Bun.serve` expects.

A client subscribes to a topic by sending a JSON message:

```json
{ "topic": "news", "data": "hello" }
```

A message that is not JSON is broadcast to every connected client.

### `WebSocketGatewayOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | `'/ws'` | Path the upgrade is accepted on |

### `WebSocketGateway`

| Member | Signature | Description |
|---|---|---|
| `path` | `string` | Path the upgrade is accepted on |
| `on` | `on(topic: string, handler: MessageHandler): void` | Registers the handler of a topic |
| `publish` | `publish(topic: string, data: string): void` | Sends a message to the sockets subscribed to a topic |
| `send` | `send(socket: WebSocket, data: string): void` | Sends a message to one socket |
| `clients` | `number` | Number of connected sockets |

### `MessageHandler`

```ts
type MessageHandler = (data: string, socket: WebSocket) => void | Promise<void>;
```

### `createWebSocketGateway(options?: WebSocketGatewayOptions)`

Returns a gateway that also carries `handleOpen`, `handleMessage` and
`handleClose`. A socket is subscribed to a topic by the first topic message it
sends, and it is unsubscribed when it closes. A socket that is not open does
not receive a message.

### `websocketHandlers(gateway: WebSocketGateway)`

Bundles the gateway into the object `Bun.serve` expects.

```ts
import { createWebSocketGateway, websocketHandlers } from 'best';

const gateway = createWebSocketGateway({ path: '/ws' });
gateway.on('news', (data) => console.log(data));

Bun.serve({
  fetch: handleHttp,
  websocket: websocketHandlers(gateway),
});
```

### `WEBSOCKET_GATEWAY`

The injection token for the gateway: `Symbol('best:websocket-gateway')`.

### `WebSocketModule`

Registers a gateway as a singleton under `WEBSOCKET_GATEWAY`.

### `createWebSocketModule(options: WebSocketGatewayOptions)`

The same module, with a gateway built from `options`.

---

## Events

The event emitter connects parts of an application without them knowing about
each other. `emit` awaits every handler of the event.

### `EventEmitter`

| Member | Signature | Description |
|---|---|---|
| `on` | `on<T>(event: string, handler: EventHandler<T>): () => void` | Registers a handler; returns the function that removes it |
| `once` | `once<T>(event: string, handler: EventHandler<T>): () => void` | Registers a handler that runs once |
| `off` | `off<T>(event: string, handler: EventHandler<T>): void` | Removes a handler |
| `emit` | `emit<T>(event: string, payload?: T): Promise<void>` | Calls every handler of the event |
| `listenerCount` | `listenerCount(event: string): number` | Number of handlers of an event |

A handler that throws does not stop the other handlers: the errors are
collected and reported as an `AggregateError`, so a failure is never swallowed
silently. A handler registered during an `emit` does not join that round.

### `EventHandler`

```ts
type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
```

### `createEventEmitter()`

Returns an emitter.

```ts
import { createEventEmitter } from 'best';

const emitter = createEventEmitter();
emitter.on('user.created', async (payload: { id: number }) => {
  await sendWelcomeMail(payload.id);
});
await emitter.emit('user.created', { id: 1 });
```

### `EVENT_EMITTER`

The injection token for the emitter: `Symbol('best:event-emitter')`.

### `EventsModule`

Registers an emitter as a singleton under `EVENT_EMITTER`.

---

## Rate limiting

The limiter counts the requests of a key in a fixed window. The counter lives
in the process heap, so the limit applies to one process.

### `RateLimitResult`

| Field | Type | Description |
|---|---|---|
| `allowed` | `boolean` | Whether the request is allowed |
| `remaining` | `number` | Requests left in the current window |
| `limit` | `number` | Requests allowed per window |
| `resetAt` | `number` | Unix milliseconds at which the window resets |

### `RateLimiter`

| Member | Signature | Description |
|---|---|---|
| `check` | `check(key: string): Promise<RateLimitResult>` | Counts one request against the key |
| `reset` | `reset(key: string): Promise<void>` | Forgets the counter of a key |
| `clear` | `clear(): Promise<void>` | Forgets every counter |

### `RateLimiterOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `100` | Requests allowed per window |
| `windowMs` | `number` | `60000` | Length of the window |
| `keyResolver` | `(context: ExecutionContext) => string` | `defaultKeyResolver` | Reads the key of a request |
| `onBlocked` | `(context: ExecutionContext, result: RateLimitResult) => void` | throws `TooManyRequestsException` | Called when a request is blocked |

### `createRateLimiter(options?: RateLimiterOptions)`

Returns a limiter.

### `defaultKeyResolver(context: ExecutionContext)`

Reads the first address of `x-forwarded-for`, then `x-real-ip`, then falls back
to the shared key `'unknown'`.

### `RateLimitGuard`

A guard that lets a request through while it stays under the limit and throws
`TooManyRequestsException` once it does not. `new RateLimitGuard(limiter, options?)`.

### `createRateLimitGuard(options?: RateLimiterOptions)`

A guard with its own limiter.

```ts
import { UseGuards, createRateLimitGuard } from 'best';

@Controller('/reports')
class ReportController {
  @Get('/')
  @UseGuards(createRateLimitGuard({ limit: 10, windowMs: 60_000 }))
  list() {
    return [];
  }
}
```

### `RATE_LIMITER`

The injection token for the limiter: `Symbol('best:rate-limiter')`.

### `RateLimiterModule`

Registers a limiter as a singleton under `RATE_LIMITER`.

### `createRateLimiterModule(options: RateLimiterOptions)`

The same module, with a limiter built from `options`.

---

## Scheduler

The scheduler runs tasks on a cron expression. The expression is a five-field
string: minute, hour, day of month, month, day of week.

Each field accepts a wildcard, a step, a value, a range or a comma-separated
list of those. The month and day-of-week fields also accept the short names
`jan` to `dec` and `sun` to `sat`.

```
*/15 * * * *      every fifteen minutes
0 9-17 * * mon-fri every hour on a weekday, from 9 to 17
0 0 1 * *         midnight on the first of the month
```

### `CronParseError`

Raised when an expression cannot be parsed.

### `parseCronExpression(expression: string): CronExpression`

Parses an expression into the five field sets. Throws `CronParseError` when a
field is malformed or out of range.

### `nextRunAt(expression: CronExpression, from?: number): number | undefined`

The next matching minute after `from`, as unix milliseconds. `undefined` when
no match falls in the next year.

### `Scheduler`

| Member | Signature | Description |
|---|---|---|
| `schedule` | `schedule(expression: string, task: SchedulerTask): () => void` | Registers a task; returns the function that removes it |
| `start` | `start(): void` | Starts the timers |
| `stop` | `stop(): void` | Stops the timers; the tasks stay registered |
| `scheduled` | `number` | Number of registered tasks |
| `nextRunAt` | `nextRunAt(expression: string): number \| undefined` | The next run of an expression |

A task that throws does not stop the scheduler: the error goes to the
`onError` callback.

### `SchedulerOptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `onError` | `(error: unknown, expression: string) => void` | none | Called when a task throws |
| `maxDelayMs` | `number` | `60000` | Upper bound of a timer delay |

### `createScheduler(options?: SchedulerOptions)`

Returns a scheduler.

```ts
import { createScheduler } from 'best';

const scheduler = createScheduler({
  onError: (error, expression) => console.error(expression, error),
});

scheduler.schedule('*/5 * * * *', async () => {
  await refreshReports();
});
scheduler.start();
```

### `SCHEDULER`

The injection token for the scheduler: `Symbol('best:scheduler')`.

### `SchedulerModule`

Registers a scheduler as a singleton under `SCHEDULER`.

### `createSchedulerModule(options: SchedulerOptions)`

The same module, with a scheduler built from `options`.

---

## Health check

Each indicator reports on one dependency. The check runs them all and reports
the overall state.

### `HealthIndicator`

| Member | Signature | Description |
|---|---|---|
| `name` | `string` | Name of the dependency |
| `check` | `check(): Promise<HealthIndicatorResult> \| HealthIndicatorResult` | Checks the dependency |

A check that throws means the dependency is down.

### `HealthIndicatorResult`

| Field | Type | Description |
|---|---|---|
| `status` | `'up' \| 'down'` | State of the dependency |
| `details` | `Record<string, unknown> \| undefined` | What the indicator wants to report |

### `HealthReport`

| Field | Type | Description |
|---|---|---|
| `status` | `'up' \| 'down'` | Overall state |
| `checks` | `Record<string, HealthIndicatorResult>` | Result of every indicator, keyed by name |
| `uptime` | `number` | Milliseconds the process has been running |

### `createHealthIndicator(name, check)`

Builds an indicator from a name and a check function.

### `createHealthCheck(indicators?: HealthIndicator[], options?: HealthCheckOptions)`

Returns a health check. `HealthCheckOptions` carries `uptime`, a function that
returns the process uptime in milliseconds. It defaults to
`process.uptime() * 1000`.

### `createHealthHandler(healthCheck: HealthCheck)`

Returns a fetch handler that answers with the report: `200` when every
indicator is up, `503` when one is down.

```ts
import { HEALTH_CHECK, HealthModule, createHealthHandler, createHealthIndicator } from 'best';

const health = createHealthCheck([
  createHealthIndicator('database', async () => {
    await db.query('SELECT 1');
    return { status: 'up' };
  }),
]);

const handler = createHealthHandler(health);
```

### `HEALTH_CHECK`

The injection token for the health check: `Symbol('best:health-check')`.

### `HealthModule`

Registers a health check as a singleton under `HEALTH_CHECK`.

### `createHealthModule(indicators?: HealthIndicator[], options?: HealthCheckOptions)`

The same module, with a check built from the indicators.

---

## Serialization

The serialization interceptor maps the value a handler returned into the value
the client receives.

### `SerializationOptions`

| Field | Type | Description |
|---|---|---|
| `transform` | `(value: unknown, context: ExecutionContext) => unknown` | Maps the handler result; absent means a pass-through |

### `createSerializationInterceptor(options?: SerializationOptions)`

Returns an interceptor with the `intercept(context, next)` shape of
`NestInterceptor`.

```ts
import { UseInterceptors, createSerializationInterceptor } from 'best';

@Controller('/users')
class UserController {
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

### `SERIALIZATION_INTERCEPTOR`

The injection token for the interceptor:
`Symbol('best:serialization-interceptor')`.

### `SerializationModule`

Registers a pass-through interceptor as a singleton.

### `createSerializationModule(options: SerializationOptions)`

The same module, with an interceptor built from `options`.

---

## Security

### `hashPassword(password: string, options?: HashPasswordOptions): Promise<string>`

Hashes a password with argon2. `HashPasswordOptions` carries `algorithm`,
which defaults to `'argon2id'` and also accepts `'bcrypt'`.

### `verifyPassword(password: string, hash: string): Promise<boolean>`

Checks a password against a hash. A hash that cannot be read returns `false`
rather than throwing.

### `signToken(payload, options): Promise<SignTokenResult>`

Signs a payload into a token. The token is
`base64url(payload).base64url(signature)`, and the signature is HMAC-SHA-256
over the payload.

| Field | Type | Description |
|---|---|---|
| `secret` | `string` | HMAC secret. Required — there is no default |
| `expiresInMs` | `number \| undefined` | Lifetime of the token; omit for a token that never expires |
| `claims` | `TokenPayload \| undefined` | Extra claims merged into the payload |

The result carries the `token` and `expiresAt`, the unix millisecond expiry.

### `verifyToken(token, options): Promise<TokenPayload | null>`

Verifies a token and returns its payload. `null` when the token is malformed,
the signature does not match, or the token is expired. `options` carries
`secret` and `now`, which overrides the clock.

```ts
import { signToken, verifyToken } from 'best';

const { token } = await signToken({ sub: user.id }, { secret, expiresInMs: 3_600_000 });
const payload = await verifyToken(token, { secret });
```

### `PASSWORD_HASHER`

The injection token for the password hasher:
`Symbol('best:password-hasher')`.

### `TOKEN_SIGNER`

The injection token for the token signer: `Symbol('best:token-signer')`.

### `SecurityModule`

Registers the password hasher as a singleton. The token signer needs a
secret, so it is only available through `createSecurityModule`.

### `createSecurityModule(options: SecurityModuleOptions)`

The same module with a token signer. `SecurityModuleOptions` carries
`secret`, which is required, and `expiresInMs`, the default lifetime of a
signed token.

```ts
import { TOKEN_SIGNER, createSecurityModule } from 'best';

@Module({ imports: [createSecurityModule({ secret: process.env.SECRET! })] })
class AppModule {}
```

---

## OpenAPI

The document is built from the route table, so it cannot drift from the routes
the application serves.

### `OpenApiDocument`

| Field | Type | Description |
|---|---|---|
| `openapi` | `string` | OpenAPI version, `'3.1.0'` by default |
| `info` | `OpenApiInfo` | Title, version and description |
| `paths` | `Record<string, Record<string, OpenApiOperation>>` | One entry per path, keyed by method |
| `components` | `{ schemas: Record<string, Record<string, unknown>> }` | The shared schemas |

### `OpenApiOptions`

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Title of the API |
| `version` | `string` | Version of the API |
| `description` | `string \| undefined` | Description of the API |
| `openapiVersion` | `string \| undefined` | OpenAPI version, `'3.1.0'` by default |
| `routes` | `RouteDefinition[]` | The routes to describe |
| `schemas` | `Record<string, Record<string, unknown>> \| undefined` | Extra schemas |

### `createOpenApiDocument(options: OpenApiOptions)`

Builds the document. A path parameter becomes a required path parameter, the
operation id is the handler name, and the controller name becomes the tag.

```ts
import { createOpenApiDocument } from 'best';

const app = await createContext([AppModule]);
const document = createOpenApiDocument({
  title: 'My API',
  version: '1.0.0',
  routes: app.router.routes,
});
```

### `OPENAPI_DOCUMENT`

The injection token for the document: `Symbol('best:openapi-document')`.

### `OpenApiModule`

Registers a document without routes as a singleton.

### `createOpenApiModule(options: OpenApiModuleOptions)`

The same module with a document built from the options. `routes` accepts an
array or a function, so it can return the routes of an application that was
created after the module was declared.

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

`SchemaBuilder` collects tables and relations into a `SchemaDefinition`.
`table()` and `relation()` register a definition and return the builder, so
the calls chain:

```ts
const schema = new SchemaBuilder()
  .table('users', [id(), text('email', { notNull: true })])
  .build();
```

`SchemaDefinition` has two required fields: `tables: TableDefinition[]` and
`relations: RelationDefinition[]`.

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
`formatDefault(value, dialect?)` renders a default value as a SQL literal.

### Query builder types

| Export | Description |
|---|---|
| `OrderBy` | `{ column: string; direction: OrderDirection }` |
| `OrderDirection` | `'asc' \| 'desc'` |
| `Quote` | `(identifier: string) => string` — quotes an identifier for a dialect |
| `SelectOptions` | Options accepted by `SelectBuilder` |
| `JoinSpec` | A join in a select builder |

`direction` is required. `asc` is the default for the builder's
`orderBy(column, direction?)` method, but the `OrderBy` object itself has no
default.

### Dialect types

| Export | Description |
|---|---|
| `Dialect` | The interface a backend dialect implements |
| `DialectName` | `'sqlite' \| 'postgres' \| 'mysql' \| 'mariadb'` |
| `UpsertOptions` | `{ table, values, conflictColumns, update }` — the input of `Dialect.upsert` |

### Driver types

| Export | Description |
|---|---|
| `Driver` | The interface every driver implements: `all`, `get`, `run`, `transaction`, `close` |
| `DriverOptions` | Options for `createDriver` — a SQLite file or a connection URL |
| `SqliteDriverOptions` | `{ file, readonly, create, strict, safeIntegers }` |
| `SqlDriverOptions` | `{ url, max, allowPublicKeyRetrieval, tls }` — used by the PostgreSQL, MySQL and MariaDB drivers |

```ts
createDriver({ file: 'app.db' });                      // SQLite
createDriver({ url: 'postgres://localhost/app' });      // PostgreSQL
createDriver({ url: 'mysql://localhost/app' });         // MySQL
createDriver({ url: 'mariadb://localhost/app' });       // MariaDB
```

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
