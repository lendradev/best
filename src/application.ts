/**
 * Application context — module scanning, provider registration, route table
 * building, and lifecycle hooks.
 */

import { Container, type ProviderScope } from './core/container.ts';
import { getDeclaredScope, getModuleMetadata } from './core/decorators.ts';
import { METADATA_KEY, getMetadata } from './core/metadata.ts';
import type { InjectionToken } from './core/tokens.ts';
import {
  getClassDecorators,
  getMethodDecorators,
  type ExceptionFilter,
  type ExecutionContext,
  type NestInterceptor,
  type PipeTransform,
} from './http/contracts.ts';
import { getParamMeta } from './http/param-decorators.ts';
import { Router, type RequestContext, type RouteDefinition } from './http/context.ts';
import { getControllerPrefix, getHttpCodes, getRoutes } from './http/route-decorators.ts';

export interface LifecycleHook {
  onModuleInit?(): void | Promise<void>;
  onApplicationBootstrap?(): void | Promise<void>;
  onModuleDestroy?(): void | Promise<void>;
  beforeApplicationShutdown?(): void | Promise<void>;
  onApplicationShutdown?(): void | Promise<void>;
}

export interface AppOptions {
  /** Prefix applied to every route path. */
  globalPrefix?: string;
  /** Bodies larger than this are rejected with 413. */
  bodyLimit?: number;
  /** Extra pipes applied to every route body argument. */
  globalPipes?: any[];
  /** Extra guards applied to every route. */
  globalGuards?: any[];
  /** Extra interceptors applied to every route. */
  globalInterceptors?: any[];
  /** Extra filters applied to every route. */
  globalFilters?: any[];
}

export type ResolvedAppOptions = Required<AppOptions>;

export class Application {
  readonly container = new Container();
  readonly router = new Router();
  readonly options: ResolvedAppOptions;

  #modules: any[] = [];
  #controllers: any[] = [];
  #providers: any[] = [];
  #initiated = false;

  constructor(modules: any[], options: AppOptions = {}) {
    this.options = {
      globalPrefix: options.globalPrefix ?? '',
      bodyLimit: options.bodyLimit ?? 1_048_576,
      globalPipes: options.globalPipes ?? [],
      globalGuards: options.globalGuards ?? [],
      globalInterceptors: options.globalInterceptors ?? [],
      globalFilters: options.globalFilters ?? [],
    };
    this.#modules = modules;
  }

  get modules(): any[] {
    return [...this.#modules];
  }

  get controllers(): any[] {
    return [...this.#controllers];
  }

  get providers(): any[] {
    return [...this.#providers];
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    if (this.#initiated) return;
    this.#initiated = true;

    for (const moduleType of this.#modules) {
      await this.#loadModule(moduleType);
    }
    this.#buildRoutes();

    await this.#callHooks('onModuleInit');
    await this.#callHooks('onApplicationBootstrap');
  }

  async #loadModule(moduleType: any, seen = new Set<any>()): Promise<void> {
    if (seen.has(moduleType)) return;
    seen.add(moduleType);

    const metadata = getModuleMetadata(moduleType);
    for (const imported of metadata.imports) {
      await this.#loadModule(imported, seen);
    }

    for (const provider of metadata.providers) {
      this.#registerProvider(provider);
    }

    for (const controller of metadata.controllers) {
      this.#controllers.push(controller);
      this.container.registerClass(controller);
    }
  }

  #registerProvider(provider: any): void {
    if (typeof provider === 'function') {
      const scope = getDeclaredScope(provider);
      this.container.registerClass(provider, { scope });
      this.#providers.push(provider);
      return;
    }

    if (provider && typeof provider === 'object') {
      const record = provider as {
        provide?: InjectionToken;
        useClass?: any;
        useValue?: unknown;
        useFactory?: (...args: any[]) => unknown;
        inject?: InjectionToken[];
        scope?: ProviderScope;
      };

      if (record.useValue !== undefined && record.provide) {
        this.container.registerValue(record.provide, record.useValue);
        this.#providers.push(record.provide);
        return;
      }
      if (record.useFactory && record.provide) {
        this.container.registerFactory(record.provide, record.useFactory, record.inject ?? [], {
          scope: record.scope ?? 'singleton',
        });
        this.#providers.push(record.provide);
        return;
      }
      if (record.useClass && record.provide) {
        this.container.registerClassAs(record.provide, record.useClass, {
          scope: record.scope ?? 'singleton',
        });
        this.#providers.push(record.provide);
        return;
      }
      if (record.provide) {
        // A bare `provide` entry without `useClass` registers the token as a
        // class provider only when the token is itself a constructor.
        if (typeof record.provide === 'function') {
          this.container.registerClass(record.provide, { scope: record.scope ?? 'singleton' });
        }
      }
    }
  }

  #buildRoutes(): void {
    for (const controllerType of this.#controllers) {
      const prefix = getControllerPrefix(controllerType);
      const routes = getRoutes(controllerType);
      const codes = getHttpCodes(controllerType);

      for (const route of routes) {
        const instance = this.container.resolve(controllerType) as Record<string, unknown>;
        const handler = instance[route.handlerName];
        if (typeof handler !== 'function') continue;

        const fullPath = this.#joinPaths(this.options.globalPrefix, prefix, route.path);
        const defaultStatus = codes.get(route.handlerName) ?? (route.method === 'POST' ? 201 : 200);

        this.router.add({
          method: route.method,
          path: fullPath,
          handlerName: route.handlerName,
          handler: handler.bind(instance) as (...args: any[]) => unknown,
          guards: [
            ...this.options.globalGuards,
            ...(getClassDecorators(controllerType, Symbol.for('best:guards')) ?? []),
            ...(getMethodDecorators(controllerType, route.handlerName, Symbol.for('best:guards')) ?? []),
          ],
          interceptors: [
            ...this.options.globalInterceptors,
            ...(getClassDecorators(controllerType, Symbol.for('best:interceptors')) ?? []),
            ...(getMethodDecorators(controllerType, route.handlerName, Symbol.for('best:interceptors')) ?? []),
          ],
          filters: [
            ...this.options.globalFilters,
            ...(getClassDecorators(controllerType, Symbol.for('best:filters')) ?? []),
            ...(getMethodDecorators(controllerType, route.handlerName, Symbol.for('best:filters')) ?? []),
          ],
          pipes: [
            ...this.options.globalPipes,
            ...(getClassDecorators(controllerType, Symbol.for('best:pipes')) ?? []),
            ...(getMethodDecorators(controllerType, route.handlerName, Symbol.for('best:pipes')) ?? []),
          ],
          controllerType,
          // defaultStatus is attached via a non-enumerable property so the
          // route shape stays stable for consumers of `router.routes`.
          ...({ defaultStatus } as any),
        });
      }
    }
  }

  #joinPaths(...parts: string[]): string {
    const joined = parts
      .filter((p) => p && p.length > 0)
      .map((p) => (p.startsWith('/') ? p : `/${p}`))
      .join('');
    return joined || '/';
  }

