/**
 * Dependency injection container.
 *
 * Resolution is constructor-signature driven: each provider declares its own
 * dependencies explicitly via `@Inject(token)`, so no `reflect-metadata` and no
 * runtime parameter type introspection is required.
 */

import { METADATA_KEY, defineMetadata, getMetadata } from './metadata.ts';
import { isClassToken, tokenToString, type InjectionToken } from './tokens.ts';

export type ProviderScope = 'singleton' | 'transient' | 'request';

export interface ProviderDefinition {
  token: InjectionToken;
  useClass?: abstract new (...args: any[]) => any;
  useValue?: unknown;
  useFactory?: (...args: any[]) => unknown;
  inject?: InjectionToken[];
  scope: ProviderScope;
}

export interface ProviderOptions {
  scope?: ProviderScope;
}

export class CircularDependencyError extends Error {
  constructor(chain: readonly string[]) {
    super(`Circular dependency detected: ${chain.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class UnknownProviderError extends Error {
  constructor(token: InjectionToken) {
    super(`No provider registered for "${tokenToString(token)}"`);
    this.name = 'UnknownProviderError';
  }
}

export class InjectionScopeError extends Error {
  constructor(token: InjectionToken, scope: ProviderScope) {
    super(
      `Cannot inject "${tokenToString(token)}" (scope "${scope}") into a singleton. ` +
        `Mark the consumer as scope "request".`,
    );
    this.name = 'InjectionScopeError';
  }
}

const PARAM_TOKENS = METADATA_KEY.PARAM_TOKENS;
const PROPERTY_TOKENS = METADATA_KEY.PROPERTY_TOKENS;

export function markInjectable(target: object): void {
  defineMetadata(METADATA_KEY.INJECTABLE, true, target);
}

export function setParamTokens(target: object, index: number, token: InjectionToken): void {
  const existing = getMetadata<Map<number, InjectionToken>>(PARAM_TOKENS, target) ?? new Map();
  existing.set(index, token);
  defineMetadata(PARAM_TOKENS, existing, target);
}

export function getParamTokens(target: object): Map<number, InjectionToken> {
  return getMetadata<Map<number, InjectionToken>>(PARAM_TOKENS, target) ?? new Map();
}

export function setPropertyTokens(target: object, key: string, token: InjectionToken): void {
  const existing = getMetadata<Map<string, InjectionToken>>(PROPERTY_TOKENS, target) ?? new Map();
  existing.set(key, token);
  defineMetadata(PROPERTY_TOKENS, existing, target);
}

export function getPropertyTokens(target: object): Map<string, InjectionToken> {
  return getMetadata<Map<string, InjectionToken>>(PROPERTY_TOKENS, target) ?? new Map();
}

/**
 * Container owns provider registrations and instance lifetimes.
 *
 * A container may have a `parent`. Child containers (used for request scope)
 * delegate unknown tokens to the parent so application-scoped providers stay
 * shared while request-scoped instances are created per child.
 */
export class Container {
  readonly #definitions = new Map<InjectionToken, ProviderDefinition>();
  readonly #singletons = new Map<InjectionToken, unknown>();
  readonly #resolutionStack: InjectionToken[] = [];
  readonly #parent?: Container;

  constructor(parent?: Container) {
    this.#parent = parent;
  }

  register(definition: ProviderDefinition): void {
    this.#definitions.set(definition.token, definition);
  }

  registerClass<T extends abstract new (...args: any[]) => any>(
    token: T,
    options: ProviderOptions = {},
  ): void {
    this.register({
      token,
      useClass: token,
      scope: options.scope ?? 'singleton',
    });
  }

  /**
   * Registers a class under a separate token, e.g. `{ provide: 'TOKEN',
   * useClass: UserService }`.
   */
  registerClassAs(
    token: InjectionToken,
    useClass: abstract new (...args: any[]) => any,
    options: ProviderOptions = {},
  ): void {
    this.register({
      token,
      useClass,
      scope: options.scope ?? 'singleton',
    });
  }

  registerValue<T>(token: InjectionToken<T>, value: T): void {
    this.register({ token, useValue: value, scope: 'singleton' });
    this.#singletons.set(token, value);
  }

  registerFactory<T>(
    token: InjectionToken<T>,
    factory: (...args: any[]) => T,
    inject: InjectionToken[] = [],
    options: ProviderOptions = {},
  ): void {
    this.register({ token, useFactory: factory, inject, scope: options.scope ?? 'singleton' });
  }

  has(token: InjectionToken): boolean {
    return this.#definitions.has(token) || (this.#parent?.has(token) ?? false);
  }

  getDefinition(token: InjectionToken): ProviderDefinition | undefined {
    return this.#definitions.get(token) ?? this.#parent?.getDefinition(token);
  }

  /** Create an isolated child container (request scope). */
  createChild(): Container {
    return new Container(this);
  }

  resolve<T = unknown>(token: InjectionToken<T>): T {
    const definition = this.getDefinition(token);
    if (!definition) throw new UnknownProviderError(token);

    if (definition.scope === 'singleton') {
      if (this.#singletons.has(token)) return this.#singletons.get(token) as T;
      const instance = this.#instantiate(definition, 'singleton');
      // Cache on the owning container so the instance is shared.
      this.#ownerOf(definition.token).#singletons.set(definition.token, instance);
      return instance as T;
    }

    if (definition.scope === 'transient') return this.#instantiate(definition, 'transient') as T;

    // request scope: cached in this (child) container only
    if (this.#singletons.has(token)) return this.#singletons.get(token) as T;
    const instance = this.#instantiate(definition, 'request');
    this.#singletons.set(token, instance);
    return instance as T;
  }

  #ownerOf(token: InjectionToken): Container {
    if (this.#definitions.has(token)) return this;
    return this.#parent ? this.#parent.#ownerOf(token) : this;
  }

  #instantiate(definition: ProviderDefinition, consumerScope: ProviderScope): unknown {
    if ('useValue' in definition) return definition.useValue;

    if (definition.useFactory) {
      const deps = (definition.inject ?? []).map((dep) => this.resolve(dep));
      return definition.useFactory(...deps);
    }

    const cls = definition.useClass;
    if (!cls) throw new UnknownProviderError(definition.token);

    const args = this.#resolveConstructorArgs(cls, definition.scope);
    const instance = new (cls as new (...args: any[]) => unknown)(...args);
    this.#injectProperties(instance, cls, definition.scope);
    return instance;
  }

  #resolveConstructorArgs(
    cls: abstract new (...args: any[]) => any,
    scope: ProviderScope,
  ): unknown[] {
    const tokens = getParamTokens(cls);
    const paramCount = tokens.size === 0 ? 0 : Math.max(...[...tokens.keys()].map((k) => k + 1));
    const args: unknown[] = new Array(paramCount);

    for (const [index, token] of tokens) {
      const depDefinition = this.getDefinition(token);
      if (depDefinition && depDefinition.scope !== 'singleton' && scope === 'singleton') {
        throw new InjectionScopeError(token, depDefinition.scope);
      }
      args[index] = this.resolve(token);
    }
    return args;
  }

  #injectProperties(
    instance: unknown,
    cls: abstract new (...args: any[]) => any,
    scope: ProviderScope,
  ): void {
    const tokens = getPropertyTokens(cls);
    if (tokens.size === 0) return;
    const target = instance as Record<string, unknown>;
    for (const [key, token] of tokens) {
      const depDefinition = this.getDefinition(token);
      if (depDefinition && depDefinition.scope !== 'singleton' && scope === 'singleton') {
        throw new InjectionScopeError(token, depDefinition.scope);
      }
      target[key] = this.resolve(token);
    }
  }

  /** Snapshot of registered tokens — used by the application inspector. */
  tokens(): InjectionToken[] {
    return [...this.#definitions.keys()];
  }
}
