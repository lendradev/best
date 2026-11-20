/**
 * Best — an HTTP application framework and a SQL ORM, built natively on Bun
 * with zero runtime dependencies.
 */

export { Application } from './application.ts';
export type { AppOptions, LifecycleHook } from './application.ts';

export { createApp, createContext } from './factory.ts';

export {
  Container,
  InjectionScopeError,
  UnknownProviderError,
  CircularDependencyError,
} from './core/container.ts';
export type { ProviderDefinition, ProviderOptions, ProviderScope } from './core/container.ts';

export {
  Inject,
  Injectable,
  InjectProperty,
  Module,
  Provider,
  getModuleMetadata,
} from './core/decorators.ts';
export type { ModuleMetadata, ModuleOptions } from './core/decorators.ts';

export { isClassToken, tokenToString } from './core/tokens.ts';
export type { InjectionToken } from './core/tokens.ts';

export {
  All,
  Controller,
  Delete,
  Get,
  Head,
  HttpCode,
  Options,
  Patch,
  Post,
  Put,
} from './http/route-decorators.ts';

export {
  Body,
  BodyPiped,
  Context,
  Ctx,
  Headers,
  Param,
  Piped,
  Query,
  Req,
} from './http/param-decorators.ts';

export {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
  TooManyRequestsException,
  UnauthorizedException,
  UnprocessableEntityException,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UseMiddleware,
  UsePipes,
} from './http/contracts.ts';
export type {
  CanActivate,
  ExceptionFilter,
  ExecutionContext,
  NestInterceptor,
  PipeTransform,
} from './http/contracts.ts';

export { ValidationPipe } from './http/validation.pipe.ts';
export type { Rule, RuleType, Schema, ValidationPipeOptions } from './http/validation.pipe.ts';

export { createFetchHandler, listen } from './http/server.ts';
export type { RunningServer, ServeOptions } from './http/server.ts';

export { Router, compilePath, matchPath } from './http/context.ts';
export type { RequestContext, ResponseContext, RouteDefinition } from './http/context.ts';

export { Logger } from './common/logger.ts';
export { ConfigService } from './common/config.ts';
export * as orm from './orm/index.ts';

export {
  CACHE_MANAGER,
  CacheModule,
  DEFAULT_MAX_SIZE,
  DEFAULT_TTL_MS,
  MemoryCacheStore,
  createCacheModule,
} from './cache/index.ts';
export type { CacheManager, CacheSetOptions, MemoryCacheOptions } from './cache/index.ts';

export {
  WORKER,
  Worker,
  WorkerModule,
  createWorkerModule,
} from './worker/index.ts';
export type { Job, JobContext, JobHandler, WorkerOptions } from './worker/index.ts';

export {
  STATIC_FILES,
  StaticFilesModule,
  createStaticFilesModule,
  createStaticHandler,
} from './static/index.ts';
export type { StaticFilesOptions } from './static/index.ts';

export {
  WEBSOCKET_GATEWAY,
  WebSocketModule,
  createWebSocketGateway,
  createWebSocketModule,
  websocketHandlers,
} from './websocket/index.ts';
export type {
  MessageHandler,
  WebSocketGateway,
  WebSocketGatewayOptions,
  WebSocketHandlers,
} from './websocket/index.ts';

export { EVENT_EMITTER, EventsModule, createEventEmitter } from './events/index.ts';
export type { EventEmitter, EventHandler } from './events/index.ts';

export {
  RATE_LIMITER,
  RateLimitGuard,
  RateLimiterModule,
  createRateLimitGuard,
  createRateLimiter,
  createRateLimiterModule,
  defaultKeyResolver,
} from './ratelimit/index.ts';
export type { RateLimitResult, RateLimiter, RateLimiterOptions } from './ratelimit/index.ts';

export {
  SCHEDULER,
  CronParseError,
  SchedulerModule,
  createScheduler,
  createSchedulerModule,
  nextRunAt,
  parseCronExpression,
} from './scheduler/index.ts';
export type {
  CronExpression,
  Scheduler,
  SchedulerOptions,
  SchedulerTask,
} from './scheduler/index.ts';

export {
  HEALTH_CHECK,
  HealthModule,
  createHealthCheck,
  createHealthHandler,
  createHealthIndicator,
  createHealthModule,
} from './health/index.ts';
export type {
  HealthCheck,
  HealthCheckOptions,
  HealthIndicator,
  HealthIndicatorResult,
  HealthReport,
  HealthStatus,
} from './health/index.ts';

export {
  SERIALIZATION_INTERCEPTOR,
  SerializationModule,
  createSerializationInterceptor,
  createSerializationModule,
} from './serialization/index.ts';
export type {
  SerializationInterceptor,
  SerializationOptions,
} from './serialization/index.ts';

export {
  PASSWORD_HASHER,
  SecurityModule,
  TOKEN_SIGNER,
  createSecurityModule,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from './security/index.ts';
export type {
  HashPasswordOptions,
  PasswordAlgorithm,
  PasswordHasher,
  SecurityModuleOptions,
  SignTokenOptions,
  SignTokenResult,
  TokenPayload,
  TokenSigner,
  VerifyTokenOptions,
} from './security/index.ts';

export {
  OPENAPI_DOCUMENT,
  OpenApiModule,
  createOpenApiDocument,
  createOpenApiModule,
} from './openapi/index.ts';
export type {
  OpenApiDocument,
  OpenApiInfo,
  OpenApiModuleOptions,
  OpenApiOperation,
  OpenApiOptions,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
} from './openapi/index.ts';