  async #callHooks(hook: keyof LifecycleHook): Promise<void> {
    for (const provider of this.#providers) {
      const instance = this.container.resolve(provider);
      const fn = (instance as LifecycleHook)[hook];
      if (typeof fn === 'function') await fn.call(instance);
    }
    for (const controller of this.#controllers) {
      const instance = this.container.resolve(controller);
      const fn = (instance as LifecycleHook)[hook];
      if (typeof fn === 'function') await fn.call(instance);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Request execution                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve a cross-cutting member. Classes and tokens are looked up in the
   * container; already-constructed instances are used as-is.
   */
  #resolveMember(member: any): any {
    if (typeof member === 'function') return this.container.resolve(member);
    return member;
  }

  /**
   * Execute a matched route through the pipeline:
   * guards -> pipes -> handler -> interceptors (reverse) -> filters on error.
   */
  async execute(
    route: RouteDefinition,
    request: RequestContext,
  ): Promise<{ status: number; headers: Headers; body: unknown }> {
    const context: ExecutionContext = {
      method: request.method,
      path: request.path,
      params: request.params,
      query: request.query,
      headers: request.headers,
      body: request.body,
      request: request.raw,
      state: {},
    };

    try {
      for (const guardType of route.guards) {
        const guard = this.#resolveMember(guardType) as { canActivate(c: ExecutionContext): any };
        const allowed = await guard.canActivate(context);
        if (!allowed) {
          return { status: 403, headers: new Headers(), body: { statusCode: 403, message: 'Forbidden' } };
        }
      }

      const args = await this.#buildHandlerArgs(route, request, context);

      const chain = async (index: number): Promise<unknown> => {
        if (index >= route.interceptors.length) return route.handler(...args);
        const interceptor = this.#resolveMember(
          route.interceptors[index],
        ) as NestInterceptor;
        return interceptor.intercept(context, () => chain(index + 1));
      };

      const result = await chain(0);
      const status = (route as any).defaultStatus ?? 200;
      return { status, headers: new Headers(), body: result };
    } catch (error) {
      for (const filterType of route.filters) {
        const filter = this.#resolveMember(filterType) as ExceptionFilter;
        const handled = filter.catch(error, context);
        if (handled !== undefined) {
          return { status: 200, headers: new Headers(), body: handled };
        }
      }
      throw error;
    }
  }

  async #buildHandlerArgs(
    route: RouteDefinition,
    request: RequestContext,
    context: ExecutionContext,
  ): Promise<unknown[]> {
    const meta = getParamMeta(route.controllerType.prototype, route.handlerName);
    const args: unknown[] = new Array(meta.length === 0 ? 0 : Math.max(...meta.map((m) => m.index)) + 1);

    for (const param of meta) {
      let value: unknown;
      switch (param.source) {
        case 'body':
          value = request.body;
          break;
        case 'query':
          value = param.name ? request.query.get(param.name) : Object.fromEntries(request.query);
          break;
        case 'param':
          value = param.name ? request.params[param.name] : request.params;
          break;
        case 'headers':
          value = param.name ? request.headers.get(param.name) : Object.fromEntries(request.headers);
          break;
        case 'request':
          value = request.raw;
          break;
        case 'context':
          value = context;
          break;
        case 'custom':
          value = context.state[param.name as string];
          break;
        default:
          value = undefined;
      }

      for (const pipeType of route.pipes) {
        const pipe = this.#resolveMember(pipeType) as PipeTransform;
        value = await pipe.transform(value, context);
      }

      if (param.pipe) {
        const pipe = this.#resolveMember(param.pipe) as PipeTransform;
        value = await pipe.transform(value, context);
      }

      args[param.index] = value;
    }

    return args;
  }

  /* ------------------------------------------------------------------ */
  /* Shutdown                                                            */
  /* ------------------------------------------------------------------ */

  async close(): Promise<void> {
    await this.#callHooks('beforeApplicationShutdown');
    await this.#callHooks('onModuleDestroy');
    await this.#callHooks('onApplicationShutdown');
  }
}

export { getMetadata, METADATA_KEY };
